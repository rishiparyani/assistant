// A2UI cards: the worked cards pass the checks, mistakes come back in words, and the card's own
// functions keep figures current as its data changes. Made-up data only.
import { describe, expect, it } from "vitest";
import { ComponentContext, GenericBinder, MessageProcessor } from "@a2ui/web_core";
import {
  DEMOS,
  PART_APIS,
  cardMessages,
  cardProblems,
  cardGuide,
  makeCatalog,
  type A2Card,
} from "./index.ts";

const open = (card: A2Card) => {
  const p = new MessageProcessor([makeCatalog()]);
  p.processMessages(cardMessages(card, "t") as never);
  return p.model.surfacesMap.get("t")!;
};
const read = (card: A2Card, id: string, base = "/") => {
  const surface = open(card);
  const api = PART_APIS.find((a) => a.name === card.parts.find((x) => x.id === id)!.component)!;
  const b = new GenericBinder<Record<string, unknown>>(
    new ComponentContext(surface, id, base),
    api.schema as never,
  );
  b.subscribe(() => undefined);
  return { surface, props: () => b.snapshot };
};

describe("A2UI cards", () => {
  it("passes every worked card", () => {
    for (const card of DEMOS) expect(cardProblems(card), card.title).toEqual([]);
  });

  it("says what's wrong, in words", () => {
    const bad: A2Card = {
      parts: [
        { id: "root", component: "Card", children: ["a", "gone"] },
        { id: "a", component: "Stat", label: "x", value: { call: "nope" }, colour: "red" },
        { id: "b", component: "Picker", value: "This month", options: ["This month", "Last month"] },
        { id: "c", component: "Sparkle" },
      ],
    };
    const words = cardProblems(bad).join(" | ");
    expect(words).toContain('"Sparkle" isn\'t a part');
    expect(words).toContain('has no property "colour"');
    expect(words).toContain('child "gone"');
    expect(words).toContain('calls "nope"');
    expect(words).toContain("value must be {path");
    expect(cardProblems({ parts: [{ id: "x", component: "Text", text: "hi" }] }).join()).toContain('"root"');
  });

  it("keeps worked-out figures current when the data changes", async () => {
    const card: A2Card = {
      parts: [
        {
          id: "root",
          component: "Stat",
          label: "Unpaid",
          format: "money",
          value: {
            call: "sum",
            args: { list: { path: "/items" }, field: "amount", where: { field: "paid", equals: false } },
          },
        },
      ],
      data: {
        items: [
          { amount: 500, paid: false },
          { amount: 700, paid: true },
        ],
      },
    };
    const { surface, props } = read(card, "root");
    expect(props().value).toBe(500);
    surface.dataModel.set("/items/1/paid", false);
    await Promise.resolve();
    expect(props().value).toBe(1200);
  });

  it("lets an empty filter through and works out a loan instalment", () => {
    const card: A2Card = {
      parts: [
        { id: "root", component: "Column", children: ["a", "b"] },
        {
          id: "a",
          component: "Text",
          text: "x",
          visible: { call: "includes", args: { list: [], value: "Paid" } },
        },
        {
          id: "b",
          component: "Stat",
          label: "EMI",
          value: { call: "loanPayment", args: { principal: 100000000, yearlyRatePercent: 12, months: 12 } },
        },
      ],
    };
    expect(read(card, "a").props().visible).toBe(true);
    // ₹10,00,000 at 12% over a year: ₹88,849 a month.
    expect(Math.round(Number(read(card, "b").props().value) / 100)).toBe(88849);
  });

  it("teaches every part and function, with an example that passes", () => {
    const guide = cardGuide();
    for (const p of PART_APIS) expect(guide).toContain(`- ${p.name}:`);
    const example = JSON.parse(guide.slice(guide.indexOf("Example: ") + 9)) as A2Card;
    expect(cardProblems(example)).toEqual([]);
  });
});
