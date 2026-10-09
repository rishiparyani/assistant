// The starter setup every personal space begins with (docs/design/universal.md §10):
// enough for everyday requests ("remind me", "note that", "spent ₹450") without building
// anything. It's ordinary data: people can rename, extend or remove any of it.
import type { FieldSpec } from "./space-object.ts";

export const STARTER_COLLECTIONS: { name: string; description: string; fields: FieldSpec[] }[] = [
  {
    name: "Notes",
    description: "Things to remember",
    fields: [
      { name: "Title", type: "text", required: true },
      { name: "Body", type: "long_text" },
      { name: "Pinned", type: "boolean" },
    ],
  },
  {
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
