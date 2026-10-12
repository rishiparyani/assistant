// The everyday lists (docs/design/universal.md §10): nobody starts with them any more
// (decision "Assistant first"); the assistant starts one on the spot the first time it's
// needed ("remind me", "note that", "spent ₹450"), so everyday requests stay on the free
// model. It's ordinary data: people can rename, extend or remove any of it.
import type { StarterKind } from "@assistant/shared";
import type { FieldSpec } from "./space-object.ts";

export const STARTER_COLLECTIONS: {
  kind: StarterKind;
  name: string;
  description: string;
  fields: FieldSpec[];
}[] = [
  {
    kind: "notes",
    name: "Notes",
    description: "Things to remember",
    fields: [
      { name: "Title", type: "text", required: true },
      { name: "Body", type: "long_text" },
      { name: "Pinned", type: "boolean" },
    ],
  },
  {
    kind: "reminders",
    name: "Reminders",
    description: "Things to do, with an optional time",
    fields: [
      { name: "Title", type: "text", required: true },
      { name: "Due", type: "datetime" },
      { name: "Done", type: "boolean" },
      { name: "Notes", type: "long_text" },
    ],
  },
  {
    kind: "events",
    name: "Events",
    description: "Things happening at a time: dinners, meetings, plans",
    fields: [
      { name: "Title", type: "text", required: true },
      { name: "Starts", type: "datetime", required: true },
      { name: "Ends", type: "datetime" },
      { name: "Place", type: "text" },
      { name: "Notes", type: "long_text" },
    ],
  },
  {
    // The Inbox (home-first.md §2 point 12): captured things that fit no list yet; ticking
    // Sorted puts one away. The assistant's best guess is kept on it.
    kind: "inbox",
    name: "Inbox",
    description: "Things captured from Siri, the share sheet or a chat that fit no list yet",
    fields: [
      { name: "Text", type: "text", required: true },
      {
        name: "Source",
        type: "choice",
        options: { choices: ["Siri", "Share sheet", "Chat", "WhatsApp", "Other"] },
      },
      { name: "Guess", type: "long_text" },
      { name: "Sorted", type: "boolean" },
    ],
  },
  {
    kind: "expenses",
    name: "Expenses",
    description: "Money I spent",
    fields: [
      { name: "What", type: "text", required: true },
      { name: "Amount", type: "money", required: true },
      { name: "Date", type: "date" },
      {
        name: "Category",
        type: "choice",
        options: { choices: ["Food", "Groceries", "Travel", "Gear", "Bills", "Other"] },
      },
      { name: "Paid with", type: "choice", options: { choices: ["UPI", "Cash", "Card"] } },
      { name: "For", type: "link", options: { target: null, many: false } },
    ],
  },
];
