// Workflows (docs/design/chat-first.md step 5): when / check / wait / then, kept in the
// space's object. A new workflow from an assistant (in-app or MCP) is always saved off: the
// person turns it on from its card, so nothing runs before they've seen the diagram and words.
import type { z } from "zod";
import {
  CreateWorkflowInput,
  SetWorkflowEnabledInput,
  WaitRef,
  WorkflowRef,
  type Person,
} from "@assistant/shared";
import { defineOperation } from "../operations.ts";
import type { OpUserCtx } from "../operations.ts";
import { spaceName, spaceOf } from "./service.ts";
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
      i.then.map(async (a) => {
        if (a.do !== "notify" && a.do !== "ask") return a;
        // "{Who}" means the person in that field of the record; everything else is someone known.
        const field = (r: string) => /^\{(.+)\}$/.exec(r.trim())?.[1]?.trim();
        const refs = a.do === "notify" ? a.to : a.who;
        const to = await recipients(
          ctx,
          refs.filter((r) => !field(r)),
        );
        const to_fields = refs.map(field).filter((f): f is string => !!f);
        if (a.do === "notify") return { ...a, to, to_fields };
        const { who: _who, ...ask } = a;
        return { ...ask, to, to_fields };
      }),
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
      "Make a workflow: when a record is added, changes, or a date comes (e.g. a day before), check it, maybe wait, then tell someone, set a field, add a record, ASK someone and wait for their answer (a process: nudges them, keeps the answer on the record), or go back to an earlier step. It is saved OFF; the person turns it on from its card.",
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
  // Processes (home-first.md §2 point 9): what's waiting on people, and a nudge.
  defineOperation({
    id: "core.list_waiting",
    tool: "whats_waiting",
    description:
      "What's waiting on people: my processes' open questions (who was asked, who has answered, since when), and the questions other people's processes are waiting on me for.",
    kind: "read",
    http: { method: "GET", path: "/waiting" },
    input: WaitRef.omit({ wait_id: true }),
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      const mine = await stub.listWaiting(actor);
      if (i.space) return mine;
      // No space named: also what's waiting on me in the spaces that shared something with me.
      const rows = await ctx.d1
        .prepare(`select distinct space_id from shared_with where user_id = ?`)
        .bind(ctx.user.id)
        .all<{ space_id: string }>();
      const others = await Promise.all(
        rows.results.map((r) => ctx.objects.SPACES.getByName(spaceName(r.space_id)).listWaiting(actor)),
      );
      const seen = new Set(mine.map((x) => x.id));
      return [...mine, ...others.flat().filter((x) => !seen.has(x.id) && x.share_id)];
    },
  }),
  defineOperation({
    id: "core.nudge",
    tool: "nudge",
    description: "Ask again, right now, the people a process is still waiting on.",
    kind: "write",
    http: { method: "POST", path: "/waiting/:wait_id/nudge" },
    input: WaitRef,
    handler: async (ctx, i) => {
      const { stub, actor } = await spaceOf(ctx, i.space);
      return stub.nudgeNow(actor, ctx.idempotencyKey, i.wait_id);
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
