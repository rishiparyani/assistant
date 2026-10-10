// Rules on a collection (chat-first step 6): checks, uniqueness and status flows, enforced in
// every write. Fake data only.
import { describe, expect, it } from "vitest";
import type { CollectionView, RecordView, RuleView } from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

async function famJam(me: User) {
  await api(me)("/collections", { body: { name: "Songs", fields: [{ name: "Title", type: "text" }] } });
  await api(me)("/collections", {
    body: {
      name: "Sign-ups",
      fields: [
        { name: "Person", type: "text" },
        { name: "Song", type: "link", options: { target: "Songs" } },
        { name: "Instrument", type: "choice", options: { choices: ["Guitar", "Keys"] } },
        { name: "Status", type: "choice", options: { choices: ["Requested", "Selected", "Not this time"] } },
      ],
    },
  });
  const song = await json<RecordView>(
    await api(me)("/collections/Songs/records", { body: { values: { Title: "Test Song One" } } }),
  );
  const signUpFor = async (person: string) =>
    json<RecordView>(
      await api(me)("/collections/Sign-ups/records", {
        body: { values: { Person: person, Song: song.id, Instrument: "Guitar", Status: "Requested" } },
      }),
    );
  return { song, signUpFor };
}
const set = (me: User, id: string, values: Record<string, unknown>) =>
  api(me)(`/records/${id}`, { method: "PATCH", body: { values } });

describe("rules", () => {
  it("checks a value on every save, and refuses a rule records already break", async () => {
    const me = await signUp("Test Owner");
    await api(me)("/collections/Expenses/records", { body: { values: { What: "Test free", Amount: "0" } } });
    const broken = await api(me)("/collections/Expenses/rules", {
      body: { kind: "check", require: [{ field: "Amount", op: "gt", value: "0" }] },
    });
    expect(broken.status).toBe(400);

    const me2 = await signUp("Test Owner");
    const ok = await api(me2)("/collections/Expenses/rules", {
      body: {
        kind: "check",
        require: [{ field: "Amount", op: "gt", value: "0" }],
        message: "Amount must be more than zero",
      },
    });
    expect(ok.status).toBe(201);
    const rule = await json<RuleView>(ok);
    expect(rule.words).toBe("In Expenses: Amount is more than 0");
    const zero = await api(me2)("/collections/Expenses/records", {
      body: { values: { What: "Test zero", Amount: "0" } },
    });
    expect(zero.status).toBe(400);
    expect(JSON.stringify(await zero.json())).toContain("Amount must be more than zero");
    expect(
      (
        await api(me2)("/collections/Expenses/records", {
          body: { values: { What: "Test tea", Amount: "20" } },
        })
      ).status,
    ).toBe(201);
    // The collection describes its rules; removing it lifts it.
    const col = await json<CollectionView>(await api(me2)("/collections/Expenses"));
    expect(col.rules?.map((r) => r.words)).toEqual(["In Expenses: Amount is more than 0"]);
    expect((await api(me2)(`/rules/${rule.id}`, { method: "DELETE" })).status).toBe(200);
    expect(
      (
        await api(me2)("/collections/Expenses/records", {
          body: { values: { What: "Test zero", Amount: "0" } },
        })
      ).status,
    ).toBe(201);
  });

  it("keeps one Selected guitarist per song, and says who has the place", async () => {
    const me = await signUp("Test Organiser");
    const { signUpFor } = await famJam(me);
    const rule = await json<RuleView>(
      await api(me)("/collections/Sign-ups/rules", {
        body: {
          kind: "unique",
          fields: ["Song", "Instrument"],
          only_if: [{ field: "Status", op: "eq", value: "Selected" }],
        },
      }),
    );
    expect(rule.words).toBe("In Sign-ups, only one record when Status is Selected per Song and Instrument");
    const rahul = await signUpFor("Test Rahul");
    const dev = await signUpFor("Test Dev");
    expect((await set(me, rahul.id, { Status: "Selected" })).status).toBe(200);
    const clash = await set(me, dev.id, { Status: "Selected" });
    expect(clash.status).toBe(409);
    const body = (await clash.json()) as {
      error: { details: { reason: string; existing: { id: string }[] } };
    };
    expect(body.error.details.reason).toBe("unique");
    expect(body.error.details.existing.map((e) => e.id)).toEqual([rahul.id]);
    // Replace: Rahul steps down, then Dev can be selected.
    expect((await set(me, rahul.id, { Status: "Not this time" })).status).toBe(200);
    expect((await set(me, dev.id, { Status: "Selected" })).status).toBe(200);
  });

  it("allows only the listed moves of a status", async () => {
    const me = await signUp("Test Organiser");
    const { signUpFor } = await famJam(me);
    const flow = await api(me)("/collections/Sign-ups/rules", {
      body: {
        kind: "flow",
        field: "Status",
        moves: { Requested: ["Selected", "Not this time"], Selected: ["Not this time"], "Not this time": [] },
      },
    });
    expect(flow.status).toBe(201);
    expect((await json<RuleView>(flow)).words).toBe(
      "Status in Sign-ups moves only Requested → Selected or Not this time; Selected → Not this time; Not this time → nothing",
    );
    const one = await signUpFor("Test Asha");
    expect((await set(me, one.id, { Status: "Selected" })).status).toBe(200);
    expect((await set(me, one.id, { Status: "Requested" })).status).toBe(400);
    expect((await set(me, one.id, { Status: "Not this time" })).status).toBe(200);
    // A value the rule leaves out can't move at all, and the words say so.
    const loose = await signUp("Test Organiser");
    const two = await famJam(loose);
    const partial = await json<RuleView>(
      await api(loose)("/collections/Sign-ups/rules", {
        body: { kind: "flow", field: "Status", moves: { Requested: ["Selected"] } },
      }),
    );
    expect(partial.words).toBe(
      "Status in Sign-ups moves only Requested → Selected; Selected → nothing; Not this time → nothing",
    );
    const asha = await two.signUpFor("Test Asha");
    expect((await set(loose, asha.id, { Status: "Selected" })).status).toBe(200);
    expect((await set(loose, asha.id, { Status: "Requested" })).status).toBe(400);
    // Unknown choices are refused when the rule is saved.
    expect(
      (
        await api(me)("/collections/Sign-ups/rules", {
          body: { kind: "flow", field: "Status", moves: { Requested: ["Maybe"] } },
        })
      ).status,
    ).toBe(400);
  });

  it("checks links changed on their own, and keeps the fields a rule uses", async () => {
    const me = await signUp("Test Organiser");
    const { song, signUpFor } = await famJam(me);
    const rule = await json<RuleView>(
      await api(me)("/collections/Sign-ups/rules", {
        body: { kind: "check", require: [{ field: "Song", op: "not_empty" }] },
      }),
    );
    const one = await signUpFor("Test Asha");
    // Taking the song off through the link route breaks the check, so it's refused.
    const off = await api(me)(`/records/${one.id}/unlink`, { body: { field: "Song", to: [song.id] } });
    expect(off.status).toBe(400);
    // Uniqueness holds for the link route too.
    await api(me)("/collections/Sign-ups/rules", {
      body: { kind: "unique", fields: ["Song", "Instrument"] },
    });
    const other = await json<RecordView>(
      await api(me)("/collections/Songs/records", { body: { values: { Title: "Test Song Two" } } }),
    );
    const second = await json<RecordView>(
      await api(me)("/collections/Sign-ups/records", {
        body: { values: { Person: "Test Dev", Song: other.id, Instrument: "Guitar" } },
      }),
    );
    const clash = await api(me)(`/records/${second.id}/links`, { body: { field: "Song", to: [song.id] } });
    expect(clash.status).toBe(409);
    // A field a rule uses can't be removed until the rule goes.
    const remove = () => api(me)("/collections/Sign-ups/fields/Song", { method: "DELETE" });
    expect((await remove()).status).toBe(409);
    for (const r of (await json<CollectionView>(await api(me)("/collections/Sign-ups"))).rules ?? [])
      await api(me)(`/rules/${r.id}`, { method: "DELETE" });
    expect(rule.id).toBeTruthy();
    expect((await remove()).status).toBe(200);
  });
});
