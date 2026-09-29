// Notifications and Web Push (T11). Fake data only; no real push service is called.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { BookingView, NotificationsView, PushStatusView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";
import { b64url, encryptPayload, sendPush, unb64url } from "../src/core/push/webpush.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const as =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const inbox = (u: User) => as(u)("/me/notifications").then((r) => json<NotificationsView>(r));

/** A browser's side of a subscription: its key pair and auth secret. */
async function fakeBrowser() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    pair,
    sub: {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
      p256dh: b64url(pub),
      auth: b64url(auth),
    },
  };
}

/** Decrypts an aes128gcm body the way a browser does (RFC 8291). */
async function decrypt(browser: Awaited<ReturnType<typeof fakeBrowser>>, body: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey(
    "raw",
    asPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      browser.pair.privateKey,
      256,
    ),
  );
  const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: s, info },
        await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
        n * 8,
      ),
    );
  const uaPublic = unb64url(browser.sub.p256dh);
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(unb64url(browser.sub.auth), secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  expect(plain.at(-1)).toBe(2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe("web push", () => {
  it("encrypts so the browser can read it, and signs with the app's VAPID key", async () => {
    const browser = await fakeBrowser();
    const body = await encryptPayload(browser.sub, new TextEncoder().encode('{"title":"Hi"}'));
    expect(await decrypt(browser, body)).toBe('{"title":"Hi"}');

    let seen: Request | null = null;
    const result = await sendPush(env, browser.sub, { title: "Test" }, async (input, init) => {
      seen = new Request(input as string, init);
      return new Response(null, { status: 201 });
    });
    expect(result).toBe("sent");
    const req = seen as unknown as Request;
    expect(req.headers.get("content-encoding")).toBe("aes128gcm");
    expect(req.headers.get("authorization")).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(await decrypt(browser, new Uint8Array(await req.arrayBuffer()))).toBe('{"title":"Test"}');

    const gone = await sendPush(env, browser.sub, {}, async () => new Response(null, { status: 410 }));
    expect(gone).toBe("gone");
    expect(await sendPush(env, { ...browser.sub, endpoint: "https://evil.example.com/x" }, {})).toBe("gone");
  });

  it("adds and removes this device; only real push services", async () => {
    const me = await signUp("Test Me");
    const browser = await fakeBrowser();
    const status = await json<PushStatusView>(await as(me)("/me/push"));
    expect(status.public_key).toMatch(/^[\w-]{80,}$/);
    expect(status.devices).toBe(0);
    const bad = await as(me)("/me/push", {
      body: {
        endpoint: "https://evil.example.com/hook",
        keys: { p256dh: browser.sub.p256dh, auth: browser.sub.auth },
      },
    });
    expect(bad.status).toBe(400);
    const add = await json<PushStatusView>(
      await as(me)("/me/push", {
        body: {
          endpoint: browser.sub.endpoint,
          keys: { p256dh: browser.sub.p256dh, auth: browser.sub.auth },
        },
      }),
    );
    expect(add).toMatchObject({ devices: 1, this_device: true, public_key: status.public_key });
    const off = await json<PushStatusView>(
      await as(me)("/me/push/remove", { body: { endpoint: browser.sub.endpoint } }),
    );
    expect(off.devices).toBe(0);
    expect((await as(me)("/me/push/test", { body: {} }).then((r) => json<{ sent: number }>(r))).sent).toBe(0);
  });
});

describe("gig notifications", () => {
  it("tells people about gigs they're added to, payments, changes and cancellations; not their own", async () => {
    const owner = await signUp("Test Owner");
    const mate = await signUp("Test Mate");
    const later = new Date(Date.now() + 10 * 86400_000 + 330 * 60_000).toISOString().slice(0, 10);
    const gig = await json<BookingView>(
      await as(owner)("/gigs", {
        body: {
          title: "Test Wedding",
          status: "enquiry",
          events: [{ start_at: `${later}T19:00`, venue_name: "Test Hall" }],
          people: [{ user_id: mate.id }],
        },
      }),
    );
    const added = await waitFor(
      () => inbox(mate),
      (n) => n.items.length >= 1,
    );
    expect(added.items[0]).toMatchObject({
      kind: "gig_added",
      title: "You're on “Test Wedding”",
      url: `/gigs/${gig.id}`,
    });
    expect(added.items[0]!.body).toContain("Test Hall");
    expect(added.unread).toBe(1);

    await as(owner)(`/gigs/${gig.id}/status`, { body: { action: "confirm" } });
    await waitFor(
      () => inbox(mate),
      (n) => n.items.some((i) => i.kind === "gig_confirmed"),
    );
    const mateId = gig.people.find((p) => p.user_id === mate.id)!.id;
    await as(owner)(`/gigs/${gig.id}/payouts`, {
      body: { person_id: mateId, amount: "3000", paid_on: later, method: "upi" },
    });
    const paid = await waitFor(
      () => inbox(mate),
      (n) => n.items.some((i) => i.kind === "paid"),
    );
    expect(paid.items.find((i) => i.kind === "paid")!.title).toBe("You were paid ₹3,000");

    const current = await json<BookingView>(await as(owner)(`/gigs/${gig.id}`));
    await as(owner)(`/gigs/${gig.id}/events/${gig.events[0]!.id}`, {
      method: "PATCH",
      body: { version: current.version, venue_name: "Test Lawns" },
    });
    const moved = await waitFor(
      () => inbox(mate),
      (n) => n.items.some((i) => i.kind === "gig_changed"),
    );
    expect(moved.items.find((i) => i.kind === "gig_changed")!.body).toContain("Test Lawns");

    await as(owner)(`/gigs/${gig.id}/status`, { body: { action: "cancel" } });
    await waitFor(
      () => inbox(mate),
      (n) => n.items.some((i) => i.kind === "gig_cancelled"),
    );

    // The owner made every change: nothing for them.
    expect((await inbox(owner)).items).toEqual([]);
    // Mark read.
    expect(
      (await json<{ unread: number }>(await as(mate)("/me/notifications/read", { body: {} }))).unread,
    ).toBe(0);
    expect((await inbox(mate)).unread).toBe(0);
  });
});
