// TESTS ONLY (AI_FAKE=1 in the test config): a scripted stand-in for the models, so the
// router, tools, confirmations and handovers can be tested without calling Workers AI.
// It looks up the exact test sentences below; the real app never reads messages this way.
import { ModelError, type ChatMessage, type ModelAnswer, type ToolSpec } from "./client.ts";
import type { ModelEntry } from "./models.ts";

let n = 0;
const call = (name: string, args: unknown): ModelAnswer => ({
  content: null,
  tool_calls: [{ id: `call_${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  usage: { input: 900, output: 60, cached: 0 },
});
const say = (content: string): ModelAnswer => ({
  content,
  tool_calls: [],
  usage: { input: 900, output: 40, cached: 0 },
});
/** Words and a call in one answer (as a model that explains and then asks). */
const both = (content: string, name: string, args: unknown): ModelAnswer => ({
  ...call(name, args),
  content,
});

/** The instructions each call got, newest last (tests check they hold still within a request). */
export const fakeSystems: string[] = [];

export function fakeModel(model: ModelEntry, messages: ChatMessage[], tools: ToolSpec[]): ModelAnswer {
  fakeSystems.push(String(messages[0]?.content ?? ""));
  if (fakeSystems.length > 50) fakeSystems.shift();
  const last = messages.at(-1)!;
  // A flow's "choose" step: the option whose name appears in the record wins (sure); a record
  // that says "Test unsure" gets a low confidence; otherwise the first option, sure.
  if (String(messages[0]?.content ?? "").startsWith("You decide one step")) {
    const text = last.content ?? "";
    const options = [...text.matchAll(/^- (.+)$/gm)].map((m) => m[1]!);
    const record = text.slice(text.indexOf("<<<")).toLowerCase();
    const hit = options.find((o) => record.includes(o.split(":")[0]!.trim().toLowerCase()));
    const choice = hit ?? options[0] ?? "";
    const confidence = record.includes("test unsure") ? 0.3 : 0.9;
    return say(JSON.stringify({ choice, confidence }));
  }
  // After a tool ran: a short reply that quotes what it got back.
  if (last.role === "tool") {
    const result = last.content ?? "";
    // "Test: remind me to call the venue": the list was just started; now the reminder itself.
    const asked = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (asked === "Test: remind me to call the venue" && result.includes('"name":"Reminders"'))
      return call("add_record", {
        collection: "Reminders",
        values: { Title: "Test call the venue", Due: "2030-01-01T18:00" },
      });
    if (result.includes('"needs_confirmation"')) return say("Please confirm the card below.");
    if (result.includes('"error"')) return say("That didn't work: " + result.slice(0, 120));
    return say("Done.");
  }
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  // "Test: fail": the provider refuses, with an error that echoes what was sent (it must
  // never reach anyone: only its fixed category does).
  // A suggested action on a chat message (the app's own prompt): "Test remind" → Remind me,
  // sure; "Test unsure" → Remind me, not sure; anything else → Nothing.
  if (String(messages[0]?.content ?? "").startsWith("You decide whether one chat message")) {
    const text = (last.content ?? "").toLowerCase();
    if (text.includes("test remind")) return say(JSON.stringify({ choice: "Remind me", confidence: 0.92 }));
    if (text.includes("test unsure")) return say(JSON.stringify({ choice: "Remind me", confidence: 0.4 }));
    return say(JSON.stringify({ choice: "Nothing", confidence: 0.95 }));
  }
  // The morning line (the app's own prompt): the facts' titles in one sentence; NOTHING when
  // the facts have no "Test" item (so a quiet day stays quiet).
  if (String(messages[0]?.content ?? "").startsWith("You write one morning line")) {
    const text = last.content ?? "";
    const titles = [...text.matchAll(/due today: ([^;\n]+)/g)].map((m) => m[1]!);
    return say(titles.length ? `Test: ${titles.join(" and ")} is due today.` : "NOTHING");
  }
  // After a setup is saved (the app's own prompt): how to use it, two messages to try, the
  // flows that fit as answers to tap.
  if (/^Make “.*”.*: saved\./.test(lastUser))
    return both(
      'Test: add the first records, then link the rest to them.\n"Add one"\n"Add another"',
      "ask_choices",
      {
        question: "Want a flow for this?",
        options: [{ label: "Remind me when one is a week old" }, { label: "Not now" }],
      },
    );
  // "Test: ask me twice": two questions asked together.
  if (lastUser === "Test: ask me twice")
    return call("ask_choices", {
      questions: [
        { question: "How often?", options: [{ label: "Every week" }, { label: "Every month" }] },
        { question: "Who should hear?", options: [{ label: "Only me" }, { label: "Everyone" }] },
      ],
    });
  // "Test: ask me": a question with answers to tap.
  if (lastUser === "Test: ask me")
    return call("ask_choices", {
      question: "How often should the reminder come?",
      options: [
        { label: "Every week", description: "Each Monday morning" },
        { label: "Every month", description: "On the 1st" },
      ],
    });
  // "Test: show a card": a card the assistant designs, filled from the Reminders list.
  if (lastUser === "Test: show a card")
    return call("show_card", {
      title: "Test reminders board",
      parts: [
        { id: "root", component: "Card", title: "Reminders", children: ["count", "list", "new", "add"] },
        {
          id: "count",
          component: "Stat",
          label: "Open",
          value: {
            call: "count",
            args: { list: { path: "/reminders" }, where: { field: "Done", not: true } },
          },
        },
        { id: "list", component: "List", children: { componentId: "line", path: "/reminders" } },
        { id: "line", component: "Row", align: "spread", children: ["row", "drop"] },
        { id: "row", component: "CheckRow", label: { path: "title" }, checked: { path: "Done" } },
        {
          id: "drop",
          component: "Button",
          label: "Delete",
          style: "secondary",
          confirm: "Sure?",
          action: { functionCall: { call: "removeItem", args: {} } },
        },
        { id: "new", component: "Field", label: "New reminder", value: { path: "/draft/Title" } },
        {
          id: "add",
          component: "Button",
          label: "Add",
          action: { functionCall: { call: "addItem", args: { to: "/reminders", from: "/draft" } } },
        },
      ],
      sources: { "/reminders": { list: "Reminders" } },
    });
  // "Test: show an action card": a button that asks the app to act (it confirms first).
  if (lastUser === "Test: show an action card")
    return call("show_card", {
      title: "Test note to self",
      parts: [
        { id: "root", component: "Card", title: "A note to keep", children: ["what", "keep"] },
        { id: "what", component: "Field", label: "What to remember", value: { path: "/note" } },
        {
          id: "keep",
          component: "Button",
          label: "Keep it",
          action: { event: { name: "remember", context: { text: { path: "/note" } } } },
        },
      ],
      data: { note: "Test the plumber comes on Fridays" },
    });
  // "Test: show a bad card": one the app can't draw (the problems come back to the model).
  if (lastUser === "Test: show a bad card")
    return call("show_card", { title: "Test bad", parts: [{ id: "root", component: "Sparkle" }] });
  if (lastUser === "Test: fail")
    throw new ModelError(`${model.label}: 429 Too Many Requests for "Test private words"`);
  const has = (name: string) => tools.some((t) => t.function.name === name);
  // "Test: delete record <id>": a delete card for that record.
  // "Test: pills for <List>": examples that act (show the list's card; open its add form).
  if (lastUser.startsWith("Test: pills for ")) {
    const list = lastUser.slice("Test: pills for ".length).trim();
    return say(
      [
        "Two things to try:",
        "",
        `> “Show ${list}” {"show": "${list}"}`,
        `> “Add one to ${list}” {"add": "${list}", "Title": "Test one"}`,
        "> “Remind me tomorrow”",
      ].join("\n"),
    );
  }
  if (lastUser.startsWith("Test: delete record "))
    return call("delete_record", { record_id: lastUser.slice("Test: delete record ".length) });
  // "Test: share <record id> with <name>": a share card for that record.
  const share = /^Test: share (\S+) with (.+)$/.exec(lastUser);
  if (share) return call("share_with", { record_id: share[1], people: [share[2]], access: "edit" });
  // "Test: open song <id>": an app's tool (Songbook), shown as the app's card.
  if (lastUser.startsWith("Test: open song "))
    return call("get_song", { song_id: lastUser.slice("Test: open song ".length) });
  // A capture about the PA: the model files it as a note (the Inbox turn makes it a card).
  if (lastUser.startsWith("Captured from ") && lastUser.includes("Test PA needs two DI boxes"))
    return call("add_record", { collection: "Notes", values: { Title: "Test PA needs two DI boxes" } });
  // A chat message being saved with a tapped suggestion: exactly that (a reminder).
  if (lastUser.startsWith("Save this chat message") && lastUser.includes("I chose: Remind me"))
    return call("add_record", {
      collection: "Reminders",
      values: { Title: "Test remind Rahul about the deposit", Due: "2030-01-01T18:00" },
    });
  // A chat message being saved (chats step 2): the model files it as a note (a card to tap).
  if (
    lastUser.startsWith("Save this chat message") &&
    lastUser.includes("<message>Test PA needs two DI boxes")
  )
    return call("add_record", { collection: "Notes", values: { Title: "Test PA needs two DI boxes" } });
  // "Test: put the rehearsal in my calendar": a calendar card, when the calendar tool is offered.
  if (lastUser === "Test: put the rehearsal in my calendar")
    return has("calendar_add_event")
      ? call("calendar_add_event", {
          title: "Test rehearsal",
          start: "2030-01-05T19:00",
          place: "Test Studio",
        })
      : say("No calendar here.");
  // "Test: which apps": whether the apps' lines reached the instructions.
  if (lastUser === "Test: which apps")
    return say(String(messages[0]?.content ?? "").includes("Songbook:") ? "Songbook is here." : "No apps.");
  // "Test: ask <name> if they're free": a question card with Yes / No.
  const ask = /^Test: ask (.+) if they're free$/.exec(lastUser);
  if (ask)
    return call("ask_people", {
      text: "Test: free on Saturday for the Test Wedding?",
      choices: ["Yes", "No"],
      people: [ask[1]],
    });
  switch (lastUser) {
    case "Test: spent 450 on groceries":
      return call("add_record", {
        collection: "Expenses",
        values: { What: "Test groceries", Amount: "450", Category: "Groceries" },
      });
    case "Test: note the PA needs two DI boxes":
      return call("add_record", { collection: "Notes", values: { Title: "Test PA needs two DI boxes" } });
    case "Test: make a collection for fam jam sign-ups":
      // Level 1 has no setup tools, so it hands over; level 2 proposes the setup.
      if (!has("create_collection")) return call("hand_over", { reason: "A new setup" });
      return call("create_collection", {
        name: "Test fam jam sign-ups",
        fields: [
          { name: "Name", type: "text" },
          { name: "Song", type: "text" },
          { name: "Instrument", type: "choice", options: { choices: ["Guitar", "Vocals", "Keys"] } },
        ],
      });
    case "Test: make a join link for Notes":
      // Sharing for other people is a setup tool (Careful): a card, then the link.
      if (!has("create_share")) return call("hand_over", { reason: "A share" });
      return call("create_share", { form: "Notes", public: false });
    case "Test: make a home setup":
      // A whole setup (lists that link, a total, cards on the home): the setup card draws it.
      if (!has("make_setup")) return call("hand_over", { reason: "A new setup" });
      return call("make_setup", {
        name: "Test home",
        collections: [
          {
            name: "Test rooms",
            fields: [
              { name: "Room", type: "text" },
              { name: "Floor", type: "number" },
            ],
          },
          {
            name: "Test repairs",
            fields: [
              { name: "Issue", type: "text" },
              { name: "Room", type: "link", options: { target: "Test rooms" } },
              { name: "Status", type: "choice", options: { choices: ["Open", "Done"] } },
              { name: "Cost", type: "money" },
            ],
          },
          {
            name: "Test bills",
            fields: [
              { name: "Bill", type: "text" },
              { name: "Repair", type: "link", options: { target: "Test repairs" } },
              { name: "Amount", type: "money" },
              { name: "Paid on", type: "date" },
            ],
          },
        ],
        rules: [
          { kind: "check", collection: "Test bills", require: [{ field: "Amount", op: "gt", value: 0 }] },
        ],
        views: [
          {
            name: "Open repairs",
            collection: "Test repairs",
            pinned: true,
            filters: [{ field: "Status", op: "eq", value: "Open" }],
          },
          {
            name: "Bills this month",
            collection: "Test bills",
            pinned: true,
            filters: [{ field: "Paid on", op: "period", value: "this_month" }],
          },
        ],
      });
    case "Test: stop the morning line":
      return call("set_morning_line", { on: false });
    case "Test: morning line at seven":
      return call("set_morning_line", { on: true, at: "07:00" });
    case "Test: formatted answer":
      // A longer answer with the Markdown a model writes (for looking at the chat's text).
      return say(
        "## Your week at a glance\n\nYou have **three things** due and one payment to make.\n\n- Call the plumber (Tuesday)\n- Renew the car insurance\n- Send the society notice\n\n### In order\n1. The plumber first, it's the oldest.\n2. Then the insurance, it lapses Friday.\n\nTry one of these:\n> “Tick the plumber”\n> “Move the insurance to Saturday”\n\n---\nSay `done` on any of these and I'll tick it.",
      );
    case "Test: remind me to call the venue":
      return call("start_list", { kind: "reminders" });
    case "Test: make a band space":
      return call("new_space", { name: "Test band" });
    case "Test: in the band money is split four ways":
      return call("set_space_instructions", { text: "Test: money is always split four ways." });
    case "Test: remember weddings are 25000":
      return call("remember", { text: "Test weddings are ₹25,000 for the band." });
    case "Test: what do you remember":
      // Says whether the remembered fact reached the instructions (they're in the system message).
      return say(
        String(messages[0]?.content ?? "").includes("Test weddings") ? "I remember." : "Nothing yet.",
      );
    case "Test: show my notes":
      return call("find_records", { collection: "Notes", search: "Test" });
    case "Test: notes by month":
      return call("query", { from: "Notes", group_by: ["Created:month"], measures: [{ fn: "count" }] });
    case "Test: how many notes":
      return call("query", { from: "Notes", measures: [{ fn: "count", as: "Notes" }], title: "Test notes" });
    case "Test: bad tool":
      return call("add_record", { collection: "Nope", values: {} });
    default:
      return say(`(${model.level}) OK`);
  }
}
