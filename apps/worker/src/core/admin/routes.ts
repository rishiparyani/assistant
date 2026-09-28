// Admin panel routes (owner-only). Not operations: they're never MCP tools or Siri
// actions. Everyone who isn't an admin gets 404, so the panel's existence isn't revealed.
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { ModuleDefinition } from "../module.ts";
import { objectBindings, requireUser, type AppEnv } from "../context.ts";
import { AppError } from "../errors.ts";
import * as admin from "./service.ts";

const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await admin.isAdmin(c.env, c.get("userCtx").user.email)))
    throw new AppError("not_found", "Not found");
  await next();
});

export function adminRoutes(modules: readonly ModuleDefinition[]) {
  const r = new Hono<AppEnv>();
  const ctxOf = (env: Env) => ({ d1: env.DB, objects: objectBindings(env) });

  // Anyone signed in may ask whether they're an admin (the app shows the link only then).
  r.get("/api/admin/me", requireUser, async (c) =>
    c.json({ is_admin: await admin.isAdmin(c.env, c.get("userCtx").user.email) }),
  );

  r.use("/api/admin/*", requireUser, requireAdmin);
  r.get("/api/admin/overview", async (c) => c.json(await admin.overview(ctxOf(c.env), modules)));
  r.get("/api/admin/admins", async (c) => c.json(await admin.listAdmins(c.env)));
  r.post("/api/admin/admins", async (c) => {
    const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
    return c.json(await admin.addAdmin(c.env, c.get("userCtx").user.id, body.email ?? ""));
  });
  r.delete("/api/admin/admins/:email", async (c) =>
    c.json(await admin.removeAdmin(c.env, c.get("userCtx").user.id, c.req.param("email"))),
  );
  r.post("/api/admin/tools/:tool", async (c) => {
    const body = await c.req.json<Record<string, string>>().catch(() => ({}));
    return c.json(
      await admin.runTool(ctxOf(c.env), modules, c.get("userCtx").user.id, c.req.param("tool"), body),
    );
  });
  r.get("/api/admin/log", async (c) => c.json(await admin.adminLog(c.env)));
  return r;
}
