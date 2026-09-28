// Builds the Worker's HTTP app. Core never imports modules: they are passed in.
import { Hono } from "hono";
import type { HealthResponse } from "@assistant/shared";
import type { ModuleDefinition } from "./module.ts";
import type { AppEnv } from "./context.ts";
import { AppError } from "./errors.ts";
import { requireUser } from "./context.ts";
import { toAppError } from "./objects/errors.ts";
import { authRoutes } from "./auth/routes.ts";
import { adminRoutes } from "./admin/routes.ts";
import { registerOperations, type AnyOperation } from "./operations.ts";
import { coreOperations } from "./me.ts";
import { calendarFeed } from "./calendar/service.ts";

export interface AppOptions {
  modules: readonly ModuleDefinition[];
}

export function createApp({ modules }: AppOptions) {
  const ids = modules.map((m) => m.id);
  const userCreated = modules.flatMap((m) => (m.hooks?.userCreated ? [m.hooks.userCreated] : []));
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate module ids: ${ids.join(", ")}`);
  const moduleSchemas = Object.assign({}, ...modules.map((m) => m.schema ?? {}));
  const operations: AnyOperation[] = [...coreOperations, ...modules.flatMap((m) => m.operations ?? [])];

  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    c.set("moduleIds", ids);
    c.set("userCreated", userCreated);
    c.set("moduleSchemas", moduleSchemas);
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
    console.error("unhandled error", err);
    return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
  });

  app.get("/api/health", async (c) => {
    try {
      const row = await c.env.DB.prepare(`select count(*) as n from d1_migrations`).first<{ n: number }>();
      return c.json<HealthResponse>({
        ok: true,
        environment: c.env.ENVIRONMENT as HealthResponse["environment"],
        modules: ids,
        migrations: row?.n ?? 0,
      });
    } catch (err) {
      console.error("health: database check failed", err);
      return c.json({ error: { code: "database_unavailable", message: "Database check failed" } }, 503);
    }
  });

  // Live updates (decision 2026-09-28): one WebSocket per open app, handed to the module
  // that owns them. Cookies ride along on cross-site WebSocket requests, so the origin
  // must be ours (no cross-site hijacking).
  const live = modules.find((m) => m.live)?.live;
  app.get("/api/live", requireUser, async (c) => {
    if (!live) throw new AppError("not_found", "Live updates aren't available");
    if (c.req.header("origin") !== new URL(c.env.BASE_URL).origin)
      throw new AppError("forbidden", "Live updates only from the app itself");
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      return c.json({ error: { code: "upgrade_required", message: "Use a WebSocket" } }, 426);
    return live(c.env, c.get("userCtx").user.id, c.req.raw);
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

  app.route("/", authRoutes);
  app.route("/", adminRoutes(modules));
  registerOperations(app, operations);

  // Unknown API paths are JSON 404s, never the SPA's index.html.
  app.all("/api/*", (c) =>
    c.json({ error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } }, 404),
  );

  return Object.assign(app, { operations });
}
