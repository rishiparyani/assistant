// Rules on a collection (chat-first step 6): checks, uniqueness and status flows. Adding or
// removing one changes a setup, so outside assistants confirm first.
import { AddRuleInput, CollectionRef, RuleRef } from "@assistant/shared";
import { defineOperation } from "../operations.ts";
import { spaceOf } from "./service.ts";

export const ruleOperations = [
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
