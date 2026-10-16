// The home you arrange (decision 2026-10-16 "A home you arrange"): each person's pages of
// cards, kept in their Personal space, theirs alone. Fake data only.
import { describe, expect, it } from "vitest";
import type { HomeLayout } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

describe("home layout", () => {
  it("starts empty, keeps pages in order without empty ones, and is per person", async () => {
    const asha = await signUp("Asha Test");
    const ravi = await signUp("Ravi Test");
    expect(await json(await api(asha)("/me/home"))).toBeNull();
    const put = await api(asha)("/me/home", {
      method: "PUT",
      body: { pages: [["now", "view:s1:v1"], [], ["share:x"]], seen: ["now", "view:s1:v1", "share:x"] },
    });
    expect(put.status).toBe(200);
    const got = await json<HomeLayout>(await api(asha)("/me/home"));
    expect(got.pages).toEqual([["now", "view:s1:v1"], ["share:x"]]);
    expect(got.seen).toEqual(["now", "view:s1:v1", "share:x"]);
    // Someone else's home is their own.
    expect(await json(await api(ravi)("/me/home"))).toBeNull();
    // Too many pages is refused.
    const many = Array.from({ length: 21 }, () => ["now"]);
    expect((await api(asha)("/me/home", { method: "PUT", body: { pages: many, seen: [] } })).status).toBe(
      400,
    );
  });
});
