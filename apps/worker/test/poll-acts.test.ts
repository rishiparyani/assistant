// Questions that act (decision 2026-10-15): a chat question tied to a pinned record's personal
// field; each person's answer in the chat becomes their own answer on the record, through the
// share, from the chat's alarm. Fake data only.
import { describe, expect, it } from "vitest";
import {
  ulid,
  type CollectionView,
  type CreatedShare,
  type GroupView,
  type RecordView,
} from "@assistant/shared";
import { call, json, signUp } from "./http.ts";

type User = Awaited<ReturnType<typeof signUp>>;
const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);
/** The newest question in the chat. */
const lastPoll = (g: GroupView) => [...g.messages].reverse().find((m) => m.kind === "poll")!;

async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** A show with personal answers (Playing? yes/no, Lift: a choice) pinned to a chat with Asha. */
async function gig() {
  const owner = await signUp("Test Owner");
  const note = await json<RecordView>(
    await api(owner)("/collections/Notes/records", { body: { values: { Title: "Test band notes" } } }),
  );
  const { link } = await json<CreatedShare>(await api(owner)("/shares", { body: { record_id: note.id } }));
  const asha = await signUp("Test Asha");
  await api(asha)("/cards/join", { body: { token: tokenOf(link) } });
  const shows = await json<CollectionView>(
    await api(owner)("/collections", {
      body: {
        name: "Test Shows",
        fields: [
          { name: "Title", type: "text" },
          { name: "Venue", type: "text" },
          { name: "Playing?", type: "boolean", options: { personal: true } },
          {
            name: "Lift",
            type: "choice",
            options: { choices: ["Own car", "Need a lift", "Train"], personal: true },
          },
        ],
      },
    }),
  );
  const show = await json<RecordView>(
    await api(owner)("/collections/Test Shows/records", {
      body: { values: { Title: "Test Taj night", Venue: "Test Taj" } },
    }),
  );
  const chat = ulid();
  const g = await json<GroupView>(
    await api(owner)(`/records/${show.id}/chat`, { body: { chat_id: chat, people: ["Test Asha"] } }),
  );
  const shareId = g.cards[0]!.share_id;
  // Asha sees the card once the chat has told the share who's in.
  expect(await until(async () => (await api(asha)(`/groups/${chat}/cards/${shareId}`)).status === 200)).toBe(
    true,
  );
  const field = (name: string) => shows.fields.find((f) => f.name === name)!.id;
  const answers = async (name: string) =>
    (await json<RecordView>(await api(owner)(`/records/${show.id}`))).answers?.[field(name)] ?? [];
  return { owner, asha, show, chat, shareId, answers };
}

describe("questions that act", () => {
  it("fills in each person's own answer on the pinned record", async () => {
    const { owner, asha, chat, shareId, answers } = await gig();
    const g = await json<GroupView>(
      await api(owner)(`/groups/${chat}/polls`, {
        body: { question: "Playing Taj on Saturday?", about: { share_id: shareId, field: "Playing?" } },
      }),
    );
    const poll = lastPoll(g);
    expect(g.polls[poll.id]).toMatchObject({
      options: ["Yes", "No", "Maybe"],
      about: { share_id: shareId, record: "Test Taj night", field: "Playing?" },
    });

    await api(asha)(`/groups/${chat}/polls/${poll.id}/vote`, { body: { option: "Yes" } });
    expect(await until(async () => (await answers("Playing?")).some((a) => a.name === "Test Asha"))).toBe(
      true,
    );
    expect((await answers("Playing?")).find((a) => a.name === "Test Asha")).toMatchObject({ value: true });

    // Changing the answer changes the record; "Maybe" and taking it back clear it.
    await api(asha)(`/groups/${chat}/polls/${poll.id}/vote`, { body: { option: "No" } });
    expect(
      await until(
        async () => (await answers("Playing?")).find((a) => a.name === "Test Asha")?.value === false,
      ),
    ).toBe(true);
    await api(asha)(`/groups/${chat}/polls/${poll.id}/vote`, { body: { option: null } });
    expect(await until(async () => !(await answers("Playing?")).some((a) => a.name === "Test Asha"))).toBe(
      true,
    );

    // The owner's own answer in the chat lands on their record too.
    await api(owner)(`/groups/${chat}/polls/${poll.id}/vote`, { body: { option: "Yes" } });
    expect(await until(async () => (await answers("Playing?")).some((a) => a.name === "Test Owner"))).toBe(
      true,
    );
  });

  it("takes a choice field's own choices as the answers", async () => {
    const { owner, asha, chat, shareId, answers } = await gig();
    // Answers that aren't the field's choices are refused.
    expect(
      (
        await api(owner)(`/groups/${chat}/polls`, {
          body: {
            question: "How are you getting there?",
            options: ["Bus", "Walk"],
            about: { share_id: shareId, field: "Lift" },
          },
        })
      ).status,
    ).toBe(400);
    const g = await json<GroupView>(
      await api(owner)(`/groups/${chat}/polls`, {
        body: {
          question: "How are you getting there?",
          options: ["Own car", "Need a lift", "Train"],
          about: { share_id: shareId, field: "Lift" },
        },
      }),
    );
    const poll = lastPoll(g);
    await api(asha)(`/groups/${chat}/polls/${poll.id}/vote`, { body: { option: "Need a lift" } });
    expect(
      await until(
        async () => (await answers("Lift")).find((a) => a.name === "Test Asha")?.value === "Need a lift",
      ),
    ).toBe(true);
    // A question made with the choices spelt differently still fills in the field's own spelling.
    const g2 = await json<GroupView>(
      await api(owner)(`/groups/${chat}/polls`, {
        body: {
          question: "Lift, again?",
          options: ["own car", "need a lift", "train"],
          about: { share_id: shareId, field: "Lift" },
        },
      }),
    );
    await api(asha)(`/groups/${chat}/polls/${lastPoll(g2).id}/vote`, { body: { option: "train" } });
    expect(
      await until(async () => (await answers("Lift")).find((a) => a.name === "Test Asha")?.value === "Train"),
    ).toBe(true);
  });

  it("drops an answer the record can't take, so later answers still land", async () => {
    const { owner, asha, chat, shareId, answers } = await gig();
    const g = await json<GroupView>(
      await api(owner)(`/groups/${chat}/polls`, {
        body: {
          question: "How are you getting there?",
          options: ["Own car", "Need a lift", "Train"],
          about: { share_id: shareId, field: "Lift" },
        },
      }),
    );
    const lift = lastPoll(g).id;
    // Asha answers while the owner takes "Train" out of the field's choices.
    const shows = await json<CollectionView>(await api(owner)("/collections/Test Shows"));
    const liftField = shows.fields.find((f) => f.name === "Lift")!;
    await api(owner)(`/collections/Test Shows/fields/${liftField.id}`, {
      method: "PATCH",
      body: { options: { choices: ["Own car", "Need a lift"], personal: true } },
    });
    await api(asha)(`/groups/${chat}/polls/${lift}/vote`, { body: { option: "Train" } });
    // Then answers a yes/no question; that one must still reach the record.
    const g2 = await json<GroupView>(
      await api(owner)(`/groups/${chat}/polls`, {
        body: { question: "Playing?", about: { share_id: shareId, field: "Playing?" } },
      }),
    );
    await api(asha)(`/groups/${chat}/polls/${lastPoll(g2).id}/vote`, { body: { option: "Yes" } });
    expect(await until(async () => (await answers("Playing?")).some((a) => a.name === "Test Asha"))).toBe(
      true,
    );
    expect((await answers("Lift")).some((a) => a.name === "Test Asha")).toBe(false);
  });

  it("only fills in personal yes/no or choice fields, and only admins or the pin's owner ask", async () => {
    const { owner, asha, chat, shareId } = await gig();
    // A plain field isn't anyone's own answer.
    const plain = await api(owner)(`/groups/${chat}/polls`, {
      body: { question: "Venue?", about: { share_id: shareId, field: "Venue" } },
    });
    expect(plain.status).toBe(400);
    // A member who isn't an admin can still ask everyone, but not fill a record in.
    expect((await api(asha)(`/groups/${chat}/polls`, { body: { question: "Free on Sat?" } })).status).toBe(
      200,
    );
    expect(
      (
        await api(asha)(`/groups/${chat}/polls`, {
          body: { question: "Playing?", about: { share_id: shareId, field: "Playing?" } },
        })
      ).status,
    ).toBe(403);
    // Something not pinned here: 404.
    expect(
      (
        await api(owner)(`/groups/${chat}/polls`, {
          body: {
            question: "Playing?",
            about: { share_id: "01HZZZZZZZZZZZZZZZZZZZZZZZ", field: "Playing?" },
          },
        })
      ).status,
    ).toBe(404);
  });
});
