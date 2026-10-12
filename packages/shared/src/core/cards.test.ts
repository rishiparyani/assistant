import { describe, expect, it } from "vitest";
import { CardSpec, cardProblems, nearestArrangement, nowScore } from "./cards.ts";

describe("card.v1", () => {
  it("accepts a plain list card and fills the defaults", () => {
    const spec = CardSpec.parse({
      title: "Today",
      arrangement: "list-plain",
      sources: [{ collection: "Reminders" }],
    });
    expect(spec.version).toBe("card.v1");
    expect(spec.size).toBe("m");
    expect(cardProblems(spec)).toEqual([]);
  });

  it("names what a spec is missing, and the nearest arrangement that works", () => {
    const spec = CardSpec.parse({
      title: "Today",
      arrangement: "list-ticks",
      size: "s",
      sources: [{ collection: "Reminders" }],
    });
    expect(cardProblems(spec)).toEqual(["list-ticks needs answer_field (the yes/no field a tick sets)"]);
    expect(nearestArrangement(spec)).toBe("list-plain");
    expect(nearestArrangement({ ...spec, arrangement: "question", size: "s" })).toBe("list-plain");
    expect(
      nearestArrangement({
        ...spec,
        arrangement: "quick-add",
        size: "s",
        sources: [{ collection: "Gigs", date_field: "Date" }],
      }),
    ).toBe("next");
  });

  it("refuses an unknown arrangement or a third source", () => {
    expect(() =>
      CardSpec.parse({ title: "x", arrangement: "pie", sources: [{ collection: "a" }] }),
    ).toThrow();
    expect(() =>
      CardSpec.parse({
        title: "x",
        arrangement: "two-numbers",
        sources: [{ collection: "a" }, { collection: "b" }, { collection: "c" }],
      }),
    ).toThrow();
  });
});

describe("nowScore", () => {
  const none = { open: 0, overdue: 0, due_today: 0, due_soon: 0, waiting: 0 };
  it("puts what's waiting on the person first, then overdue, today, soon, open", () => {
    const scores = [
      nowScore({ ...none, waiting: 1 }),
      nowScore({ ...none, overdue: 1 }),
      nowScore({ ...none, due_today: 1 }),
      nowScore({ ...none, due_soon: 1 }),
      nowScore({ ...none, open: 1 }),
    ];
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(nowScore(none)).toBe(0);
  });
  it("doesn't let a long list outrank one overdue item", () => {
    expect(nowScore({ ...none, open: 40 })).toBeLessThan(nowScore({ ...none, overdue: 1 }));
  });
});
