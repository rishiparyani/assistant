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

/** The instructions each call got, newest last (tests check they hold still within a request). */
export const fakeSystems: string[] = [];

export function fakeModel(model: ModelEntry, messages: ChatMessage[], tools: ToolSpec[]): ModelAnswer {
  fakeSystems.push(String(messages[0]?.content ?? ""));
  if (fakeSystems.length > 50) fakeSystems.shift();
  const last = messages.at(-1)!;
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
    if (result.includes('"needs_confirmation"')) return say("Please confirm the card above.");
    if (result.includes('"error"')) return say("That didn't work: " + result.slice(0, 120));
    return say("Done.");
  }
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  // "Test: fail": the provider refuses, with an error that echoes what was sent (it must
  // never reach anyone: only its fixed category does).
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
  // "Test: show a bad card": one the app can't draw (the problems come back to the model).
  if (lastUser === "Test: show a bad card")
    return call("show_card", { title: "Test bad", parts: [{ id: "root", component: "Sparkle" }] });
  if (lastUser === "Test: fail")
    throw new ModelError(`${model.label}: 429 Too Many Requests for "Test private words"`);
  const has = (name: string) => tools.some((t) => t.function.name === name);
  // "Test: delete record <id>": a delete card for that record.
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
