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

  it("says what a share, a rule or a group does for other people", () => {
    expect(words("create_share", { form: "Complaints", public: true })).toEqual({
      title: "Make a join link for “Complaints” as a form",
      details: ["Anyone with the link, no sign-in", "They can look (a form: they can send in)"],
    });
    expect(
      words("set_share_rule", { user_id: "*", filters: [{ field: "Flat", op: "eq", value: "A-101" }] }),
    ).toEqual({ title: "Limit what everyone in a share sees", details: ["Flat eq A-101"] });
    expect(words("create_group", { name: "Test Society", people: ["Test Dev"] }).title).toBe(
      "Make a group “Test Society”",
    );
    expect(words("start_chat_home", {}).title).toBe("Start this chat's home");
  });
});
