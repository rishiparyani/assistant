// Nightly backups to Google Drive (fake Drive here) and restore. Fake data only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { BookingView } from "@assistant/shared";
import type { DriveClient } from "../src/core/backup/drive.ts";
import { gunzip, restoreBackup, runBackup, type BackupFile } from "../src/core/backup/service.ts";
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
