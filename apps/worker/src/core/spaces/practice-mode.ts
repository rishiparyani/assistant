// Rehearsing as a person (docs/design/from-scratch.md §2 point 9, FS3): while the app is used
// as one of a practice copy's people, only the copy answers, as that person. Which operations
// may run then: reading and using lists, records, views, what's shared, what's waiting, and who
// I am; the rest (making spaces, the assistant, chats with people, settings) is refused, so
// nothing in the copy reaches anyone and nothing of the owner's is reached as someone else.
import type { PracticeMode, UserCtx } from "../context.ts";

export const PRACTICE_OPS: ReadonlySet<string> = new Set([
  "core.get_me",
  "core.list_spaces",
  "core.list_collections",
  "core.describe_collection",
  "core.find_records",
  "core.query",
  "core.get_record",
  "core.add_record",
  "core.update_record",
  "core.update_records",
  "core.list_views",
  "core.open_view",
  "core.history",
  "core.list_comments",
  "core.add_comment",
  "core.shared_with_me",
  "core.open_shared_card",
  "core.update_shared_record",
  "core.add_shared_record",
  "core.answer_question",
  "core.get_question",
  "core.shared_comments",
  "core.add_shared_comment",
  "core.list_workflows",
  "core.get_workflow",
  "core.list_waiting",
  // These answer with nothing while rehearsing (a person's own things are never shown).
  "core.memories",
  "core.list_groups",
  "core.list_chat_people",
  "core.search",
]);

/** Whether this operation may run while rehearsing. */
export const practiceAllowed = (opId: string, ctx: Pick<UserCtx, "practice">) =>
  !ctx.practice || PRACTICE_OPS.has(opId);

/** The rehearsal, when the request is one. */
export const practiceOf = (ctx: Pick<UserCtx, "practice">): PracticeMode | null => ctx.practice ?? null;
