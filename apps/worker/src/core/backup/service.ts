// Nightly backups to the owner's Google Drive (decision 2026-09-28). One compressed JSON
// file per night: D1 (minus sign-in secrets) and each module's own data (gigs: every
// gig's object). Kept 60 deep; restore puts rows back without overwriting anything.
import type { AdminCtx, ModuleDefinition } from "../module.ts";
import { objectBindings } from "../context.ts";
import { getSetting, setSetting } from "../settings.ts";
import { decryptSecret, encryptSecret } from "../crypto.ts";
import { googleDrive, type DriveClient } from "./drive.ts";

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
};

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  environment: string;
  created_at: string;
  d1: Record<string, Record<string, unknown>[]>;
  modules: Record<string, unknown>;
}

export interface BackupStatus {
  at: string;
  ok: boolean;
  bytes?: number;
  file?: string;
  error?: string;
}

type BackupEnv = Env & {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
};

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
    const data = await gzip(JSON.stringify(file));
    let folder = await getSetting(env.DB, "drive_folder_id");
    if (!folder) {
      folder = await client.ensureFolder(`Assistant backups (${env.ENVIRONMENT})`);
      await setSetting(env.DB, "drive_folder_id", folder);
    }
    const name = `assistant-${env.ENVIRONMENT}-${now.toISOString().slice(0, 16).replace(":", "")}.json.gz`;
    await client.upload(folder, name, data, "application/gzip");
    // Keep the newest KEEP backups.
    const files = (await client.list(folder)).filter((f) => f.name.startsWith("assistant-"));
    for (const old of files.slice(KEEP)) await client.remove(old.id);
    status = { at: now.toISOString(), ok: true, bytes: data.byteLength, file: name };
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
): Promise<{ rows: number; modules: Record<string, number> }> {
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
  return { rows, modules: restored };
}

/** Nightly at about 02:30 India time (21:00 UTC), on the 15-minute timer. */
export const backupDue = (now: Date) => now.getUTCHours() === 21 && now.getUTCMinutes() < 15;
