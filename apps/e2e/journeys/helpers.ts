// Shared steps for the journeys: made-up people made through the API, the app opened as one of
// them at phone size, and checks every screen must pass (no crash, no sideways scrolling).
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const BASE = process.env.BASE ?? "http://localhost:8787";
const PASSWORD = "test-password-123";
/** Different on every run, so the journeys can run again on the same local server. */
export const RUN = Date.now().toString(36);

export interface Person {
  name: string;
  email: string;
  cookie: string;
  id: string;
}

const json = { "content-type": "application/json", origin: BASE };

/** Signs up (or, if the address exists, signs in) and returns the session. Fake data only. */
export async function person(name: string, email?: string): Promise<Person> {
  const address = email ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${RUN}@example.com`;
  let r = await fetch(`${BASE}/auth/sign-up/email`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ name, email: address, password: PASSWORD }),
  });
  if (!r.ok)
    r = await fetch(`${BASE}/auth/sign-in/email`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ email: address, password: PASSWORD }),
    });
  if (!r.ok) throw new Error(`sign-in failed for ${address}: ${r.status}`);
  const cookie = r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.includes("session_token"));
  if (!cookie) throw new Error("no session cookie");
  const me = (await api({ cookie } as Person)("GET", "/me")) as { user: { id: string; name: string } };
  return { name: me.user.name, email: address, cookie, id: me.user.id };
}

/** The owner's test address: the assistant is on for this person (apps/worker/.dev.vars.example). */
export const owner = () => person("Test Owner", "admin@example.com");

/** Calls the API as a person; throws with the server's words when it refuses. */
export function api(p: Pick<Person, "cookie">) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { ...json, cookie: p.cookie, "idempotency-key": crypto.randomUUID() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}

/** Makes `b` someone `a` knows: `a` shares a note and `b` joins it by its link. */
export async function introduce(a: Person, b: Person): Promise<void> {
  const note = (await api(a)("POST", "/collections/Notes/records", {
    values: { Title: `E2E hello ${RUN}` },
  })) as { id: string };
  const { link } = (await api(a)("POST", "/shares", { record_id: note.id, access: "view" })) as {
    link: string;
  };
  await api(b)("POST", "/cards/join", { token: link.slice(link.indexOf("#") + 1) });
}

export interface Opened {
  page: Page;
  context: BrowserContext;
  /** Crashes in the page; every journey ends by checking there were none. */
  errors: string[];
}

/** The app at phone size, signed in as `p`, the first-run tour off. */
export async function openApp(
  browser: Browser,
  p: Person,
  o: { dark?: boolean; offlineReady?: boolean } = {},
): Promise<Opened> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: o.dark ? "dark" : "light",
  });
  await context.addInitScript(() => localStorage.setItem("tour:off", "1"));
  const at = p.cookie.indexOf("=");
  await context.addCookies([{ name: p.cookie.slice(0, at), value: p.cookie.slice(at + 1), url: BASE }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Chats", { exact: true }).first()).toBeVisible();
  return { page, context, errors };
}

/** Nothing on the screen is wider than the phone (the page never scrolls sideways). */
export async function expectNoSideways(page: Page): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, "the page scrolls sideways").toBeLessThanOrEqual(1);
}

/** The bell at the top of Chats (its spoken name says what's waiting). */
export const bell = (page: Page) => page.getByRole("button", { name: /^Inbox/ });
