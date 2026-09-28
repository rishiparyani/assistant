// Builds the Worker's HTTP app. Core never imports modules: they are passed in.
import { Hono } from "hono";
import type { HealthResponse } from "@assistant/shared";
import type { ModuleDefinition } from "./module.ts";
import type { AppEnv } from "./context.ts";
import { AppError } from "./errors.ts";
import { toAppError } from "./objects/errors.ts";
import { authRoutes } from "./auth/routes.ts";
import { adminRoutes } from "./admin/routes.ts";
import { registerOperations, type AnyOperation } from "./operations.ts";
import { workspaceOperations } from "./workspaces/operations.ts";

export interface AppOptions {
  modules: readonly ModuleDefinition[];
}

export function createApp({ modules }: AppOptions) {
  const ids = modules.map((m) => m.id);
  const userCreated = modules.flatMap((m) => (m.hooks?.userCreated ? [m.hooks.userCreated] : []));
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate module ids: ${ids.join(", ")}`);
  const moduleSchemas = Object.assign({}, ...modules.map((m) => m.schema ?? {}));
  const operations: AnyOperation[] = [
    ...workspaceOperations(
      ids,
      modules.map((m) => m.hooks ?? {}),
    ),
    ...modules.flatMap((m) => m.operations ?? []),
  ];

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

  app.route("/", authRoutes);
  app.route("/", adminRoutes(modules));
  registerOperations(app, operations);

  // Unknown API paths are JSON 404s, never the SPA's index.html.
  app.all("/api/*", (c) =>
    c.json({ error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } }, 404),
  );

  return Object.assign(app, { operations });
}
