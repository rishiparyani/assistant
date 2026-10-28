// Worked A2UI cards (decision 2026-10-18 "Try A2UI"): shown on the trial screen and given to the
// assistant as examples of what a good card looks like. Made-up data only. Money in paise.
import type { A2Card } from "./index.ts";

/** A small business's invoices: overview with linked figures, filterable records, insights. */
export const INVOICES: A2Card = {
  title: "Invoices",
  parts: [
    {
      id: "root",
      component: "Card",
      title: "Invoices",
      subtitle: "Payments from clients",
      icon: "🧾",
      children: ["tabs"],
    },
    {
      id: "tabs",
      component: "Tabs",
      tabs: [
        { title: "Overview", child: "overview" },
        { title: "Records", child: "records" },
        { title: "Insights", child: "insights" },
      ],
    },
    // Overview: every figure is worked out from the items, so a change anywhere shows here.
    { id: "overview", component: "Column", children: ["figures", "trend"] },
    {
      id: "figures",
      component: "Grid",
      columns: 2,
      children: ["billed", "collected", "outstanding", "count"],
    },
    {
      id: "billed",
      component: "Stat",
      label: "Billed",
      format: "money",
      value: { call: "sum", args: { list: { path: "/items" }, field: "amount" } },
    },
    {
      id: "collected",
      component: "Stat",
      label: "Collected",
      format: "money",
      tone: "good",
      value: {
        call: "sum",
        args: { list: { path: "/items" }, field: "amount", where: { field: "status", equals: "Paid" } },
      },
    },
    {
      id: "outstanding",
      component: "Stat",
      label: "Outstanding",
      format: "money",
      tone: "warn",
      hint: "Needs a follow-up",
      value: {
        call: "sum",
        args: { list: { path: "/items" }, field: "amount", where: { field: "status", not: "Paid" } },
      },
    },
    {
      id: "count",
      component: "Stat",
      label: "Invoices",
      value: { call: "count", args: { list: { path: "/items" } } },
      hint: {
        call: "text",
        args: {
          parts: [
            {
              call: "count",
              args: { list: { path: "/items" }, where: { field: "status", equals: "Overdue" } },
            },
            " overdue",
          ],
        },
      },
    },
    { id: "trend", component: "Section", title: "Collected by week", children: ["line"] },
    { id: "line", component: "LineChart", format: "money", data: { path: "/weeks" } },
    // Records: filter chips, and rows that open to change their status or delete them.
    { id: "records", component: "Column", children: ["filters", "list"] },
    { id: "filters", component: "Chips", value: { path: "/show" }, options: ["Paid", "Pending", "Overdue"] },
    {
      id: "list",
      component: "List",
      children: { componentId: "entry", path: "/items" },
      empty: "No invoices yet.",
    },
    {
      id: "entry",
      component: "Column",
      gap: "none",
      children: ["row", "detail"],
      visible: { call: "includes", args: { list: { path: "/show" }, value: { path: "status" } } },
    },
    {
      id: "row",
      component: "ItemRow",
      title: { path: "client" },
      subtitle: { path: "when" },
      avatar: { path: "client" },
      amount: { path: "amount" },
      badge: { path: "status" },
      badgeTone: {
        call: "pick",
        args: {
          when: { call: "equals", args: { a: { path: "status" }, b: "Paid" } },
          then: "good",
          else: "warn",
        },
      },
      selected: { path: "open" },
      action: { functionCall: { call: "toggle", args: { path: "open" } } },
    },
    { id: "detail", component: "Column", visible: { path: "open" }, children: ["status", "remove"] },
    {
      id: "status",
      component: "Radio",
      label: "Payment status",
      value: { path: "status" },
      options: ["Paid", "Pending", "Overdue"],
    },
    {
      id: "remove",
      component: "Button",
      label: "Delete invoice",
      style: "danger",
      confirm: "Tap again to delete",
      action: { functionCall: { call: "removeItem", args: {} } },
    },
    // Insights
    { id: "insights", component: "Column", children: ["share", "byClient", "tip"] },
    {
      id: "share",
      component: "ProgressRing",
      label: "Collected so far",
      colour: "green",
      value: {
        call: "divide",
        args: {
          a: {
            call: "sum",
            args: { list: { path: "/items" }, field: "amount", where: { field: "status", equals: "Paid" } },
          },
          b: { call: "sum", args: { list: { path: "/items" }, field: "amount" } },
        },
      },
    },
    {
      id: "byClient",
      component: "PieChart",
      format: "money",
      data: { call: "groupSum", args: { list: { path: "/items" }, by: "client", field: "amount" } },
    },
    {
      id: "tip",
      component: "Notice",
      tone: "warn",
      text: {
        call: "text",
        args: {
          parts: [
            {
              call: "money",
              args: {
                value: {
                  call: "sum",
                  args: {
                    list: { path: "/items" },
                    field: "amount",
                    where: { field: "status", equals: "Overdue" },
                  },
                },
              },
            },
            " is overdue. A friendly reminder usually works.",
          ],
        },
      },
    },
  ],
  data: {
    show: [],
    items: [
      { client: "Asha Interiors", when: "Oct 17", amount: 1800000, status: "Paid" },
      { client: "Kumar Traders", when: "Oct 20", amount: 1500000, status: "Pending" },
      { client: "Green Leaf Café", when: "Oct 23", amount: 1200000, status: "Pending" },
      { client: "Mehta & Sons", when: "Oct 26", amount: 2200000, status: "Overdue" },
      { client: "Asha Interiors", when: "Oct 29", amount: 1400000, status: "Paid" },
    ],
    weeks: [
      { label: "W1", value: 900000 },
      { label: "W2", value: 1400000 },
      { label: "W3", value: 1100000 },
      { label: "W4", value: 2300000 },
      { label: "W5", value: 1900000 },
      { label: "W6", value: 3200000 },
    ],
  },
};

/** A loan calculator: three sliders drive the instalment, the totals and the chart. */
export const LOAN: A2Card = {
  title: "Loan calculator",
  parts: [
    {
      id: "root",
      component: "Card",
      title: "Home loan",
      subtitle: "Move the sliders",
      icon: "🏠",
      children: ["inputs", "result", "split", "note"],
    },
    { id: "inputs", component: "Column", children: ["amount", "rate", "years"] },
    {
      id: "amount",
      component: "Slider",
      label: "Amount",
      value: { path: "/amount" },
      min: 10000000,
      max: 500000000,
      step: 5000000,
      format: "money",
    },
    {
      id: "rate",
      component: "Slider",
      label: "Interest a year",
      value: { path: "/rate" },
      min: 6,
      max: 15,
      step: 0.1,
      format: "percent",
    },
    {
      id: "years",
      component: "Slider",
      label: "Years",
      value: { path: "/years" },
      min: 1,
      max: 30,
      step: 1,
      format: "number",
    },
    { id: "result", component: "Grid", columns: 2, children: ["emi", "interest"] },
    {
      id: "emi",
      component: "Stat",
      label: "Each month",
      format: "money",
      tone: "accent",
      value: {
        call: "loanPayment",
        args: {
          principal: { path: "/amount" },
          yearlyRatePercent: { path: "/rate" },
          months: { call: "multiply", args: { a: { path: "/years" }, b: 12 } },
        },
      },
    },
    {
      id: "interest",
      component: "Stat",
      label: "Total interest",
      format: "money",
      tone: "warn",
      value: {
        call: "subtract",
        args: {
          a: {
            call: "multiply",
            args: {
              a: {
                call: "loanPayment",
                args: {
                  principal: { path: "/amount" },
                  yearlyRatePercent: { path: "/rate" },
                  months: { call: "multiply", args: { a: { path: "/years" }, b: 12 } },
                },
              },
              b: { call: "multiply", args: { a: { path: "/years" }, b: 12 } },
            },
          },
          b: { path: "/amount" },
        },
      },
    },
    {
      id: "split",
      component: "PieChart",
      format: "money",
      slices: [
        { label: "Borrowed", value: { path: "/amount" } },
        {
          label: "Interest",
          value: {
            call: "subtract",
            args: {
              a: {
                call: "multiply",
                args: {
                  a: {
                    call: "loanPayment",
                    args: {
                      principal: { path: "/amount" },
                      yearlyRatePercent: { path: "/rate" },
                      months: { call: "multiply", args: { a: { path: "/years" }, b: 12 } },
                    },
                  },
                  b: { call: "multiply", args: { a: { path: "/years" }, b: 12 } },
                },
              },
              b: { path: "/amount" },
            },
          },
        },
      ],
    },
    { id: "note", component: "Text", style: "caption", text: "A guide only; the bank's figure decides." },
  ],
  data: { amount: 250000000, rate: 8.5, years: 20 },
};

/** A month's budget: income, spending sliders, a switch, what's left and where savings go. */
export const BUDGET: A2Card = {
  title: "Monthly budget",
  parts: [
    {
      id: "root",
      component: "Card",
      title: "Monthly budget",
      icon: "💰",
      colour: "green",
      children: ["income", "spend", "left", "used", "save"],
    },
    {
      id: "income",
      component: "Field",
      label: "Income this month (₹)",
      value: { path: "/income" },
      kind: "money",
    },
    { id: "spend", component: "Section", title: "Spending", children: ["rentOn", "rent", "food", "travel"] },
    { id: "rentOn", component: "Switch", label: "I pay rent", value: { path: "/payRent" } },
    {
      id: "rent",
      component: "Slider",
      label: "Rent",
      value: { path: "/rent" },
      min: 0,
      max: 6000000,
      step: 100000,
      format: "money",
      visible: { path: "/payRent" },
    },
    {
      id: "food",
      component: "Slider",
      label: "Food",
      value: { path: "/food" },
      min: 0,
      max: 3000000,
      step: 50000,
      format: "money",
    },
    {
      id: "travel",
      component: "Slider",
      label: "Travel",
      value: { path: "/travel" },
      min: 0,
      max: 2000000,
      step: 50000,
      format: "money",
    },
    { id: "left", component: "Grid", columns: 2, children: ["spent", "remaining"] },
    {
      id: "spent",
      component: "Stat",
      label: "Spending",
      format: "money",
      value: {
        call: "add",
        args: {
          a: { call: "pick", args: { when: { path: "/payRent" }, then: { path: "/rent" }, else: 0 } },
          b: { call: "add", args: { a: { path: "/food" }, b: { path: "/travel" } } },
        },
      },
    },
    {
      id: "remaining",
      component: "Stat",
      label: "Left to save",
      format: "money",
      tone: "good",
      value: {
        call: "subtract",
        args: {
          a: { path: "/income" },
          b: {
            call: "add",
            args: {
              a: { call: "pick", args: { when: { path: "/payRent" }, then: { path: "/rent" }, else: 0 } },
              b: { call: "add", args: { a: { path: "/food" }, b: { path: "/travel" } } },
            },
          },
        },
      },
    },
    {
      id: "used",
      component: "Progress",
      label: "Of income spent",
      format: "money",
      value: 0,
      current: {
        call: "add",
        args: {
          a: { call: "pick", args: { when: { path: "/payRent" }, then: { path: "/rent" }, else: 0 } },
          b: { call: "add", args: { a: { path: "/food" }, b: { path: "/travel" } } },
        },
      },
      target: { path: "/income" },
    },
    { id: "save", component: "Section", title: "If you save what's left at 7%", children: ["growth"] },
    {
      id: "growth",
      component: "LineChart",
      format: "money",
      data: {
        call: "growth",
        args: {
          start: 0,
          monthly: {
            call: "subtract",
            args: {
              a: { path: "/income" },
              b: {
                call: "add",
                args: {
                  a: { call: "pick", args: { when: { path: "/payRent" }, then: { path: "/rent" }, else: 0 } },
                  b: { call: "add", args: { a: { path: "/food" }, b: { path: "/travel" } } },
                },
              },
            },
          },
          yearlyRatePercent: 7,
          months: 24,
        },
      },
    },
  ],
  data: { income: 9000000, payRent: true, rent: 2500000, food: 1200000, travel: 600000 },
};

// Made-up spending over the last hundred days, the same every time (a steady pseudo-random).
const day = (ago: number) => {
  const d = new Date();
  d.setDate(d.getDate() - ago);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const SPENT: { What: string; Category: string; Date: string; Amount: number }[] = (() => {
  const kinds = [
    ["Groceries", "Food", 90000],
    ["Dinner out", "Food", 140000],
    ["Chai and snacks", "Food", 12000],
    ["Cab", "Travel", 42000],
    ["Metro card", "Travel", 50000],
    ["Petrol", "Travel", 180000],
    ["Shoes", "Shopping", 320000],
    ["Kitchen things", "Shopping", 85000],
    ["Electricity bill", "Bills", 210000],
    ["Phone bill", "Bills", 59900],
    ["Movie", "Fun", 70000],
    ["Gym", "Health", 150000],
  ] as const;
  const out: { What: string; Category: string; Date: string; Amount: number }[] = [];
  let seed = 7;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let ago = 0; ago < 100; ago++) {
    const many = rand() < 0.55 ? (rand() < 0.3 ? 2 : 1) : 0;
    for (let k = 0; k < many; k++) {
      const [What, Category, base] = kinds[Math.floor(rand() * kinds.length)]!;
      out.push({
        What,
        Category,
        Date: day(ago),
        Amount: Math.round((base * (0.6 + rand() * 0.8)) / 100) * 100,
      });
    }
  }
  return out;
})();

const thisMonth = { call: "inMonth", args: { list: { path: "/spent" }, dateField: "Date", month: "this" } };
const lastMonth = { call: "inMonth", args: { list: { path: "/spent" }, dateField: "Date", month: "last" } };
const chosenMonth = {
  call: "inMonth",
  args: {
    list: { path: "/spent" },
    dateField: "Date",
    month: {
      call: "pick",
      args: {
        when: { call: "equals", args: { a: { path: "/period" }, b: "This month" } },
        then: "this",
        else: "last",
      },
    },
  },
};
const sumOf = (list: object, where?: object) => ({
  call: "sum",
  args: { list, field: "Amount", ...(where ? { where } : {}) },
});

/** Where the money goes: a headline with its change, tiles, a donut, months, days and a searchable table. */
export const SPENDING: A2Card = {
  title: "Spending",
  parts: [
    {
      id: "root",
      component: "Card",
      title: "Spending",
      subtitle: "Every expense, worked out",
      icon: "💸",
      children: ["period", "hero", "tiles", "tabs"],
    },
    {
      id: "period",
      component: "Segmented",
      value: { path: "/period" },
      options: ["This month", "Last month"],
    },
    {
      id: "hero",
      component: "Hero",
      label: "Spent",
      format: "money",
      colour: "teal",
      value: sumOf(chosenMonth),
      change: { call: "change", args: { now: sumOf(thisMonth), before: sumOf(lastMonth) } },
      changeLabel: "this month vs last",
      goodWhen: "down",
      trend: {
        call: "pluck",
        args: {
          list: { call: "byMonth", args: { list: { path: "/spent" }, dateField: "Date", field: "Amount" } },
          field: "value",
        },
      },
    },
    { id: "tiles", component: "Grid", columns: 3, children: ["food", "travel", "bills"] },
    {
      id: "food",
      component: "Tile",
      icon: "🍽️",
      label: "Food",
      colour: "orange",
      format: "money",
      value: sumOf(chosenMonth, { field: "Category", equals: "Food" }),
    },
    {
      id: "travel",
      component: "Tile",
      icon: "🚕",
      label: "Travel",
      colour: "blue",
      format: "money",
      value: sumOf(chosenMonth, { field: "Category", equals: "Travel" }),
    },
    {
      id: "bills",
      component: "Tile",
      icon: "💡",
      label: "Bills",
      colour: "purple",
      format: "money",
      value: sumOf(chosenMonth, { field: "Category", equals: "Bills" }),
    },
    {
      id: "tabs",
      component: "Tabs",
      tabs: [
        { title: "Where", child: "where" },
        { title: "Months", child: "months" },
        { title: "Days", child: "days" },
        { title: "All", child: "all" },
      ],
    },
    { id: "where", component: "Column", children: ["bars", "insideLabel", "inside", "budget"] },
    // Tap a bar: the biggest three in that category show under it (tap again: the month's biggest).
    {
      id: "bars",
      component: "BarChart",
      format: "money",
      multicolour: true,
      selected: { path: "/cat" },
      data: { call: "groupSum", args: { list: chosenMonth, by: "Category", field: "Amount" } },
      labelField: "label",
      valueField: "value",
    },
    {
      id: "insideLabel",
      component: "Text",
      style: "caption",
      text: {
        call: "pick",
        args: {
          when: { path: "/cat" },
          then: { call: "text", args: { parts: [{ path: "/cat" }, ": the biggest three"] } },
          else: "Tap a bar to see what's in it. The month's biggest three:",
        },
      },
    },
    {
      id: "inside",
      component: "Table",
      data: {
        call: "take",
        args: {
          list: {
            call: "sortBy",
            args: {
              list: {
                call: "filter",
                args: { list: chosenMonth, where: { field: "Category", equals: { path: "/cat" } } },
              },
              field: "Amount",
              desc: true,
            },
          },
          count: 3,
        },
      },
      columns: [
        { label: "What", field: "What" },
        { label: "₹", field: "Amount", format: "money" },
      ],
      empty: "Nothing here this month.",
    },
    {
      id: "budget",
      component: "Progress",
      label: "Of the month's budget",
      format: "money",
      value: 0,
      current: sumOf(chosenMonth),
      target: { path: "/budget" },
    },
    { id: "months", component: "Column", children: ["columns", "monthsNote"] },
    {
      id: "columns",
      component: "ColumnChart",
      format: "money",
      colour: "teal",
      labelField: "label",
      valueField: "value",
      data: {
        call: "byMonth",
        args: { list: { path: "/spent" }, dateField: "Date", field: "Amount", months: 6 },
      },
    },
    { id: "monthsNote", component: "Text", style: "caption", text: "The last six months." },
    {
      id: "days",
      component: "Heatmap",
      data: { path: "/spent" },
      dateField: "Date",
      valueField: "Amount",
      weeks: 14,
      colour: "teal",
      label: "Darker days, more spent",
    },
    { id: "all", component: "Column", children: ["search", "table"] },
    { id: "search", component: "Search", value: { path: "/q" }, placeholder: "Search what or category" },
    {
      id: "table",
      component: "Table",
      total: true,
      max: 12,
      data: {
        call: "sortBy",
        args: {
          list: {
            call: "search",
            args: { list: chosenMonth, text: { path: "/q" }, fields: ["What", "Category"] },
          },
          field: "Date",
          desc: true,
        },
      },
      columns: [
        { label: "What", field: "What" },
        { label: "Day", field: "Date", format: "date" },
        { label: "₹", field: "Amount", format: "money" },
      ],
      empty: "Nothing matches.",
    },
  ],
  data: { spent: SPENT, period: "This month", q: "", budget: 3000000, cat: "" },
};

/** Splitting a bill (chats-home.md 6, "answers that are tiny apps"): who shared, the tip, each
 *  share worked out live, and a button that adds it to expenses. */
const withTip = {
  call: "multiply",
  args: {
    a: { path: "/total" },
    b: {
      call: "pick",
      args: {
        when: { call: "equals", args: { a: { path: "/tip" }, b: "10%" } },
        then: 1.1,
        else: {
          call: "pick",
          args: { when: { call: "equals", args: { a: { path: "/tip" }, b: "5%" } }, then: 1.05, else: 1 },
        },
      },
    },
  },
};
export const SPLIT: A2Card = {
  title: "Split the bill",
  parts: [
    {
      id: "root",
      component: "Card",
      title: "Dinner",
      subtitle: "₹4,500 to split",
      icon: "🍽️",
      children: ["whoLabel", "who", "tipLabel", "tip", "each", "add", "added"],
    },
    { id: "whoLabel", component: "Text", style: "caption", text: "Who shared it?" },
    { id: "who", component: "Chips", value: { path: "/who" }, options: ["You", "Priya", "Dev"] },
    { id: "tipLabel", component: "Text", style: "caption", text: "Tip" },
    { id: "tip", component: "Segmented", value: { path: "/tip" }, options: ["No tip", "5%", "10%"] },
    {
      id: "each",
      component: "Stat",
      label: "Each pays",
      format: "money",
      value: {
        call: "round",
        args: {
          value: {
            call: "divide",
            args: { a: withTip, b: { call: "size", args: { list: { path: "/who" } } } },
          },
          places: -2,
        },
      },
      hint: {
        call: "text",
        args: {
          parts: [
            { call: "money", args: { value: withTip } },
            " with the tip, ",
            { call: "size", args: { list: { path: "/who" } } },
            " people",
          ],
        },
      },
    },
    {
      id: "add",
      component: "Button",
      label: "Add to expenses",
      style: "primary",
      action: {
        functionCall: {
          call: "addItem",
          args: { to: "/expenses", item: { What: "Dinner", Category: "Food", Amount: 450000 } },
        },
      },
    },
    {
      id: "added",
      component: "Text",
      style: "caption",
      visible: {
        call: "greater",
        args: { a: { call: "size", args: { list: { path: "/expenses" } } }, b: 0 },
      },
      text: "Added to expenses.",
    },
  ],
  data: { total: 450000, who: ["You", "Priya", "Dev"], tip: "10%", expenses: [] },
};

/** A trip planned together: a countdown, who's going, steps, a board, a calendar, money and packing. */
export const PLANNER: A2Card = {
  title: "Trip planner",
  parts: [
    {
      id: "root",
      component: "Card",
      title: "Goa trip",
      subtitle: "Planned together",
      icon: "🏖️",
      colour: "teal",
      children: ["countdown", "who", "steps", "tabs"],
    },
    {
      id: "countdown",
      component: "Countdown",
      label: "Leaving in",
      date: { path: "/leave" },
      icon: "✈️",
      colour: "teal",
    },
    { id: "who", component: "Column", gap: "small", children: ["going", "rating"] },
    { id: "going", component: "AvatarStack", names: { path: "/people" } },
    { id: "rating", component: "Stars", label: "The homestay, so far", value: { path: "/stars" } },
    {
      id: "steps",
      component: "Steps",
      current: {
        call: "count",
        args: { list: { path: "/tasks" }, where: { field: "Status", equals: "Done" } },
      },
      steps: [
        { title: "Pick the dates", detail: "Everyone free" },
        { title: "Book tickets" },
        { title: "Book the stay" },
        { title: "Pack", detail: "The night before" },
      ],
    },
    {
      id: "tabs",
      component: "Tabs",
      tabs: [
        { title: "Tasks", child: "board" },
        { title: "Dates", child: "dates" },
        { title: "Money", child: "money" },
        { title: "Packing", child: "packing" },
      ],
    },
    {
      id: "board",
      component: "Board",
      data: { path: "/tasks" },
      groupField: "Status",
      columns: ["To do", "Doing", "Done"],
      titleField: "Title",
      subtitleField: "Due",
    },
    { id: "dates", component: "Column", children: ["calendar", "picked", "timeline"] },
    {
      id: "calendar",
      component: "Calendar",
      data: { path: "/tasks" },
      dateField: "Due",
      value: { path: "/day" },
    },
    {
      id: "picked",
      component: "Notice",
      icon: "📌",
      tone: "accent",
      visible: { call: "isSet", args: { value: { path: "/day" } } },
      text: {
        call: "text",
        args: {
          parts: [
            { call: "dateText", args: { date: { path: "/day" } } },
            ": ",
            {
              call: "count",
              args: { list: { path: "/tasks" }, where: { field: "Due", equals: { path: "/day" } } },
            },
            " to do",
          ],
        },
      },
    },
    {
      id: "timeline",
      component: "Timeline",
      data: { call: "sortBy", args: { list: { path: "/tasks" }, field: "Due" } },
      titleField: "Title",
      dateField: "Due",
      detailField: "Status",
      max: 5,
    },
    { id: "money", component: "Column", children: ["travellers", "total", "split", "back"] },
    {
      id: "travellers",
      component: "Stepper",
      label: "Travellers",
      value: { path: "/travellers" },
      min: 1,
      max: 12,
    },
    { id: "total", component: "Field", label: "Trip budget (₹)", value: { path: "/budget" }, kind: "money" },
    { id: "split", component: "Grid", columns: 2, children: ["each", "ring"] },
    {
      id: "each",
      component: "Stat",
      label: "Each pays",
      icon: "🤝",
      colour: "teal",
      format: "money",
      value: { call: "divide", args: { a: { path: "/budget" }, b: { path: "/travellers" } } },
    },
    {
      id: "ring",
      component: "ProgressRing",
      label: "Spent so far",
      colour: "orange",
      size: "small",
      value: { call: "divide", args: { a: { path: "/spentSoFar" }, b: { path: "/budget" } } },
    },
    { id: "back", component: "DateField", label: "Coming back", value: { path: "/back" } },
    { id: "packing", component: "Column", children: ["clothes", "papers"] },
    {
      id: "clothes",
      component: "Accordion",
      title: "Clothes",
      icon: "👕",
      open: true,
      subtitle: {
        call: "text",
        args: {
          parts: [
            { call: "count", args: { list: { path: "/clothes" }, where: { field: "done", equals: true } } },
            " of ",
            { call: "count", args: { list: { path: "/clothes" } } },
            " packed",
          ],
        },
      },
      children: ["clothesList"],
    },
    { id: "clothesList", component: "List", children: { componentId: "clothesRow", path: "/clothes" } },
    { id: "clothesRow", component: "CheckRow", label: { path: "name" }, checked: { path: "done" } },
    {
      id: "papers",
      component: "Accordion",
      title: "Tickets and papers",
      icon: "🎫",
      children: ["papersList"],
    },
    { id: "papersList", component: "List", children: { componentId: "papersRow", path: "/papers" } },
    { id: "papersRow", component: "CheckRow", label: { path: "name" }, checked: { path: "done" } },
  ],
  data: {
    leave: day(-12),
    back: day(-17),
    day: "",
    people: ["Asha Rao", "Kabir Shah", "Meera Iyer", "Dev Nair", "Zoya Khan"],
    stars: 4,
    travellers: 5,
    budget: 9000000,
    spentSoFar: 3400000,
    tasks: [
      { Title: "Agree on dates", Status: "Done", Due: day(3) },
      { Title: "Book train tickets", Status: "Doing", Due: day(-2) },
      { Title: "Book the homestay", Status: "To do", Due: day(-4) },
      { Title: "Travel insurance", Status: "To do", Due: day(-8) },
      { Title: "Plan day trips", Status: "To do", Due: day(-10) },
    ],
    clothes: [
      { name: "Swimwear", done: true },
      { name: "Sandals", done: false },
      { name: "Sunglasses", done: false },
      { name: "Light jacket", done: false },
    ],
    papers: [
      { name: "ID cards", done: false },
      { name: "Tickets (printed)", done: false },
    ],
  },
};

export const DEMOS: A2Card[] = [SPENDING, SPLIT, PLANNER, INVOICES, LOAN, BUDGET];
