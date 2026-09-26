import { describe, expect, it } from "vitest";
import { formatDateIST, formatDateTimeIST, isDateOnly, isoDateIST, toUtcIso } from "./dates.ts";

describe("toUtcIso", () => {
  it.each([
    ["2026-12-12T19:00", "2026-12-12T13:30:00.000Z"],
    ["2026-12-12 19:00", "2026-12-12T13:30:00.000Z"],
    ["2026-12-12T19:00:30", "2026-12-12T13:30:30.000Z"],
    ["2026-12-12", "2026-12-11T18:30:00.000Z"],
    ["2026-12-12T13:30:00Z", "2026-12-12T13:30:00.000Z"],
    ["2026-12-12T19:00:00+05:30", "2026-12-12T13:30:00.000Z"],
    ["2026-12-12T02:00:00.123-04:00", "2026-12-12T06:00:00.123Z"],
  ])("%s → %s", (input, utc) => {
    expect(toUtcIso(input)).toBe(utc);
  });

  it.each(["", "tomorrow", "12/12/2026", "2026-02-30", "2026-12-12T25:00", "2026-13-01"])(
    "rejects %j",
    (input) => {
      expect(() => toUtcIso(input)).toThrow();
    },
  );
});

describe("IST display", () => {
  it("formats date-times in IST", () => {
    expect(formatDateTimeIST("2026-12-12T13:30:00.000Z")).toBe("Sat, 12 Dec 2026, 7:00 pm IST");
    // Just after midnight IST is still the previous day in UTC.
    expect(isoDateIST("2026-12-11T18:45:00.000Z")).toBe("2026-12-12");
  });

  it("formats calendar dates without shifting them", () => {
    expect(formatDateIST("2026-12-12")).toBe("Sat, 12 Dec 2026");
  });

  it("validates date-only strings", () => {
    expect(isDateOnly("2026-12-12")).toBe(true);
    expect(isDateOnly("2026-02-29")).toBe(false);
    expect(isDateOnly("2028-02-29")).toBe(true);
    expect(isDateOnly("2026-12-12T00:00")).toBe(false);
  });
});
