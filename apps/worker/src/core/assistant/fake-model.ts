// TESTS ONLY (AI_FAKE=1 in the test config): a scripted stand-in for the models, so the
// router, tools, confirmations and handovers can be tested without calling Workers AI.
// It looks up the exact test sentences below; the real app never reads messages this way.
import type { ChatMessage, ModelAnswer, ToolSpec } from "./client.ts";
import type { ModelEntry } from "./models.ts";

let n = 0;
const call = (name: string, args: unknown): ModelAnswer => ({
  content: null,
  tool_calls: [{ id: `call_${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  usage: { input: 900, output: 60 },
});
const say = (content: string): ModelAnswer => ({
  content,
  tool_calls: [],
  usage: { input: 900, output: 40 },
});

export function fakeModel(model: ModelEntry, messages: ChatMessage[], tools: ToolSpec[]): ModelAnswer {
  const last = messages.at(-1)!;
  // After a tool ran: a short reply that quotes what it got back.
  if (last.role === "tool") {
    const result = last.content ?? "";
    if (result.includes('"needs_confirmation"')) return say("Please confirm the card above.");
    if (result.includes('"error"')) return say("That didn't work: " + result.slice(0, 120));
    return say("Done.");
  }
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const has = (name: string) => tools.some((t) => t.function.name === name);
  // "Test: delete record <id>": a delete card for that record.
  if (lastUser.startsWith("Test: delete record "))
    return call("delete_record", { record_id: lastUser.slice("Test: delete record ".length) });
  // "Test: share <record id> with <name>": a share card for that record.
  const share = /^Test: share (\S+) with (.+)$/.exec(lastUser);
  if (share) return call("share_with", { record_id: share[1], people: [share[2]], access: "edit" });
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
    case "Test: remember weddings are 25000":
      return call("remember", { text: "Test weddings are ₹25,000 for the band." });
    case "Test: what do you remember":
      // Says whether the remembered fact reached the instructions (they're in the system message).
      return say(
        String(messages[0]?.content ?? "").includes("Test weddings") ? "I remember." : "Nothing yet.",
      );
    case "Test: show my notes":
      return call("find_records", { collection: "Notes", search: "Test" });
    case "Test: bad tool":
      return call("add_record", { collection: "Nope", values: {} });
    default:
      return say(`(${model.level}) OK`);
  }
}
