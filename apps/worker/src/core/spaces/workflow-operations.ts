// Workflows (docs/design/chat-first.md step 5): when / check / wait / then, kept in the
// space's object. A new workflow from an assistant (in-app or MCP) is always saved off: the
// person turns it on from its card, so nothing runs before they've seen the diagram and words.
import type { z } from "zod";
import { CreateWorkflowInput, SetWorkflowEnabledInput, WorkflowRef, type Person } from "@assistant/shared";
import { defineOperation } from "../operations.ts";
import type { OpUserCtx } from "../operations.ts";
import { spaceOf } from "./service.ts";
import { resolvePeople } from "./shares.ts";
import type { WorkflowSpec } from "./space-object.ts";

/** "me" is the person asking; anyone else must be someone they know (never a guess). */
async function recipients(ctx: OpUserCtx, refs: string[]): Promise<Person[]> {
  const me = refs.some((r) => r.trim().toLowerCase() === "me");
  const others = refs.filter((r) => r.trim().toLowerCase() !== "me");
  return [
    ...(me ? [{ user_id: ctx.user.id, name: "me" }] : []),
    ...(others.length ? await resolvePeople(ctx, others) : []),
  ];
}

export async function createWorkflow(ctx: OpUserCtx, i: z.output<typeof CreateWorkflowInput>) {
  const spec: WorkflowSpec = {
    name: i.name,
    when: i.when,
    check: i.check,
    wait_minutes: i.wait_minutes,
    then: await Promise.all(
      i.then.map(async (a) => (a.do === "notify" ? { ...a, to: await recipients(ctx, a.to) } : a)),
    ),
    // Outside assistants can't turn one on by themselves.
    enabled: ctx.source === "mcp" ? false : i.enabled,
  };
  const { stub, actor } = await spaceOf(ctx, i.space);
  return stub.createWorkflow(actor, ctx.idempotencyKey, spec);
}

export const workflowOperations = [
  defineOperation({
    id: "core.create_workflow",
    tool: "create_workflow",
    description:
      "Make a workflow: when a record is added, changes, or a date comes (e.g. a day before), check it, maybe wait, then tell someone, set a field or add a record. It is saved OFF; the person turns it on from its card.",
    kind: "write",
    confirm: true,
    http: { method: "POST", path: "/workflows", status: 201 },
    input: CreateWorkflowInput,
    handler: (ctx, i) => createWorkflow(ctx, i),
  }),
  defineOperation({
    id: "core.list_workflows",
    tool: "list_workflows",
    description: "My workflows: on or off, in plain words, how often they ran.",
    kind: "read",
    http: { method: "GET", path: "/workflows" },
    input: WorkflowRef.omit({ workflow_id: true }),
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.listWorkflows(actor);
    },
  }),
  defineOperation({
    id: "core.get_workflow",
    tool: "get_workflow",
    description: "One workflow with what it did lately.",
    kind: "read",
    http: { method: "GET", path: "/workflows/:workflow_id" },
    input: WorkflowRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.getWorkflow(actor, i.workflow_id);
    },
  }),
  defineOperation({
    id: "core.set_workflow_enabled",
    tool: "set_workflow_enabled",
    description: "Turn a workflow on or off.",
    kind: "write",
    confirm: true,
    http: { method: "PUT", path: "/workflows/:workflow_id/enabled" },
    input: SetWorkflowEnabledInput,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.setWorkflowEnabled(actor, ctx.idempotencyKey, i.workflow_id, i.enabled);
    },
  }),
  defineOperation({
    id: "core.delete_workflow",
    tool: "delete_workflow",
    description: "Delete a workflow (it stops at once).",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/workflows/:workflow_id" },
    input: WorkflowRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.deleteWorkflow(actor, ctx.idempotencyKey, i.workflow_id);
    },
  }),
];
