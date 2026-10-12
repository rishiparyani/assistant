// What a card draws from (the app fills it: records, totals, the step a process waits on).
// The spec says what kind of card it is; the rest is the data it shows.
import type {
  CollectionView,
  Memory,
  RecordView,
  SavedView,
  ShareAccess,
  ShareKind,
  WaitingItem,
} from "@assistant/shared";
import type { CardSpec } from "../spec.ts";
import type { CollectionColour } from "./theme.ts";

export interface HomeCard {
  id: string;
  /** The saved view this card shows (its order and size live there); null for a list the
   *  chat shows that isn't saved as a view, and for a process card. */
  view: SavedView | null;
  spec: CardSpec;
  /** The list the records come from; null for a process card. */
  collection: CollectionView | null;
  colour: CollectionColour;
  records: RecordView[];
  total: number | null;
  /** A process card (home-first.md §2 point 9): the step waiting on people. */
  waiting?: WaitingItem;
  /** The memory card (home-first.md §2 point 16): what the assistant remembers for me. */
  memory?: Memory[];
  /** Something shared with me (collaborator homes, home-first.md §2 point 8). */
  shared?: {
    share_id: string;
    kind: ShareKind;
    access: ShareAccess;
    owner: string;
    /** A shared record's fields, shown as rows. */
    fields?: { name: string; display: string }[];
  };
}
