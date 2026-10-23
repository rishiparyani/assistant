// The confirm cards' words (service.ts describe): a field's card names the field and its kind,
// never "field: set" (the first Sol scorecard, 2026-10-23).
import { describe, expect, it } from "vitest";
import { describe as words } from "../src/core/assistant/service.ts";

describe("confirm card words", () => {
  it("names a new field and its kind", () => {
    expect(
      words("add_field", { collection: "Expenses", field: { name: "Reimbursed", type: "boolean" } }),
    ).toEqual({ title: "Add a field “Reimbursed” to Expenses", details: ["yes/no"] });
    expect(
      words("add_field", {
        collection: "Expenses",
        field: { name: "Status", type: "text", options: { formula: 'if({Amount} > 2000, "Big", "Small")' } },
      }),
    ).toEqual({
      title: "Add a field “Status” to Expenses",
      details: ["text", 'Formula: if({Amount} > 2000, "Big", "Small")'],
    });
    expect(
      words("add_field", {
        collection: "Expenses",
        field: {
          name: "Kisne diya",
          type: "choice",
          options: { choices: ["Rishi", "Band", "Client"] },
          required: true,
        },
      }).details,
    ).toEqual(["choice", "Choices: Rishi, Band, Client", "Required"]);
  });

  it("names the field a change or removal is about", () => {
    expect(words("update_field", { collection: "Events", field: "Fee", name: "Amount" })).toEqual({
      title: "Change the field “Fee” in Events",
      details: ["Renamed to Amount"],
    });
    expect(words("remove_field", { collection: "Events", field: "Fee" })).toEqual({
      title: "Remove the field “Fee” from Events",
      details: [],
    });
  });
});
