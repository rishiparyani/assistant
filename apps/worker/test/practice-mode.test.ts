// Rehearsing as a person (docs/design/from-scratch.md §2 point 9, FS3): with the
// `x-practice-as` header the whole API answers as one of a practice copy's people, from the
// copy only. Fake data only.
import { describe, expect, it } from "vitest";
import type {
  CreatedShare,
  MeResponse,
  PracticeView,
  RecordView,
  SharedWithMe,
  SpaceView,
  WaitingItem,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User, as?: string) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...(as ? { headers: { "x-practice-as": as } } : {}), ...init });
async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

describe("rehearsing as a person", () => {
  it("answers every call as the person played, from the copy only, and refuses the rest", async () => {
    const owner = await signUp("Test Owner");
    const note = await json<RecordView>(
      await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test plan" } } }),
    );
    const { link } = await json<CreatedShare>(
      await api(owner)("/shares", { body: { record_id: note.id, access: "view" } }),
    );
    const rahul = await signUp("Rahul Test");
    const priya = await signUp("Priya Test");
    for (const u of [rahul, priya])
      await api(u)("/cards/join", { body: { token: link.slice(link.indexOf("#") + 1) } });
    await api(owner)("/collections", {
      body: {
        name: "Dinners",
        fields: [
          { name: "Title", type: "text" },
          { name: "Reply", type: "text" },
        ],
      },
    });
    await api(owner)("/workflows", {
      body: {
        name: "One then the other",
        when: { event: "added", collection: "Dinners" },
        then: [
          { do: "ask", who: ["Rahul"], text: "Book {Title}?", choices: ["Yes", "No"], save_to: "Reply" },
          { do: "ask", who: ["Priya"], text: "Rahul said {Reply}. Bring dessert?", choices: ["Yes", "No"] },
        ],
        enabled: false,
      },
    });
    const practice = await json<SpaceView>(await api(owner)("/spaces/Personal/practice", { body: {} }));
    const base = `/spaces/${practice.id}/practice`;
    const v = await json<PracticeView>(await api(owner)(base));
    const id = (name: string) => v.people.find((p) => p.name === name)!.user_id;
    const asRahul = api(owner, `${practice.id} ${id("Rahul Test")}`);
    const asPriya = api(owner, `${practice.id} ${id("Priya Test")}`);

    // Who I am: Rahul, with no assistant; the rehearsal is named.
    const me = await json<MeResponse>(await asRahul("/me"));
    expect([me.user.name, me.assistant, me.practice?.space]).toEqual(["Rahul Test", false, practice.id]);
    // Rahul only has cards, so no spaces; the owner's own things never show.
    expect(await json<SpaceView[]>(await asRahul("/spaces"))).toEqual([]);
    expect(await json(await asRahul("/groups"))).toEqual([]);
    expect(await json(await asRahul("/memories"))).toEqual([]);
    expect((await json<SharedWithMe[]>(await asRahul("/cards"))).map((c) => [c.kind, c.title])).toEqual([
      ["card", "Test plan"],
    ]);
    // What isn't using the copy is refused while rehearsing.
    expect((await asRahul("/spaces", { body: { name: "Test new" } })).status).toBe(403);
    expect((await asRahul(`${base}`)).status).toBe(403);
    expect((await asRahul("/chats")).status).toBe(403);

    // The flow runs in the copy: Rahul's question waits on him, answered as him; then Priya's.
    await api(owner)("/collections/Dinners/records", {
      body: { space: practice.id, values: { Title: "Test Friday" } },
    });
    expect(await until(async () => (await json<WaitingItem[]>(await asRahul("/waiting"))).length === 1)).toBe(
      true,
    );
    const wait = (await json<WaitingItem[]>(await asRahul("/waiting")))[0]!;
    expect([wait.text, !!wait.share_id]).toEqual(["Book Test Friday?", true]);
    expect((await asPriya("/waiting", {})).status).toBe(200);
    expect(await json<WaitingItem[]>(await asPriya("/waiting"))).toEqual([]);
    expect((await asPriya(`/cards/${wait.share_id}/answer`, { body: { answer: "Yes" } })).status).toBe(404);
    expect((await asRahul(`/cards/${wait.share_id}/answer`, { body: { answer: "Yes" } })).status).toBe(200);
    expect(await until(async () => (await json<WaitingItem[]>(await asPriya("/waiting"))).length === 1)).toBe(
      true,
    );
    expect((await json<WaitingItem[]>(await asPriya("/waiting")))[0]!.text).toBe(
      "Rahul said Yes. Bring dessert?",
    );
    // Nothing reached the real people.
    expect((await json<SharedWithMe[]>(await api(rahul)("/cards"))).some((c) => c.kind === "question")).toBe(
      false,
    );

    // Playing yourself: the copy as its owner, with its lists.
    const asMe = api(owner, `${practice.id} ${owner.id}`);
    const mine = await json<SpaceView[]>(await asMe("/spaces"));
    expect(mine.map((s) => [s.id, s.role])).toEqual([[practice.id, "owner"]]);

    // A rehearsal that isn't yours, or isn't a copy, is 404 (the header is the only way in).
    expect((await api(rahul, `${practice.id} ${id("Priya Test")}`)("/me")).status).toBe(404);
    const personal = (await json<SpaceView[]>(await api(owner)("/spaces"))).find(
      (s) => s.kind === "personal",
    )!;
    expect((await api(owner, `${personal.id} ${id("Rahul Test")}`)("/me")).status).toBe(404);
    expect((await api(owner, "nonsense")("/me")).status).toBe(404);
  });
});
