// The assistant reads stored times in India time, but only in date-time fields and
// timestamps; text people typed (even a pasted UTC time) reaches it unchanged.
import { describe, expect, it } from "vitest";
import type { CollectionView } from "@assistant/shared";
import { inIndiaTime } from "../src/core/assistant/service.ts";

const field = (id: string, name: string, type: "text" | "datetime") => ({
  id,
  name,
  type,
  options: {},
  required: false,
  aliases: [],
});
const cols = [
  {
    id: "c1",
    name: "Reminders",
    description: null,
    title_field_id: "f_title",
    fields: [field("f_title", "Title", "text"), field("f_due", "Due", "datetime")],
    linked_from: [],
    updated_at: "2026-01-01T00:00:00.000Z",
  },
] as unknown as CollectionView[];

describe("tool results in India time", () => {
  it("converts date-time fields and timestamps, never typed text", () => {
    const utc = "2026-10-14T13:30:00.000Z";
    const out = JSON.parse(
      JSON.stringify(
        {
          title: utc,
          values: { f_title: utc, f_due: utc },
          named: { Title: utc, Due: utc },
          created_at: utc,
        },
        inIndiaTime(cols),
      ),
    ) as Record<string, Record<string, string> | string>;
    const ist = "2026-10-14T19:00:00+05:30";
    expect(out).toEqual({
      title: utc,
      values: { f_title: utc, f_due: ist },
      named: { Title: utc, Due: ist },
      created_at: ist,
    });
  });
});
