import { describe, expect, it } from "vitest";
import { guessType, parseCsv, readCell, readDate, toCsv } from "./csv.ts";

describe("csv", () => {
  it("reads quotes, commas, tabs, new lines and a BOM", () => {
    const text =
      '\uFEFFTitle,Amount,Note\r\n"Test, strings",450,"two\nlines"\r\nCapo,"1,200","say ""hi"""\r\n\r\n';
    const p = parseCsv(text);
    expect(p.columns).toEqual(["Title", "Amount", "Note"]);
    expect(p.rows).toEqual([
      ["Test, strings", "450", "two\nlines"],
      ["Capo", "1,200", 'say "hi"'],
    ]);
    const tabs = parseCsv("A\tB\n1\t2\n3\n");
    expect(tabs.separator).toBe("\t");
    expect(tabs.rows).toEqual([
      ["1", "2"],
      ["3", ""],
    ]);
    expect(parseCsv(",Two\n1,2").columns).toEqual(["Column 1", "Two"]);
  });

  it("writes what it reads", () => {
    const csv = toCsv(
      ["Title", "Paid"],
      [
        ["Test, one", true],
        ['say "hi"', null],
      ],
    );
    expect(csv).toBe('Title,Paid\r\n"Test, one",Yes\r\n"say ""hi""",\r\n');
    expect(parseCsv(csv).rows).toEqual([
      ["Test, one", "Yes"],
      ['say "hi"', ""],
    ]);
  });

  it("guesses a column's kind and reads cells the Indian way", () => {
    expect(guessType(["450", "1200", ""])).toBe("number");
    expect(guessType(["₹450", "Rs 1,200"])).toBe("money");
    expect(guessType(["1,20,000", "4,500"])).toBe("money");
    expect(guessType(["12/10/2026", "2026-10-13", "1-1-2026"])).toBe("date");
    expect(guessType(["yes", "No", "haan"])).toBe("boolean");
    expect(guessType(["a", "b", "a", "b", "a", "b", "a", "c"])).toBe("choice");
    expect(guessType(["Test wedding", "Test club"])).toBe("text");
    expect(readDate("12/10/2026")).toBe("2026-10-12");
    expect(readDate("1-2-2026")).toBe("2026-02-01");
    expect(readDate("13/13/2026")).toBeNull();
    expect(readCell("date", "12/10/2026")).toBe("2026-10-12");
    expect(readCell("money", "₹1,20,000.50")).toBe("120000.50");
    expect(readCell("number", "1,200")).toBe(1200);
    expect(readCell("boolean", "Haan")).toBe(true);
    expect(readCell("multi_choice", "Guitar; Vocals")).toEqual(["Guitar", "Vocals"]);
    expect(readCell("text", "  ")).toBeNull();
  });
});
