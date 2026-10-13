// Nightly backups to Google Drive (fake Drive here) and restore. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { BookingView } from "@assistant/shared";
import type { DriveClient } from "../src/core/backup/drive.ts";
import {
  buildBackup,
  gunzip,
  restoreBackup,
  runBackup,
  type BackupFile,
} from "../src/core/backup/service.ts";
import { decryptSecret, encryptSecret } from "../src/core/crypto.ts";
import { modules } from "../src/modules/index.ts";
import { call, json, signUp } from "./http.ts";

function fakeDrive(existing = 0) {
  const files: { id: string; name: string; createdTime: string; data?: Uint8Array }[] = [];
  for (let i = 0; i < existing; i++)
    files.push({
      id: `old-${i}`,
      name: `assistant-test-old-${i}.json.gz`,
      createdTime: new Date(2026, 0, 1 + i).toISOString(),
    });
  const drive: DriveClient = {
    ensureFolder: async () => "folder-1",
    upload: async (_folder, name, data) => {
      files.push({ id: `f-${files.length}`, name, createdTime: new Date().toISOString(), data });
      return { id: `f-${files.length}` };
    },
    list: async () => [...files].sort((a, b) => b.createdTime.localeCompare(a.createdTime)),
    remove: async (id) => {
      files.splice(
        files.findIndex((f) => f.id === id),
        1,
      );
    },
    download: async (id) => files.find((f) => f.id === id)!.data!,
  };
  return { drive, files };
}

describe("backups", () => {
  it("upload one compressed file with every gig and no sign-in secrets, keeping the newest 60", async () => {
    const owner = await signUp("Test Owner");
    const gig = await json<BookingView>(
      await call("/api/gigs", {
        cookie: owner.cookie,
        body: { title: "Test Backed Up", fee: 5000, events: [{ start_at: "2027-05-01T19:00" }] },
      }),
    );
    await call(`/api/gigs/${gig.id}/payments`, {
      cookie: owner.cookie,
      body: { amount: 1000, method: "upi" },
    });
    // The gig registers in its creation month on its first delivery.
    await new Promise((r) => setTimeout(r, 1500));

    const { drive, files } = fakeDrive(60);
    const status = await runBackup(env, modules, drive);
    expect(status).toMatchObject({ ok: true, file: expect.stringMatching(/^assistant-.*\.json\.gz$/) });
    expect(files).toHaveLength(60); // the oldest one went
    const uploaded = files.find((f) => f.data)!;
    const file = JSON.parse(await gunzip(uploaded.data!)) as BackupFile;
    expect(file.format).toBe("assistant-backup/v1");
    expect(file.d1.user!.some((u) => u.id === owner.id)).toBe(true);
    expect(file.d1.account!.every((a) => a.password === null && a.accessToken === null)).toBe(true);
    const dump = (file.modules.gigs as { gigs: Record<string, { tables: Record<string, unknown[]> }> }).gigs[
      gig.id
    ]!;
    expect(dump.tables.gig).toHaveLength(1);
    expect(dump.tables.payments).toHaveLength(1);
    expect(dump.tables._idempotency).toBeUndefined();

    // Restore brings back a gig that's gone (here: the same gig under a fresh id).
    const lost = `${gig.id.slice(0, -4)}ZZZZ`;
    const copy: BackupFile = { ...file, modules: { gigs: { gigs: { [lost]: dump } } } };
    const result = await restoreBackup(env, modules, copy);
    expect(result.modules.gigs).toBe(1);
    const back = await json<BookingView>(await call(`/api/gigs/${lost}`, { cookie: owner.cookie }));
    expect(back.money.received!.amount_display).toBe("₹1,000");
    // Restoring again changes nothing.
    expect((await restoreBackup(env, modules, copy)).modules.gigs).toBe(0);
  });

  it("keeps lists, chats and group chats too, and restores them into empty objects", async () => {
    const owner = await signUp("Test Owner");
    await call("/api/collections/Notes/records", {
      cookie: owner.cookie,
      body: { values: { Title: "Test kept note" } },
    });
    await call("/api/chat", { cookie: owner.cookie, body: { text: "Hello" } });
    const group = await json<{ id: string }>(
      await call("/api/groups", {
        cookie: owner.cookie,
        body: { id: "01J0000000000000000000BAND", name: "Test Band" },
      }),
    );
    const file = await buildBackup(env, modules);
    const spaces = Object.entries(file.core!.spaces);
    const mine = spaces.find(([, d]) =>
      (d.tables.records ?? []).some((r) => String(r.title).includes("Test kept note")),
    );
    expect(mine).toBeDefined();
    expect(mine![1].tables._idempotency).toBeUndefined();
    expect(file.core!.chats[`chat:${owner.id}`]).toBeDefined();
    expect(file.core!.groups[group.id]).toBeDefined();
    expect(file.d1.spaces!.length).toBeGreaterThan(0);

    // A lost space comes back (here: the same data under a fresh name), and only once.
    const copy: BackupFile = {
      ...file,
      d1: {},
      modules: {},
      core: { spaces: { "test-restored": mine![1] }, chats: {}, groups: {} },
    };
    expect((await restoreBackup(env, modules, copy)).core).toBe(1);
    const restored = env.SPACES.getByName("space:test-restored");
    const dump = await restored.exportData();
    expect((dump!.tables.records ?? []).some((r) => String(r.title).includes("Test kept note"))).toBe(true);
    expect((await restoreBackup(env, modules, copy)).core).toBe(0);
  });

  it("restores backups made before later changes to the storage, and never into a used chat", async () => {
    // A group backed up when it had only its first tables (version 1) still comes back, and
    // the later changes are applied after it.
    const old = {
      version: 1,
      tables: {
        _audit: [
          {
            id: 1,
            at: "2026-01-01T00:00:00.000Z",
            actor_user_id: "test-user",
            source: "web",
            action: "test_action",
            entity_type: "group",
            entity_id: "test",
            before_json: null,
            after_json: null,
          },
        ],
      },
    };
    const g = env.GROUPS.getByName("group:test-old-version");
    expect(await g.importData(old)).toBe(true);
    await runInDurableObject(g, (_i, state) => {
      const sql = state.storage.sql;
      expect(Number(sql.exec(`select version from _schema`).one().version)).toBe(5);
      expect(sql.exec(`select action from _audit`).toArray()).toEqual([{ action: "test_action" }]);
      expect(sql.exec(`select count(*) as n from grp`).one().n).toBe(0);
    });
    // A backup newer than the code is refused.
    let refused = "";
    try {
      await env.GROUPS.getByName("group:test-new-version").importData({ version: 999, tables: {} });
    } catch (e) {
      refused = String(e);
    }
    expect(refused).toContain("schema version 999");

    // A chat with no messages but other things kept (a memory) counts as used.
    const memory = {
      version: 5,
      tables: {
        memories: [
          { id: "test-memory", text: "Test fact", source: "chat", created_at: "2026-01-01T00:00:00.000Z" },
        ],
      },
    };
    const chat = env.CHATS.getByName("chat:test-restore-used");
    expect(await chat.importData(memory)).toBe(true);
    expect(await chat.importData(memory)).toBe(false);
  });

  it("does nothing until Drive is connected; restore is for owners and needs confirming", async () => {
    expect(await runBackup(env, modules)).toBeNull();
    const someone = await signUp();
    expect(
      (await call("/api/admin/restore?confirm=RESTORE", { cookie: someone.cookie, raw: "{}" })).status,
    ).toBe(404);
  });

  it("keeps secrets sealed", async () => {
    const sealed = await encryptSecret("test-key-material", "refresh-token-value");
    expect(sealed).not.toContain("refresh-token-value");
    expect(await decryptSecret("test-key-material", sealed)).toBe("refresh-token-value");
    await expect(decryptSecret("other-key", sealed)).rejects.toThrow();
  });
});
