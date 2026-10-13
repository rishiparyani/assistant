// Nightly backups to the owner's Google Drive (decision 2026-09-28). One compressed JSON
// file per night: D1 (minus sign-in secrets) and each module's own data (gigs: every
// gig's object). Kept 60 deep; restore puts rows back without overwriting anything.
import type { AdminCtx, ModuleDefinition } from "../module.ts";
import { objectBindings } from "../context.ts";
import { getSetting, setSetting } from "../settings.ts";
import { decryptSecret, encryptSecret } from "../crypto.ts";
import { googleDrive, type DriveClient } from "./drive.ts";
import { decryptFile, encryptFile, isEncryptedFile } from "../crypto.ts";
import { spaceName } from "../spaces/service.ts";
import type { ObjectDump } from "../objects/storage.ts";

export const BACKUP_FORMAT = "assistant-backup/v1";
const KEEP = 60;

/** D1 tables in a backup, and the columns left out (secrets: tokens, passwords). */
const D1_TABLES: Record<string, readonly string[]> = {
  user: [],
  account: ["accessToken", "refreshToken", "idToken", "password"],
  passkey: [],
  tags: [],
  pending_people: [],
  admins: [],
  admin_audit: [],
  // access_tokens is left out on purpose: links and tokens are made again after a restore.
  user_audit: [],
  // The universal app's indexes (its data is in the objects, under "core" below).
  spaces: [],
  space_members: [],
  shared_with: [],
  assistant_access: [],
  group_members: [],
  direct_chats: [],
};

/**
 * The universal app's own objects (lists and records, chats, group chats), each as a dump
 * of its tables. Restores go into empty objects only.
 */
export interface CoreBackup {
  spaces: Record<string, ObjectDump>;
  chats: Record<string, ObjectDump>;
  groups: Record<string, ObjectDump>;
}

async function exportCore(env: BackupEnv): Promise<CoreBackup> {
  const out: CoreBackup = { spaces: {}, chats: {}, groups: {} };
  const ids = async (q: string) => (await env.DB.prepare(q).all<{ id: string }>()).results.map((r) => r.id);
  for (const id of await ids(`select id from spaces`)) {
    const dump = await env.SPACES.getByName(spaceName(id)).exportData();
    if (dump) out.spaces[id] = dump;
  }
  for (const id of await ids(`select distinct group_id as id from group_members`)) {
    const dump = await env.GROUPS.getByName(`group:${id}`).exportData();
    if (dump) out.groups[id] = dump;
  }
  // Each person's main chat (it also lists their other chats and keeps their memory).
  for (const uid of await ids(`select id from user`)) {
    const main = env.CHATS.getByName(`chat:${uid}`);
    const dump = await main.exportData();
    if (!dump) continue;
    out.chats[`chat:${uid}`] = dump;
    for (const cid of await main.chatIds()) {
      const other = await env.CHATS.getByName(`chat:${uid}:${cid}`).exportData();
      if (other) out.chats[`chat:${uid}:${cid}`] = other;
    }
  }
  return out;
}

async function importCore(env: BackupEnv, core: CoreBackup): Promise<number> {
  let n = 0;
  for (const [id, dump] of Object.entries(core.spaces ?? {}))
    if (await env.SPACES.getByName(spaceName(id)).importData(dump)) n++;
  for (const [id, dump] of Object.entries(core.groups ?? {}))
    if (await env.GROUPS.getByName(`group:${id}`).importData(dump)) n++;
  for (const [name, dump] of Object.entries(core.chats ?? {}))
    if (await env.CHATS.getByName(name).importData(dump)) n++;
  return n;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  environment: string;
  created_at: string;
  d1: Record<string, Record<string, unknown>[]>;
  modules: Record<string, unknown>;
  /** Lists, chats and groups (missing in backups made before 2026-10-10). */
  core?: CoreBackup;
}

export interface BackupStatus {
  at: string;
  ok: boolean;
  bytes?: number;
  file?: string;
  error?: string;
  /** Encrypted with the owner's key (BACKUP_KEY); restore needs the same key. */
  encrypted?: boolean;
}

type BackupEnv = Env & {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
  /** Optional: the owner's backup key; without it backups are gzipped JSON in the owner's Drive. */
  BACKUP_KEY?: string;
};

/** Whether backups are encrypted (the owner set BACKUP_KEY). */
export const backupEncrypted = (env: BackupEnv) => !!env.BACKUP_KEY;

/**
 * The backup file as uploaded: gzipped JSON, sealed with the owner's key when there is one.
 * Reading takes the same key (`openBackupBytes`).
 */
export async function packBackup(env: BackupEnv, file: BackupFile): Promise<Uint8Array> {
  const data = await gzip(JSON.stringify(file));
  return env.BACKUP_KEY ? encryptFile(env.BACKUP_KEY, data) : data;
}

/** A backup's bytes (encrypted, gzipped or plain JSON) back to the file; `key` wins over the env's. */
export async function openBackupBytes(
  env: BackupEnv,
  bytes: Uint8Array,
  key?: string | null,
): Promise<BackupFile> {
  let data = bytes;
  if (isEncryptedFile(data)) {
    const k = key || env.BACKUP_KEY;
    if (!k) throw new Error("This backup is encrypted; restore needs the backup key");
    data = await decryptFile(k, data);
  }
  const text = data[0] === 0x1f && data[1] === 0x8b ? await gunzip(data) : new TextDecoder().decode(data);
  let file: BackupFile;
  try {
    file = JSON.parse(text) as BackupFile;
  } catch {
    throw new Error("Not a backup file");
  }
  return file;
}

export async function buildBackup(
  env: BackupEnv,
  modules: readonly ModuleDefinition[],
  now = new Date(),
): Promise<BackupFile> {
  const d1: BackupFile["d1"] = {};
  for (const [table, hidden] of Object.entries(D1_TABLES)) {
    const { results } = await env.DB.prepare(`select * from "${table}"`).all<Record<string, unknown>>();
    d1[table] = results.map((r) => {
      const row = { ...r };
      for (const h of hidden) if (h in row) row[h] = null;
      return row;
    });
  }
  const ctx: AdminCtx = { d1: env.DB, objects: objectBindings(env) };
  const out: BackupFile["modules"] = {};
  for (const m of modules) if (m.backup) out[m.id] = await m.backup.export(ctx);
  return {
    format: BACKUP_FORMAT,
    environment: env.ENVIRONMENT,
    created_at: now.toISOString(),
    d1,
    modules: out,
    core: await exportCore(env),
  };
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(data: Uint8Array): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

// --- Drive connection ------------------------------------------------------------------

export async function driveConnected(env: BackupEnv): Promise<boolean> {
  return (await getSetting(env.DB, "drive_refresh_token")) !== null;
}

export async function saveDriveToken(env: BackupEnv, refreshToken: string) {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is missing");
  await setSetting(env.DB, "drive_refresh_token", await encryptSecret(env.BETTER_AUTH_SECRET, refreshToken));
  await setSetting(env.DB, "drive_connected_at", new Date().toISOString());
}

export async function disconnectDrive(env: BackupEnv) {
  await setSetting(env.DB, "drive_refresh_token", null);
  await setSetting(env.DB, "drive_folder_id", null);
}

async function openDrive(env: BackupEnv): Promise<DriveClient | null> {
  const sealed = await getSetting(env.DB, "drive_refresh_token");
  if (!sealed || !env.BETTER_AUTH_SECRET || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return googleDrive({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: await decryptSecret(env.BETTER_AUTH_SECRET, sealed),
  });
}

// --- Running and restoring -------------------------------------------------------------

export async function backupStatus(env: BackupEnv): Promise<BackupStatus | null> {
  const raw = await getSetting(env.DB, "backup_last");
  return raw ? (JSON.parse(raw) as BackupStatus) : null;
}

/** Makes a backup and uploads it (drive defaults to the connected Google Drive). */
export async function runBackup(
  env: BackupEnv,
  modules: readonly ModuleDefinition[],
  drive?: DriveClient | null,
  now = new Date(),
): Promise<BackupStatus | null> {
  const client = drive ?? (await openDrive(env).catch(() => null));
  if (!client) {
    if (await driveConnected(env)) {
      const status: BackupStatus = {
        at: now.toISOString(),
        ok: false,
        error: "Couldn't sign in to Google Drive",
      };
      await setSetting(env.DB, "backup_last", JSON.stringify(status));
      return status;
    }
    return null; // not connected: nothing to do
  }
  let status: BackupStatus;
  try {
    const file = await buildBackup(env, modules, now);
    const data = await packBackup(env, file);
    const encrypted = backupEncrypted(env);
    let folder = await getSetting(env.DB, "drive_folder_id");
    if (!folder) {
      folder = await client.ensureFolder(`Assistant backups (${env.ENVIRONMENT})`);
      await setSetting(env.DB, "drive_folder_id", folder);
    }
    const stamp = now.toISOString().slice(0, 16).replace(":", "");
    const name = `assistant-${env.ENVIRONMENT}-${stamp}.json.gz${encrypted ? ".enc" : ""}`;
    await client.upload(folder, name, data, encrypted ? "application/octet-stream" : "application/gzip");
    // Keep the newest KEEP backups.
    const files = (await client.list(folder)).filter((f) => f.name.startsWith("assistant-"));
    for (const old of files.slice(KEEP)) await client.remove(old.id);
    status = { at: now.toISOString(), ok: true, bytes: data.byteLength, file: name, encrypted };
  } catch (err) {
    console.error("backup: failed", err);
    status = { at: now.toISOString(), ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  await setSetting(env.DB, "backup_last", JSON.stringify(status));
  return status;
}

/** Puts a backup back: D1 rows that are missing, and each module's data into empty objects. */
export async function restoreBackup(
  env: BackupEnv,
  modules: readonly ModuleDefinition[],
  file: BackupFile,
): Promise<{ rows: number; modules: Record<string, number>; core: number }> {
  if (file.format !== BACKUP_FORMAT) throw new Error("Not a Gigspree backup file");
  let rows = 0;
  for (const table of Object.keys(D1_TABLES)) {
    for (const row of file.d1[table] ?? []) {
      const cols = Object.keys(row).filter((c) => row[c] !== null || !D1_TABLES[table]!.includes(c));
      const res = await env.DB.prepare(
        `insert or ignore into "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map(() => "?").join(", ")})`,
      )
        .bind(...cols.map((c) => row[c] ?? null))
        .run();
      rows += res.meta.changes;
    }
  }
  const ctx: AdminCtx = { d1: env.DB, objects: objectBindings(env) };
  const restored: Record<string, number> = {};
  for (const m of modules) {
    if (m.backup && file.modules[m.id] !== undefined)
      restored[m.id] = await m.backup.import(ctx, file.modules[m.id]);
  }
  const core = file.core ? await importCore(env, file.core) : 0;
  return { rows, modules: restored, core };
}

/** Nightly at about 02:30 India time (21:00 UTC), on the 15-minute timer. */
export const backupDue = (now: Date) => now.getUTCHours() === 21 && now.getUTCMinutes() < 15;
