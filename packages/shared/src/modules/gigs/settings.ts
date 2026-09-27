// Per-collective Gigs settings (stored in workspace_modules.settings_json; owner's choice).
import { z } from "zod";

export const WHO = ["owners", "everyone"] as const;
export type Who = (typeof WHO)[number];

export interface GigsSettings {
  /** Members see who plays each gig (names and roles). */
  lineup_visible_to_members: boolean;
  /** Who can set a gig's lineup and shares (and add people to the roster while doing it). */
  lineup_editors: Who;
  /** Who can record and correct payouts to musicians. */
  payout_recorders: Who;
}

export const DEFAULT_GIGS_SETTINGS: GigsSettings = {
  lineup_visible_to_members: true,
  lineup_editors: "owners",
  payout_recorders: "owners",
};

export const UpdateGigsSettingsInput = z.object({
  lineup_visible_to_members: z.boolean().optional().describe("Members see who plays each gig"),
  lineup_editors: z.enum(WHO).optional().describe('"owners" or "everyone" can set lineups and shares'),
  payout_recorders: z.enum(WHO).optional().describe('"owners" or "everyone" can record payouts'),
});

/** Stored JSON → settings, falling back to defaults for anything missing or invalid. */
export function readGigsSettings(json: string | null | undefined): GigsSettings {
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {
    raw = {};
  }
  const parsed = UpdateGigsSettingsInput.safeParse(raw);
  return { ...DEFAULT_GIGS_SETTINGS, ...(parsed.success ? stripUndefined(parsed.data) : {}) };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
