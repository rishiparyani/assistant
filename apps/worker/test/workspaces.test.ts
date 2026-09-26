import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import type { InvitationView, MeResponse, WorkspaceDetail, WorkspaceSummary } from "@assistant/shared";
import { requireUser, requireWorkspace, type AppEnv } from "../src/core/context.ts";
import { AppError } from "../src/core/errors.ts";
import { call, json, signUp } from "./http.ts";

async function createBand(cookie: string, name = "Test Band") {
  const res = await call("/api/workspaces", { cookie, body: { name } });
  expect(res.status).toBe(201);
  return json<WorkspaceSummary>(res);
}

async function auditActions(workspaceId: string) {
  const { results } = await env.DB.prepare(
    `select action, source from audit_log where workspace_id = ? order by id`,
  )
    .bind(workspaceId)
    .all<{ action: string; source: string }>();
  return results.map((r) => `${r.action}:${r.source}`);
}

describe("sign-up", () => {
  it("creates a personal workspace with every module enabled", async () => {
    const u = await signUp("Test Musician");
    const me = await json<MeResponse>(await call("/api/me", { cookie: u.cookie }));
    expect(me.user.email).toBe(u.email);
    expect(me.workspaces).toHaveLength(1);
    const [personal] = me.workspaces;
    expect(personal).toMatchObject({ kind: "personal", role: "owner", name: "Test Musician (personal)" });
    const detail = await json<WorkspaceDetail>(await call(`/api/w/${personal!.id}`, { cookie: u.cookie }));
    expect(detail.modules).toEqual(["gigs"]);
    expect(await auditActions(personal!.id)).toEqual(["create_workspace:system"]);
  });

  it("uses ULIDs for Better Auth ids", async () => {
    const u = await signUp();
    expect(u.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe("authentication", () => {
  it("rejects API calls without a session", async () => {
    const res = await call("/api/me");
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("blocks Better Auth's own organization and OAuth-admin endpoints", async () => {
    const u = await signUp();
    for (const path of [
      "/auth/organization/create",
      "/auth/organization/list",
      "/auth/oauth2/get-clients",
      "/auth/admin/oauth2/resources",
    ]) {
      const res = await call(path, { cookie: u.cookie, body: { name: "x", slug: "x" } });
      expect(res.status, path).toBe(404);
    }
    // Sign-in related endpoints still work.
    expect((await call("/auth/get-session", { cookie: u.cookie })).status).toBe(200);
  });
});

describe("band workspaces", () => {
  it("lets any user create one and become its owner", async () => {
    const u = await signUp();
    const band = await createBand(u.cookie, "  The Test Band  ");
    expect(band).toMatchObject({ name: "The Test Band", kind: "band", role: "owner" });
    const me = await json<MeResponse>(await call("/api/me", { cookie: u.cookie }));
    expect(me.workspaces.map((w) => w.kind)).toEqual(["personal", "band"]);
    expect(await auditActions(band.id)).toEqual(["create_band_workspace:web"]);
  });

  it("validates input", async () => {
    const u = await signUp();
    const res = await call("/api/workspaces", { cookie: u.cookie, body: { name: "  " } });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({
      error: { code: "validation_failed", details: { issues: [{ path: "name" }] } },
    });
    const bad = await call("/api/workspaces", { cookie: u.cookie, raw: "{not json" });
    expect(bad.status).toBe(400);
  });
});

describe("workspace isolation", () => {
  it("hides other people's workspaces completely", async () => {
    const owner = await signUp("Test Owner");
    const stranger = await signUp("Test Stranger");
    const band = await createBand(owner.cookie);
    const ownerMe = await json<MeResponse>(await call("/api/me", { cookie: owner.cookie }));
    const personal = ownerMe.workspaces.find((w) => w.kind === "personal")!;

    for (const id of [band.id, personal.id, "01JUNKJUNKJUNKJUNKJUNKJUNK"]) {
      expect((await call(`/api/w/${id}`, { cookie: stranger.cookie })).status).toBe(404);
      const invite = await call(`/api/w/${id}/invitations`, {
        cookie: stranger.cookie,
        body: { email: stranger.email },
      });
      expect(invite.status).toBe(404);
    }
    const detail = await json<WorkspaceDetail>(await call(`/api/w/${band.id}`, { cookie: owner.cookie }));
    const ownerMemberId = detail.members[0]!.id;
    const removal = await call(`/api/w/${band.id}/members/${ownerMemberId}`, {
      method: "DELETE",
      cookie: stranger.cookie,
    });
    expect(removal.status).toBe(404);
    const strangerMe = await json<MeResponse>(await call("/api/me", { cookie: stranger.cookie }));
    expect(strangerMe.workspaces.map((w) => w.id)).not.toContain(band.id);
  });
});

describe("invitations and roles", () => {
  it("runs the invite → accept → remove flow with roles enforced", async () => {
    const owner = await signUp("Test Owner");
    const bandmate = await signUp("Test Bandmate");
    const other = await signUp("Test Other");
    const band = await createBand(owner.cookie);

    const inviteRes = await call(`/api/w/${band.id}/invitations`, {
      cookie: owner.cookie,
      body: { email: bandmate.email.toUpperCase() },
    });
    expect(inviteRes.status).toBe(201);
    const invite = await json<InvitationView>(inviteRes);
    expect(invite).toMatchObject({
      email: bandmate.email,
      role: "member",
      status: "pending",
      workspace_name: "Test Band",
    });
    expect(invite.url).toBe(`http://localhost:8787/invite/${invite.id}`);

    // Only the invited email can see or accept it.
    expect((await call(`/api/invitations/${invite.id}`, { cookie: other.cookie })).status).toBe(404);
    expect(
      (await call(`/api/invitations/${invite.id}/accept`, { cookie: other.cookie, body: {} })).status,
    ).toBe(404);
    expect(
      await json(await call(`/api/invitations/${invite.id}`, { cookie: bandmate.cookie })),
    ).toMatchObject({ status: "pending" });

    const accepted = await call(`/api/invitations/${invite.id}/accept`, {
      cookie: bandmate.cookie,
      body: {},
    });
    expect(accepted.status).toBe(200);
    expect(await json(accepted)).toMatchObject({ id: band.id, role: "member" });
    // Accepting twice is a conflict, not a second membership.
    expect(
      (await call(`/api/invitations/${invite.id}/accept`, { cookie: bandmate.cookie, body: {} })).status,
    ).toBe(409);

    // The bandmate can read the workspace but not manage it, and doesn't see invitations.
    const asMember = await json<WorkspaceDetail>(
      await call(`/api/w/${band.id}`, { cookie: bandmate.cookie }),
    );
    expect(asMember.role).toBe("member");
    expect(asMember.members.map((m) => m.role).sort()).toEqual(["member", "owner"]);
    expect(asMember.invitations).toEqual([]);
    const memberInvite = await call(`/api/w/${band.id}/invitations`, {
      cookie: bandmate.cookie,
      body: { email: other.email },
    });
    expect(memberInvite.status).toBe(403);
    const ownerMember = asMember.members.find((m) => m.role === "owner")!;
    expect(
      (
        await call(`/api/w/${band.id}/members/${ownerMember.id}`, {
          method: "DELETE",
          cookie: bandmate.cookie,
        })
      ).status,
    ).toBe(403);

    // Inviting an existing member is a conflict.
    expect(
      (await call(`/api/w/${band.id}/invitations`, { cookie: owner.cookie, body: { email: bandmate.email } }))
        .status,
    ).toBe(409);

    // The last owner can't be removed; the bandmate can.
    expect(
      (await call(`/api/w/${band.id}/members/${ownerMember.id}`, { method: "DELETE", cookie: owner.cookie }))
        .status,
    ).toBe(409);
    const bandmateMember = asMember.members.find((m) => m.role === "member")!;
    expect(
      (
        await call(`/api/w/${band.id}/members/${bandmateMember.id}`, {
          method: "DELETE",
          cookie: owner.cookie,
        })
      ).status,
    ).toBe(200);
    expect((await call(`/api/w/${band.id}`, { cookie: bandmate.cookie })).status).toBe(404);

    expect(await auditActions(band.id)).toEqual([
      "create_band_workspace:web",
      "invite_member:web",
      "accept_invitation:web",
      "remove_member:web",
    ]);
  });

  it("re-inviting replaces the pending invitation, and owners can cancel one", async () => {
    const owner = await signUp();
    const band = await createBand(owner.cookie);
    const email = "someone@example.com";
    const first = await json<InvitationView>(
      await call(`/api/w/${band.id}/invitations`, { cookie: owner.cookie, body: { email } }),
    );
    const second = await json<InvitationView>(
      await call(`/api/w/${band.id}/invitations`, { cookie: owner.cookie, body: { email } }),
    );
    let detail = await json<WorkspaceDetail>(await call(`/api/w/${band.id}`, { cookie: owner.cookie }));
    expect(detail.invitations.map((i) => i.id)).toEqual([second.id]);
    expect(first.id).not.toBe(second.id);
    expect(
      (await call(`/api/w/${band.id}/invitations/${second.id}`, { method: "DELETE", cookie: owner.cookie }))
        .status,
    ).toBe(200);
    detail = await json<WorkspaceDetail>(await call(`/api/w/${band.id}`, { cookie: owner.cookie }));
    expect(detail.invitations).toEqual([]);
  });

  it("rejects expired invitations", async () => {
    const owner = await signUp();
    const invitee = await signUp();
    const band = await createBand(owner.cookie);
    const invite = await json<InvitationView>(
      await call(`/api/w/${band.id}/invitations`, { cookie: owner.cookie, body: { email: invitee.email } }),
    );
    await env.DB.prepare(`update invitation set expiresAt = '2000-01-01T00:00:00.000Z' where id = ?`)
      .bind(invite.id)
      .run();
    expect(await json(await call(`/api/invitations/${invite.id}`, { cookie: invitee.cookie }))).toMatchObject(
      { status: "expired" },
    );
    expect(
      (await call(`/api/invitations/${invite.id}/accept`, { cookie: invitee.cookie, body: {} })).status,
    ).toBe(409);
  });

  it("doesn't allow members in personal workspaces", async () => {
    const u = await signUp();
    const me = await json<MeResponse>(await call("/api/me", { cookie: u.cookie }));
    const res = await call(`/api/w/${me.workspaces[0]!.id}/invitations`, {
      cookie: u.cookie,
      body: { email: "x@example.com" },
    });
    expect(res.status).toBe(400);
  });
});

describe("module check", () => {
  // A throwaway route guarded like module routes will be (T04+).
  const app = new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set("moduleIds", ["gigs"]);
      c.set("moduleSchemas", {});
      await next();
    })
    .get("/api/w/:workspaceId/gigs-only", requireUser, requireWorkspace({ module: "gigs" }), (c) =>
      c.json({ ok: true }),
    )
    .onError((err, c) => (err instanceof AppError ? c.json(err.toJSON(), err.status) : c.json({}, 500)));

  it("blocks workspaces that don't have the module enabled", async () => {
    const u = await signUp();
    const band = await createBand(u.cookie);
    const req = () =>
      app.request(
        `/api/w/${band.id}/gigs-only`,
        { headers: { cookie: u.cookie, origin: "http://localhost:8787" } },
        env,
      );
    expect((await req()).status).toBe(200);
    await env.DB.prepare(`update workspace_modules set enabled = 0 where workspace_id = ?`)
      .bind(band.id)
      .run();
    expect((await req()).status).toBe(403);
  });
});
