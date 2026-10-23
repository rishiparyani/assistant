import { describe, expect, it } from "vitest";
import { MakeSetupInput, proposedRuleWords, setupWords } from "./setups.ts";

describe("setupWords", () => {
  it("says what the setup makes, from its definition", () => {
    const s = MakeSetupInput.parse({
      name: "Test guests",
      collections: [
        {
          name: "Guests",
          fields: [
            { name: "Name", type: "text" },
            { name: "Plus-ones", type: "number" },
            { name: "Heads", type: "number", options: { formula: "1 + {Plus-ones}" } },
            { name: "Gig", type: "link", options: { target: "Gigs" } },
            { name: "Going", type: "choice", options: { choices: ["Yes", "No"], personal: true } },
          ],
        },
      ],
      rules: [
        { collection: "Guests", kind: "check", require: [{ field: "Plus-ones", op: "lte", value: 5 }] },
      ],
      views: [{ name: "Big groups", collection: "Guests", pinned: true }],
    });
    expect(setupWords(s)).toEqual([
      "Guests: Name, Plus-ones (number), Going (one of Yes, No; each person's own)",
      "Heads in Guests = 1 + {Plus-ones}",
      "Gig in Guests links to Gigs",
      "In Guests: Plus-ones is at most 5",
      "A view “Big groups” of Guests, on the shortcuts bar",
    ]);
  });

  it("gives a proposed rule the saved one's words: conditions, limits and moves", () => {
    // The card before Confirm reads from these (Codex on PR 183: a flow's moves are a record,
    // and a conditional check or a limit must not read as a plain one).
    const s = MakeSetupInput.parse({
      name: "Test guests",
      collections: [{ name: "Guests", fields: [{ name: "Name", type: "text" }] }],
      rules: [
        {
          kind: "check",
          collection: "Guests",
          require: [{ field: "Heads", op: "lte", value: 5 }],
          only_if: [{ field: "Kind", op: "eq", value: "Friend" }],
        },
        { kind: "unique", collection: "Guests", fields: ["Host"], at_most: 3, of: "Heads" },
        { kind: "flow", collection: "Guests", field: "Status", moves: { Invited: ["Coming", "Not coming"] } },
      ],
    });
    expect(s.rules!.map(proposedRuleWords)).toEqual([
      "In Guests when Kind is Friend: Heads is at most 5",
      "In Guests, at most 3 Heads in all per Host",
      "Status in Guests moves only Invited → Coming or Not coming",
    ]);
  });
});
