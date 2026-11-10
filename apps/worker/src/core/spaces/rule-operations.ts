// Setups (chat-first step 6): a whole setup at once, and rules on a collection (checks,
// uniqueness and status flows). Both change a setup, so outside assistants confirm first.
import {
  AddRuleInput,
  CollectionRef,
  MakeSetupInput,
  RuleRef,
  ShareSetupInput,
  type SetupResult,
} from "@assistant/shared";
import type { z } from "zod";
import { ObjectError, toAppError } from "../objects/errors.ts";
import { defineOperation, type OpUserCtx } from "../operations.ts";
import { mySpaces, newSpace, removeEmptySpace, spaceOf } from "./service.ts";
import { shareSetup } from "./setup-share.ts";
import { workflowSpec } from "./workflow-operations.ts";

/** A setup as the space's object takes it: workflows with their people resolved, saved off. */
export async function setupSpec(ctx: OpUserCtx, i: z.output<typeof MakeSetupInput>) {
  return {
    collections: i.collections.map((c) => ({
      id: c.id ?? null,
      name: c.name,
      description: c.description ?? null,
      fields: c.fields,
    })),
    rules: i.rules,
    views: i.views,
    workflows: await Promise.all(
      i.workflows.map((w) => workflowSpec(ctx, { ...w, space: i.space, enabled: false })),
    ),
  };
}

/**
 * The id of the space a setup makes, from the write's key: a retry of the same write finds the
 * space it already made and finishes the setup in it, instead of failing on the name it took
 * itself. ULID-shaped (26 Crockford characters); without a key, a fresh ULID.
 */
async function setupSpaceId(ctx: OpUserCtx): Promise<string | undefined> {
  if (!ctx.idempotencyKey) return undefined;
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ctx.user.id}:${ctx.idempotencyKey}`)),
  );
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = A[bytes[0]! & 7]!;
  for (let n = 1; n < 26; n++) out += A[bytes[n]! & 31];
  return out;
}

/** A whole setup: into a space that exists, or into a new one made for it by the same write. */
export async function makeSetup(ctx: OpUserCtx, i: z.output<typeof MakeSetupInput>) {
  if (i.new_space && i.space) throw new ObjectError("validation_failed", "Pass space or new_space, not both");
  const spec = await setupSpec(ctx, i);
  if (!i.new_space) {
    const { stub, actor } = await spaceOf(ctx, i.space);
    return stub.makeSetup(actor, ctx.idempotencyKey, spec);
  }
  const id = await setupSpaceId(ctx);
  const again = id ? (await mySpaces(ctx)).find((s) => s.id === id) : undefined;
  const made = again ?? (await newSpace(ctx, i.new_space, id));
  const { stub, actor } = await spaceOf(ctx, made.id);
  try {
    const result = (await stub.makeSetup(actor, ctx.idempotencyKey, spec)) as unknown as SetupResult;
    return { ...result, space: { id: made.id, name: made.name } };
  } catch (e) {
    // Nothing half-made: a setup that can't be made takes the space made for it away again
    // (only one this write made and that's still empty).
    if (e instanceof ObjectError || toAppError(e))
      await removeEmptySpace(ctx, made.id).catch(() => undefined);
    throw e;
  }
}

export const ruleOperations = [
  defineOperation({
    id: "core.make_setup",
    tool: "make_setup",
    description:
      "Propose a whole setup at once, as one card: new collections with their fields, links between them, formulas and rollups, rules and saved views, the workflows that run on them, and (new_space) a new space to hold it all. The person sees one plan and it's made, all together, only when they confirm. Prefer this over separate new_space, create_collection and create_workflow calls for anything with more than one part.",
    kind: "write",
    confirm: true,
    http: { method: "POST", path: "/setups", status: 201 },
    input: MakeSetupInput,
    handler: (ctx, i) => makeSetup(ctx, i),
  }),
  defineOperation({
    id: "core.share_setup",
    tool: "share_setup",
    description:
      "Share my setup with people I know, by name: the structure of some (or all) of my lists, with their fields, links, calculated fields, rules and saved views, never their records. Each person gets a card in their chat and taps Make it to get the same setup in their own space.",
    kind: "write",
    confirm: true,
    http: { method: "POST", path: "/setups/share", status: 201 },
    input: ShareSetupInput,
    handler: (ctx, i) => shareSetup(ctx, i),
  }),
  defineOperation({
    id: "core.add_rule",
    tool: "add_rule",
    description:
      'Add a rule to a collection: a check every record must meet ("Amount more than 0"), uniqueness ("only one Selected per Song and Instrument") or a status flow (allowed moves of a choice field).',
    kind: "write",
    confirm: true,
    http: { method: "POST", path: "/collections/:collection/rules", status: 201 },
    input: AddRuleInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      const { space: _s, collection, ...rule } = i;
      return stub.addRule(actor, ctx.idempotencyKey, collection, rule);
    },
  }),
  defineOperation({
    id: "core.list_rules",
    tool: "list_rules",
    description: "A collection's rules, in plain words.",
    kind: "read",
    http: { method: "GET", path: "/collections/:collection/rules" },
    input: CollectionRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.listRules(actor, i.collection);
    },
  }),
  defineOperation({
    id: "core.delete_rule",
    tool: "delete_rule",
    description: "Remove a rule from a collection.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/rules/:rule_id" },
    input: RuleRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.deleteRule(actor, ctx.idempotencyKey, i.rule_id);
    },
  }),
];
