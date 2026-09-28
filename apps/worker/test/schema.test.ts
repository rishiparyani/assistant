// The D1 schema after workspaces were retired (R1 step 7): identity, admin, the tag
// registry and people waiting for an account. Gigs live in Durable Objects.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ulid } from "@assistant/shared";

const run = (sql: string, ...params: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...params)
    .run();

describe("migrations", () => {
  it("leave exactly the tables in use", async () => {
    const { results } = await env.DB.prepare(
      `select name from sqlite_master where type = 'table' and name not like '\\_%' escape '\\' and name not like 'sqlite_%' and name <> 'd1_migrations' order by name`,
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(
      [
        "account",
        "admin_audit",
        "admins",
        "jwks",
        "oauthAccessToken",
        "oauthClient",
        "oauthClientAssertion",
        "oauthClientResource",
        "oauthConsent",
        "oauthRefreshToken",
        "oauthResource",
        "passkey",
        "pending_people",
        "session",
        "tags",
        "user",
        "verification",
      ].sort(),
    );
  });

  it("default timestamps to UTC ISO strings", async () => {
    const id = ulid();
    await run(
      `insert into tags (id, kind, name, name_key) values (?, 'custom', 'Test Tag', ?)`,
      id,
      `test-${id}`,
    );
    const row = await env.DB.prepare(`select created_at from tags where id = ?`)
      .bind(id)
      .first<{ created_at: string }>();
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("constraints", () => {
  it("keep one tag per kind and name, and only known kinds", async () => {
    const key = `test-unique-${ulid()}`;
    await run(`insert into tags (id, kind, name, name_key) values (?, 'custom', 'A', ?)`, ulid(), key);
    await expect(
      run(`insert into tags (id, kind, name, name_key) values (?, 'custom', 'a', ?)`, ulid(), key),
    ).rejects.toThrow(/UNIQUE/);
    await expect(
      run(`insert into tags (id, kind, name, name_key) values (?, 'collective', 'A', ?)`, ulid(), key),
    ).resolves.toBeTruthy();
    await expect(
      run(`insert into tags (id, kind, name, name_key) values (?, 'band', 'A', ?)`, ulid(), `${key}-2`),
    ).rejects.toThrow(/CHECK/);
  });

  it("enforces foreign keys", async () => {
    await expect(
      run(
        `insert into tags (id, kind, name, name_key, created_by) values (?, 'custom', 'x', ?, 'no-such-user')`,
        ulid(),
        `test-fk-${ulid()}`,
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("indexes", () => {
  // D1 bills rows scanned: the hot queries must use an index, never a full scan.
  it.each([
    [`select * from tags where kind = ? and name_key in (?, ?)`, "tags_kind_name_uidx"],
    [`select gig_id, person_id from pending_people where email = ?`, "pending_people_email_person_uidx"],
    [`select * from admin_audit order by created_at desc limit 50`, "admin_audit_created_idx"],
    [`select count(*) from "user" where createdAt >= ?`, "user_createdAt_idx"],
  ])("%s uses %s", async (query, indexName) => {
    const params = (query.match(/\?/g) ?? []).map(() => "x");
    const { results } = await env.DB.prepare(`explain query plan ${query}`)
      .bind(...params)
      .all<{ detail: string }>();
    const plan = results.map((r) => r.detail).join(" | ");
    expect(plan).toContain(indexName);
  });
});
