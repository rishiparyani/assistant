// Backups sealed with the owner's key (HF 9): unreadable in Drive without it, and restore takes
// the same key. Fake data and a fake Drive only.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { DriveClient } from "../src/core/backup/drive.ts";
import { buildBackup, openBackupBytes, packBackup, runBackup } from "../src/core/backup/service.ts";
import { decryptFile, encryptFile, isEncryptedFile } from "../src/core/crypto.ts";
import { modules } from "../src/modules/index.ts";
import { call, json, signUp } from "./http.ts";

function fakeDrive() {
  const files: { id: string; name: string; createdTime: string; data?: Uint8Array; type?: string }[] = [];
  const drive: DriveClient = {
    ensureFolder: async () => "folder-1",
    upload: async (_folder, name, data, type) => {
      files.push({ id: `f-${files.length}`, name, createdTime: new Date().toISOString(), data, type });
      return { id: `f-${files.length}` };
    },
    list: async () => [...files],
    remove: async () => undefined,
    download: async (id) => files.find((f) => f.id === id)!.data!,
  };
  return { drive, files };
}

const KEY = "test-backup-key-correct-horse-battery";
const sealedEnv = { ...env, BACKUP_KEY: KEY } as typeof env;

describe("backups with the owner's key", () => {
  it("seals and opens a file; a wrong key or a changed byte is refused", async () => {
    const plain = new TextEncoder().encode("Test bytes ₹450");
    const sealed = await encryptFile(KEY, plain);
    expect(isEncryptedFile(sealed)).toBe(true);
    expect(isEncryptedFile(plain)).toBe(false);
    expect(new TextDecoder().decode(sealed)).not.toContain("Test bytes");
    expect(new TextDecoder().decode(await decryptFile(KEY, sealed))).toBe("Test bytes ₹450");
    await expect(decryptFile("other-key", sealed)).rejects.toThrow("doesn't open");
    const changed = new Uint8Array(sealed);
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    await expect(decryptFile(KEY, changed)).rejects.toThrow();
  });

  it("uploads an encrypted file when the key is set, readable only with it", async () => {
    const owner = await signUp("Test Owner");
    await call("/api/collections/Notes/records", {
      cookie: owner.cookie,
      body: { values: { Title: "Test sealed note" } },
    });
    const { drive, files } = fakeDrive();
    const status = await runBackup(sealedEnv, modules, drive);
    expect(status).toMatchObject({
      ok: true,
      encrypted: true,
      file: expect.stringMatching(/\.json\.gz\.enc$/),
    });
    const up = files[0]!;
    expect(up.type).toBe("application/octet-stream");
    expect(isEncryptedFile(up.data!)).toBe(true);
    expect(new TextDecoder().decode(up.data!)).not.toContain("Test sealed note");
    // Opened with the key: the same backup; without any key: refused.
    const file = await openBackupBytes(sealedEnv, up.data!);
    expect(JSON.stringify(file.core)).toContain("Test sealed note");
    await expect(openBackupBytes(env, up.data!)).rejects.toThrow("needs the backup key");
    expect(JSON.stringify((await openBackupBytes(env, up.data!, KEY)).core)).toContain("Test sealed note");
    // Without the key set, the same backup goes up as gzipped JSON, as before.
    const plain = await packBackup(env, await buildBackup(env, modules));
    expect(isEncryptedFile(plain)).toBe(false);
    expect(plain[0]).toBe(0x1f);
  });

  it("restores an encrypted file with the key sent along", async () => {
    const owner = await signUp("Test Owner", "owner.admin@example.com");
    const file = await buildBackup(env, modules);
    const sealed = await packBackup(sealedEnv, {
      ...file,
      d1: {},
      modules: {},
      core: { spaces: { "test-sealed-space": { version: 1, tables: {} } }, chats: {}, groups: {} },
    });
    const refused = await call("/api/admin/restore?confirm=RESTORE", { cookie: owner.cookie, raw: sealed });
    expect(refused.status).toBe(400);
    expect((await json<{ error: { message: string } }>(refused)).error.message).toContain(
      "needs the backup key",
    );
    const ok = await call("/api/admin/restore?confirm=RESTORE", {
      cookie: owner.cookie,
      raw: sealed,
      headers: { "x-backup-key": KEY },
    });
    expect(ok.status).toBe(200);
    expect((await json<{ core: number }>(ok)).core).toBe(1);
  });
});
