// The owner-only admin panel (docs/design/gig-centric.md §10b). Owners come from the
// ADMIN_EMAILS binding in vitest.config.ts. Fake data only.
import { describe, expect, it } from "vitest";
import { call, json, signUp } from "./http.ts";

const OWNER = "owner.admin@example.com";
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** Signs in as the owner (signing up the first time; tests in a file share one database). */
async function owner() {
  const body = { name: "Test Owner", email: OWNER, password: "test-password-123" };
  const up = await call("/auth/sign-up/email", { body });
  if (up.status === 200) return cookieOf(up);
  return cookieOf(await call("/auth/sign-in/email", { body: { email: OWNER, password: body.password } }));
}

const isAdmin = async (cookie: string) =>
  (await json<{ is_admin: boolean }>(await call("/api/admin/me", { cookie }))).is_admin;

type Overview = {
  sections: { title: string; stats: { label: string; value: string | number }[] }[];
  tools: { id: string }[];
};

describe("admin panel", () => {
  it("is invisible to everyone except owners (matched case-insensitively)", async () => {
    const someone = await signUp();
    expect(await isAdmin(someone.cookie)).toBe(false);
    expect((await call("/api/admin/overview", { cookie: someone.cookie })).status).toBe(404);
    expect((await call("/api/admin/overview")).status).toBe(401);
    // vitest.config.ts lists "Owner.Admin@example.com".
    expect(await isAdmin(await owner())).toBe(true);
  });

  it("shows counts only, and the tools", async () => {
    await signUp();
    const o = await json<Overview>(await call("/api/admin/overview", { cookie: await owner() }));
    expect(o.sections.map((s) => s.title)).toEqual(["People", "Assistant (AI)", "Gigs", "Delivery (outbox → queue)"]);
    const people = o.sections[0]!.stats;
    expect(people.find((s) => s.label === "Accounts")!.value).toBeGreaterThanOrEqual(2);
    expect(people.find((s) => s.label === "New this week")!.value).toBeGreaterThanOrEqual(2);
    expect(o.tools.map((t) => t.id)).toEqual(["gigs.retry_dead", "gigs.flush", "gigs.rebuild"]);
    expect(JSON.stringify(o)).not.toContain("@example.com"); // nothing identifying anyone
  });

  it("says per-action numbers need the analytics token, and hides them from others", async () => {
    const someone = await signUp();
    expect((await call("/api/admin/operations", { cookie: someone.cookie })).status).toBe(404);
    const res = await call("/api/admin/operations", { cookie: await owner() });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ available: false, operations: [] });
  });

  it("lets admins add and remove admins, but never the owners", async () => {
    const boss = await owner();
    const helper = await signUp("Test Helper");
    const added = await json<{ owners: string[]; admins: { email: string }[] }>(
      await call("/api/admin/admins", { cookie: boss, body: { email: helper.email.toUpperCase() } }),
    );
    expect(added.owners).toEqual([OWNER, "second.owner@example.com"]);
    expect(added.admins.map((a) => a.email)).toContain(helper.email);
    expect(await isAdmin(helper.cookie)).toBe(true);

    // The helper can't remove an owner.
    const res = await call(`/api/admin/admins/${encodeURIComponent(OWNER)}`, {
      method: "DELETE",
      cookie: helper.cookie,
    });
    expect(res.status).toBe(409);

    await call(`/api/admin/admins/${encodeURIComponent(helper.email)}`, { method: "DELETE", cookie: boss });
    expect(await isAdmin(helper.cookie)).toBe(false);
    expect((await call("/api/admin/admins", { cookie: boss, body: { email: "not-an-email" } })).status).toBe(
      400,
    );

    const log = await json<{ action: string }[]>(await call("/api/admin/log", { cookie: boss }));
    expect(log.map((l) => l.action).slice(0, 2)).toEqual(["remove_admin", "add_admin"]);
  });

  it("runs the delivery tools, checks input, and records them", async () => {
    const someone = await signUp();
    expect((await call("/api/admin/tools/gigs.flush", { cookie: someone.cookie, body: {} })).status).toBe(
      404,
    );

    const boss = await owner();
    const flush = await json<{ result: string }>(
      await call("/api/admin/tools/gigs.flush", { cookie: boss, body: {} }),
    );
    expect(flush.result).toMatch(/^Asked \d+ gigs? to send their updates\.$/);
    const bad = await call("/api/admin/tools/gigs.rebuild", { cookie: boss, body: { from: "2026-13" } });
    expect(bad.status).toBe(400);
    const ok = await json<{ result: string }>(
      await call("/api/admin/tools/gigs.rebuild", { cookie: boss, body: { from: "2026-01", to: "2026-02" } }),
    );
    expect(ok.result).toMatch(/^Rebuilt summaries for \d+ gigs?/);
    expect((await call("/api/admin/tools/nope.nope", { cookie: boss, body: {} })).status).toBe(404);
    const log = await json<{ action: string }[]>(await call("/api/admin/log", { cookie: boss }));
    expect(log[0]!.action).toBe("tool:gigs.rebuild");
  });
});
