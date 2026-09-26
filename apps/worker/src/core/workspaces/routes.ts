// Thin HTTP adapters over the workspace services. T04 moves these onto the operation
// registry (which adds idempotency keys); behaviour stays the same.
import { Hono } from "hono";
import type { MeResponse } from "@assistant/shared";
import { requireUser, requireWorkspace, type AppEnv } from "../context.ts";
import * as workspaces from "./service.ts";

export const workspaceRoutes = new Hono<AppEnv>()
  .use("/api/me", requireUser)
  .use("/api/me/*", requireUser)
  .use("/api/workspaces", requireUser)
  .use("/api/w/*", requireUser)
  .use("/api/invitations/*", requireUser)

  .get("/api/me", async (c) => {
    const ctx = c.get("userCtx");
    return c.json<MeResponse>({ user: ctx.user, workspaces: await workspaces.listWorkspaces(ctx) });
  })
  .post("/api/workspaces", async (c) => {
    const ws = await workspaces.createBandWorkspace(c.get("userCtx"), await c.req.json(), c.get("moduleIds"));
    return c.json(ws, 201);
  })
  .get("/api/w/:workspaceId", requireWorkspace(), async (c) =>
    c.json(await workspaces.getWorkspaceDetail(c.get("ctx"))),
  )
  .post("/api/w/:workspaceId/invitations", requireWorkspace({ role: "owner" }), async (c) =>
    c.json(await workspaces.inviteMember(c.get("ctx"), await c.req.json()), 201),
  )
  .delete("/api/w/:workspaceId/invitations/:invitationId", requireWorkspace({ role: "owner" }), async (c) => {
    await workspaces.cancelInvitation(c.get("ctx"), c.req.param("invitationId"));
    return c.body(null, 204);
  })
  .delete("/api/w/:workspaceId/members/:memberId", requireWorkspace({ role: "owner" }), async (c) => {
    await workspaces.removeMember(c.get("ctx"), c.req.param("memberId"));
    return c.body(null, 204);
  })
  .get("/api/invitations/:invitationId", async (c) =>
    c.json(await workspaces.getInvitation(c.get("userCtx"), c.req.param("invitationId"))),
  )
  .post("/api/invitations/:invitationId/accept", async (c) =>
    c.json(await workspaces.acceptInvitation(c.get("userCtx"), c.req.param("invitationId"))),
  );
