// Fake cards for the gallery (apps/mobile/app/gallery.tsx): every arrangement the app draws,
// at every size it can be drawn at, with obviously made-up data. Also a quick way to see a
// new part before any list uses it.
import type { CollectionView, FieldType, RecordView } from "@assistant/shared";
import { ARRANGEMENT_INFO } from "../catalogue.ts";
import { ARRANGEMENT_SIZES, ARRANGEMENTS, CARD_VERSION, type Arrangement, type CardSize } from "../spec.ts";
import type { HomeCard } from "./model.ts";
import type { CollectionColour } from "./theme.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const field = (id: string, name: string, type: FieldType) => ({
  id,
  name,
  type,
  options: {},
  required: false,
  aliases: [],
});
const COLLECTION: CollectionView = {
  id: "sample",
  name: "Sample list",
  description: null,
  title_field_id: "f_title",
  fields: [
    field("f_title", "Title", "text"),
    field("f_done", "Done", "boolean"),
    field("f_date", "Date", "date"),
    field("f_amount", "Amount", "money"),
  ],
  linked_from: [],
  updated_at: NOW,
};

const ROWS: [string, boolean, number, number][] = [
  ["Test strings for the Strat", true, -2, 45_000],
  ["Test rehearsal room", false, 1, 120_000],
  ["Test invoice to the café", false, 3, 1_500_000],
  ["Test cab to the gig", true, 6, 80_000],
  ["Test new capo", false, 12, 60_000],
];
const RECORDS: RecordView[] = ROWS.map(([title, done, offset, paise], i) => ({
  id: `r${i}`,
  collection_id: COLLECTION.id,
  title,
  values: { f_title: title, f_done: done, f_date: day(offset), f_amount: paise },
  named: {
    Title: title,
    Done: done ? "Yes" : "No",
    Date: day(offset),
    Amount: `₹${(paise / 100).toLocaleString("en-IN")}`,
  },
  links: {},
  created_at: NOW,
  updated_at: NOW,
  version: 1,
}));

const COLOURS: CollectionColour[] = ["time", "money", "people", "music", "flow", "home", "neutral"];

/** What the gallery shows: the arrangements the app draws (not the ones still to come). */
export const GALLERY_ARRANGEMENTS: Arrangement[] = ARRANGEMENTS.filter(
  (a) => !ARRANGEMENT_INFO[a].later && a !== "question" && a !== "quick-add",
);

export function sampleCard(arrangement: Arrangement, size: CardSize): HomeCard {
  const colour = COLOURS[GALLERY_ARRANGEMENTS.indexOf(arrangement) % COLOURS.length]!;
  const source = {
    collection: COLLECTION.id,
    sum_field: arrangement === "number" ? "f_amount" : null,
    answer_field: arrangement === "list-ticks" || arrangement === "progress" ? "f_done" : null,
    date_field: arrangement === "next" || arrangement === "countdown" ? "f_date" : null,
  };
  const records =
    arrangement === "next" || arrangement === "countdown"
      ? [...RECORDS]
          .filter((r) => String(r.values.f_date) >= day(0))
          .sort((a, b) => String(a.values.f_date).localeCompare(String(b.values.f_date)))
      : RECORDS;
  const card: HomeCard = {
    id: `sample:${arrangement}:${size}`,
    view: null,
    spec: {
      version: CARD_VERSION,
      title: `${arrangement} · ${size.toUpperCase()}`,
      arrangement,
      size,
      sources: [source],
    },
    collection: COLLECTION,
    colour,
    records,
    total: arrangement === "number" ? ROWS.reduce((a, r) => a + r[3], 0) : null,
  };
  if (arrangement === "memory")
    card.memory = [
      { id: "m1", text: "Usual rate for a solo gig: ₹15,000 (test)", source: "From a chat" },
      { id: "m2", text: "Test Café pays by UPI, a week after", source: "From a chat" },
    ] as HomeCard["memory"];
  if (arrangement === "process")
    card.waiting = {
      id: "w1",
      space_id: "sample",
      workflow_id: "wf1",
      workflow: "Confirm the lineup",
      record_id: "r1",
      record: "Test wedding, Saturday",
      text: "Can you play the Test wedding on Saturday?",
      choices: ["Yes", "No"],
      on: [
        { user_id: "u1", name: "Test Rahul", answer: "Yes" },
        { user_id: "u2", name: "Test Priya", answer: null },
      ],
      asked_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      nudges: 0,
      next_nudge_at: null,
      share_id: null,
      mine: null,
    };
  return card;
}

/** Every drawn arrangement at every size it allows: the small ones first (they pair up), then
 *  medium, then large, each in catalogue order. */
export function sampleCards(): HomeCard[] {
  return (["s", "m", "l"] as const).flatMap((size) =>
    GALLERY_ARRANGEMENTS.filter((a) => ARRANGEMENT_SIZES[a].includes(size)).map((a) => sampleCard(a, size)),
  );
}
