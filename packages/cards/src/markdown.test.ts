import { describe, expect, it } from "vitest";
import { blocksOf, spansOf } from "./markdown.ts";

describe("the assistant's Markdown", () => {
  it("reads bold, italics and code, and leaves lone marks alone", () => {
    expect(spansOf("Add **an expense** like *this* or `that`, 2*3")).toEqual([
      { text: "Add " },
      { text: "an expense", bold: true },
      { text: " like " },
      { text: "this", italic: true },
      { text: " or " },
      { text: "that", code: true },
      { text: ", 2*3" },
    ]);
    expect(spansOf("plain words")).toEqual([{ text: "plain words" }]);
  });

  it("splits paragraphs, lists and a heading line", () => {
    expect(
      blocksOf(
        "Here's what I can do:\n\n**Cards**:\n- Add an expense\n- Delete records\n\n1. first\n2. second\n# Done",
      ),
    ).toEqual([
      { kind: "p", lines: ["Here's what I can do:"] },
      { kind: "p", lines: ["**Cards**:"] },
      { kind: "list", items: ["Add an expense", "Delete records"], ordered: false },
      { kind: "list", items: ["first", "second"], ordered: true },
      { kind: "h", text: "Done", level: 1 },
    ]);
  });

  it("reads heading levels, quotes and rules", () => {
    expect(blocksOf("# Big\n### Small\n> “Add flat 101”\n> plain\n---\nafter")).toEqual([
      { kind: "h", text: "Big", level: 1 },
      { kind: "h", text: "Small", level: 3 },
      { kind: "q", lines: ["“Add flat 101”", "plain"] },
      { kind: "hr" },
      { kind: "p", lines: ["after"] },
    ]);
  });
});
