// Fake cards for the gallery (apps/mobile/app/gallery.tsx): every arrangement the app draws,
// at every size it can be drawn at, with obviously made-up data. Also a quick way to see a
// new part before any list uses it.
import type { CollectionView, FieldType, QueryResult, RecordView } from "@assistant/shared";
import { ARRANGEMENT_INFO } from "../catalogue.ts";
import {
  ARRANGEMENT_SIZES,
  ARRANGEMENTS,
  CARD_SIZES,
  CARD_VERSION,
  type Arrangement,
  type CardSize,
} from "../spec.ts";
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
  ["Test electricity bill", true, -2, 45_000],
  ["Test plumber visit", false, 1, 120_000],
  ["Test invoice to the client", false, 3, 1_500_000],
  ["Test cab to the airport", true, 6, 80_000],
  ["Test new phone cover", false, 12, 60_000],
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

/** A worked-out answer (spending by category), as the space returns it. */
const SAMPLE_ANSWER: QueryResult = {
  title: "Spending by category",
  collection_id: COLLECTION.id,
  collection: COLLECTION.name,
  columns: [
    { name: "Category", kind: "group", type: "text" },
    { name: "Spent", kind: "measure", type: "money" },
    { name: "Items", kind: "measure", type: "number" },
  ],
  rows: (
    [
      ["Test Rent", 9_500_000, 1],
      ["Test Groceries", 6_200_000, 14],
      ["Test Travel", 2_400_000, 4],
      ["Test Eating out", 1_800_000, 6],
      ["Test Gifts", 900_000, 2],
    ] as const
  ).map(([category, paise, items]) => ({
    cells: [category, paise, items],
    shown: [category, `₹${(paise / 100).toLocaleString("en-IN")}`, String(items)],
  })),
  more: 0,
  scanned: 14,
  words: "Test Expenses where Date is in this year, by Category: Spent (total Amount), Items (count)",
};

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
  if (arrangement === "table" || arrangement === "bars") card.answer = SAMPLE_ANSWER;
  if (arrangement === "memory")
    card.memory = [
      { id: "m1", text: "The usual electrician charge is ₹500 (test)", source: "From a chat" },
      { id: "m2", text: "Test landlord takes rent by UPI on the 1st", source: "From a chat" },
    ] as HomeCard["memory"];
  if (arrangement === "process")
    card.waiting = {
      id: "w1",
      space_id: "sample",
      workflow_id: "wf1",
      workflow: "Confirm the dinner",
      record_id: "r1",
      record: "Test dinner, Saturday",
      text: "Can you come to the Test dinner on Saturday?",
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

const WORKOUTS: CollectionView = {
  id: "workouts",
  name: "Test workouts",
  description: null,
  title_field_id: "s_title",
  fields: [
    field("s_title", "Workout", "text"),
    field("s_ready", "Done", "boolean"),
    { ...field("s_status", "Status", "choice"), options: { choices: ["Easy", "Steady", "Hard"] } },
    field("s_runs", "Rounds", "number"),
    field("s_rating", "Feel", "number"),
    field("s_volume", "Effort", "number"),
    field("s_paid", "Logged", "boolean"),
  ],
  linked_from: [],
  updated_at: NOW,
};
const WORKOUT_ROWS: [string, boolean, string, number, number, number][] = [
  ["Test morning run", true, "Hard", 12, 5, 70],
  ["Test yoga", false, "Easy", 3, 3, 40],
  ["Test cycling", true, "Steady", 8, 4, 55],
  ["Test swim", false, "Easy", 1, 2, 30],
];
const WORKOUT_RECORDS: RecordView[] = WORKOUT_ROWS.map(([title, ready, status, runs, feel, vol], i) => ({
  id: `s${i}`,
  collection_id: WORKOUTS.id,
  title,
  values: {
    s_title: title,
    s_ready: ready,
    s_status: status,
    s_runs: runs,
    s_rating: feel,
    s_volume: vol,
    s_paid: i === 0,
  },
  named: { Workout: title },
  links: {},
  created_at: NOW,
  updated_at: NOW,
  version: 1,
}));

/** Cards with controls on their rows: every kind of control, on made-up workouts. */
export function controlCards(): HomeCard[] {
  const make = (
    id: string,
    title: string,
    size: CardSize,
    controls: NonNullable<HomeCard["spec"]["controls"]>,
  ): HomeCard => ({
    id: `sample:controls:${id}`,
    view: null,
    spec: {
      version: CARD_VERSION,
      title,
      arrangement: "list-plain",
      size,
      sources: [{ collection: WORKOUTS.id }],
      controls,
    },
    collection: WORKOUTS,
    colour: "flow",
    records: WORKOUT_RECORDS,
    total: null,
  });
  return [
    make("switch-stepper", "Switch + stepper", "m", [
      { field: "s_runs", as: "stepper", min: 0 },
      { field: "s_ready", as: "switch" },
    ]),
    make("chips", "Chips", "m", [{ field: "s_status", as: "chips" }]),
    make("stars-button", "Stars + button", "m", [
      { field: "s_rating", as: "stars", min: 0, max: 5 },
      { field: "s_paid", as: "button", label: "Logged", value: true },
    ]),
    make("slider-tick", "Slider + tick", "l", [
      { field: "s_ready", as: "tick" },
      { field: "s_volume", as: "slider", min: 0, max: 100, step: 5 },
    ]),
  ];
}

const APPOINTMENTS: CollectionView = {
  id: "appointments",
  name: "Test appointments",
  description: null,
  title_field_id: "g_title",
  fields: [
    field("g_title", "Place", "text"),
    field("g_when", "Starts", "datetime"),
    { ...field("g_with", "With", "choice"), options: { choices: ["Test Asha", "Test Dev", "Just me"] } },
    field("g_fee", "Cost", "money"),
    field("g_todo", "To do", "long_text"),
    field("g_addr", "Address", "text"),
    field("g_paid", "Paid", "boolean"),
  ],
  linked_from: [],
  updated_at: NOW,
};
/** A date-time `offset` days from today at an India-time hour. */
const at = (offset: number, hour: number, min = 0) =>
  new Date(Date.parse(`${day(offset)}T00:00:00Z`) + (hour * 60 + min - 330) * 60_000).toISOString();
const APPOINTMENT_ROWS: [string, string, string, number, string | null, boolean][] = [
  ["Test Dental Clinic", at(0, 18), "Just me", 150_000, "Take the old X-rays and the insurance card", false],
  ["Test Café, Kalyani Nagar", at(1, 12, 30), "Test Asha", 120_000, null, false],
  ["Test Car Service", at(4, 10), "Test Dev", 650_000, null, true],
  ["Test Wedding Lawn", at(9, 19), "Test Asha", 500_000, "Pick up the gift on the way", false],
];
const APPOINTMENT_RECORDS: RecordView[] = APPOINTMENT_ROWS.map(
  ([title, when, withWho, fee, todo, paid], i) => ({
    id: `g${i}`,
    collection_id: APPOINTMENTS.id,
    title,
    values: {
      g_title: title,
      g_when: when,
      g_with: withWho,
      g_fee: fee,
      g_todo: todo,
      g_addr: `${title}, Pune`,
      g_paid: paid,
    },
    named: { Place: title, With: withWho },
    links: {},
    created_at: NOW,
    updated_at: NOW,
    version: 1,
  }),
);

/** Cards with rich rows: date tiles, details with colour dots, pills, a callout and a button. */
export function richCards(): HomeCard[] {
  const make = (
    id: string,
    title: string,
    size: CardSize,
    row: NonNullable<HomeCard["spec"]["row"]>,
    arrangement: Arrangement = "next",
  ): HomeCard => ({
    id: `sample:rows:${id}`,
    view: null,
    spec: {
      version: CARD_VERSION,
      title,
      arrangement,
      size,
      sources: [
        {
          collection: APPOINTMENTS.id,
          date_field: "g_when",
          answer_field: arrangement === "list-ticks" ? "g_paid" : null,
        },
      ],
      row,
    },
    collection: APPOINTMENTS,
    colour: "time",
    records: APPOINTMENT_RECORDS,
    total: null,
  });
  const full = {
    date: "g_when",
    details: ["g_when", "g_with"],
    pills: ["g_fee"],
    callout: { field: "g_todo", label: "To do" },
    action: { field: "g_addr", as: "directions" as const },
  };
  return [
    make("appointments-l", "Coming up", "l", full),
    {
      // Chips on a rich row: who it's with, changeable from the card.
      ...make("appointments-m", "Next appointments", "m", { ...full, callout: null, pills: [] }),
      spec: {
        ...make("appointments-m", "Next appointments", "m", { ...full, callout: null, pills: [] }).spec,
        controls: [{ field: "g_with", as: "chips" as const }],
      },
    },
    make("paid", "Paid yet?", "m", { ...full, callout: null, action: null, pills: ["g_fee"] }, "list-ticks"),
    make("appointment-s", "Next one", "s", {
      date: "g_when",
      details: ["g_with"],
      pills: ["g_fee"],
      callout: null,
      action: null,
    }),
  ];
}

/** Every drawn arrangement at every size it allows: the small ones first (they pair up), then
 *  medium, then large, each in catalogue order. */
export function sampleCards(): HomeCard[] {
  return CARD_SIZES.flatMap((size) =>
    GALLERY_ARRANGEMENTS.filter((a) => ARRANGEMENT_SIZES[a].includes(size)).map((a) => sampleCard(a, size)),
  );
}
