import { describe, expect, it } from "vitest";
import type { CollectionView, RecordView } from "@assistant/shared";
import { countdown, nextUp } from "./next-up.ts";
import type { HomeCard } from "./native/model.ts";

// 13 Oct 2026, 5:50 pm India time.
const NOW = Date.parse("2026-10-13T17:50:00+05:30");
const gigs: CollectionView = {
  id: "c",
  name: "Test gigs",
  description: null,
  title_field_id: "t",
  fields: [
    { id: "t", name: "Title", type: "text", required: false, aliases: [], options: {}, position: 0 },
    { id: "d", name: "Starts", type: "datetime", required: false, aliases: [], options: {}, position: 1 },
    { id: "x", name: "Done", type: "boolean", required: false, aliases: [], options: {}, position: 2 },
  ],
  linked_from: [],
  updated_at: "",
} as unknown as CollectionView;
const rec = (id: string, starts: string | null, done = false): RecordView =>
  ({
    id,
    collection_id: "c",
    title: id,
    values: { t: id, d: starts, x: done },
    named: {},
    links: {},
  }) as unknown as RecordView;
const card = (records: RecordView[]): HomeCard =>
  ({
    id: "k",
    view: null,
    spec: {
      version: "card.v1",
      title: "Gigs",
      arrangement: "list-ticks",
      size: "m",
      sources: [{ collection: "c", answer_field: "x" }],
    },
    collection: gigs,
    colour: "time",
    records,
    total: null,
  }) as unknown as HomeCard;

describe("next up", () => {
  it("picks the soonest thing still to come, skipping past, ticked and far-off ones", () => {
    const n = nextUp(
      [
        card([
          rec("Test past", "2026-10-13T06:00:00Z"),
          rec("Test ticked", "2026-10-13T14:00:00Z", true),
          rec("Test tonight", "2026-10-13T15:00:00Z"),
          rec("Test next week", "2026-10-20T13:30:00Z"),
          rec("Test far", "2026-12-12T13:30:00Z"),
        ]),
      ],
      NOW,
    );
    expect(n?.record.title).toBe("Test tonight");
    expect(countdown(n!, NOW)).toBe("in 2 h 40 min");
    expect(nextUp([card([rec("Test far", "2026-12-12T13:30:00Z")])], NOW)).toBeNull();
  });

  it("finds the soonest even when it isn't among the card's first rows", () => {
    const c = {
      ...card([rec("Test next week", "2026-10-20T13:30:00Z")]),
      upcoming: [rec("Test tomorrow", "2026-10-14T13:30:00Z")],
    };
    expect(nextUp([c], NOW)?.record.title).toBe("Test tomorrow");
  });

  it("says when in words", () => {
    const at = (iso: string, allDay = false) => ({ at: Date.parse(iso), allDay });
    expect(countdown(at("2026-10-13T18:20:00+05:30"), NOW)).toBe("in 30 min");
    expect(countdown(at("2026-10-14T20:30:00+05:30"), NOW)).toBe("tomorrow, 8:30 pm");
    expect(countdown(at("2026-10-17T18:00:00+05:30"), NOW)).toBe("Sat, 6 pm");
    expect(countdown(at("2026-10-12T18:30:00Z", true), NOW)).toBe("today");
    expect(countdown(at("2026-10-24T18:30:00Z", true), NOW)).toBe("in 12 days");
  });
});
