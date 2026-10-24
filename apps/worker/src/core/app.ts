// Builds the Worker's HTTP app. Core never imports modules: they are passed in.
import { Hono } from "hono";
import { isClassicPath, type HealthResponse } from "@assistant/shared";
import type { ModuleDefinition } from "./module.ts";
import type { AppEnv } from "./context.ts";
import { liveOf } from "./live/live-object.ts";
import { AppError } from "./errors.ts";
import { requireUser, userCtxFor } from "./context.ts";
import { spaceOf } from "./spaces/service.ts";
import { getAuth } from "./auth/auth.ts";
import { MCP_PATH, OAUTH_SCOPES } from "./auth/options.ts";
import { issuer, mcpUrl, mcpUserId, resourceMetadataUrl } from "./mcp/auth.ts";
import { handleMcp } from "./mcp/server.ts";
import { toAppError } from "./objects/errors.ts";
import { authRoutes } from "./auth/routes.ts";
import { connectorOperations, connectorRoutes } from "./connectors/operations.ts";
import { adminRoutes } from "./admin/routes.ts";
import { operationContext, registerOperations, type AnyOperation } from "./operations.ts";
import { coreOperations } from "./me.ts";
import { spaceOperations } from "./spaces/operations.ts";
import { shareOperations } from "./spaces/share-operations.ts";
import { workflowOperations } from "./spaces/workflow-operations.ts";
import { searchOperations } from "./search/operations.ts";
import { ruleOperations } from "./spaces/rule-operations.ts";
import { openPublicShare } from "./spaces/shares.ts";
import { PublicShareInput } from "@assistant/shared";
import { assistantOperations } from "./assistant/operations.ts";
import { groupOperations } from "./groups/operations.ts";
import { calendarFeed } from "./calendar/service.ts";
import { resetRoutes, resetting } from "./reset/service.ts";

/** The iPhone app (apps/ios/capacitor.config.ts `appId`). */
const IOS_BUNDLE_ID = "in.gigspree.assistant";

export interface AppOptions {
  modules: readonly ModuleDefinition[];
}

/**
 * A page of the old site (decision 2026-10-22 "The website is the app"): the Expo app's web
 * build is the site's index, so the pages the Svelte site still owns are served from their own
 * index, kept at /classic/index.html by the web build. 404 without the static assets.
 */
async function classicIndex(env: Env, req: Request): Promise<Response> {
  const assets = (env as { ASSETS?: Fetcher }).ASSETS;
  if (!assets) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  url.pathname = "/classic/index.html";
  const res = await assets.fetch(new Request(url, { headers: req.headers }));
  // Never cached as a page: a new deploy must reach the browser on the next open.
  return new Response(res.body, {
    status: res.status,
    headers: { ...Object.fromEntries(res.headers), "cache-control": "no-cache" },
  });
}

export function createApp({ modules }: AppOptions) {
  const ids = modules.map((m) => m.id);
  const userCreated = modules.flatMap((m) => (m.hooks?.userCreated ? [m.hooks.userCreated] : []));
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate module ids: ${ids.join(", ")}`);
  const moduleSchemas = Object.assign({}, ...modules.map((m) => m.schema ?? {}));
  const operations: AnyOperation[] = [
    ...coreOperations,
    ...spaceOperations,
    ...shareOperations,
    ...workflowOperations,
    ...searchOperations,
    ...ruleOperations,
    ...connectorOperations,
    ...modules.flatMap((m) => m.operations ?? []),
  ];
  // The assistant's tools are the operations above.
  operations.push(...assistantOperations(() => operations));
  operations.push(...groupOperations(() => operations));

  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    c.set("moduleIds", ids);
    c.set("userCreated", userCreated);
    c.set("moduleSchemas", moduleSchemas);
    await next();
  });

  // While the "Start over" job runs, the app is closed (see `resetting`): only the reset path
  // and the health check answer.
  app.use(async (c, next) => {
    if (resetting(c.env) && !c.req.path.startsWith("/api/internal/reset") && c.req.path !== "/api/health")
      return c.json(
        { error: { code: "unavailable", message: "The app is being reset. Try again in a few minutes." } },
        503,
      );
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json(err.toJSON(), err.status);
    // Errors thrown inside Durable Objects arrive as plain errors carrying their code.
    const fromObject = toAppError(err);
    if (fromObject) return c.json(fromObject.toJSON(), fromObject.status);
    if (err instanceof RangeError) {
      // Thrown by shared parsers (money, dates) on bad input.
      return c.json({ error: { code: "validation_failed", message: err.message } }, 400);
    }
    if (err instanceof SyntaxError) {
      return c.json(
        { error: { code: "validation_failed", message: "Request body must be valid JSON" } },
        400,
      );
    }
    // A short reference the person can quote; the log line (Workers Logs in the Cloudflare
    // dashboard) carries it with the route and the error, never the request's data.
    const ref = Math.random().toString(36).slice(2, 8);
    console.error(`unhandled error ref=${ref} ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: { code: "internal", message: `Something went wrong (ref ${ref})` } }, 500);
  });

  // The test-phase reset (decision 2026-10-16 "Start over from a GitHub job"): a 404 unless
  // the "Start over" job has set RESET_TOKEN for its own run.
  app.route("/api/internal/reset", resetRoutes(modules));

  app.get("/api/health", async (c) => {
    try {
      const row = await c.env.DB.prepare(`select count(*) as n from d1_migrations`).first<{ n: number }>();
      return c.json<HealthResponse>({
        ok: true,
        environment: c.env.ENVIRONMENT as HealthResponse["environment"],
        modules: ids,
        migrations: row?.n ?? 0,
        auth_secret: !!c.env.BETTER_AUTH_SECRET,
      });
    } catch (err) {
      console.error("health: database check failed", err);
      return c.json({ error: { code: "database_unavailable", message: "Database check failed" } }, 503);
    }
  });

  // The old site's pages, at the addresses they always had (packages/shared site.ts has the
  // list); every other path is the app's, answered by the static index (single-page fallback).
  app.get("*", async (c, next) => {
    if (!isClassicPath(new URL(c.req.url).pathname)) return next();
    return classicIndex(c.env, c.req.raw);
  });
  // The app lived under /app before it became the site: old links still open the same screen.
  app.get("/app/*", (c) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice("/app".length) || "/";
    return c.redirect(url.toString(), 301);
  });
  app.get("/app", (c) => {
    const url = new URL(c.req.url);
    url.pathname = "/";
    return c.redirect(url.toString(), 301);
  });

  // Live updates (decision 2026-09-28): one WebSocket per open app, kept by the person's
  // live object (core/live). Cookies ride along on cross-site WebSocket requests, so the
  // origin must be ours (no cross-site hijacking).
  app.get("/api/live", requireUser, async (c) => {
    if (c.req.header("origin") !== new URL(c.env.BASE_URL).origin)
      throw new AppError("forbidden", "Live updates only from the app itself");
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      return c.json({ error: { code: "upgrade_required", message: "Use a WebSocket" } }, 426);
    return liveOf(c.env, c.get("userCtx").user.id).fetch(c.req.raw);
  });

  // A list or a view as a CSV file for the browser (the same export as the export_csv tool).
  app.get("/api/export/:file", requireUser, async (c) => {
    const file = c.req.param("file");
    if (!file.endsWith(".csv")) return c.text("Not found", 404);
    const q = c.req.query();
    const op = operations.find((o) => o.id === "core.export_csv")!;
    const { stub, actor } = await spaceOf(operationContext(op, c.get("userCtx")), q.space || undefined);
    const out = await stub.exportCsv(actor, {
      collection: decodeURIComponent(file.slice(0, -4)),
      view: q.view || undefined,
      filters: [],
    });
    return c.body(`\uFEFF${out.csv}`, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${out.name.replace(/[^\x20-\x7e]+/g, "_").replace(/"/g, "")}"`,
      "cache-control": "no-store",
    });
  });

  // Private calendar feed (T08): no sign-in, the secret link is the key. 404 for
  // unknown or revoked links, without saying which.
  app.get("/api/calendar/:file", async (c) => {
    const file = c.req.param("file");
    const ics = file.endsWith(".ics") ? await calendarFeed(c.env, modules, file.slice(0, -4)) : null;
    if (ics === null) return c.text("Not found", 404);
    return c.body(ics, 200, {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex",
    });
  });

  // Shared links (e.g. a gig's guest list for its venue): no sign-in, the secret link is
  // the key; handed to the module that owns the token's prefix. 404 for anything invalid.
  const sharedHeaders = {
    "cache-control": "no-store",
    "x-robots-tag": "noindex",
    "referrer-policy": "no-referrer",
  };
  const sharedFor = (token: string) =>
    /^[a-z]{1,8}_[A-Za-z0-9_-]{20,200}$/.test(token)
      ? modules.find((m) => m.sharedLinks?.prefix === token.slice(0, token.indexOf("_")))?.sharedLinks
      : undefined;
  app.get("/api/shared/:token", async (c) => {
    const token = c.req.param("token");
    const data = await sharedFor(token)?.read(c.env, token);
    if (!data)
      return c.json(
        { error: { code: "not_found", message: "This link doesn't work (any more)" } },
        404,
        sharedHeaders,
      );
    return c.json(data, 200, sharedHeaders);
  });
  app.post("/api/shared/:token/:action", async (c) => {
    const token = c.req.param("token");
    const key = c.req.header("idempotency-key") ?? null;
    if (!key || key.length > 200)
      throw new AppError(
        "validation_failed",
        "Writes need an Idempotency-Key header (a unique value per action)",
      );
    const links = sharedFor(token);
    const data = links?.act
      ? await links.act(c.env, token, c.req.param("action"), await c.req.json(), key)
      : null;
    if (!data)
      return c.json(
        { error: { code: "not_found", message: "This link doesn't work (any more)" } },
        404,
        sharedHeaders,
      );
    return c.json(data, 200, sharedHeaders);
  });

  // Link-only views (design §11; forms by link ended 2026-10-12, every write needs a sign-in):
  // the token comes in the body (it sits after # in the link, so it never reaches logs) and the
  // space's object checks it.
  const linkGone = () => new AppError("not_found", "This link doesn't work (any more)");
  app.post("/api/link/open", async (c) => {
    const body = PublicShareInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw linkGone();
    const data = await openPublicShare(c.env, body.data.token, body.data.cursor);
    if (!data) throw linkGone();
    return c.json(data, 200, sharedHeaders);
  });

  // MCP (T10): AI assistants connect with OAuth (consent in the app) and call the
  // operations as tools. Stateless: POST only.
  const mcpUnauthorized = (baseUrl: string, description: string) =>
    new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer error="invalid_token", error_description="${description}", resource_metadata="${resourceMetadataUrl(baseUrl)}"`,
      },
    });
  app.post(MCP_PATH, async (c) => {
    const token = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return mcpUnauthorized(c.env.BASE_URL, "Missing bearer token");
    const userId = await mcpUserId(c.env, c.get("userCreated"), token);
    const user = userId
      ? await c.env.DB.prepare(`select id, name, email, image from "user" where id = ?`)
          .bind(userId)
          .first<{ id: string; name: string; email: string; image: string | null }>()
      : null;
    if (!user) return mcpUnauthorized(c.env.BASE_URL, "Invalid or expired token");
    return handleMcp(c.env, operations, userCtxFor(c.env, moduleSchemas, user, "mcp", null), c.req.raw);
  });
  app.on(
    ["GET", "DELETE"],
    MCP_PATH,
    () => new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } }),
  );
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    app.get(path, async (c) =>
      c.json({
        resource: mcpUrl(c.env.BASE_URL),
        authorization_servers: [await issuer(getAuth({ env: c.env, userCreated: c.get("userCreated") }))],
        scopes_supported: OAUTH_SCOPES,
        bearer_methods_supported: ["header"],
        resource_name: "Gigspree",
      }),
    );
  }

  // Passkeys inside the iPhone app (docs/design/ios-app.md): Apple checks that this site
  // lists the app. Only once the Team ID is set.
  app.get("/.well-known/apple-app-site-association", (c) => {
    const team = c.env.APPLE_TEAM_ID?.trim();
    if (!team || !/^[A-Z0-9]{10}$/.test(team)) return c.notFound();
    return c.json({ webcredentials: { apps: [`${team}.${IOS_BUNDLE_ID}`] } });
  });

  app.route("/", authRoutes);
  app.route("/", adminRoutes(modules));
  app.route("/", connectorRoutes);
  registerOperations(app, operations);

  // Unknown API paths are JSON 404s, never the SPA's index.html.
  app.all("/api/*", (c) =>
    c.json({ error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } }, 404),
  );

  return Object.assign(app, { operations });
}
