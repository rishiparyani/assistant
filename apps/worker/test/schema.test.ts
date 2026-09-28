import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ulid } from "@assistant/shared";
import { seedGig, seedWorkspace } from "./fixtures.ts";

const run = (sql: string, ...params: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...params)
    .run();

describe("migrations", () => {
  it("create every table", async () => {
    const { results } = await env.DB.prepare(
      `select name from sqlite_master where type = 'table' and name not like '\\_%' escape '\\' and name not like 'sqlite_%' and name <> 'd1_migrations' order by name`,
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(
      [
        "account",
        "admin_audit",
        "admins",
        "api_tokens",
        "audit_log",
        "clients",
        "confirm_tokens",
        "expenses",
        "gig_lineup",
        "gigs",
        "idempotency_keys",
        "invitation",
        "jwks",
        "member",
        "musicians",
        "oauthAccessToken",
        "oauthClient",
        "oauthClientAssertion",
        "oauthClientResource",
        "oauthConsent",
        "oauthRefreshToken",
        "oauthResource",
        "passkey",
        "organization",
        "payments",
        "payouts",
        "pending_people",
        "session",
        "tags",
        "user",
        "venues",
        "verification",
        "workspace_modules",
      ].sort(),
    );
  });

  it("default timestamps to UTC ISO strings", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const gigId = await seedGig(workspaceId, userId);
    const row = await env.DB.prepare(`select created_at, status from gigs where id = ?`)
      .bind(gigId)
      .first<{ created_at: string; status: string }>();
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(row?.status).toBe("enquiry");
  });
});

describe("constraints", () => {
  it("rejects an unknown gig status and a negative fee", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const insert = (status: string, fee: number) =>
      run(
        `insert into gigs (id, workspace_id, title, start_at, status, fee_paise, created_by) values (?, ?, 'x', '2026-12-12T00:00:00.000Z', ?, ?, ?)`,
        ulid(),
        workspaceId,
        status,
        fee,
        userId,
      );
    await expect(insert("maybe", 0)).rejects.toThrow(/CHECK/);
    await expect(insert("confirmed", -1)).rejects.toThrow(/CHECK/);
    await expect(insert("confirmed", 100)).resolves.toBeTruthy();
  });

  it("keeps payments append-only in shape: positive payments, negative reversals, one reversal each", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const gigId = await seedGig(workspaceId, userId);
    const pay = (amount: number, reverses: string | null, paidOn = "2026-12-12", method = "upi") => {
      const id = ulid();
      return run(
        `insert into payments (id, workspace_id, gig_id, amount_paise, paid_on, method, reverses_payment_id, created_by) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        workspaceId,
        gigId,
        amount,
        paidOn,
        method,
        reverses,
        userId,
      ).then(() => id);
    };
    const first = await pay(2_000_000, null);
    await expect(pay(-2_000_000, null)).rejects.toThrow(/CHECK/); // negative without a reversal link
    await expect(pay(2_000_000, first)).rejects.toThrow(/CHECK/); // positive reversal
    await expect(pay(0, null)).rejects.toThrow(/CHECK/);
    await expect(pay(100, null, "12/12/2026")).rejects.toThrow(/CHECK/);
    await expect(pay(100, null, "2026-12-12", "gold")).rejects.toThrow(/CHECK/);
    await pay(-2_000_000, first);
    await expect(pay(-2_000_000, first)).rejects.toThrow(/UNIQUE/); // reversed twice
  });

  it("allows each musician once per gig lineup", async () => {
    const { userId, workspaceId } = await seedWorkspace();
    const gigId = await seedGig(workspaceId, userId);
    const musicianId = ulid();
    await run(
      `insert into musicians (id, workspace_id, name) values (?, ?, 'Test Drummer')`,
      musicianId,
      workspaceId,
    );
    const add = () =>
      run(
        `insert into gig_lineup (id, workspace_id, gig_id, musician_id, share_paise) values (?, ?, ?, ?, 1000000)`,
        ulid(),
        workspaceId,
        gigId,
        musicianId,
      );
    await add();
    await expect(add()).rejects.toThrow(/UNIQUE/);
  });

  it("enforces foreign keys", async () => {
    await expect(
      run(
        `insert into clients (id, workspace_id, name) values (?, 'no-such-workspace', 'Test Client')`,
        ulid(),
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("indexes", () => {
  // D1 bills rows scanned: the hot queries must use an index, never a full scan.
  it.each([
    [
      `select * from gigs where workspace_id = ? and start_at >= ? order by start_at`,
      "gigs_workspace_start_idx",
    ],
    [`select * from gigs where workspace_id = ? and status = ?`, "gigs_workspace_status_idx"],
    [`select * from gigs where workspace_id = ? and client_id = ?`, "gigs_workspace_client_idx"],
    [
      `select sum(amount_paise) from payments where workspace_id = ? and gig_id = ?`,
      "payments_workspace_gig_idx",
    ],
    [
      `select * from payments where workspace_id = ? and paid_on between ? and ?`,
      "payments_workspace_paid_on_idx",
    ],
    [
      `select * from expenses where workspace_id = ? and spent_on between ? and ?`,
      "expenses_workspace_spent_on_idx",
    ],
    [`select * from clients where workspace_id = ? and name like ?`, "clients_workspace_name_idx"],
    [`select * from gig_lineup where workspace_id = ? and gig_id = ?`, "gig_lineup_workspace_gig_idx"],
    [
      `select sum(amount_paise) from payouts where workspace_id = ? and musician_id = ?`,
      "payouts_workspace_musician_idx",
    ],
    [
      `select * from audit_log where workspace_id = ? order by created_at desc`,
      "audit_log_workspace_created_idx",
    ],
    [`select * from member where userId = ?`, "member_userId_idx"],
  ])("%s uses %s", async (query, indexName) => {
    const params = (query.match(/\?/g) ?? []).map(() => "x");
    const { results } = await env.DB.prepare(`explain query plan ${query}`)
      .bind(...params)
      .all<{ detail: string }>();
    const plan = results.map((r) => r.detail).join(" | ");
    expect(plan).toContain(indexName);
    expect(plan).not.toMatch(
      /\bSCAN (gigs|payments|expenses|clients|gig_lineup|payouts|audit_log|member)\b(?! USING)/,
    );
  });
});
