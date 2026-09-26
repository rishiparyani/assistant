// Builds the Worker's HTTP app. Core never imports modules: they are passed in.
import { Hono } from "hono";
import type { HealthResponse } from "@assistant/shared";
import type { ModuleDefinition } from "./module.ts";

export interface AppOptions {
  modules: readonly ModuleDefinition[];
}

export function createApp({ modules }: AppOptions) {
  const ids = modules.map((m) => m.id);
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate module ids: ${ids.join(", ")}`);

  const app = new Hono<{ Bindings: Env }>();

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

  // Unknown API paths are JSON 404s, never the SPA's index.html.
  app.all("/api/*", (c) =>
    c.json({ error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } }, 404),
  );

  return app;
}
