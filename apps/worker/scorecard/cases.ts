// The scorecard's requests (docs/design/universal.md §10 "Model test"): real things people
// say, in English and Hinglish, each run through the whole app (router, tools, checks) on a
// fresh test person with fake data, and graded by what the app ended up with: the records,
// the cards waiting for a tap, the reply. Only the model calls are real.
import type { ChatView, FindResult, Memory, SavedView } from "@assistant/shared";
import { call, json, signUp } from "../test/http.ts";

export type User = Awaited<ReturnType<typeof signUp>>;

export const api =
  (u: User) =>
  (path: string, init: Parameters<typeof call>[1] = {}) =>
    call(`/api${path}`, { cookie: u.cookie, ...init });

export const find = (u: User, collection: string) =>
  api(u)(`/collections/${collection}/find`, { body: {} }).then((r) =>
    r.status === 200 ? json<FindResult>(r) : { items: [] as FindResult["items"] },
  );

export const say = (u: User, text: string) =>
  api(u)("/chat", { body: { text } }).then((r) => json<ChatView>(r));

/** Dates the way records show them ("13 Oct 2026"), in India time. */
export function dayIst(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export interface Outcome {
  view: ChatView;
  /** This turn's items only (after the person's message). */
  turn: ChatView["items"];
  reply: string;
  cards: NonNullable<ChatView["items"][number]["card"]>[];
}

export interface Case {
  id: string;
  /** What it tests, in a few words (shown in the scorecard). */
  about: string;
  /** 1: everyday (free model); 2: setups (smart model, only with AI credit). */
  level: 1 | 2;
  /** Hinglish or English, for the scorecard's split. */
  lang: "en" | "hi-en";
  text: string;
  /** Lists the person starts with (default: notes, reminders, events, expenses). */
  lists?: boolean;
  /** Fake data put in first, through the API (never through the model). */
  seed?: (u: User) => Promise<void>;
  /** null when it passed, else why not (shown in the scorecard). */
  check: (u: User, o: Outcome) => Promise<string | null>;
}

/** A stored date-time (UTC ISO) as India-time day and hour:minute, e.g. ["2026-10-13", "18:00"]. */
export function ist(iso: unknown): [string, string] | null {
  if (typeof iso !== "string" || !iso.includes("T")) return null;
  const t = new Date(Date.parse(iso) + 330 * 60_000).toISOString();
  return [t.slice(0, 10), t.slice(11, 16)];
}
const at = (iso: unknown, day: string | null, hm: string) => {
  const p = ist(iso);
  return !!p && (day === null || p[0] === day) && p[1] === hm;
};

const has = (s: string | null | undefined, ...parts: string[]) =>
  !!s && parts.every((p) => s.toLowerCase().includes(p.toLowerCase()));
const titles = async (u: User, c: string) => (await find(u, c)).items.map((r) => r.title);
const show = (x: unknown) => JSON.stringify(x).slice(0, 160);
const handedOver = (o: Outcome) =>
  o.turn.some((i) => i.role === "note" && has(i.text, "smart model")) ||
  has(o.reply, "needs the smart model");
const add = (u: User, collection: string, values: Record<string, unknown>) =>
  api(u)(`/collections/${collection}/records`, { body: { values } });

export const CASES: Case[] = [
  {
    id: "remind-tomorrow",
    about: "a reminder with a date",
    level: 1,
    lang: "en",
    text: "Remind me to restring the Strat tomorrow at 6 pm",
    check: async (u) => {
      const r = (await find(u, "Reminders")).items.find((i) => has(i.title, "restring"));
      if (!r) return `no reminder: ${show(await titles(u, "Reminders"))}`;
      return at(r.named.Due, isoDay(1), "18:00") ? null : `Due is ${ist(r.named.Due)?.join(" ") ?? "empty"}`;
    },
  },
  {
    id: "remind-hinglish",
    about: "Hinglish reminder with a time",
    level: 1,
    lang: "hi-en",
    text: "kal sham 7 baje Dev ko call karna hai, yaad dila dena",
    check: async (u) => {
      const r = (await find(u, "Reminders")).items.find((i) => has(i.title, "dev"));
      if (!r) return `no reminder: ${show(await titles(u, "Reminders"))}`;
      return at(r.named.Due, isoDay(1), "19:00") ? null : `Due is ${ist(r.named.Due)?.join(" ") ?? "empty"}`;
    },
  },
  {
    id: "note",
    about: "a plain note",
    level: 1,
    lang: "en",
    text: "Note: the PA at Test Café needs two DI boxes",
    check: async (u) => {
      const t = await titles(u, "Notes");
      return t.some((x) => has(x, "DI")) ? null : `notes: ${show(t)}`;
    },
  },
  {
    id: "expense",
    about: "money waits for a tap",
    level: 1,
    lang: "en",
    text: "Spent 450 on strings at Furtados",
    check: async (u, o) => {
      const c = o.cards.find((x) => x.tool === "add_record");
      if (!c) return `no card; reply: ${o.reply.slice(0, 120)}`;
      if (!c.details.some((d) => has(d, "450"))) return `card details: ${show(c.details)}`;
      return (await find(u, "Expenses")).items.length ? "added without a tap" : null;
    },
  },
  {
    id: "expense-hinglish",
    about: "Hinglish expense",
    level: 1,
    lang: "hi-en",
    text: "aaj chai aur samosa pe 60 rupaye kharch kiye",
    check: async (_u, o) => {
      const c = o.cards.find((x) => x.tool === "add_record");
      if (!c) return `no card; reply: ${o.reply.slice(0, 120)}`;
      return c.details.some((d) => has(d, "60")) ? null : `card details: ${show(c.details)}`;
    },
  },
  {
    id: "expense-yesterday",
    about: "expense dated yesterday",
    level: 1,
    lang: "en",
    text: "Paid 1200 for a cab to the gig yesterday, by UPI",
    check: async (_u, o) => {
      const c = o.cards.find((x) => x.tool === "add_record");
      if (!c) return `no card; reply: ${o.reply.slice(0, 120)}`;
      const d = c.details.join(" | ");
      const dated = has(d, isoDay(-1)) || has(d, dayIst(-1));
      return /1,?200/.test(d) && dated && has(d, "UPI") ? null : `card details: ${d}`;
    },
  },
  {
    id: "event",
    about: "an event with a place",
    level: 1,
    lang: "en",
    text: "Dinner with the band on Saturday 8 pm at Test Bistro",
    check: async (u) => {
      const e = (await find(u, "Events")).items[0];
      if (!e) return "no event";
      return at(e.named.Starts, null, "20:00") && has(String(e.named.Place ?? ""), "Bistro")
        ? null
        : `event: ${show(e.named)}`;
    },
  },
  {
    id: "three-at-once",
    about: "several items in one message",
    level: 1,
    lang: "en",
    text: "Add buy strings, book the rehearsal room and send the invoice to my reminders",
    check: async (u) => {
      const t = await titles(u, "Reminders");
      const ok = ["strings", "rehearsal", "invoice"].every((w) => t.some((x) => has(x, w)));
      return ok ? null : `reminders: ${show(t)}`;
    },
  },
  {
    id: "mark-done",
    about: "tick off an existing reminder",
    level: 1,
    lang: "en",
    text: "I bought the strings, tick it off",
    seed: async (u) => {
      await add(u, "Reminders", { Title: "Buy strings" });
      await add(u, "Reminders", { Title: "Call the venue" });
    },
    check: async (u) => {
      const items = (await find(u, "Reminders")).items;
      const strings = items.find((i) => has(i.title, "strings"));
      const venue = items.find((i) => has(i.title, "venue"));
      if (strings?.named.Done !== "Yes") return `Buy strings Done = ${strings?.named.Done}`;
      return venue?.named.Done === "Yes" ? "ticked the wrong one too" : null;
    },
  },
  {
    id: "move-time",
    about: "change a reminder's time",
    level: 1,
    lang: "en",
    text: "Move the rehearsal reminder to 8 pm",
    seed: async (u) => {
      await add(u, "Reminders", { Title: "Rehearsal", Due: `${isoDay(1)}T13:30:00.000Z` });
    },
    check: async (u) => {
      const r = (await find(u, "Reminders")).items.find((i) => has(i.title, "rehearsal"));
      return at(r?.named.Due, isoDay(1), "20:00")
        ? null
        : `Due is ${ist(r?.named.Due)?.join(" ") ?? "empty"}`;
    },
  },
  {
    id: "delete-waits",
    about: "a delete waits for a tap",
    level: 1,
    lang: "en",
    text: "Delete the note about the DI boxes",
    seed: async (u) => {
      await add(u, "Notes", { Title: "PA needs two DI boxes" });
      await add(u, "Notes", { Title: "Setlist ideas" });
    },
    check: async (u, o) => {
      const c = o.cards.find((x) => x.tool === "delete_record");
      if (!c) return `no delete card; reply: ${o.reply.slice(0, 120)}`;
      return (await titles(u, "Notes")).length === 2 ? null : "deleted without a tap";
    },
  },
  {
    id: "spent-total",
    about: "answer from the data",
    level: 1,
    lang: "en",
    text: "How much have I spent this month?",
    seed: async (u) => {
      await add(u, "Expenses", { What: "Strings", Amount: "450", Date: isoDay(0) });
      await add(u, "Expenses", { What: "Cab", Amount: "1200", Date: isoDay(0) });
    },
    check: async (_u, o) =>
      /1,?650/.test(o.reply) || o.turn.some((i) => i.role === "live")
        ? null
        : `reply: ${o.reply.slice(0, 160)}`,
  },
  {
    id: "find-note",
    about: "find something by meaning",
    level: 1,
    lang: "en",
    text: "What did I write about the sound system?",
    seed: async (u) => {
      await add(u, "Notes", { Title: "PA needs two DI boxes", Body: "The mixer at Test Café has no DI" });
      await add(u, "Notes", { Title: "Birthday gift for Ma" });
    },
    check: async (_u, o) =>
      has(o.reply, "DI") || o.turn.some((i) => i.role === "live") ? null : `reply: ${o.reply.slice(0, 160)}`,
  },
  {
    id: "show-list",
    about: "show a list",
    level: 1,
    lang: "en",
    text: "Show my reminders",
    seed: async (u) => {
      await add(u, "Reminders", { Title: "Buy strings" });
    },
    check: async (_u, o) =>
      o.turn.some((i) => i.role === "live") || has(o.reply, "strings")
        ? null
        : `reply: ${o.reply.slice(0, 160)}`,
  },
  {
    id: "remember",
    about: "remember a fact",
    level: 1,
    lang: "en",
    text: "Remember that my usual rate for a solo gig is 15000",
    check: async (u) => {
      const m = await json<Memory[]>(await api(u)("/memories"));
      return m.some((x) => /15,?000/.test(x.text)) ? null : `memories: ${show(m.map((x) => x.text))}`;
    },
  },
  {
    id: "recall",
    about: "use what it remembers",
    level: 1,
    lang: "en",
    text: "What's my usual solo rate?",
    seed: async (u) => {
      await api(u)("/memories", { body: { text: "Usual rate for a solo gig: ₹15,000" } });
    },
    check: async (_u, o) => (/15,?000/.test(o.reply) ? null : `reply: ${o.reply.slice(0, 160)}`),
  },
  {
    id: "start-list",
    about: "start an everyday list on the spot",
    level: 1,
    lang: "en",
    text: "Remind me to pay the rent on the 1st",
    lists: false,
    check: async (u) => {
      const t = await titles(u, "Reminders");
      return t.some((x) => has(x, "rent")) ? null : `reminders: ${show(t)}`;
    },
  },
  {
    id: "small-talk",
    about: "no tools for small talk",
    level: 1,
    lang: "en",
    text: "thanks, that's all for now!",
    check: async (u, o) => {
      if (o.cards.length) return `made a card: ${o.cards[0]!.tool}`;
      const n = (await titles(u, "Notes")).length + (await titles(u, "Reminders")).length;
      return n ? "wrote something" : null;
    },
  },
  {
    id: "handover-list",
    about: "hands a new list over to setups",
    level: 1,
    lang: "en",
    text: "Make me a list to track my guitar students with their phone number and monthly fee",
    check: async (u, o) => {
      if (handedOver(o)) return null;
      const cols = await json<{ name: string }[]>(await api(u)("/collections"));
      return cols.some((c) => has(c.name, "student")) ? null : `reply: ${o.reply.slice(0, 160)}`;
    },
  },
  {
    id: "handover-card",
    about: "hands a new home card over",
    level: 1,
    lang: "en",
    text: "Put a card on my home that shows what I spent this month by category",
    check: async (u, o) => {
      if (handedOver(o)) return null;
      const views = await json<SavedView[]>(await api(u)("/views"));
      return views.length > 4 ? null : `reply: ${o.reply.slice(0, 160)}`;
    },
  },
  {
    id: "setup-students",
    about: "build a list with fields",
    level: 2,
    lang: "en",
    text: "Make me a list to track my guitar students: name, phone, monthly fee, and which day they come",
    check: async (u, o) => {
      // A setup is shown as a card first; confirming makes it.
      const c = o.cards.find((x) => ["make_setup", "create_collection"].includes(x.tool));
      if (!c) return `no setup card; reply: ${o.reply.slice(0, 120)}`;
      const d = c.details.join(" | ");
      return has(d, "phone") && has(d, "fee") ? null : `card details: ${d.slice(0, 200)}`;
    },
  },
  {
    id: "setup-card",
    about: "make a home card",
    level: 2,
    lang: "en",
    text: "Pin a card on my home showing what I spent this month",
    seed: async (u) => {
      await add(u, "Expenses", { What: "Strings", Amount: "450", Date: isoDay(0) });
    },
    check: async (u, o) => {
      const before = 4; // the starter cards
      const views = await json<SavedView[]>(await api(u)("/views"));
      if (views.length > before) return null;
      return o.cards.some((x) => ["save_view", "make_setup"].includes(x.tool))
        ? null
        : `no card; reply: ${o.reply.slice(0, 120)}`;
    },
  },
  {
    id: "setup-practice",
    about: "a tracker with choices and a card",
    level: 2,
    lang: "hi-en",
    text: "mujhe ek practice tracker chahiye: songs, status learning ya ready, aur home pe ek card jo dikhaye kitne ready hain",
    check: async (_u, o) => {
      const c = o.cards.find((x) => ["make_setup", "create_collection"].includes(x.tool));
      if (!c) return `no setup card; reply: ${o.reply.slice(0, 120)}`;
      const d = c.details.join(" | ");
      return has(d, "learning") && has(d, "ready") ? null : `card details: ${d.slice(0, 200)}`;
    },
  },
];

/** "2026-10-13" in India time, `offset` days from today. */
export function isoDay(offset = 0): string {
  return new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

export { signUp };
