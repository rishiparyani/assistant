import { describe, expect, it } from "vitest";
import { MakeSetupInput, setupWords } from "./setups.ts";

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
});
