// Shared by the questions-that-act tests: a show with personal answers and plain fields, pinned
// to a chat with Asha. Fake data only.
import {
  ulid,
  type CollectionView,
  type CreatedShare,
  type GroupView,
  type RecordView,
} from "@assistant/shared";
import { expect } from "vitest";
import { call, json, signUp } from "./http.ts";
export { json };

export type User = Awaited<ReturnType<typeof signUp>>;
export const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });
const tokenOf = (link: string) => link.slice(link.indexOf("#") + 1);
/** The newest question in the chat. */
export const lastPoll = (g: GroupView) => [...g.messages].reverse().find((m) => m.kind === "poll")!;

export async function until(check: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** A show with personal answers (Playing? yes/no, Lift: a choice) pinned to a chat with Asha. */
export async function gig() {
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
          { name: "Fee", type: "money" },
          { name: "Call time", type: "datetime" },
          { name: "Dress", type: "choice", options: { choices: ["Black", "Casual", "Band tees"] } },
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
  const value = async (name: string) =>
    (await json<RecordView>(await api(owner)(`/records/${show.id}`))).values[field(name)] ?? null;
  return { owner, asha, show, chat, shareId, answers, value };
}
