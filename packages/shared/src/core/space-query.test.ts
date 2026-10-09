import { describe, expect, it } from "vitest";
import { findInRecords } from "./space-query.ts";
import type { CollectionView, RecordView } from "./spaces.ts";

const col: CollectionView = {
  id: "C1",
  name: "Expenses",
  description: null,
  title_field_id: "f_what",
  linked_from: [],
  updated_at: "",
  fields: [
    { id: "f_what", name: "What", type: "text", options: {}, required: true, aliases: [] },
    { id: "f_amt", name: "Amount", type: "money", options: {}, required: true, aliases: ["cost"] },
    { id: "f_date", name: "Date", type: "date", options: {}, required: false, aliases: [] },
    {
      id: "f_cat",
      name: "Category",
      type: "choice",
      options: { choices: ["Food", "Travel"] },
      required: false,
      aliases: [],
    },
    { id: "f_gig", name: "Gig", type: "link", options: { target: "G" }, required: false, aliases: [] },
  ],
};
const rec = (id: string, title: string, values: RecordView["values"], gig?: string): RecordView => ({
  id,
  collection_id: "C1",
  title,
  values: { f_what: title, ...values },
  named: {},
  links: gig ? { f_gig: [{ id: gig, collection_id: "G", title: "Test gig" }] } : {},
  created_at: `2026-10-0${id.slice(-1)}T00:00:00.000Z`,
  updated_at: "",
  version: 1,
});
const all = [
  rec("R1", "Test groceries", { f_amt: 45000, f_date: "2026-10-14", f_cat: "Food" }),
  rec("R2", "Test cab to venue", { f_amt: 120000, f_date: "2026-10-02", f_cat: "Travel" }, "GIG1"),
  rec("R3", "Test strings", { f_amt: 60000, f_date: "2026-09-20" }),
];
// Wed 14 Oct 2026, 23:00 IST.
const now = Date.parse("2026-10-14T17:30:00Z");
const titles = (q: Parameters<typeof findInRecords>[2]) =>
  findInRecords(col, all, q, { userId: "u1", now }).map((r) => r.title);

describe("findInRecords", () => {
  it("filters like the server", () => {
    expect(titles({ filters: [{ field: "cost", op: "gte", value: "600" }] })).toEqual([
      "Test strings",
      "Test cab to venue",
    ]);
    expect(titles({ filters: [{ field: "Date", op: "period", value: "this_month" }] })).toEqual([
      "Test cab to venue",
      "Test groceries",
    ]);
    expect(titles({ filters: [{ field: "f_cat", op: "eq", value: "food" }] })).toEqual(["Test groceries"]);
    expect(titles({ filters: [{ field: "Category", op: "empty" }] })).toEqual(["Test strings"]);
    expect(titles({ filters: [{ field: "Gig", op: "eq", value: "GIG1" }] })).toEqual(["Test cab to venue"]);
    expect(titles({ filters: [{ field: "What", op: "contains", value: "VEN" }] })).toEqual([
      "Test cab to venue",
    ]);
    expect(titles({ search: "str" })).toEqual(["Test strings"]);
  });

  it("sorts with empty values last and newest first by default", () => {
    expect(titles({})).toEqual(["Test strings", "Test cab to venue", "Test groceries"]);
    expect(titles({ sort: { field: "Amount", dir: "desc" } })).toEqual([
      "Test cab to venue",
      "Test strings",
      "Test groceries",
    ]);
    expect(titles({ sort: { field: "Category", dir: "asc" } })).toEqual([
      "Test groceries",
      "Test cab to venue",
      "Test strings",
    ]);
  });
});
