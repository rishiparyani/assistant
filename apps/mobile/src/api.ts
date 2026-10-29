// The app's only way to reach the backend. No business logic here.
import type { ApiErrorBody } from "@assistant/shared";
import { Platform } from "react-native";
import { API_URL } from "./config.ts";
import { cookieHeader } from "./auth.ts";
import { practiceHeader, type PracticeAs } from "./practice-mode.ts";
import { openAccountId } from "./storage.ts";

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

export const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export interface RequestOptions {
  /**
   * Rehearsing (src/practice-mode.ts): left out, the call is made as whoever is being played
   * right now; null makes it as yourself (the rehearsal's own controls); a value, as that.
   */
  practice?: PracticeAs | null;
  /**
   * The account the call is made for (refused by the server if another is signed in). Left out,
   * the account whose copy is open; null for the one call that asks who is signed in.
   */
  account?: string | null;
}

/**
 * Called when the server says another account is signed in than the one this app has open (a
 * switch in another tab, or one that didn't finish): the session asks who it is and catches up.
 */
let onOtherAccount: (() => void) | null = null;
export const whenOtherAccount = (f: (() => void) | null) => (onOtherAccount = f);

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  key?: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const as = practiceHeader(opts.practice === undefined ? undefined : opts.practice);
  if (as) headers["x-practice-as"] = as;
  const meant = opts.account === undefined ? openAccountId() : opts.account;
  if (meant) headers["x-account"] = meant;
  // Every write carries a fresh key so a retried request can't happen twice.
  if (method !== "GET") headers["idempotency-key"] = key ?? newKey();
  const cookie = await cookieHeader();
  if (cookie) headers.cookie = cookie;
  // State-changing requests must name the app as their origin (the Worker checks it).
  headers.origin = API_URL;
  // On the phone the session travels only in the cookie header above, never from the system's
  // cookie jar: on iOS the jar's cookies replace a hand-set cookie header, and the jar holds no
  // session after a Google sign-in (that arrived through the sign-in sheet) but does hold the
  // sign-in's short-lived state cookie, so every call came back "not signed in" (owner,
  // 2026-10-24, TestFlight). The website's browser keeps its own cookie.
  const credentials: RequestCredentials = Platform.OS === "web" ? "include" : "omit";
  // The account whose copy is open when the call starts: an answer that comes back after a
  // switch to another account is dropped, so nothing of one account is saved in another's copy.
  const account = openAccountId();
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers,
      credentials,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "offline", "You're offline. This needs a connection.");
  }
  const data = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | ApiErrorBody | null);
  if (account && openAccountId() !== account)
    // Not "offline" (which would queue it again, as the account now open): dropped for good.
    throw new ApiError(409, "account_changed", "You switched accounts while this was on its way.", {
      account_changed: true,
    });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if ((err?.details as { account_changed?: boolean } | undefined)?.account_changed) onOtherAccount?.();
    throw new ApiError(
      res.status,
      err?.code ?? "request_failed",
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return data as T;
}

export const isOffline = (e: unknown) => e instanceof ApiError && e.status === 0;
