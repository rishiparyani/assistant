// The fam jam test (docs/design/universal.md §5; chat-first step 6): sign-ups run end to end
// from the blocks, with no fam-jam code. Fake data only.
import { describe, expect, it } from "vitest";
import type { CreatedShare, FindResult, RecordView, SharedListView, WorkflowView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);

async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
type Inbox = { items: { title: string; body: string | null }[] };
const inbox = async (u: User) => (await json<Inbox>(await api(u)("/me/notifications"))).items;

describe("fam jam sign-ups", () => {
  it("runs from setup to results", async () => {
    // 1. Setup: one card, made in one go.
    const organizer = await signUp("Test Organizer");
    const made = await api(organizer)("/setups", {
      body: {
        name: "Test fam jam",
        collections: [
          {
            name: "Songs",
            fields: [
              { name: "Title", type: "text" },
              { name: "Artist", type: "text" },
              { name: "Set", type: "choice", options: { choices: ["Early", "Late"] } },
            ],
          },
          {
            name: "Sign-ups",
            fields: [
              { name: "Note", type: "text" },
              { name: "Song", type: "link", required: true, options: { target: "Songs" } },
              { name: "Who", type: "person" },
              { name: "Instrument", type: "choice", options: { choices: ["Guitar", "Keys", "Vocals"] } },
              {
                name: "Status",
                type: "choice",
                options: { choices: ["Requested", "Selected", "Not this time"] },
              },
            ],
          },
        ],
        rules: [
          {
            collection: "Sign-ups",
            kind: "unique",
            fields: ["Song", "Instrument"],
            only_if: [{ field: "Status", op: "eq", value: "Selected" }],
          },
          {
            collection: "Sign-ups",
            kind: "flow",
            field: "Status",
            moves: {
              Requested: ["Selected", "Not this time"],
              Selected: ["Not this time"],
              "Not this time": ["Selected"],
            },
          },
        ],
        views: [{ name: "Test songs", collection: "Songs" }],
      },
    });
    expect(made.status).toBe(201);
    const songs: RecordView[] = [];
    for (const [t, set] of [
      ["Test Song A", "Early"],
      ["Test Song B", "Late"],
    ])
      songs.push(
        await json<RecordView>(
          await api(organizer)("/collections/Songs/records", { body: { values: { Title: t, Set: set } } }),
        ),
      );

    // 2. One join link for the songs, one for the sign-up form.
    const songShare = await json<CreatedShare>(
      await api(organizer)("/shares", { body: { view: "Test songs" } }),
    );
    const form = await json<CreatedShare>(
      await api(organizer)("/shares", { body: { form: "Sign-ups", hide_fields: ["Status"] } }),
    );
    // A link-only form can't fill in the required Song (nobody to pick as); a signed-in one can.
    expect(
      (await api(organizer)("/shares", { body: { form: "Sign-ups", public: true, hide_fields: ["Status"] } }))
        .status,
    ).toBe(400);
    const [rahul, dev, asha] = [
      await signUp("Test Rahul"),
      await signUp("Test Dev"),
      await signUp("Test Asha"),
    ];
    for (const u of [rahul, dev, asha])
      for (const s of [songShare, form])
        expect((await api(u)("/cards/join", { body: { token: tokenOf(s.link) } })).status).toBe(200);

    // 3. Per-person visibility: Rahul only sees the late set.
    const rahulId = (
      await json<{ people: { user_id: string; name: string }[] }[]>(
        await api(organizer)(`/shares?target_id=${songShare.share.target_id}`),
      )
    )[0]!.people.find((p) => p.name === "Test Rahul")!.user_id;
    await api(organizer)(`/shares/${songShare.share.id}/rules/${rahulId}`, {
      method: "PUT",
      body: { filters: [{ field: "Set", op: "eq", value: "Late" }] },
    });
    const seen = async (u: User) =>
      (await json<SharedListView>(await api(u)(`/cards/${songShare.share.id}`))).records.map((r) => r.title);
    expect(await seen(rahul)).toEqual(["Test Song B"]);
    expect((await seen(dev)).sort()).toEqual(["Test Song A", "Test Song B"]);

    // 4. Each signs up through the form as themselves ("me").
    const signUpFor = async (u: User, song: RecordView, instrument: string) =>
      api(u)(`/cards/${form.share.id}/records`, {
        body: { section: "form", values: { Song: song.id, Who: "me", Instrument: instrument } },
      });
    for (const [u, s] of [
      [rahul, songs[1]!],
      [dev, songs[1]!],
      [asha, songs[0]!],
    ] as const)
      expect((await signUpFor(u, s, "Guitar")).status).toBe(201);

    // The form offers Rahul only the songs he can see, and "Me" for Who.
    const rahulForm = await json<{ fields: { name: string; pick?: { title: string }[] }[] }>(
      await api(rahul)(`/cards/${form.share.id}`),
    );
    expect(rahulForm.fields.find((f) => f.name === "Song")?.pick?.map((p) => p.title)).toEqual([
      "Test Song B",
    ]);
    expect(rahulForm.fields.find((f) => f.name === "Who")?.pick?.map((p) => p.title)).toEqual(["Me"]);
    // A song hidden from Rahul can't be signed up for either.
    expect((await signUpFor(rahul, songs[0]!, "Keys")).status).toBe(403);

    // 5. Results: tell each selected person (a workflow from blocks).
    const wf = await json<WorkflowView>(
      await api(organizer)("/workflows", {
        body: {
          name: "Test you're in",
          when: { event: "changed", collection: "Sign-ups", field: "Status" },
          check: [{ field: "Status", op: "eq", value: "Selected" }],
          then: [{ do: "notify", text: "You're playing at the fam jam", to: ["{Who}"] }],
          enabled: true,
        },
      }),
    );
    expect(wf.words.at(-1)).toBe("Tell {Who}: “You're playing at the fam jam”");

    // 6. Consolidating: one guitarist per song; replacing someone means moving them first.
    const all = await json<FindResult>(await api(organizer)("/collections/Sign-ups/find", { body: {} }));
    const by = (name: string) => all.items.find((r) => r.named.Who === name)!;
    const set = (r: RecordView, Status: string) =>
      api(organizer)(`/records/${r.id}`, { method: "PATCH", body: { values: { Status } } });
    for (const r of all.items) await set(r, "Requested");
    expect((await set(by("Test Rahul"), "Selected")).status).toBe(200);
    const clash = await set(by("Test Dev"), "Selected");
    expect(clash.status).toBe(409);
    expect((await set(by("Test Rahul"), "Not this time")).status).toBe(200);
    expect((await set(by("Test Dev"), "Selected")).status).toBe(200);
    expect((await set(by("Test Asha"), "Selected")).status).toBe(200);

    // Dev and Asha hear they're in; Rahul doesn't.
    expect(
      await until(async () => (await inbox(dev)).some((n) => n.body === "You're playing at the fam jam")),
    ).toBe(true);
    expect(
      await until(async () => (await inbox(asha)).some((n) => n.body === "You're playing at the fam jam")),
    ).toBe(true);
    expect((await inbox(rahul)).some((n) => n.title === "Test you're in")).toBe(false);
  });
});
