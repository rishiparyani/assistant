import { describe, expect, it } from "vitest";
import { DEFAULT_GIGS_SETTINGS, readGigsSettings } from "./settings.ts";

describe("readGigsSettings", () => {
  it("falls back to defaults for missing, partial or broken JSON", () => {
    expect(readGigsSettings(null)).toEqual(DEFAULT_GIGS_SETTINGS);
    expect(readGigsSettings("not json")).toEqual(DEFAULT_GIGS_SETTINGS);
    expect(readGigsSettings('{"lineup_editors":"everyone"}')).toEqual({
      ...DEFAULT_GIGS_SETTINGS,
      lineup_editors: "everyone",
    });
    expect(readGigsSettings('{"payout_recorders":"anyone"}')).toEqual(DEFAULT_GIGS_SETTINGS);
  });
});
