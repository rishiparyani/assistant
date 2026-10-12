// Share my setup (home-first.md §5.4): the structure of some of my lists (fields, links,
// calculated fields, rules, saved views), never their records, sent to people I know as a
// card in their chat. They read it and tap Make it to get it in their own space; the copy is
// made there by make_setup, checked by the same schemas and limits as any setup. Nothing is
// made before the tap.
import {
  SetupDefinition,
  setupWords,
  type Person,
  type ShareSetupInput,
  type SharedSetup,
} from "@assistant/shared";
import type { OpUserCtx } from "../operations.ts";
import { AppError } from "../errors.ts";
import { assistantOnFor } from "../assistant/access.ts";
import { inboxName } from "../push/notify.ts";
import { spaceOf } from "./service.ts";
import { resolvePeople } from "./shares.ts";

/** How long the card can be tapped: a week (a confirm card lasts minutes). */
const SHARED_SETUP_MINUTES = 7 * 24 * 60;

export async function shareSetup(ctx: OpUserCtx, i: ShareSetupInput): Promise<SharedSetup> {
  const people = (await resolvePeople(ctx, i.to)).filter((p) => p.user_id !== ctx.user.id);
  if (!people.length) throw new AppError("validation_failed", "Say who to share it with (someone else).");
  const { stub, actor } = await spaceOf(ctx, i.space);
  // The stub's result type doesn't survive the RPC typing (unknown values in filters); the
  // definition is checked by the schema right below anyway.
  const described = (await stub.describeSetup(actor, i.collections ?? null)) as unknown as SetupDefinition;
  const parsed = SetupDefinition.safeParse({ ...described, name: i.name ?? described.name });
  if (!parsed.success)
    throw new AppError(
      "validation_failed",
      `This setup can't be sent as it is: ${parsed.error.issues[0]?.message ?? "it doesn't fit a setup"}`,
    );
  const def = parsed.data;
  const words = setupWords(def);
  for (const p of people)
    if (!(await assistantOnFor(ctx, p.user_id)))
      throw new AppError(
        "validation_failed",
        `${p.name} doesn't have the assistant yet, so they can't make a setup. An owner can switch it on for them in Settings.`,
      );
  const title = `Make “${def.name}” (from ${ctx.user.name})`;
  const details = [
    `${ctx.user.name} shared this setup with you: the lists and how they work, none of their records. Make it puts it in your own space.`,
    ...words,
  ];
  for (const p of people) await sendTo(ctx, p, def, title, details);
  return { name: def.name, to: people, words, collections: def.collections.map((c) => c.name) };
}

async function sendTo(
  ctx: OpUserCtx,
  p: Person,
  def: SetupDefinition,
  title: string,
  details: string[],
): Promise<void> {
  const chat = ctx.objects.CHATS.get(ctx.objects.CHATS.idFromName(`chat:${p.user_id}`));
  // The card and its message land together, once per request key and person: a retry after
  // a failure delivers to whoever didn't get it, and nobody gets it twice.
  const delivered = await chat.deliverCard(
    p.user_id,
    `setup:${ctx.idempotencyKey ?? crypto.randomUUID()}`,
    { tool: "make_setup", args: def as unknown as Record<string, unknown>, title, details },
    `${ctx.user.name} shared a setup with you: “${def.name}”. Make it to get it in your own space (the lists, not their records); nothing happens otherwise.`,
    SHARED_SETUP_MINUTES,
  );
  if (!delivered) return;
  try {
    await ctx.objects.INBOX.getByName(inboxName(p.user_id)).notify({
      kind: "setup_shared",
      title: `${ctx.user.name} shared a setup`,
      body: def.name,
      url: "/",
    });
  } catch (e) {
    console.error("notify failed", e instanceof Error ? e.message : String(e));
  }
}
