// Lists and notes on a gig (docs/design/gig-centric.md §11). Everyone on the gig can use
// them unless a manager turned that off for players (setting players_edit_lists). Removing
// needs confirmation from AI assistants, like every delete.
import {
  AddGigNoteInput,
  AddListItemsInput,
  CreateGigListInput,
  GigListRef,
  GigNoteRef,
  ListItemRef,
  MoveListItemInput,
  UpdateGigListInput,
  UpdateGigNoteInput,
  UpdateListItemInput,
} from "@assistant/shared";
import { defineOperation } from "../../core/operations.ts";
import * as c from "./services/collab.ts";

export const collabOperations = [
  defineOperation({
    id: "gigs.create_gig_list",
    tool: "create_gig_list",
    description:
      "Make a list on a gig (a setlist, a packing list, a run of show...), optionally for one event and with its items in order. Lists appear in the gig's Lists tab for everyone on it. get_gig returns the gig's lists.",
    kind: "write",
    http: { method: "POST", path: "/gigs/:gig_id/lists", status: 201 },
    input: CreateGigListInput,
    handler: (ctx, input) => c.createList(ctx, input),
  }),
  defineOperation({
    id: "gigs.update_gig_list",
    tool: "update_gig_list",
    description:
      "Rename a gig's list, move it to another event or the whole gig, or turn tick boxes on or off.",
    kind: "write",
    http: { method: "PATCH", path: "/gigs/:gig_id/lists/:list_id" },
    input: UpdateGigListInput,
    handler: (ctx, input) => c.updateList(ctx, input),
  }),
  defineOperation({
    id: "gigs.remove_gig_list",
    tool: "remove_gig_list",
    description: "Remove a whole list from a gig.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/gigs/:gig_id/lists/:list_id" },
    input: GigListRef,
    handler: (ctx, input) => c.removeList(ctx, input.gig_id, input.list_id),
  }),
  defineOperation({
    id: "gigs.add_list_items",
    tool: "add_list_items",
    description:
      "Add items to a gig's list, in order: at the end (leave out after_item_id), at the top (after_item_id null) or after an item.",
    kind: "write",
    http: { method: "POST", path: "/gigs/:gig_id/lists/:list_id/items", status: 201 },
    input: AddListItemsInput,
    handler: (ctx, input) => c.addItems(ctx, input),
  }),
  defineOperation({
    id: "gigs.update_list_item",
    tool: "update_list_item",
    description: "Change an item's text or detail, or tick it off (lists with tick boxes).",
    kind: "write",
    http: { method: "PATCH", path: "/gigs/:gig_id/lists/:list_id/items/:item_id" },
    input: UpdateListItemInput,
    handler: (ctx, input) => c.updateItem(ctx, input),
  }),
  defineOperation({
    id: "gigs.move_list_item",
    tool: "move_list_item",
    description: "Reorder a list: put an item just after another item, or at the top (after_item_id null).",
    kind: "write",
    http: { method: "POST", path: "/gigs/:gig_id/lists/:list_id/items/:item_id/move" },
    input: MoveListItemInput,
    handler: (ctx, input) => c.moveItem(ctx, input),
  }),
  defineOperation({
    id: "gigs.remove_list_item",
    tool: "remove_list_item",
    description: "Remove an item from a gig's list.",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/gigs/:gig_id/lists/:list_id/items/:item_id" },
    input: ListItemRef,
    handler: (ctx, input) => c.removeItem(ctx, input.gig_id, input.list_id, input.item_id),
  }),
  defineOperation({
    id: "gigs.add_gig_note",
    tool: "add_gig_note",
    description:
      "Post a note on a gig for everyone on it (e.g. soundcheck time, what to bring). get_gig returns them as shared_notes, newest first.",
    kind: "write",
    http: { method: "POST", path: "/gigs/:gig_id/notes", status: 201 },
    input: AddGigNoteInput,
    handler: (ctx, input) => c.addNote(ctx, input),
  }),
  defineOperation({
    id: "gigs.update_gig_note",
    tool: "update_gig_note",
    description: "Change a note you wrote on a gig.",
    kind: "write",
    http: { method: "PATCH", path: "/gigs/:gig_id/notes/:note_id" },
    input: UpdateGigNoteInput,
    handler: (ctx, input) => c.updateNote(ctx, input),
  }),
  defineOperation({
    id: "gigs.remove_gig_note",
    tool: "remove_gig_note",
    description: "Remove a note from a gig (your own, or any note if you manage the gig).",
    kind: "write",
    confirm: true,
    http: { method: "DELETE", path: "/gigs/:gig_id/notes/:note_id" },
    input: GigNoteRef,
    handler: (ctx, input) => c.removeNote(ctx, input.gig_id, input.note_id),
  }),
];
