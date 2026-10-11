// The app's only way to reach the backend. No business logic here.
import type { ApiErrorBody } from "@assistant/shared";
import { API_URL } from "./config.ts";
import { cookieHeader } from "./auth.ts";

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

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export async function request<T>(method: string, path: string, body?: unknown, key?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  // Every write carries a fresh key so a retried request can't happen twice.
  if (method !== "GET") headers["idempotency-key"] = key ?? newKey();
  const cookie = await cookieHeader();
  if (cookie) headers.cookie = cookie;
  // State-changing requests must name the app as their origin (the Worker checks it).
  headers.origin = API_URL;
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "offline", "You're offline. This needs a connection.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
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
