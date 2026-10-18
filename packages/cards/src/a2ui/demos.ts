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
      component: "Progress",
      label: "Collected so far",
      tone: "good",
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
      component: "BarChart",
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
      component: "BarChart",
      format: "money",
      bars: [
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
      tone: "warn",
      value: {
        call: "divide",
        args: {
          a: {
            call: "add",
            args: {
              a: { call: "pick", args: { when: { path: "/payRent" }, then: { path: "/rent" }, else: 0 } },
              b: { call: "add", args: { a: { path: "/food" }, b: { path: "/travel" } } },
            },
          },
          b: { path: "/income" },
        },
      },
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

export const DEMOS: A2Card[] = [INVOICES, LOAN, BUDGET];
