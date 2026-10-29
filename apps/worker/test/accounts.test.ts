// Several accounts on one device (docs/design/chats-home.md 7, the account switcher): one
// device stays signed in to each account it signs in with, switches with one tap, and signs out
// of one or all. The device is a cookie jar here, as the phone keeps one. Fake data only.
import { describe, expect, it } from "vitest";
import { call, json, signUp } from "./http.ts";

/** A device's cookies: what the server sets is kept, what it expires is dropped. */
function device() {
  const jar = new Map<string, string>();
  const take = (res: Response) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const at = pair!.indexOf("=");
      const name = pair!.slice(0, at).trim();
      const gone = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (gone) jar.delete(name);
      else jar.set(name, pair!.slice(at + 1));
    }
    return res;
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    jar,
    send: async (path: string, body?: unknown) =>
      take(await call(path, { cookie: cookie(), ...(body !== undefined ? { body } : {}) })),
  };
}

type Listed = { session: { token: string }; user: { id: string; name: string } }[];
const signIn = (d: ReturnType<typeof device>, email: string) =>
  d.send("/auth/sign-in/email", { email, password: "test-password-123" });
const who = async (d: ReturnType<typeof device>) => {
  const r = await d.send("/api/me");
  return r.status === 200 ? (await json<{ user: { name: string } }>(r)).user.name : r.status;
};

describe("accounts on one device", () => {
  it("adds a second account, switches between them, and signs out of one or all", async () => {
    const a = await signUp("Test Asha");
    const b = await signUp("Test Kabir");
    const phone = device();
    await signIn(phone, a.email);
    // Kept before the second sign-in (the app does this before "Add another account").
    expect((await json<{ kept: boolean }>(await phone.send("/auth/multi-session/keep", {}))).kept).toBe(true);
    await signIn(phone, b.email);
    expect(await who(phone)).toBe("Test Kabir");

    const listed = await json<Listed>(await phone.send("/auth/multi-session/list-device-sessions"));
    expect(listed.map((l) => l.user.name).sort()).toEqual(["Test Asha", "Test Kabir"]);

    const asha = listed.find((l) => l.user.name === "Test Asha")!;
    expect(
      (await phone.send("/auth/multi-session/set-active", { sessionToken: asha.session.token })).status,
    ).toBe(200);
    expect(await who(phone)).toBe("Test Asha");

    // Signing out of Kabir only leaves Asha signed in.
    const kabir = listed.find((l) => l.user.name === "Test Kabir")!;
    await phone.send("/auth/multi-session/revoke", { sessionToken: kabir.session.token });
    const left = await json<Listed>(await phone.send("/auth/multi-session/list-device-sessions"));
    expect(left.map((l) => l.user.name)).toEqual(["Test Asha"]);
    expect(await who(phone)).toBe("Test Asha");

    // Sign out of all: nobody is signed in, and the old sessions don't work anywhere.
    await signIn(phone, b.email);
    const before = new Map(phone.jar);
    await phone.send("/auth/sign-out", {});
    expect(await who(phone)).toBe(401);
    const stolen = [...before].map(([k, v]) => `${k}=${v}`).join("; ");
    expect((await call("/api/me", { cookie: stolen })).status).toBe(401);
  });

  it("can't switch to a session it was never given", async () => {
    const a = await signUp("Test Asha");
    const other = await signUp("Test Dev");
    const phone = device();
    await signIn(phone, a.email);
    // Dev's session token, learned some other way, is not on this device: refused.
    const elsewhere = device();
    await signIn(elsewhere, other.email);
    const theirs = await json<Listed>(await elsewhere.send("/auth/multi-session/list-device-sessions"));
    const r = await phone.send("/auth/multi-session/set-active", { sessionToken: theirs[0]!.session.token });
    expect(r.status).toBe(401);
    expect(await who(phone)).toBe("Test Asha");
  });

  it("keeps at most five accounts", async () => {
    const phone = device();
    for (let i = 1; i <= 6; i++) {
      const u = await signUp(`Test Person ${i}`);
      await signIn(phone, u.email);
      await phone.send("/auth/multi-session/keep", {});
    }
    const listed = await json<Listed>(await phone.send("/auth/multi-session/list-device-sessions"));
    expect(listed.length).toBeLessThanOrEqual(5);
  });
});

describe("a change made in one account", () => {
  it("is refused when another account is signed in by the time it's sent", async () => {
    const a = await signUp("Test Asha");
    const b = await signUp("Test Kabir");
    const r = await call("/api/collections/Notes/records", {
      cookie: b.cookie,
      headers: { "x-account": a.id },
      body: { values: { Title: "Test note" } },
    });
    expect(r.status).toBe(409);
    expect((await json(r)).error.details.account_changed).toBe(true);
    const ok = await call("/api/collections/Notes/records", {
      cookie: b.cookie,
      headers: { "x-account": b.id },
      body: { values: { Title: "Test note" } },
    });
    expect(ok.status).toBe(201);
  });
});
