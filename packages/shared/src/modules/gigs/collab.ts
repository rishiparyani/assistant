// Working together on a gig (docs/design/gig-centric.md §11): lists (a setlist, a packing
// list, a run of show: anything in order) and notes. Everyone on the gig sees them; players
// may change them unless a manager turns that off (setting players_edit_lists).
import { z } from "zod";
import { BookingRef } from "./booking.ts";
import { clientId, id, optionalText } from "./common.ts";

export const LIST_LIMITS = { lists: 30, items: 300, notes: 500 } as const;

const listTitle = z.string().trim().min(1).max(80);
const itemText = z.string().trim().min(1).max(200);
const noteBody = z.string().trim().min(1).max(2000);
/** A list holds items and breaks: a break divides it (an interval between sets, a "Cables"
 *  heading on a packing list) and is never numbered or ticked (decision 2026-10-03). */
export const LIST_ITEM_KINDS = ["item", "break"] as const;
export type ListItemKind = (typeof LIST_ITEM_KINDS)[number];
const breakMinutes = z.number().int().min(1).max(600);

export const ListItemInput = z.object({
  id: clientId,
  text: itemText.describe("e.g. a song title"),
  detail: optionalText(200).describe('Optional, e.g. "key of G · 4 min"'),
  song_id: id("Song").optional().describe("A song in my library (find_songs), for setlists"),
  kind: z
    .enum(LIST_ITEM_KINDS)
    .default("item")
    .describe(
      '"break" divides the list (e.g. text "Break", minutes 15, between two sets); not numbered or ticked',
    ),
  minutes: breakMinutes.nullish().describe("How long a break is, in minutes (breaks only)"),
});

export const CreateGigListInput = BookingRef.extend({
  id: clientId,
  title: listTitle.describe('e.g. "Set 1", "Packing", "Run of show"'),
  event_id: id("Event").optional().describe("Leave out for a list for the whole gig"),
  checkable: z.boolean().default(false).describe("Items can be ticked off (e.g. a packing list)"),
  items: z.array(ListItemInput).max(LIST_LIMITS.items).default([]).describe("The items, in order"),
});
export const GigListRef = BookingRef.extend({ list_id: id("List") });
export const UpdateGigListInput = GigListRef.extend({
  title: listTitle.optional(),
  event_id: id("Event").nullish().describe("null makes it a list for the whole gig"),
  checkable: z.boolean().optional(),
});

export const AddListItemsInput = GigListRef.extend({
  items: z.array(ListItemInput).min(1).max(LIST_LIMITS.items),
  after_item_id: id("Item")
    .nullish()
    .describe("Add them after this item; null adds them at the top; leave out to add at the end"),
});
export const ListItemRef = GigListRef.extend({ item_id: id("Item") });
export const UpdateListItemInput = ListItemRef.extend({
  text: itemText.optional(),
  detail: optionalText(200),
  done: z.boolean().optional().describe("Tick or untick (lists with checkable on; not breaks)"),
  minutes: breakMinutes.nullish().describe("A break's length in minutes; null clears it (breaks only)"),
});
export const MoveListItemInput = ListItemRef.extend({
  after_item_id: id("Item").nullable().describe("The item it should come after; null moves it to the top"),
});

export const AddGigNoteInput = BookingRef.extend({ id: clientId, body: noteBody });
export const GigNoteRef = BookingRef.extend({ note_id: id("Note") });
export const UpdateGigNoteInput = GigNoteRef.extend({ body: noteBody });

export interface GigListItemView {
  id: string;
  /** "break": a divider in the list (an interval between sets, a heading). */
  kind: ListItemKind;
  text: string;
  /** A break's length, or null. */
  minutes: number | null;
  detail: string | null;
  /** A song in the list maker's library (music module), or null. */
  song_id: string | null;
  done: boolean;
  /** Who ticked it, when done. */
  done_by: string | null;
  /** Set on the device for a change still waiting to sync (never sent by the server). */
  pending?: boolean;
}

export interface GigListView {
  id: string;
  title: string;
  /** The event it's for, or null for the whole gig. */
  event_id: string | null;
  checkable: boolean;
  items: GigListItemView[];
  created_by: string;
  updated_at: string;
  /** Set on the device for a change still waiting to sync (never sent by the server). */
  pending?: boolean;
}

export interface GigNoteView {
  id: string;
  body: string;
  author: string;
  is_mine: boolean;
  created_at: string;
  /** Set when the note was changed after it was posted. */
  edited_at: string | null;
  /** Set on the device for a change still waiting to sync (never sent by the server). */
  pending?: boolean;
}
