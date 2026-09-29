import { z } from "zod";

/** An API token for Siri Shortcuts and scripts (the secret itself is shown only once). */
export interface ApiTokenView {
  id: string;
  name: string;
  /** "read", or "read write" when it may make changes. */
  scopes: ("read" | "write")[];
  created_at: string;
  last_used_at: string | null;
}

export interface CreatedApiTokenView extends ApiTokenView {
  /** The secret: shown now and never again. */
  token: string;
}

export const CreateApiTokenInput = z.object({
  name: z.string().trim().min(1).max(60).describe('What it\'s for, e.g. "Siri on my iPhone"'),
  write: z.boolean().optional().describe("Allow changes (add gigs, record payments); read-only if left out"),
});

export const ApiTokenRef = z.object({ token_id: z.string().trim().min(1).max(40) });
