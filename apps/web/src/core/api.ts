// The web app's only way to reach the backend. No business logic here.
import { untrack } from "svelte";
import { activity } from "./activity.svelte.ts";
import {
  isHealthResponse,
  type ApiErrorBody,
  type ApiTokenView,
  type CalendarFeedView,
  type CreatedApiTokenView,
  type HealthResponse,
  type MeResponse,
  type NotificationsView,
} from "@assistant/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  /** Background work (e.g. saving for offline): no progress bar. */
  quiet?: boolean;
  /** The write's Idempotency-Key, when the caller made it (e.g. a queued change). */
  key?: string;
  /** The one call that asks who is signed in: made for no account in particular. */
  anyAccount?: boolean;
}

/**
 * The account this tab shows (the app can switch accounts in another tab; decision 2026-10-29
 * "Several accounts on one device"). Every call names it (`x-account`); the server refuses a
 * call when another account is signed in, and an answer that comes back after this tab's
 * account changed is dropped, so nothing of one account is saved as another's. The session
 * says who it is and catches up when told (`bindAccount`, in session.svelte.ts).
 */
let accountNow: () => string | null = () => null;
let otherAccount: () => void = () => undefined;
export function bindAccount(now: () => string | null, other: () => void) {
  accountNow = now;
  otherAccount = other;
}
/** Refused or dropped because another account is signed in than the one this tab shows. */
export const accountChanged = (e: unknown) =>
  e instanceof ApiError && !!(e.details as { account_changed?: boolean } | undefined)?.account_changed;

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
  // Every write carries a fresh key so a retried request can't happen twice.
  if (method !== "GET") headers["idempotency-key"] = opts.key ?? crypto.randomUUID();
  const meant = opts.anyAccount ? null : accountNow();
  if (meant) headers["x-account"] = meant;
  // untrack: requests often start inside an $effect, which must not depend on this counter.
  if (!opts.quiet) untrack(() => activity.pending++);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Failed after this tab's account changed: dropped, never retried as the new account.
    if (meant && accountNow() !== meant)
      throw new ApiError(409, "account_changed", "You switched accounts while this was on its way.", {
        account_changed: true,
      });
    // No connection (or it dropped): a clear message, and a status 0 others can check.
    throw new ApiError(0, "offline", "You're offline. This needs a connection.");
  } finally {
    if (!opts.quiet) untrack(() => activity.pending--);
  }
  const data = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | ApiErrorBody | null);
  if (meant && accountNow() !== meant)
    throw new ApiError(409, "account_changed", "You switched accounts while this was on its way.", {
      account_changed: true,
    });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if ((err?.details as { account_changed?: boolean } | undefined)?.account_changed) otherAccount();
    throw new ApiError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return data as T;
}

export interface AdminOverview {
  sections: {
    title: string;
    stats: { label: string; value: string | number; hint?: string; tone?: "ok" | "warn" | "bad" }[];
  }[];
  tools: {
    id: string;
    label: string;
    description: string;
    fields: { name: string; label: string; placeholder?: string }[];
  }[];
  generated_at: string;
}
export interface AdminList {
  owners: string[];
  admins: { email: string; added_at: string; added_by: string | null }[];
}
export interface AdminLogEntry {
  action: string;
  detail: unknown;
  at: string;
  actor: string | null;
}

/**
 * The owner-only admin panel. Admin writes are naturally repeatable, so no Idempotency-Key.
 * Online-only: admin tools act on live server data.
 */
export const adminApi = {
  me: () => request<{ is_admin: boolean }>("GET", "/api/admin/me"),
  overview: () => request<AdminOverview>("GET", "/api/admin/overview"),
  admins: () => request<AdminList>("GET", "/api/admin/admins"),
  addAdmin: (email: string) => request<AdminList>("POST", "/api/admin/admins", { email }),
  removeAdmin: (email: string) =>
    request<AdminList>("DELETE", `/api/admin/admins/${encodeURIComponent(email)}`),
  runTool: (id: string, input: Record<string, string>) =>
    request<{ result: string }>("POST", `/api/admin/tools/${id}`, input),
  log: () => request<AdminLogEntry[]>("GET", "/api/admin/log"),
  operations: () => request<AdminOperations>("GET", "/api/admin/operations"),
  alerts: () => request<AdminAlerts>("GET", "/api/admin/alerts"),
  setAlerts: (enabled: boolean) => request<{ enabled: boolean }>("POST", "/api/admin/alerts", { enabled }),
  testAlert: () => request<{ sent: boolean }>("POST", "/api/admin/alerts/test", {}),
  backup: () => request<AdminBackup>("GET", "/api/admin/backup"),
  backupNow: () => request<AdminBackup["last"]>("POST", "/api/admin/backup/run", {}),
  disconnectDrive: () => request<{ connected: boolean }>("POST", "/api/admin/drive/disconnect", {}),
  restore: async (file: File, key = "") => {
    const res = await fetch("/api/admin/restore?confirm=RESTORE", {
      method: "POST",
      // An encrypted file opens with the Worker's own key; a key typed in wins over it.
      headers: { "idempotency-key": crypto.randomUUID(), ...(key ? { "x-backup-key": key } : {}) },
      body: file,
    });
    const body = (await res.json()) as { rows: number; modules: Record<string, number> } & ApiErrorBody;
    if (!res.ok)
      throw new ApiError(res.status, body.error?.code ?? "unknown", body.error?.message ?? "Restore failed");
    return body;
  },
};

export interface AdminBackup {
  google_configured: boolean;
  /** The BACKUP_KEY secret is set: files in Drive are sealed with it. */
  encrypted: boolean;
  connected: boolean;
  last: {
    at: string;
    ok: boolean;
    bytes?: number;
    file?: string;
    error?: string;
    encrypted?: boolean;
  } | null;
}

export interface AdminAlerts {
  enabled: boolean;
  telegram: { token: boolean; chat: boolean };
  checks: { id: string; label: string; ok: boolean; detail?: string; fix?: string; since: string | null }[];
}

export interface AdminOperations {
  /** False until the read-only analytics token is set up. */
  available: boolean;
  operations: {
    operation: string;
    calls: number;
    server_errors: number;
    client_errors: number;
    p50_ms: number;
    p95_ms: number;
  }[];
  error?: string;
}

export const api = {
  health: async (): Promise<HealthResponse> => {
    const body = await request<unknown>("GET", "/api/health");
    if (!isHealthResponse(body)) throw new Error("Unexpected health response");
    return body;
  },
  me: () => request<MeResponse>("GET", "/api/me", undefined, { anyAccount: true }),
};

/** A readable message for any thrown value. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** My private calendar feed link (core, T08). Online-only: the server makes the link secret. */
export const calendarApi = {
  get: () => request<CalendarFeedView>("GET", "/api/me/calendar"),
  enable: (reset = false) => request<CalendarFeedView>("POST", "/api/me/calendar", reset ? { reset } : {}),
  disable: () => request<CalendarFeedView>("DELETE", "/api/me/calendar"),
};

/** API tokens for Siri Shortcuts (core, T09). Online-only: the server makes and revokes tokens. */
export const tokensApi = {
  list: () => request<ApiTokenView[]>("GET", "/api/me/tokens"),
  create: (name: string, write: boolean) =>
    request<CreatedApiTokenView>("POST", "/api/me/tokens", { name, write }),
  revoke: (id: string) => request<{ revoked: true }>("DELETE", `/api/me/tokens/${encodeURIComponent(id)}`),
};

/** My notifications (core, T11). Online-only: marking read is retried next time. */
export const notificationsApi = {
  list: () => request<NotificationsView>("GET", "/api/me/notifications?limit=20"),
  markAllRead: () => request<{ unread: 0 }>("POST", "/api/me/notifications/read", {}),
};
