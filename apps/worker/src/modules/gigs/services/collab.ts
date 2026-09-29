// Lists and notes on a gig (docs/design/gig-centric.md §11): thin services in front of the
// gig's own object, which checks who may change them and keeps idempotency and audit.
import type {
  AddGigNoteInput,
  AddListItemsInput,
  CreateGigListInput,
  MoveListItemInput,
  UpdateGigListInput,
  UpdateGigNoteInput,
  UpdateListItemInput,
} from "@assistant/shared";
import type { z } from "zod";
import type { OpUserCtx } from "../../../core/operations.ts";
import type { Actor } from "../../../core/objects/storage.ts";
import { bookingName } from "../objects/names.ts";

const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });
const gig = (ctx: OpUserCtx, gigId: string) => ctx.objects.BOOKINGS.getByName(bookingName(gigId));
const items = (xs: { text: string; detail?: string | null }[]) =>
  xs.map((x) => ({ text: x.text, detail: x.detail ?? null }));

export const createList = (ctx: OpUserCtx, i: z.output<typeof CreateGigListInput>) =>
  gig(ctx, i.gig_id).createList(
    { title: i.title, event_id: i.event_id ?? null, checkable: i.checkable, items: items(i.items) },
    actorOf(ctx),
    ctx.idempotencyKey,
  );

export const updateList = (ctx: OpUserCtx, i: z.output<typeof UpdateGigListInput>) =>
  gig(ctx, i.gig_id).updateList(
    i.list_id,
    { title: i.title, event_id: i.event_id, checkable: i.checkable },
    actorOf(ctx),
    ctx.idempotencyKey,
  );

export const removeList = (ctx: OpUserCtx, gigId: string, listId: string) =>
  gig(ctx, gigId).removeList(listId, actorOf(ctx), ctx.idempotencyKey);

export const addItems = (ctx: OpUserCtx, i: z.output<typeof AddListItemsInput>) =>
  gig(ctx, i.gig_id).addItems(i.list_id, items(i.items), i.after_item_id, actorOf(ctx), ctx.idempotencyKey);

export const updateItem = (ctx: OpUserCtx, i: z.output<typeof UpdateListItemInput>) =>
  gig(ctx, i.gig_id).updateItem(
    i.list_id,
    i.item_id,
    { text: i.text, detail: i.detail, done: i.done },
    actorOf(ctx),
    ctx.idempotencyKey,
  );

export const moveItem = (ctx: OpUserCtx, i: z.output<typeof MoveListItemInput>) =>
  gig(ctx, i.gig_id).moveItem(i.list_id, i.item_id, i.after_item_id, actorOf(ctx), ctx.idempotencyKey);

export const removeItem = (ctx: OpUserCtx, gigId: string, listId: string, itemId: string) =>
  gig(ctx, gigId).removeItem(listId, itemId, actorOf(ctx), ctx.idempotencyKey);

export const addNote = (ctx: OpUserCtx, i: z.output<typeof AddGigNoteInput>) =>
  gig(ctx, i.gig_id).addNote(i.body, actorOf(ctx), ctx.idempotencyKey);

export const updateNote = (ctx: OpUserCtx, i: z.output<typeof UpdateGigNoteInput>) =>
  gig(ctx, i.gig_id).updateNote(i.note_id, i.body, actorOf(ctx), ctx.idempotencyKey);

export const removeNote = (ctx: OpUserCtx, gigId: string, noteId: string) =>
  gig(ctx, gigId).removeNote(noteId, actorOf(ctx), ctx.idempotencyKey);
