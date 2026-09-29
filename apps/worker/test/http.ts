// Test helpers: talk to the Worker over HTTP like the web app does. Fake data only.
import { exports } from "cloudflare:workers";

const BASE = "http://localhost:8787";
const worker = () => (exports as unknown as { default: Fetcher }).default;

export async function call(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    cookie?: string;
    raw?: string;
    idempotencyKey?: string | null;
    /** An API token (Authorization: Bearer …) instead of a cookie. */
    bearer?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers({ origin: BASE });
  const method = init.method ?? (init.body !== undefined || init.raw !== undefined ? "POST" : "GET");
  // API writes need an Idempotency-Key; a fresh one per call unless the test sets it.
  if (method !== "GET" && path.startsWith("/api/") && init.idempotencyKey !== null) {
    headers.set("idempotency-key", init.idempotencyKey ?? crypto.randomUUID());
  }
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  let body: string | undefined;
  if (init.raw !== undefined) body = init.raw;
  else if (init.body !== undefined) body = JSON.stringify(init.body);
  if (body !== undefined) headers.set("content-type", "application/json");
  return worker().fetch(BASE + path, {
    method: init.method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test convenience
export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let n = 0;
/** Signs up a new user (email/password works on localhost only) and returns its cookie. */
export async function signUp(name = "Test User", email = `test-${Date.now()}-${++n}@example.com`) {
  const res = await call("/auth/sign-up/email", { body: { name, email, password: "test-password-123" } });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { user } = await json<{ user: { id: string } }>(res);
  return { cookie, email, id: user.id, name };
}
