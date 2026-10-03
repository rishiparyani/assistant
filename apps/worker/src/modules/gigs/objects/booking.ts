// One gig's own database (docs/design/gig-centric.md §5): the gig, its events and people,
// and (from step 3) its money. Everything that must be exactly consistent lives here and
// is changed one request at a time. Changes others must hear about go through the outbox:
// the note is written with the change, then handed to the summaries queue by the alarm.
import { DurableObject } from "cloudflare:workers";
import {
  GIG_SETTINGS_DEFAULTS,
  GUEST_LIMITS,
  LIST_LIMITS,
  formatDateIST,
  formatDateTimeIST,
  isoDateIST,
  money,
  paymentStatus,
  ulid,
  type BookingRole,
  type BookingView,
  type EventKind,
  type GigKind,
  type GigListView,
  type GigMoney,
  type GigNoteView,
  type GuestListView,
  type SharedGuestListView,
  type GigPaymentView,
  type GigSettings,
  type GigHistoryView,
  type PayeeView,
  type PaymentMethod,
} from "@assistant/shared";
import {
  BASE_TABLES,
  audit,
  bumpAndNote,
  clearOutbox,
  currentSeq,
  getMeta,
  hashOf,
  idempotent,
  migrate,
  nowIso,
  outboxFailed,
  outboxNote,
  setMeta,
  exportTables,
  importTables,
  type Actor,
  type AuditEntry,
  type ObjectDump,
  type Migrations,
} from "../../../core/objects/storage.ts";
import { ObjectError } from "../../../core/objects/errors.ts";
import { describe, sourceLabel, whoDid, type AuditRow, type HistoryNames } from "../history.ts";
import { createdMonthOf, monthName, monthOf, pendingName, pendingShard } from "./names.ts";
import type { GigSummaries, IndexCard, LearnedContact, PersonGigSummary, SummaryMessage } from "./types.ts";

/** What a backup holds for each gig. */
const BACKUP_TABLES = [
  "gig",
  "gig_tags",
  "events",
  "people",
  "lineup",
  "payments",
  "payouts",
  "expenses",
  "lists",
  "list_items",
  "notes",
  "guests",
  "attendance",
  "_audit",
  "_targets",
  "_meta",
] as const;

const MIGRATIONS: Migrations = [
  BASE_TABLES +
    `
  create table gig (
    id text primary key,
    title text not null,
    status text not null check (status in ('enquiry', 'confirmed', 'completed', 'cancelled')),
    version integer not null default 1,
    created_by text not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create table events (
    id text primary key,
    title text,
    start_at text not null,
    end_at text,
    venue_name text,
    position integer not null,
    deleted_at text
  );
  create table people (
    id text primary key,
    user_id text,
    name text not null,
    email text,
    role text not null check (role in ('manager', 'player')),
    added_by text,
    created_at text not null,
    removed_at text
  );
  create unique index people_user_uidx on people (user_id) where user_id is not null and removed_at is null;
  -- Everyone who has ever received summaries, so removals reach them too.
  create table _targets (kind text not null, key text not null, primary key (kind, key));
  `,
  // Step 2: full gig details (client snapshot, type, notes), event venue city and notes,
  // people's phone numbers.
  `
  alter table gig add column event_type text;
  alter table gig add column client_name text;
  alter table gig add column client_phone text;
  alter table gig add column client_organisation text;
  alter table gig add column notes text;
  alter table gig add column cancel_reason text;
  alter table events add column venue_city text;
  alter table events add column notes text;
  alter table people add column phone text;
  `,
  // Step 3: money. Payments and payouts are append-only (a correction is a reversing
  // entry); expenses can be removed. Balances and statuses are derived, never stored.
  `
  alter table gig add column fee_paise integer not null default 0 check (fee_paise >= 0);
  alter table gig add column settings_json text not null default '{}';
  create table lineup (
    id text primary key,
    event_id text not null,
    person_id text not null,
    part text,
    share_paise integer not null check (share_paise >= 0),
    position integer not null
  );
  create unique index lineup_event_person_uidx on lineup (event_id, person_id);
  create index lineup_person_idx on lineup (person_id);
  create table payments (
    id text primary key,
    amount_paise integer not null check (amount_paise <> 0),
    paid_on text not null,
    method text not null,
    note text,
    reverses_id text,
    created_by text,
    created_at text not null
  );
  create unique index payments_reverses_uidx on payments (reverses_id) where reverses_id is not null;
  create table payouts (
    id text primary key,
    person_id text not null,
    event_id text,
    amount_paise integer not null check (amount_paise <> 0),
    paid_on text not null,
    method text not null,
    note text,
    reverses_id text,
    created_by text,
    created_at text not null
  );
  create index payouts_person_idx on payouts (person_id);
  create unique index payouts_reverses_uidx on payouts (reverses_id) where reverses_id is not null;
  create table expenses (
    id text primary key,
    event_id text,
    category text not null,
    amount_paise integer not null check (amount_paise > 0),
    spent_on text not null,
    note text,
    created_by text,
    created_at text not null,
    deleted_at text
  );
  `,
  // Step 5: a collective tag and custom tags (ids from the D1 tag registry, names as snapshots).
  `
  alter table gig add column collective_tag_id text;
  alter table gig add column collective_name text;
  create table gig_tags (tag_id text primary key, name text not null, position integer not null);
  `,
  // Refunds (e.g. an advance returned when a gig is cancelled) are their own entries, not
  // corrections: kind 'refund', negative amount.
  `
  alter table payments add column kind text not null default 'payment';
  `,
  // Working together (§11): lists (setlist, packing, run of show) and notes. Positions are
  // numbers with room between them, so moving an item changes only that item's row.
  `
  create table lists (
    id text primary key,
    title text not null,
    event_id text,
    checkable integer not null default 0,
    created_by text not null,
    created_by_name text not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create index lists_created_idx on lists (created_at) where deleted_at is null;
  create table list_items (
    id text primary key,
    list_id text not null,
    text text not null,
    detail text,
    position real not null,
    done_at text,
    done_by_name text,
    created_by text not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create index list_items_list_idx on list_items (list_id, position) where deleted_at is null;
  create table notes (
    id text primary key,
    body text not null,
    created_by text not null,
    author_name text not null,
    created_at text not null,
    edited_at text,
    deleted_at text
  );
  create index notes_created_idx on notes (created_at) where deleted_at is null;
  `,
  // Guest list: each guest belongs to someone on the gig (their host) and counts as
  // 1 + plus_ones heads. Limits, closing time and the venue link live on the gig.
  `
  alter table gig add column guest_settings_json text not null default '{}';
  create table guests (
    id text primary key,
    name text not null,
    plus_ones integer not null default 0 check (plus_ones >= 0),
    note text,
    host_person_id text not null,
    added_by text,
    created_at text not null,
    updated_at text not null,
    arrived_at text,
    deleted_at text
  );
  create index guests_host_idx on guests (host_person_id) where deleted_at is null;
  create index guests_created_idx on guests (created_at) where deleted_at is null;
  `,
  // 8: a list item can point at a song in someone's library (the music module); the item's
  // text is the song's title at the time, so the list reads fine without the library.
  `alter table list_items add column song_id text;`,
  // 9: what a cancelled gig was (enquiry or confirmed), so reopening puts it back.
  `alter table gig add column cancelled_from text;`,
  // 10: rehearsals (docs/design/rehearsals.md). Events are shows or rehearsals; a gig of
  // kind "rehearsal" is a rehearsal that isn't for any gig. People answer whether they're
  // coming to a rehearsal (no answer = no row).
  `
  alter table gig add column kind text not null default 'gig' check (kind in ('gig', 'rehearsal'));
  alter table events add column kind text not null default 'show' check (kind in ('show', 'rehearsal'));
  create table attendance (
    event_id text not null,
    person_id text not null,
    going integer not null check (going in (0, 1)),
    updated_at text not null,
    primary key (event_id, person_id)
  );
  create index attendance_person_idx on attendance (person_id);
  `,
  // 11: date options on an enquiry (soft blocks): shows marked hold until the client picks;
  // confirming keeps the picked one(s) and releases the rest (docs/design/holds.md).
  `alter table events add column hold integer not null default 0 check (hold in (0, 1));`,
  // 12: groups can arrive in parts (Rahul +2: 1 of 3 in). Guests ticked as arrived before
  // this came in whole.
  `
  alter table guests add column arrived_count integer not null default 0 check (arrived_count >= 0);
  update guests set arrived_count = 1 + plus_ones where arrived_at is not null;
  `,
];

/** Already validated and normalised by the Worker (packages/shared booking.ts schemas). */
export interface EventInput {
  kind?: EventKind;
  hold?: boolean;
  title?: string | null;
  start_at: string;
  end_at?: string | null;
  venue_name?: string | null;
  venue_city?: string | null;
  notes?: string | null;
}
/** A person as resolved by the Worker: an account (user_id) or just a name. */
export interface PersonInput {
  user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: BookingRole;
}
export interface ClientInput {
  name: string;
  phone?: string | null;
  organisation?: string | null;
}
/** Payment or payout details, amounts already in paise. */
export interface MoneyEntryInput {
  amount_paise: number;
  paid_on: string;
  method: PaymentMethod;
  note: string | null;
}
/** Someone on the gig, by id or by their exact name on this gig. */
export interface PersonPick {
  person_id?: string;
  person_name?: string;
}
export interface LineupEntryInput extends PersonPick {
  part: string | null;
  share_paise: number;
}
export interface ExpenseInput {
  event_id: string | null;
  category: string;
  amount_paise: number;
  spent_on: string;
  note: string | null;
}
export type SettingsInput = Partial<GigSettings>;
export interface ListItemInput {
  /** Made on the device for changes made offline (docs/design/offline.md). */
  id?: string | null;
  text: string;
  detail: string | null;
  /** A song in the list maker's library (music module); the text is its title. */
  song_id?: string | null;
}
export interface CreateListInput {
  id?: string | null;
  title: string;
  event_id: string | null;
  checkable: boolean;
  items: ListItemInput[];
}
export interface UpdateListInput {
  title?: string;
  event_id?: string | null;
  checkable?: boolean;
}
export interface GuestInput {
  id?: string | null;
  name: string;
  plus_ones: number;
  note: string | null;
}
export interface UpdateGuestInput {
  name?: string;
  plus_ones?: number;
  note?: string | null;
  arrived?: boolean;
  /** How many of the group are in (0 to 1 + plus_ones). */
  arrived_count?: number;
}
export interface GuestSettingsInput {
  total_limit?: number | null;
  per_person_limit?: number | null;
  closes_at?: string | null;
}
/** The venue link as the Worker made it: the token's hash to check, and the token sealed. */
export interface GuestLinkInput {
  hash: string;
  sealed: string;
}
export interface UpdateItemInput {
  text?: string;
  detail?: string | null;
  done?: boolean;
}
/** A tag from the D1 registry (the Worker resolves names to ids). */
export interface TagRef {
  id: string;
  name: string;
}

export interface CreateGigInput {
  gig_id: string;
  kind?: GigKind;
  title: string;
  event_type?: string | null;
  status?: "enquiry" | "confirmed";
  client?: ClientInput | null;
  notes?: string | null;
  fee_paise?: number;
  settings?: SettingsInput;
  collective?: TagRef | null;
  tags?: TagRef[];
  events: EventInput[];
  people: PersonInput[];
}
export interface UpdateGigInput {
  version: number;
  title?: string;
  event_type?: string | null;
  client?: ClientInput | null;
  notes?: string | null;
  fee_paise?: number;
  settings?: SettingsInput;
  collective?: TagRef | null;
  tags?: TagRef[];
}
export interface UpdateEventInput {
  version: number;
  title?: string | null;
  start_at?: string;
  end_at?: string | null;
  venue_name?: string | null;
  venue_city?: string | null;
  notes?: string | null;
}

type GigStatus = BookingView["status"];
type GigRow = {
  id: string;
  kind: GigKind;
  title: string;
  event_type: string | null;
  status: GigStatus;
  cancel_reason: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_organisation: string | null;
  notes: string | null;
  fee_paise: number;
  settings_json: string;
  guest_settings_json: string;
  collective_tag_id: string | null;
  collective_name: string | null;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
type EventRow = {
  id: string;
  kind: EventKind;
  /** 1: a date option on an enquiry (soft block). */
  hold: number;
  title: string | null;
  start_at: string;
  end_at: string | null;
  venue_name: string | null;
  venue_city: string | null;
  notes: string | null;
  position: number;
};
type PersonRow = {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: BookingRole;
};
type LineupRow = {
  id: string;
  event_id: string;
  person_id: string;
  part: string | null;
  share_paise: number;
};
type EntryRow = {
  id: string;
  kind: "payment" | "refund";
  amount_paise: number;
  paid_on: string;
  method: PaymentMethod;
  note: string | null;
  reverses_id: string | null;
  created_at: string;
};
type PayoutRow = EntryRow & { person_id: string; event_id: string | null };
type ExpenseRow = {
  id: string;
  event_id: string | null;
  category: string;
  amount_paise: number;
  spent_on: string;
  note: string | null;
  created_at: string;
};

/** Allowed status changes: enquiry → confirmed → completed; enquiry → completed; either → cancelled. */
const TRANSITIONS: Record<"confirm" | "complete" | "cancel", { to: GigStatus; from: GigStatus[] }> = {
  confirm: { to: "confirmed", from: ["enquiry"] },
  complete: { to: "completed", from: ["enquiry", "confirmed"] },
  cancel: { to: "cancelled", from: ["enquiry", "confirmed"] },
};

export class BookingObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  // --- Writes ------------------------------------------------------------------------
  // Every write: idempotent (key), checked (gig exists, caller's role), audited, and
  // announced through the outbox, all in one transaction; then delivery is scheduled.

  async create(input: CreateGigInput, actor: Actor, key: string | null): Promise<BookingView> {
    if (!actor.userId) throw new ObjectError("forbidden", "Sign in to create a gig");
    if (!input.events.length) throw new ObjectError("validation_failed", "A gig needs at least one event");
    if (!input.people.some((p) => p.user_id === actor.userId && p.role === "manager"))
      throw new ObjectError("validation_failed", "The creator must be one of the gig's managers");
    const kind = input.kind ?? "gig";
    if (kind === "rehearsal") {
      if (input.client || (input.fee_paise ?? 0) > 0)
        throw new ObjectError("validation_failed", "A rehearsal has no client or fee", {
          reason: "rehearsal_no_money",
        });
      // A rehearsal that isn't for a gig holds only rehearsals, and is simply on.
      input = {
        ...input,
        status: "confirmed",
        events: input.events.map((e) => ({ ...e, kind: "rehearsal" })),
      };
    } else if (!input.events.some((e) => (e.kind ?? "show") === "show"))
      throw new ObjectError("validation_failed", "A gig needs at least one show (not only rehearsals)", {
        reason: "no_show",
      });
    if (input.events.some((e) => e.hold) && (kind !== "gig" || (input.status ?? "enquiry") !== "enquiry"))
      throw new ObjectError(
        "validation_failed",
        "Date options (holds) are for enquiries; confirming picks the date",
        { reason: "hold_needs_enquiry" },
      );
    const hash = await hashOf(["create", input]);
    const view = idempotent(this.ctx.storage, key, hash, () => {
      if (this.gigRow()) throw new ObjectError("conflict", "This gig already exists");
      const ts = nowIso();
      this.sql.exec(
        `insert into gig (id, kind, title, event_type, status, client_name, client_phone, client_organisation, notes,
           fee_paise, settings_json, collective_tag_id, collective_name, created_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.gig_id,
        kind,
        input.title,
        input.event_type ?? null,
        input.status ?? "enquiry",
        input.client?.name ?? null,
        input.client?.phone ?? null,
        input.client?.organisation ?? null,
        input.notes ?? null,
        input.fee_paise ?? 0,
        JSON.stringify(input.settings ?? {}),
        input.collective?.id ?? null,
        input.collective?.name ?? null,
        actor.userId,
        ts,
        ts,
      );
      input.events.forEach((e, i) => this.insertEvent(e, i));
      this.setTags(input.tags ?? []);
      for (const p of dedupePeople(input.people)) this.insertPerson(p, actor.userId!, ts);
      const after = this.viewFor(actor.userId!);
      audit(this.sql, actor, { action: "create_gig", entityType: "gig", entityId: input.gig_id, after });
      bumpAndNote(this.sql);
      return after;
    });
    await this.scheduleDelivery();
    return view;
  }

  /** Changes the gig's details if it hasn't changed since `version`. */
  async update(input: UpdateGigInput, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["update", input], actor, key, "manager", (gig) => {
      this.checkVersion(gig, input.version);
      if (gig.kind === "rehearsal" && (input.client || (input.fee_paise ?? 0) > 0))
        throw new ObjectError("validation_failed", "A rehearsal has no client or fee", {
          reason: "rehearsal_no_money",
        });
      const next = {
        title: input.title ?? gig.title,
        event_type: input.event_type === undefined ? gig.event_type : input.event_type,
        client_name: input.client === undefined ? gig.client_name : (input.client?.name ?? null),
        client_phone: input.client === undefined ? gig.client_phone : (input.client?.phone ?? null),
        client_organisation:
          input.client === undefined ? gig.client_organisation : (input.client?.organisation ?? null),
        notes: input.notes === undefined ? gig.notes : input.notes,
        fee_paise: input.fee_paise ?? gig.fee_paise,
        settings_json: input.settings
          ? JSON.stringify({ ...settingsOf(gig), ...input.settings })
          : gig.settings_json,
        collective_tag_id:
          input.collective === undefined ? gig.collective_tag_id : (input.collective?.id ?? null),
        collective_name:
          input.collective === undefined ? gig.collective_name : (input.collective?.name ?? null),
      };
      const tagsBefore = this.tagRows().map((t) => t.name);
      if (input.tags) this.setTags(input.tags);
      this.sql.exec(
        `update gig set title = ?, event_type = ?, client_name = ?, client_phone = ?, client_organisation = ?,
           notes = ?, fee_paise = ?, settings_json = ?, collective_tag_id = ?, collective_name = ?,
           version = version + 1, updated_at = ? where id = ?`,
        next.title,
        next.event_type,
        next.client_name,
        next.client_phone,
        next.client_organisation,
        next.notes,
        next.fee_paise,
        next.settings_json,
        next.collective_tag_id,
        next.collective_name,
        nowIso(),
        gig.id,
      );
      return {
        action: "update_gig",
        entityType: "gig",
        entityId: gig.id,
        before: { ...pickKeys(gig, next), tags: input.tags ? tagsBefore : undefined },
        after: { ...next, tags: input.tags?.map((t) => t.name) },
      };
    });
  }

  /** Kept for step 1 callers and tests: a title-only update. */
  async rename(title: string, version: number, actor: Actor, key: string | null): Promise<BookingView> {
    return this.update({ version, title }, actor, key);
  }

  /**
   * Confirm, complete, cancel or reopen. Cancelling can refund part or all of what the
   * client paid (in the same step); whatever isn't refunded is kept as the gig's income.
   * Reopening undoes a cancellation: back to the status it had (from the audit log); a
   * refund recorded then stays (it's money that moved; record a new payment if not).
   */
  async setStatus(
    action: "confirm" | "complete" | "cancel" | "reopen",
    reason: string | null,
    actor: Actor,
    key: string | null,
    refund: { amount_paise: number; method: PaymentMethod } | null = null,
    keep: string[] | null = null,
  ): Promise<BookingView> {
    return this.write(["status", action, reason, refund, keep], actor, key, "manager", (gig) => {
      const t: { to: GigStatus; from: GigStatus[] } =
        action === "reopen" ? { to: this.statusBeforeCancel(), from: ["cancelled"] } : TRANSITIONS[action];
      // A rehearsal of its own is simply on: it can be cancelled and reopened, nothing else.
      if (gig.kind === "rehearsal" && action === "complete")
        throw new ObjectError("conflict", "A rehearsal can be cancelled or reopened, not marked as played", {
          reason: "rehearsal_status",
        });
      if (gig.status === t.to) return null; // already there: nothing to do
      if (!t.from.includes(gig.status))
        throw new ObjectError("conflict", `A ${gig.status} gig can't be changed to ${t.to}`, {
          reason: "invalid_transition",
          status: gig.status,
        });
      // Date options (holds): confirming keeps the date(s) the client picked and releases the
      // rest; a gig can't be played while its date is still an option.
      const holds = this.eventRows().filter((e) => e.hold === 1);
      let picked: string[] = [];
      let released: string[] = [];
      if (holds.length && action === "complete")
        throw new ObjectError("conflict", "Confirm which date the client picked first", {
          reason: "pick_date",
        });
      if (holds.length && action === "confirm") {
        const wanted = new Set(keep ?? []);
        const kept = holds.filter((e) => wanted.has(e.id));
        const fixed = this.eventRows().filter((e) => e.kind === "show" && e.hold === 0);
        if (!kept.length && !fixed.length)
          throw new ObjectError("validation_failed", "Pick the date the client chose", {
            reason: "pick_date",
            options: holds.map((e) => ({ event_id: e.id, start_at: e.start_at })),
          });
        const ts = nowIso();
        for (const e of holds) {
          if (wanted.has(e.id)) this.sql.exec(`update events set hold = 0 where id = ?`, e.id);
          else {
            this.sql.exec(`update events set deleted_at = ? where id = ?`, ts, e.id);
            this.sql.exec(`delete from lineup where event_id = ?`, e.id);
          }
        }
        picked = kept.map((e) => e.start_at);
        released = holds.filter((e) => !wanted.has(e.id)).map((e) => e.start_at);
      }
      if (refund && refund.amount_paise > 0) {
        if (action !== "cancel") throw new ObjectError("validation_failed", "Refunds go with a cancellation");
        const received = this.totals(gig, []).received;
        if (refund.amount_paise > received)
          throw new ObjectError("validation_failed", "You can't refund more than the client paid", {
            reason: "refund_too_large",
            received_paise: received,
          });
        const id = this.insertEntry(
          "payments",
          {
            amount_paise: -refund.amount_paise,
            paid_on: isoDateIST(nowIso()),
            method: refund.method,
            note: "Refund on cancellation",
          },
          actor,
          null,
        );
        this.sql.exec(`update payments set kind = 'refund' where id = ?`, id);
      }
      this.sql.exec(
        `update gig set status = ?, cancel_reason = ?, cancelled_from = ?, version = version + 1, updated_at = ?
         where id = ?`,
        t.to,
        action === "cancel" ? reason : action === "reopen" ? null : gig.cancel_reason,
        action === "cancel" ? gig.status : null,
        nowIso(),
        gig.id,
      );
      return {
        action: `${action}_gig`,
        entityType: "gig",
        entityId: gig.id,
        before: { status: gig.status },
        after: {
          status: t.to,
          reason: action === "cancel" ? reason : undefined,
          refund_paise: refund?.amount_paise || undefined,
          picked: picked.length ? picked : undefined,
          released: released.length ? released : undefined,
        },
      };
    });
  }

  /** What a cancelled gig was before; for gigs cancelled before migration 9, from the audit log. */
  private statusBeforeCancel(): GigStatus {
    const kept = this.sql
      .exec<{ cancelled_from: string | null }>(`select cancelled_from from gig`)
      .toArray()[0];
    if (kept?.cancelled_from === "enquiry" || kept?.cancelled_from === "confirmed")
      return kept.cancelled_from;
    // Once per old gig: a small log, read only when reopening.
    const row = this.sql
      .exec<{ before_json: string | null }>(
        `select before_json from _audit where action = 'cancel_gig' order by id desc limit 1`,
      )
      .toArray()[0];
    const was = row?.before_json ? (JSON.parse(row.before_json) as { status?: GigStatus }).status : null;
    return was === "enquiry" ? "enquiry" : "confirmed";
  }

  /** Soft delete, for mistakes. Everyone's summaries drop the gig. */
  async remove(actor: Actor, key: string | null): Promise<{ deleted: true }> {
    await this.write(
      ["delete"],
      actor,
      key,
      "manager",
      (gig) => {
        this.sql.exec(
          `update gig set deleted_at = ?, version = version + 1, updated_at = ? where id = ?`,
          nowIso(),
          nowIso(),
          gig.id,
        );
        return { action: "delete_gig", entityType: "gig", entityId: gig.id, before: { title: gig.title } };
      },
      { returnView: false },
    );
    return { deleted: true };
  }

  async addEvent(input: EventInput, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["add_event", input], actor, key, "manager", (gig) => {
      this.checkNotCancelled(gig);
      const count = this.eventRows().length;
      if (count >= 20) throw new ObjectError("validation_failed", "A gig can have at most 20 events");
      const event = gig.kind === "rehearsal" ? { ...input, kind: "rehearsal" as const, hold: false } : input;
      if (event.hold && (gig.status !== "enquiry" || (event.kind ?? "show") !== "show"))
        throw new ObjectError(
          "validation_failed",
          "Date options (holds) are for enquiries; confirming picks the date",
          { reason: "hold_needs_enquiry" },
        );
      const id = this.insertEvent(event, count);
      this.touch(gig.id);
      return { action: "add_event", entityType: "event", entityId: id, after: event };
    });
  }

  async updateEvent(
    eventId: string,
    input: UpdateEventInput,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["update_event", eventId, input], actor, key, "manager", (gig) => {
      this.checkNotCancelled(gig);
      this.checkVersion(gig, input.version);
      const e = this.requireEvent(eventId);
      const next = {
        title: input.title === undefined ? e.title : input.title,
        start_at: input.start_at ?? e.start_at,
        end_at: input.end_at === undefined ? e.end_at : input.end_at,
        venue_name: input.venue_name === undefined ? e.venue_name : input.venue_name,
        venue_city: input.venue_city === undefined ? e.venue_city : input.venue_city,
        notes: input.notes === undefined ? e.notes : input.notes,
      };
      checkTimes(next.start_at, next.end_at);
      this.sql.exec(
        `update events set title = ?, start_at = ?, end_at = ?, venue_name = ?, venue_city = ?, notes = ? where id = ?`,
        next.title,
        next.start_at,
        next.end_at,
        next.venue_name,
        next.venue_city,
        next.notes,
        e.id,
      );
      this.touch(gig.id);
      return {
        action: "update_event",
        entityType: "event",
        entityId: e.id,
        before: pickKeys(e, next),
        after: next,
      };
    });
  }

  async removeEvent(eventId: string, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["remove_event", eventId], actor, key, "manager", (gig) => {
      this.checkNotCancelled(gig);
      const e = this.requireEvent(eventId);
      const events = this.eventRows();
      if (events.length <= 1)
        throw new ObjectError("conflict", "A gig needs at least one event; delete the gig instead", {
          reason: "last_event",
        });
      if (gig.kind === "gig" && e.kind === "show" && !events.some((x) => x.kind === "show" && x.id !== e.id))
        throw new ObjectError("conflict", "A gig needs at least one show; delete the gig instead", {
          reason: "last_show",
        });
      this.sql.exec(`update events set deleted_at = ? where id = ?`, nowIso(), e.id);
      this.sql.exec(`delete from lineup where event_id = ?`, e.id);
      this.sql.exec(`delete from attendance where event_id = ?`, e.id);
      this.touch(gig.id);
      return { action: "remove_event", entityType: "event", entityId: e.id, before: e };
    });
  }

  async addPerson(person: PersonInput, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["add_person", person], actor, key, "manager", (gig) => {
      if (person.user_id && this.personRows().some((p) => p.user_id === person.user_id))
        throw new ObjectError("conflict", "That person is already on this gig", { reason: "already_on_gig" });
      if (this.personRows().length >= 100)
        throw new ObjectError("validation_failed", "A gig can have at most 100 people");
      const id = this.insertPerson(person, actor.userId!, nowIso());
      this.touch(gig.id);
      return {
        action: "add_person",
        entityType: "person",
        entityId: id,
        after: { ...person, email: undefined },
      };
    });
  }

  async updatePerson(
    personId: string,
    input: { role?: BookingRole; name?: string; phone?: string | null },
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["update_person", personId, input], actor, key, "manager", (gig) => {
      const p = this.requirePerson(personId);
      const next = {
        role: input.role ?? p.role,
        name: input.name ?? p.name,
        phone: input.phone === undefined ? p.phone : input.phone,
      };
      // Saving without a change isn't a change (and would read "Renamed X to X" in the history).
      if (next.role === p.role && next.name === p.name && (next.phone ?? null) === (p.phone ?? null))
        return null;
      if (p.role === "manager" && next.role !== "manager") this.keepAManager(p.id);
      this.sql.exec(
        `update people set role = ?, name = ?, phone = ? where id = ?`,
        next.role,
        next.name,
        next.phone,
        p.id,
      );
      this.touch(gig.id);
      return {
        action: "update_person",
        entityType: "person",
        entityId: p.id,
        before: { role: p.role, name: p.name },
        after: { role: next.role, name: next.name, phone_changed: next.phone !== p.phone || undefined },
      };
    });
  }

  async removePerson(
    personId: string,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView | { removed: true }> {
    const removingSelf = this.personRows().find((p) => p.id === personId)?.user_id === actor.userId;
    const result = await this.write(
      ["remove_person", personId],
      actor,
      key,
      "manager",
      (gig) => {
        const p = this.requirePerson(personId);
        if (p.role === "manager") this.keepAManager(p.id);
        if (this.paidTo(p.id) !== 0)
          throw new ObjectError(
            "conflict",
            "This person has been paid for this gig; reverse their payouts first",
            {
              reason: "has_payouts",
            },
          );
        this.sql.exec(`update people set removed_at = ? where id = ?`, nowIso(), p.id);
        this.sql.exec(`delete from lineup where person_id = ?`, p.id);
        this.sql.exec(`delete from attendance where person_id = ?`, p.id);
        this.touch(gig.id);
        return {
          action: "remove_person",
          entityType: "person",
          entityId: p.id,
          before: { name: p.name, role: p.role },
        };
      },
      { returnView: !removingSelf },
    );
    return removingSelf ? { removed: true } : (result as BookingView);
  }

  /**
   * Someone added by email signed up: link that person on this gig to their new account,
   * so the gig reaches their Home. System action (from sign-up); checks the email matches.
   */
  async attachAccount(personId: string, userId: string, email: string): Promise<boolean> {
    const gig = this.gigRow();
    if (!gig || gig.deleted_at) return false;
    const attached = this.ctx.storage.transactionSync(() => {
      const p = this.sql
        .exec<{ id: string; user_id: string | null; email: string | null }>(
          `select id, user_id, email from people where id = ? and removed_at is null`,
          personId,
        )
        .toArray()[0];
      if (!p || p.user_id || (p.email ?? "").toLowerCase() !== email.toLowerCase()) return false;
      if (this.personRows().some((x) => x.user_id === userId)) return false; // already on the gig
      this.sql.exec(`update people set user_id = ?, email = null where id = ?`, userId, p.id);
      this.touch(gig.id);
      // A system change (the account is in `after`): their Home then says "You're on …", which
      // it skips for changes a person made themselves.
      audit(
        this.sql,
        { userId: null, source: "system" },
        { action: "attach_account", entityType: "person", entityId: p.id, after: { user_id: userId } },
      );
      bumpAndNote(this.sql);
      return true;
    });
    if (attached) await this.scheduleDelivery();
    return attached;
  }

  /** People added by an email with no account yet (the Worker records them in D1). */
  async awaitingAccounts(): Promise<{ person_id: string; email: string }[]> {
    return this.sql
      .exec<{ person_id: string; email: string }>(
        `select id as person_id, lower(email) as email from people
         where user_id is null and email is not null and removed_at is null`,
      )
      .toArray();
  }

  // --- Money -------------------------------------------------------------------------
  // Payments and payouts only ever grow: a correction is a reversing entry. None of these
  // bump the gig's version (adding a payment never conflicts with someone's edit).

  async recordPayment(input: MoneyEntryInput, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["record_payment", input], actor, key, "manager", (gig) => {
      checkHasMoney(gig);
      const id = this.insertEntry("payments", input, actor, null);
      this.stamp(gig.id);
      return { action: "record_payment", entityType: "payment", entityId: id, after: input };
    });
  }

  async reversePayment(
    paymentId: string,
    note: string | null,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["reverse_payment", paymentId, note], actor, key, "manager", (gig) => {
      const p = this.reversible("payments", paymentId, "Payment");
      const id = this.insertEntry("payments", reversalOf(p, note), actor, p.id);
      this.stamp(gig.id);
      return {
        action: "reverse_payment",
        entityType: "payment",
        entityId: id,
        before: { payment_id: p.id, amount_paise: p.amount_paise },
      };
    });
  }

  async recordExpense(input: ExpenseInput, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["record_expense", input], actor, key, "manager", (gig) => {
      checkHasMoney(gig);
      if (input.event_id) this.requireEvent(input.event_id);
      const id = ulid();
      this.sql.exec(
        `insert into expenses (id, event_id, category, amount_paise, spent_on, note, created_by, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.event_id,
        input.category,
        input.amount_paise,
        input.spent_on,
        input.note,
        actor.userId,
        nowIso(),
      );
      this.stamp(gig.id);
      return { action: "record_expense", entityType: "expense", entityId: id, after: input };
    });
  }

  async removeExpense(expenseId: string, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["remove_expense", expenseId], actor, key, "manager", (gig) => {
      const e = this.expenseRows().find((x) => x.id === expenseId);
      if (!e) throw new ObjectError("not_found", "Expense not found");
      this.sql.exec(`update expenses set deleted_at = ? where id = ?`, nowIso(), e.id);
      this.stamp(gig.id);
      return { action: "remove_expense", entityType: "expense", entityId: e.id, before: e };
    });
  }

  /** Replaces an event's lineup (who plays, their part and share). Checks the gig's version. */
  async setLineup(
    eventId: string,
    version: number,
    entries: LineupEntryInput[],
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["set_lineup", eventId, version, entries], actor, key, "manager", (gig) => {
      this.checkNotCancelled(gig);
      this.checkVersion(gig, version);
      const e = this.requireEvent(eventId);
      if (e.kind === "rehearsal")
        throw new ObjectError(
          "validation_failed",
          "A rehearsal has no lineup; everyone on the gig says if they're coming",
          { reason: "rehearsal_no_lineup" },
        );
      if (e.hold)
        throw new ObjectError(
          "validation_failed",
          "This date is only an option; set the lineup once the client picks it",
          { reason: "hold_no_lineup" },
        );
      const resolved = entries.map((x) => ({ ...x, person: this.pickPerson(x) }));
      const ids = resolved.map((x) => x.person.id);
      if (new Set(ids).size !== ids.length)
        throw new ObjectError("validation_failed", "Someone is on the lineup twice");
      const before = this.lineupRows().filter((l) => l.event_id === e.id);
      this.sql.exec(`delete from lineup where event_id = ?`, e.id);
      resolved.forEach((x, i) =>
        this.sql.exec(
          `insert into lineup (id, event_id, person_id, part, share_paise, position) values (?, ?, ?, ?, ?, ?)`,
          ulid(),
          e.id,
          x.person.id,
          x.part,
          x.share_paise,
          i,
        ),
      );
      this.touch(gig.id);
      return {
        action: "set_lineup",
        entityType: "event",
        entityId: e.id,
        before: before.map(({ person_id, part, share_paise }) => ({ person_id, part, share_paise })),
        after: resolved.map((x) => ({ person_id: x.person.id, part: x.part, share_paise: x.share_paise })),
      };
    });
  }

  async recordPayout(
    input: MoneyEntryInput & PersonPick & { event_id: string | null },
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["record_payout", input], actor, key, "manager", (gig) => {
      checkHasMoney(gig);
      const person = this.pickPerson(input);
      if (input.event_id) this.requireEvent(input.event_id);
      const id = this.insertEntry("payouts", input, actor, null, {
        person_id: person.id,
        event_id: input.event_id,
      });
      this.stamp(gig.id);
      return {
        action: "record_payout",
        entityType: "payout",
        entityId: id,
        after: { ...input, person_id: person.id, person_name: undefined },
      };
    });
  }

  async reversePayout(
    payoutId: string,
    note: string | null,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["reverse_payout", payoutId, note], actor, key, "manager", (gig) => {
      const p = this.reversible("payouts", payoutId, "Payout") as PayoutRow;
      const id = this.insertEntry("payouts", reversalOf(p, note), actor, p.id, {
        person_id: p.person_id,
        event_id: p.event_id,
      });
      this.stamp(gig.id);
      return {
        action: "reverse_payout",
        entityType: "payout",
        entityId: id,
        before: { payout_id: p.id, person_id: p.person_id, amount_paise: p.amount_paise },
      };
    });
  }

  // --- Rehearsals --------------------------------------------------------------------

  /**
   * Whether someone is coming to a rehearsal. Everyone on the gig answers for themselves;
   * managers may answer for anyone. Like lists, it doesn't bump the gig's version.
   */
  async setAttendance(
    eventId: string,
    personId: string | null,
    going: boolean,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["attendance", eventId, personId, going], actor, key, "player", (gig) => {
      this.checkNotCancelled(gig);
      const e = this.requireEvent(eventId);
      if (e.kind !== "rehearsal")
        throw new ObjectError("validation_failed", "Only rehearsals ask who's coming", {
          reason: "not_rehearsal",
        });
      const me = this.requireMe(actor);
      const who = personId ? this.requirePerson(personId) : me;
      if (who.id !== me.id && me.role !== "manager")
        throw new ObjectError("forbidden", "Only the gig's managers can answer for someone else");
      const before = this.sql
        .exec<{ going: number }>(
          `select going from attendance where event_id = ? and person_id = ?`,
          e.id,
          who.id,
        )
        .toArray()[0];
      if (before && Boolean(before.going) === going) return null;
      this.sql.exec(
        `insert into attendance (event_id, person_id, going, updated_at) values (?, ?, ?, ?)
         on conflict (event_id, person_id) do update set going = excluded.going, updated_at = excluded.updated_at`,
        e.id,
        who.id,
        going ? 1 : 0,
        nowIso(),
      );
      this.stamp(gig.id);
      return {
        action: "set_attendance",
        entityType: "event",
        entityId: e.id,
        before: before ? { person_id: who.id, going: Boolean(before.going) } : undefined,
        after: { person_id: who.id, going },
      };
    });
  }

  // --- Lists and notes (§11) ---------------------------------------------------------
  // Everyone on the gig may change them unless a manager turned that off for players.
  // They don't bump the gig's version, so editing a list never blocks an edit of the gig.

  async createList(input: CreateListInput, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["create_list", input], actor, key, "player", (gig) => {
      const me = this.requireEditor(actor, gig);
      const count = this.sql
        .exec<{ n: number }>(`select count(*) as n from lists where deleted_at is null`)
        .one().n;
      if (count >= LIST_LIMITS.lists)
        throw new ObjectError("validation_failed", `A gig can have up to ${LIST_LIMITS.lists} lists`);
      if (input.event_id) this.requireEvent(input.event_id);
      const id = this.newId("lists", input.id);
      const ts = nowIso();
      this.sql.exec(
        `insert into lists (id, title, event_id, checkable, created_by, created_by_name, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.title,
        input.event_id,
        input.checkable ? 1 : 0,
        actor.userId,
        me.name,
        ts,
        ts,
      );
      this.insertItems(id, input.items, undefined, actor, ts);
      this.stamp(gig.id);
      return { action: "create_list", entityType: "list", entityId: id, after: input };
    });
  }

  async updateList(listId: string, input: UpdateListInput, actor: Actor, key: string | null) {
    return this.write(["update_list", listId, input], actor, key, "player", (gig) => {
      this.requireEditor(actor, gig);
      const before = this.requireList(listId);
      if (input.event_id) this.requireEvent(input.event_id);
      const after = {
        title: input.title ?? before.title,
        event_id: input.event_id === undefined ? before.event_id : input.event_id,
        checkable: input.checkable === undefined ? before.checkable : input.checkable ? 1 : 0,
      };
      this.sql.exec(
        `update lists set title = ?, event_id = ?, checkable = ?, updated_at = ? where id = ?`,
        after.title,
        after.event_id,
        after.checkable,
        nowIso(),
        listId,
      );
      this.stamp(gig.id);
      return { action: "update_list", entityType: "list", entityId: listId, before, after };
    });
  }

  async removeList(listId: string, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["remove_list", listId], actor, key, "player", (gig) => {
      this.requireEditor(actor, gig);
      const before = this.requireList(listId);
      const ts = nowIso();
      this.sql.exec(`update lists set deleted_at = ? where id = ?`, ts, listId);
      this.sql.exec(
        `update list_items set deleted_at = ? where list_id = ? and deleted_at is null`,
        ts,
        listId,
      );
      this.stamp(gig.id);
      return { action: "remove_list", entityType: "list", entityId: listId, before };
    });
  }

  /** Adds items at the end, at the top (`after` null) or after an item. */
  async addItems(
    listId: string,
    items: ListItemInput[],
    after: string | null | undefined,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["add_items", listId, items, after], actor, key, "player", (gig) => {
      this.requireEditor(actor, gig);
      this.requireList(listId);
      const count = this.itemRows(listId).length;
      if (count + items.length > LIST_LIMITS.items)
        throw new ObjectError("validation_failed", `A list can have up to ${LIST_LIMITS.items} items`);
      const ids = this.insertItems(listId, items, after, actor, nowIso());
      this.touchList(listId);
      this.stamp(gig.id);
      return { action: "add_list_items", entityType: "list", entityId: listId, after: { ids, items } };
    });
  }

  async updateItem(
    listId: string,
    itemId: string,
    input: UpdateItemInput,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["update_item", listId, itemId, input], actor, key, "player", (gig) => {
      const me = this.requireEditor(actor, gig);
      const list = this.requireList(listId);
      const before = this.requireItem(listId, itemId);
      if (input.done !== undefined && !list.checkable)
        throw new ObjectError("validation_failed", "This list doesn't have tick boxes");
      const done =
        input.done === undefined
          ? { at: before.done_at, by: before.done_by_name }
          : input.done
            ? { at: before.done_at ?? nowIso(), by: before.done_at ? before.done_by_name : me.name }
            : { at: null, by: null };
      const after = {
        text: input.text ?? before.text,
        detail: input.detail === undefined ? before.detail : input.detail,
        done_at: done.at,
      };
      this.sql.exec(
        `update list_items set text = ?, detail = ?, done_at = ?, done_by_name = ?, updated_at = ? where id = ?`,
        after.text,
        after.detail,
        done.at,
        done.by,
        nowIso(),
        itemId,
      );
      this.touchList(listId);
      this.stamp(gig.id);
      return {
        action: "update_list_item",
        entityType: "list_item",
        entityId: itemId,
        before: { text: before.text, detail: before.detail, done_at: before.done_at },
        after,
      };
    });
  }

  /** Moves an item to just after another one (null: to the top). One row changes. */
  async moveItem(
    listId: string,
    itemId: string,
    after: string | null,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["move_item", listId, itemId, after], actor, key, "player", (gig) => {
      this.requireEditor(actor, gig);
      this.requireList(listId);
      const item = this.requireItem(listId, itemId);
      if (after === itemId) return null;
      if (after) this.requireItem(listId, after);
      const others = this.itemRows(listId).filter((x) => x.id !== itemId);
      const [position] = this.positionsAfter(listId, others, after, 1);
      this.sql.exec(
        `update list_items set position = ?, updated_at = ? where id = ?`,
        position,
        nowIso(),
        itemId,
      );
      this.touchList(listId);
      this.stamp(gig.id);
      return {
        action: "move_list_item",
        entityType: "list_item",
        entityId: itemId,
        before: { position: item.position },
        after: { after_item_id: after },
      };
    });
  }

  async removeItem(listId: string, itemId: string, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["remove_item", listId, itemId], actor, key, "player", (gig) => {
      this.requireEditor(actor, gig);
      this.requireList(listId);
      const before = this.requireItem(listId, itemId);
      this.sql.exec(`update list_items set deleted_at = ? where id = ?`, nowIso(), itemId);
      this.touchList(listId);
      this.stamp(gig.id);
      return {
        action: "remove_list_item",
        entityType: "list_item",
        entityId: itemId,
        before: { text: before.text, detail: before.detail },
      };
    });
  }

  async addNote(
    body: string,
    actor: Actor,
    key: string | null,
    noteId?: string | null,
  ): Promise<BookingView> {
    return this.write(["add_note", body, noteId ?? null], actor, key, "player", (gig) => {
      const me = this.requireEditor(actor, gig);
      const count = this.sql
        .exec<{ n: number }>(`select count(*) as n from notes where deleted_at is null`)
        .one().n;
      if (count >= LIST_LIMITS.notes)
        throw new ObjectError("validation_failed", `A gig can have up to ${LIST_LIMITS.notes} notes`);
      const id = this.newId("notes", noteId);
      this.sql.exec(
        `insert into notes (id, body, created_by, author_name, created_at) values (?, ?, ?, ?, ?)`,
        id,
        body,
        actor.userId,
        me.name,
        nowIso(),
      );
      this.stamp(gig.id);
      return { action: "add_note", entityType: "note", entityId: id, after: { body } };
    });
  }

  /** Only the note's author can change it. */
  async updateNote(noteId: string, body: string, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["update_note", noteId, body], actor, key, "player", (gig) => {
      this.requireEditor(actor, gig);
      const before = this.requireNote(noteId);
      if (before.created_by !== actor.userId)
        throw new ObjectError("forbidden", "Only the person who wrote a note can change it");
      if (before.body === body) return null;
      this.sql.exec(`update notes set body = ?, edited_at = ? where id = ?`, body, nowIso(), noteId);
      this.stamp(gig.id);
      return {
        action: "update_note",
        entityType: "note",
        entityId: noteId,
        before: { body: before.body },
        after: { body },
      };
    });
  }

  /** The author or a manager can remove a note. */
  async removeNote(noteId: string, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["remove_note", noteId], actor, key, "player", (gig) => {
      const role = this.requireRole(actor);
      const before = this.requireNote(noteId);
      if (before.created_by !== actor.userId && role !== "manager")
        throw new ObjectError("forbidden", "Only the note's author or a manager can remove it");
      if (before.created_by === actor.userId) this.requireEditor(actor, gig);
      this.sql.exec(`update notes set deleted_at = ? where id = ?`, nowIso(), noteId);
      this.stamp(gig.id);
      return { action: "remove_note", entityType: "note", entityId: noteId, before: { body: before.body } };
    });
  }

  // --- Guest list ----------------------------------------------------------------------
  // Everyone on the gig adds their own guests until the list closes; managers add for
  // anyone, change anything, set limits and share a link with the venue.

  async addGuests(
    guests: GuestInput[],
    hostPersonId: string | null,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["add_guests", guests, hostPersonId], actor, key, "player", (gig) => {
      const me = this.requireMe(actor);
      const host = hostPersonId ? this.requirePerson(hostPersonId) : me;
      if (host.id !== me.id && me.role !== "manager")
        throw new ObjectError("forbidden", "Only managers can add guests for someone else");
      this.requireListOpen(gig, me);
      const count = this.sql
        .exec<{ n: number }>(`select count(*) as n from guests where deleted_at is null`)
        .one().n;
      if (count + guests.length > GUEST_LIMITS.guests)
        throw new ObjectError(
          "validation_failed",
          `A guest list can have up to ${GUEST_LIMITS.guests} guests`,
        );
      const heads = guests.reduce((n, g) => n + 1 + g.plus_ones, 0);
      this.checkGuestLimits(gig, host, heads);
      const ts = nowIso();
      const ids = guests.map((g) => {
        const id = this.newId("guests", g.id);
        this.sql.exec(
          `insert into guests (id, name, plus_ones, note, host_person_id, added_by, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          g.name,
          g.plus_ones,
          g.note,
          host.id,
          actor.userId,
          ts,
          ts,
        );
        return id;
      });
      this.stamp(gig.id);
      return {
        action: "add_guests",
        entityType: "guest",
        entityId: ids[0]!,
        after: { ids, host: host.id, guests },
      };
    });
  }

  async updateGuest(guestId: string, input: UpdateGuestInput, actor: Actor, key: string | null) {
    return this.write(["update_guest", guestId, input], actor, key, "player", (gig) => {
      const me = this.requireMe(actor);
      const before = this.requireGuest(guestId);
      const changesDetails =
        input.name !== undefined || input.plus_ones !== undefined || input.note !== undefined;
      if (me.role !== "manager") {
        if (input.arrived !== undefined || input.arrived_count !== undefined)
          throw new ObjectError("forbidden", "Only managers (or the venue's door link) mark arrivals");
        if (before.host_person_id !== me.id) throw new ObjectError("not_found", "Guest not found");
        if (changesDetails) this.requireListOpen(gig, me);
      }
      const plusOnes = input.plus_ones ?? before.plus_ones;
      if (plusOnes > before.plus_ones)
        this.checkGuestLimits(gig, this.requirePerson(before.host_person_id), plusOnes - before.plus_ones);
      const count = arrivedCount(before, 1 + plusOnes, input.arrived_count ?? input.arrived);
      const after = {
        name: input.name ?? before.name,
        plus_ones: plusOnes,
        note: input.note === undefined ? before.note : input.note,
        arrived_count: count,
        // When the first of the group came in.
        arrived_at: count ? (before.arrived_at ?? nowIso()) : null,
      };
      this.sql.exec(
        `update guests set name = ?, plus_ones = ?, note = ?, arrived_count = ?, arrived_at = ?, updated_at = ?
         where id = ?`,
        after.name,
        after.plus_ones,
        after.note,
        after.arrived_count,
        after.arrived_at,
        nowIso(),
        guestId,
      );
      this.stamp(gig.id);
      return { action: "update_guest", entityType: "guest", entityId: guestId, before, after };
    });
  }

  async removeGuest(guestId: string, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["remove_guest", guestId], actor, key, "player", (gig) => {
      const me = this.requireMe(actor);
      const before = this.requireGuest(guestId);
      if (me.role !== "manager") {
        if (before.host_person_id !== me.id) throw new ObjectError("not_found", "Guest not found");
        this.requireListOpen(gig, me);
      }
      this.sql.exec(`update guests set deleted_at = ? where id = ?`, nowIso(), guestId);
      this.stamp(gig.id);
      return { action: "remove_guest", entityType: "guest", entityId: guestId, before };
    });
  }

  /** Limits and closing time (managers). Only the fields given change. */
  async setGuestList(input: GuestSettingsInput, actor: Actor, key: string | null): Promise<BookingView> {
    return this.write(["set_guest_list", input], actor, key, "manager", (gig) => {
      const before = guestSettingsOf(gig);
      const after: GuestSettings = {
        ...before,
        ...(input.total_limit !== undefined ? { total_limit: input.total_limit } : {}),
        ...(input.per_person_limit !== undefined ? { per_person_limit: input.per_person_limit } : {}),
        ...(input.closes_at !== undefined ? { closes_at: input.closes_at } : {}),
      };
      this.saveGuestSettings(gig.id, after);
      this.stamp(gig.id);
      const { link_hash: _h, link_sealed: _s, ...shown } = after;
      const { link_hash: _bh, link_sealed: _bs, ...was } = before;
      return { action: "set_guest_list", entityType: "gig", entityId: gig.id, before: was, after: shown };
    });
  }

  /**
   * Turns the venue link on (a new token, or keeps the current one), off (null), or
   * changes whether door staff may tick arrivals (managers).
   */
  async setGuestLink(
    link: GuestLinkInput | null | undefined,
    checkIn: boolean | undefined,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    // The request is "new link / no link / same link", not the token: a retry makes a new
    // random token, and must still count as the same request.
    const kind = link === null ? "off" : link ? "new" : "same";
    return this.write(["set_guest_link", kind, checkIn], actor, key, "manager", (gig) => {
      const before = guestSettingsOf(gig);
      const after: GuestSettings = { ...before };
      if (link === null) {
        after.link_hash = null;
        after.link_sealed = null;
      } else if (link) {
        after.link_hash = link.hash;
        after.link_sealed = link.sealed;
      }
      if (checkIn !== undefined) after.link_check_in = checkIn;
      // Same link, same permission: nothing changed (and nothing for the history).
      if (kind === "same" && after.link_check_in === before.link_check_in) return null;
      this.saveGuestSettings(gig.id, after);
      this.stamp(gig.id);
      return {
        action: link === null ? "disable_guest_link" : link ? "enable_guest_link" : "set_guest_link",
        entityType: "gig",
        entityId: gig.id,
        before: { enabled: !!before.link_hash, check_in: before.link_check_in },
        after: { enabled: !!after.link_hash, check_in: after.link_check_in },
      };
    });
  }

  /** The venue link's sealed token, for managers to see it again. */
  async guestLink(actor: Actor): Promise<{ sealed: string | null; check_in: boolean }> {
    const gig = this.requireGig();
    this.requireRole(actor, "manager");
    const g = guestSettingsOf(gig);
    return { sealed: g.link_hash ? g.link_sealed : null, check_in: g.link_check_in };
  }

  /** What the venue sees; null unless `tokenHash` is this gig's current link. */
  async sharedGuests(tokenHash: string): Promise<SharedGuestListView | null> {
    const gig = this.gigRow();
    if (!gig || gig.deleted_at || !this.linkMatches(gig, tokenHash)) return null;
    return this.sharedView(gig);
  }

  /** Door check-in from the venue link (when allowed). */
  async sharedArrive(
    tokenHash: string,
    guestId: string,
    arrived: boolean | number,
    key: string | null,
  ): Promise<SharedGuestListView | null> {
    const gig = this.gigRow();
    if (!gig || gig.deleted_at || !this.linkMatches(gig, tokenHash)) return null;
    if (!guestSettingsOf(gig).link_check_in)
      throw new ObjectError("forbidden", "This link can't mark arrivals");
    const actor: Actor = { userId: null, source: "link" };
    const result = idempotent(this.ctx.storage, key, await hashOf(["arrive", guestId, arrived]), () => {
      const g = this.requireGuest(guestId);
      const count = arrivedCount(g, 1 + g.plus_ones, arrived);
      if (count !== g.arrived_count) {
        const at = count ? (g.arrived_at ?? nowIso()) : null;
        this.sql.exec(
          `update guests set arrived_count = ?, arrived_at = ?, updated_at = ? where id = ?`,
          count,
          at,
          nowIso(),
          guestId,
        );
        this.stamp(gig.id);
        audit(this.sql, actor, {
          action: "guest_arrived",
          entityType: "guest",
          entityId: guestId,
          before: { arrived_at: g.arrived_at, arrived_count: g.arrived_count, heads: 1 + g.plus_ones },
          after: { arrived_at: at, arrived_count: count, heads: 1 + g.plus_ones },
        });
        bumpAndNote(this.sql);
      }
      return this.sharedView(this.requireGig());
    });
    await this.scheduleDelivery();
    return result;
  }

  // --- Reads -------------------------------------------------------------------------

  async view(actor: Actor): Promise<BookingView> {
    this.requireGig();
    this.requireRole(actor);
    return this.viewFor(actor.userId!);
  }

  /** The gig's history of changes (managers only). */
  /**
   * Who changed what, newest first, in plain words (managers; it includes money). A page
   * of `limit` entries older than `beforeId` (the log's own row id).
   */
  async history(actor: Actor, beforeId: number | null = null, limit = 50): Promise<GigHistoryView> {
    const gig = this.requireGig();
    this.requireRole(actor, "manager");
    const rows = this.sql
      .exec<AuditRow>(
        `select id, at, actor_user_id, source, action, entity_type, entity_id, before_json, after_json
         from _audit where (? is null or id < ?) order by id desc limit ?`,
        beforeId,
        beforeId,
        limit + 1,
      )
      .toArray();
    // Only the people, events, lists, items and guests this page mentions (removed ones
    // too), so a page costs the same however long the gig's history is.
    const page = rows.slice(0, limit);
    const ids = new Set<string>();
    const users = new Set<string>();
    const collect = (v: unknown): void => {
      if (typeof v === "string") {
        if (ULID_RE.test(v)) ids.add(v);
      } else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    for (const r of page) {
      ids.add(r.entity_id);
      if (r.actor_user_id) users.add(r.actor_user_id);
      for (const json of [r.before_json, r.after_json]) {
        try {
          collect(json ? JSON.parse(json) : null);
        } catch {
          // an unreadable entry still shows its sentence
        }
      }
    }
    const byIds = <T extends Record<string, SqlStorageValue>>(sql: string, list: string[]): T[] => {
      const out: T[] = [];
      for (let i = 0; i < list.length; i += 90) {
        const chunk = list.slice(i, i + 90);
        out.push(
          ...this.sql.exec<T>(sql.replace("(?)", `(${chunk.map(() => "?").join(", ")})`), ...chunk).toArray(),
        );
      }
      return out;
    };
    const idList = [...ids];
    const people = [
      ...byIds<{ id: string; user_id: string | null; name: string }>(
        `select id, user_id, name from people where id in (?)`,
        idList,
      ),
      ...byIds<{ id: string; user_id: string | null; name: string }>(
        `select id, user_id, name from people where user_id in (?)`,
        [...users],
      ),
    ];
    const items = byIds<{ id: string; list_id: string; text: string }>(
      `select id, list_id, text from list_items where id in (?)`,
      idList,
    );
    const names: HistoryNames = {
      users: new Map(people.filter((p) => p.user_id).map((p) => [p.user_id!, p.name])),
      people: new Map(people.map((p) => [p.id, p.name])),
      personOfUser: new Map(people.filter((p) => p.user_id).map((p) => [p.user_id!, p.id])),
      events: new Map(
        byIds<{ id: string; title: string | null; start_at: string; kind: string }>(
          `select id, title, start_at, kind from events where id in (?)`,
          idList,
        ).map((e) => [e.id, e]),
      ),
      lists: new Map(
        byIds<{ id: string; title: string }>(`select id, title from lists where id in (?)`, [
          ...new Set([...idList, ...items.map((i) => i.list_id)]),
        ]).map((l) => [l.id, l.title]),
      ),
      items: new Map(items.map((i) => [i.id, i])),
      guests: new Map(
        byIds<{ id: string; name: string }>(`select id, name from guests where id in (?)`, idList).map(
          (g) => [g.id, g.name],
        ),
      ),
      gigKind: gig.kind,
    };
    const me = actor.userId;
    const entries = page.map((r) => ({
      id: r.id,
      at: r.at,
      at_display: formatDateTimeIST(r.at),
      who: whoDid(r, names),
      is_me: r.actor_user_id !== null && r.actor_user_id === me,
      source: r.source,
      source_label: sourceLabel(r.source),
      action: r.action,
      ...describe(r, names),
    }));
    return { items: entries, next_before: rows.length > limit ? (entries.at(-1)?.id ?? null) : null };
  }

  /** What this gig tells people's Homes and the month indexes, at the current sequence. */
  async summaries(): Promise<GigSummaries | null> {
    const gig = this.gigRow();
    if (!gig) return null;
    const events = this.eventRows();
    const people = this.personRows();
    const deleted = gig.deleted_at !== null;

    const peopleOut: GigSummaries["people"] = {};
    const monthsOut: Record<string, IndexCard[]> = {};
    if (!deleted) {
      const lineup = this.lineupRows();
      const totals = this.totals(gig, lineup);
      const tagRows = this.tagRows();
      const answers = this.attendanceRows();
      // A gig's date is its first show's; rehearsals before it don't move it in reports.
      const firstShow = events.find((e) => e.kind === "show") ?? events[0];
      const settings = settingsOf(gig);
      const changedBy =
        this.sql
          .exec<{ actor_user_id: string | null }>(`select actor_user_id from _audit order by id desc limit 1`)
          .toArray()[0]?.actor_user_id ?? null;
      for (const p of people) {
        if (!p.user_id) continue;
        const mine = lineup.filter((l) => l.person_id === p.id);
        const manager = p.role === "manager";
        const gigRow: PersonGigSummary = {
          gig_id: gig.id,
          kind: gig.kind,
          gig_title: gig.title,
          event_type: gig.event_type,
          client_name: gig.client_name,
          status: gig.status,
          role: p.role,
          first_start_at: firstShow?.start_at ?? gig.created_at,
          share_paise: sum(mine.map((l) => l.share_paise)),
          paid_paise: this.paidTo(p.id),
          fee_paise: manager ? totals.fee : null,
          received_paise: manager ? totals.received : null,
          expenses_paise: manager ? totals.expenses : null,
          shares_total_paise: manager ? totals.shares : null,
          payouts_paise: manager ? totals.payouts : null,
          collective: gig.collective_tag_id
            ? { id: gig.collective_tag_id, name: gig.collective_name ?? "" }
            : null,
          tags: tagRows.map((t) => ({ id: t.tag_id, name: t.name })),
          lineup_visible: manager || settings.players_see_lineup,
          co_user_ids: (manager || settings.players_see_lineup
            ? people
            : people.filter((x) => x.role === "manager")
          )
            .filter((x) => x.user_id && x.user_id !== p.user_id)
            .map((x) => x.user_id!),
          changed_by: changedBy,
          ...(manager ? { contacts: this.learnedContacts(gig, events, people, p.user_id) } : {}),
        };
        const rows = events.map((e) => ({
          gig_id: gig.id,
          event_id: e.id,
          kind: e.kind,
          hold: e.hold === 1,
          going: e.kind === "rehearsal" ? answerOf(answers, e.id, p.id) : null,
          gig_title: gig.title,
          event_title: e.title,
          event_type: gig.event_type,
          client_name: gig.client_name,
          start_at: e.start_at,
          end_at: e.end_at,
          venue_name: e.venue_name,
          status: gig.status,
          role: p.role,
          part: mine.find((l) => l.event_id === e.id)?.part ?? null,
          share_paise: mine.find((l) => l.event_id === e.id)?.share_paise ?? 0,
          collective_name: gig.collective_name,
        }));
        peopleOut[p.user_id] = { events: rows, gig: gigRow };
      }
      const managers = people.filter((p) => p.role === "manager" && p.user_id).map((p) => p.user_id!);
      // Rehearsals aren't bookings: duplicate warnings look at shows only.
      for (const e of events.filter((x) => x.kind === "show")) {
        const ym = monthOf(e.start_at);
        (monthsOut[ym] ??= []).push({
          gig_id: gig.id,
          event_id: e.id,
          start_at: e.start_at,
          date: isoDateIST(e.start_at),
          venue_key: nameKey(e.venue_name),
          venue_name: e.venue_name,
          client_key: nameKey(gig.client_name),
          status: gig.status,
          manager_user_ids: managers,
        });
      }
    }
    // Everyone who ever got rows hears about removals (an empty list), and is remembered.
    for (const { kind, key } of this.sql.exec<{ kind: string; key: string }>(
      `select kind, key from _targets`,
    )) {
      if (kind === "person") peopleOut[key] ??= { events: [], gig: null };
      else monthsOut[key] ??= [];
    }
    for (const id of Object.keys(peopleOut))
      this.sql.exec(`insert or ignore into _targets (kind, key) values ('person', ?)`, id);
    for (const ym of Object.keys(monthsOut))
      this.sql.exec(`insert or ignore into _targets (kind, key) values ('month', ?)`, ym);

    return {
      gig_id: gig.id,
      seq: currentSeq(this.sql),
      people: peopleOut,
      months: monthsOut,
    };
  }

  /** The client, venues and other people on this gig, for a manager's address book. */
  private learnedContacts(
    gig: GigRow,
    events: EventRow[],
    people: PersonRow[],
    self: string,
  ): LearnedContact[] {
    const out: LearnedContact[] = [];
    if (gig.client_name) out.push({ kind: "client", name: gig.client_name, phone: gig.client_phone });
    for (const e of events)
      if (e.venue_name) out.push({ kind: "venue", name: e.venue_name, city: e.venue_city });
    for (const p of people)
      if (p.user_id !== self)
        out.push({ kind: "person", name: p.name, email: p.email, phone: p.phone, user_id: p.user_id });
    return out;
  }

  // --- Backups ----------------------------------------------------------------------

  /** Everything needed to restore this gig (not idempotency records or the outbox). */
  async exportData(): Promise<ObjectDump | null> {
    if (!this.gigRow()) return null;
    return exportTables(this.sql, BACKUP_TABLES);
  }

  /** Restores a backup into this (empty) gig, then re-announces it so Homes catch up. */
  async importData(dump: ObjectDump): Promise<boolean> {
    if (this.gigRow()) return false; // never overwrite a gig that exists
    importTables(this.ctx.storage, dump, BACKUP_TABLES);
    this.ctx.storage.transactionSync(() => {
      // In a fresh environment the month registry and pending lists don't know this gig.
      setMeta(this.sql, "registered", "0");
      setMeta(this.sql, "pending", "0");
      bumpAndNote(this.sql);
    });
    await this.scheduleDelivery();
    return true;
  }

  // --- Outbox delivery (alarm) --------------------------------------------------------

  /** Delivery tools: send any waiting note now. */
  async flush(): Promise<boolean> {
    if (!outboxNote(this.sql)) return false;
    await this.ctx.storage.setAlarm(Date.now());
    return true;
  }

  /** Rebuild tool: re-announce the current state (receivers replace this gig's rows). */
  async resync(): Promise<void> {
    if (!this.gigRow()) return;
    this.ctx.storage.transactionSync(() => bumpAndNote(this.sql));
    await this.scheduleDelivery();
  }

  override async alarm(): Promise<void> {
    const note = outboxNote(this.sql);
    if (!note) return this.leavePending();
    const gigId = this.gigRow()?.id;
    if (!gigId) return;
    try {
      // First delivery: put the gig in its creation month's registry, which the rebuild
      // tool uses to find every gig (so it never depends on the queue having worked).
      if (getMeta(this.sql, "registered") !== "1") {
        await this.env.MONTHS.getByName(monthName(createdMonthOf(gigId))).registerCreated(gigId);
        setMeta(this.sql, "registered", "1");
      }
      const message: SummaryMessage = { gig_id: gigId, seq: note.seq };
      await this.env.SUMMARIES.send(message);
    } catch (err) {
      // Keep the note; try again later, waiting longer each time. Never give up.
      const delay = outboxFailed(this.sql);
      console.warn(
        `outbox: hand-over failed for a gig (attempt ${note.attempts + 1}); retry in ${delay} ms`,
        err,
      );
      await this.joinPending(gigId);
      await this.ctx.storage.setAlarm(Date.now() + delay);
      return;
    }
    const empty = clearOutbox(this.sql, note.seq);
    if (empty) await this.leavePending();
    else await this.ctx.storage.setAlarm(Date.now()); // a newer change arrived while sending
  }

  private async scheduleDelivery() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  private async joinPending(gigId: string) {
    if (getMeta(this.sql, "pending") === "1") return;
    try {
      const stub = this.env.PENDING.getByName(pendingName(pendingShard(gigId)));
      await stub.add(gigId);
      setMeta(this.sql, "pending", "1");
    } catch (err) {
      console.warn("outbox: couldn't join the pending list", err);
    }
  }

  private async leavePending() {
    if (getMeta(this.sql, "pending") !== "1") return;
    const gigId = this.gigRow()?.id;
    if (!gigId) return;
    try {
      await this.env.PENDING.getByName(pendingName(pendingShard(gigId))).remove(gigId);
      setMeta(this.sql, "pending", "0");
    } catch (err) {
      console.warn("outbox: couldn't leave the pending list", err);
    }
  }

  // --- Helpers ----------------------------------------------------------------------

  private lineupRows(): LineupRow[] {
    return this.sql
      .exec<LineupRow>(
        `select l.id, l.event_id, l.person_id, l.part, l.share_paise
         from lineup l join events e on e.id = l.event_id
         where e.deleted_at is null order by e.start_at, e.position, l.position`,
      )
      .toArray();
  }

  private entryRows(table: "payments"): EntryRow[];
  private entryRows(table: "payouts"): PayoutRow[];
  private entryRows(table: "payments" | "payouts"): EntryRow[] {
    const extra = table === "payouts" ? ", person_id, event_id" : "";
    return this.sql
      .exec<EntryRow>(
        `select id, ${table === "payments" ? "kind" : "'payment' as kind"}, amount_paise, paid_on, method, note,
                reverses_id, created_at${extra}
         from ${table} order by paid_on, created_at, rowid`,
      )
      .toArray();
  }

  /** Rehearsal answers of people still on the gig, in the order people were added. */
  private attendanceRows(): { event_id: string; person_id: string; going: number }[] {
    return this.sql
      .exec<{ event_id: string; person_id: string; going: number }>(
        `select a.event_id, a.person_id, a.going from attendance a
         join people p on p.id = a.person_id where p.removed_at is null order by p.rowid`,
      )
      .toArray();
  }

  private expenseRows(): ExpenseRow[] {
    return this.sql
      .exec<ExpenseRow>(
        `select id, event_id, category, amount_paise, spent_on, note, created_at
         from expenses where deleted_at is null order by spent_on, created_at, rowid`,
      )
      .toArray();
  }

  private paidTo(personId: string): number {
    return Number(
      this.sql
        .exec(`select coalesce(sum(amount_paise), 0) as n from payouts where person_id = ?`, personId)
        .one().n,
    );
  }

  private totals(gig: GigRow, lineup: LineupRow[]) {
    const received = Number(
      this.sql.exec(`select coalesce(sum(amount_paise), 0) as n from payments`).one().n,
    );
    const expenses = Number(
      this.sql.exec(`select coalesce(sum(amount_paise), 0) as n from expenses where deleted_at is null`).one()
        .n,
    );
    const shares = sum(lineup.map((l) => l.share_paise));
    const payouts = Number(this.sql.exec(`select coalesce(sum(amount_paise), 0) as n from payouts`).one().n);
    // A cancelled gig earns only what the client paid and wasn't refunded.
    const fee = gig.status === "cancelled" ? Math.max(0, received) : gig.fee_paise;
    return { fee, received, expenses, shares, payouts };
  }

  private insertEntry(
    table: "payments" | "payouts",
    input: MoneyEntryInput,
    actor: Actor,
    reverses: string | null,
    payout?: { person_id: string; event_id: string | null },
  ): string {
    const id = ulid();
    const cols = payout ? ", person_id, event_id" : "";
    const marks = payout ? ", ?, ?" : "";
    this.sql.exec(
      `insert into ${table} (id, amount_paise, paid_on, method, note, reverses_id, created_by, created_at${cols})
       values (?, ?, ?, ?, ?, ?, ?, ?${marks})`,
      id,
      input.amount_paise,
      input.paid_on,
      input.method,
      input.note,
      reverses,
      actor.userId,
      nowIso(),
      ...(payout ? [payout.person_id, payout.event_id] : []),
    );
    return id;
  }

  /** A payment or payout that can still be reversed (not a correction, not already reversed). */
  private reversible(table: "payments" | "payouts", id: string, what: string): EntryRow {
    const rows = table === "payments" ? this.entryRows("payments") : this.entryRows("payouts");
    const row = rows.find((r) => r.id === id);
    if (!row) throw new ObjectError("not_found", `${what} not found`);
    if (row.kind === "refund")
      throw new ObjectError("conflict", "A refund can't be reversed; record a new payment instead", {
        reason: "is_refund",
      });
    if (row.reverses_id)
      throw new ObjectError(
        "conflict",
        `This is already a correction; record a new ${what.toLowerCase()} instead`,
        {
          reason: "is_reversal",
        },
      );
    if (rows.some((r) => r.reverses_id === id))
      throw new ObjectError("conflict", `This ${what.toLowerCase()} has already been reversed`, {
        reason: "already_reversed",
      });
    return row;
  }

  /** Someone on the gig by id, or by exact name (case-insensitive); never a guess. */
  private pickPerson(pick: PersonPick): PersonRow {
    if (pick.person_id) return this.requirePerson(pick.person_id);
    const name = pick.person_name?.trim().toLowerCase();
    if (!name) throw new ObjectError("validation_failed", "Give a person_id or person_name");
    const people = this.personRows();
    const matches = people.filter((p) => p.name.toLowerCase() === name);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1)
      throw new ObjectError(
        "ambiguous",
        `More than one person on this gig is called "${pick.person_name}". Pick one by person_id.`,
        {
          field: "person_name",
          candidates: matches.map((p) => ({ id: p.id, name: p.name, role: p.role })),
        },
      );
    const close = people.filter((p) => p.name.toLowerCase().includes(name));
    if (close.length)
      throw new ObjectError(
        "ambiguous",
        `No one on this gig is called exactly "${pick.person_name}". Did you mean one of these? Use their person_id.`,
        {
          field: "person_name",
          candidates: close.map((p) => ({ id: p.id, name: p.name, role: p.role })),
        },
      );
    throw new ObjectError(
      "not_found",
      `No one called "${pick.person_name}" is on this gig. Add them first (add_gig_person).`,
    );
  }

  private tagRows(): { tag_id: string; name: string }[] {
    return this.sql
      .exec<{ tag_id: string; name: string }>(`select tag_id, name from gig_tags order by position`)
      .toArray();
  }

  private setTags(tags: TagRef[]) {
    this.sql.exec(`delete from gig_tags`);
    const seen = new Set<string>();
    tags.forEach((t, i) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      this.sql.exec(`insert into gig_tags (tag_id, name, position) values (?, ?, ?)`, t.id, t.name, i);
    });
  }

  /** A money change: the gig's updated_at moves, its version doesn't. */
  private stamp(gigId: string) {
    this.sql.exec(`update gig set updated_at = ? where id = ?`, nowIso(), gigId);
  }

  private gigRow(): GigRow | null {
    return (this.sql.exec<GigRow>(`select * from gig limit 1`).toArray()[0] as GigRow | undefined) ?? null;
  }

  /** The gig, if it exists and isn't deleted. */
  private requireGig(): GigRow {
    const gig = this.gigRow();
    if (!gig || gig.deleted_at) throw new ObjectError("not_found", "Gig not found");
    return gig;
  }

  private eventRows(): EventRow[] {
    return this.sql
      .exec<EventRow>(
        `select id, kind, hold, title, start_at, end_at, venue_name, venue_city, notes, position
         from events where deleted_at is null order by start_at, position`,
      )
      .toArray();
  }

  private requireEvent(id: string): EventRow {
    const e = this.eventRows().find((x) => x.id === id);
    if (!e) throw new ObjectError("not_found", "Event not found");
    return e;
  }

  private personRows(): PersonRow[] {
    return this.sql
      .exec<PersonRow>(
        `select id, user_id, name, email, phone, role from people where removed_at is null order by rowid`,
      )
      .toArray();
  }

  private requirePerson(id: string): PersonRow {
    const p = this.personRows().find((x) => x.id === id);
    if (!p) throw new ObjectError("not_found", "Person not found on this gig");
    return p;
  }

  private keepAManager(leavingId: string) {
    if (!this.personRows().some((p) => p.role === "manager" && p.id !== leavingId))
      throw new ObjectError("conflict", "A gig needs at least one manager", { reason: "last_manager" });
  }

  private insertEvent(e: EventInput, position: number): string {
    checkTimes(e.start_at, e.end_at ?? null);
    const id = ulid();
    this.sql.exec(
      `insert into events (id, kind, hold, title, start_at, end_at, venue_name, venue_city, notes, position)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      e.kind ?? "show",
      e.hold && (e.kind ?? "show") === "show" ? 1 : 0,
      e.title ?? null,
      e.start_at,
      e.end_at ?? null,
      e.venue_name ?? null,
      e.venue_city ?? null,
      e.notes ?? null,
      position,
    );
    return id;
  }

  private insertPerson(p: PersonInput, addedBy: string, ts: string): string {
    const id = ulid();
    this.sql.exec(
      `insert into people (id, user_id, name, email, phone, role, added_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      p.user_id,
      p.name,
      p.email,
      p.phone,
      p.role,
      addedBy,
      ts,
    );
    return id;
  }

  private requireMe(actor: Actor): PersonRow {
    const me = actor.userId ? this.personRows().find((p) => p.user_id === actor.userId) : undefined;
    if (!me) throw new ObjectError("not_found", "Gig not found");
    return me;
  }

  private requireGuest(id: string): GuestRow {
    const g = this.sql
      .exec<GuestRow>(
        `select id, name, plus_ones, note, host_person_id, created_at, arrived_at, arrived_count from guests
         where id = ? and deleted_at is null`,
        id,
      )
      .toArray()[0];
    if (!g) throw new ObjectError("not_found", "Guest not found");
    return g;
  }

  private guestRows(): GuestRow[] {
    return this.sql
      .exec<GuestRow>(
        `select id, name, plus_ones, note, host_person_id, created_at, arrived_at, arrived_count from guests
         where deleted_at is null order by created_at, rowid`,
      )
      .toArray();
  }

  /** Players can't change the list once it closes or the gig is over; managers always can. */
  private requireListOpen(gig: GigRow, me: PersonRow) {
    if (me.role === "manager") return;
    if (!guestListOpen(gig))
      throw new ObjectError("conflict", "The guest list is closed; ask a manager", {
        reason: "guest_list_closed",
      });
  }

  private checkGuestLimits(gig: GigRow, host: PersonRow, adding: number) {
    const s = guestSettingsOf(gig);
    const rows = this.guestRows();
    const heads = sum(rows.map((g) => 1 + g.plus_ones));
    if (s.total_limit !== null && heads + adding > s.total_limit)
      throw new ObjectError("conflict", `The guest list is full: ${heads} of ${s.total_limit} places taken`, {
        reason: "guest_list_full",
        heads,
        limit: s.total_limit,
      });
    const mine = sum(rows.filter((g) => g.host_person_id === host.id).map((g) => 1 + g.plus_ones));
    if (s.per_person_limit !== null && mine + adding > s.per_person_limit)
      throw new ObjectError(
        "conflict",
        `${host.name} can bring up to ${s.per_person_limit} (${mine} already on the list)`,
        { reason: "guest_limit_reached", heads: mine, limit: s.per_person_limit },
      );
  }

  private saveGuestSettings(gigId: string, s: GuestSettings) {
    this.sql.exec(`update gig set guest_settings_json = ? where id = ?`, JSON.stringify(s), gigId);
  }

  private linkMatches(gig: GigRow, tokenHash: string): boolean {
    const h = guestSettingsOf(gig).link_hash;
    return !!h && h === tokenHash;
  }

  private sharedView(gig: GigRow): SharedGuestListView {
    const names = new Map(this.personRows().map((p) => [p.id, p.name]));
    const rows = this.guestRows();
    const first = this.eventRows()[0];
    return {
      gig_title: gig.title,
      starts_at: first?.start_at ?? null,
      starts_display: first ? formatDateTimeIST(first.start_at) : null,
      venue: first ? [first.venue_name, first.venue_city].filter(Boolean).join(", ") || null : null,
      heads: sum(rows.map((g) => 1 + g.plus_ones)),
      arrived_heads: sum(rows.map((g) => g.arrived_count)),
      check_in: guestSettingsOf(gig).link_check_in,
      guests: rows
        .map((g) => ({
          id: g.id,
          name: g.name,
          plus_ones: g.plus_ones,
          note: g.note,
          guest_of: names.get(g.host_person_id) ?? "",
          arrived: g.arrived_count >= 1 + g.plus_ones,
          arrived_count: g.arrived_count,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
    };
  }

  private guestListFor(gig: GigRow, me: PersonRow | undefined): GuestListView {
    const s = guestSettingsOf(gig);
    const manager = me?.role === "manager";
    const names = new Map(this.personRows().map((p) => [p.id, p.name]));
    const rows = this.guestRows();
    const heads = (xs: GuestRow[]) => sum(xs.map((g) => 1 + g.plus_ones));
    const mine = rows.filter((g) => g.host_person_id === me?.id);
    return {
      total_limit: s.total_limit,
      per_person_limit: s.per_person_limit,
      closes_at: s.closes_at,
      open: manager || guestListOpen(gig),
      heads: heads(rows),
      my_heads: heads(mine),
      arrived_heads: sum(rows.map((g) => g.arrived_count)),
      guests: (manager ? rows : mine).map((g) => ({
        id: g.id,
        name: g.name,
        plus_ones: g.plus_ones,
        note: g.note,
        host_person_id: g.host_person_id,
        host_name: names.get(g.host_person_id) ?? "",
        is_mine: g.host_person_id === me?.id,
        arrived: g.arrived_count >= 1 + g.plus_ones,
        arrived_count: g.arrived_count,
        created_at: g.created_at,
      })),
      link: manager ? { enabled: !!s.link_hash, check_in: s.link_check_in } : null,
    };
  }

  /** A new row's id: the one made on the device (offline changes), or a fresh ULID. */
  private newId(table: "lists" | "list_items" | "notes" | "guests", given?: string | null): string {
    if (!given) return ulid();
    const taken = this.sql
      .exec<{ n: number }>(`select count(*) as n from ${table} where id = ?`, given)
      .one().n;
    if (taken) throw new ObjectError("conflict", "That id is already used", { reason: "id_taken" });
    return given;
  }

  /** Me on this gig, if I may change its lists and notes. */
  private requireEditor(actor: Actor, gig: GigRow): PersonRow {
    const me = actor.userId ? this.personRows().find((p) => p.user_id === actor.userId) : undefined;
    if (!me) throw new ObjectError("not_found", "Gig not found");
    if (me.role !== "manager" && !settingsOf(gig).players_edit_lists)
      throw new ObjectError("forbidden", "Only the gig's managers can change its lists and notes");
    return me;
  }

  private listRows(): ListRow[] {
    return this.sql
      .exec<ListRow>(
        `select id, title, event_id, checkable, created_by_name, updated_at from lists
         where deleted_at is null order by created_at, rowid`,
      )
      .toArray();
  }

  private requireList(id: string): ListRow {
    const l = this.listRows().find((x) => x.id === id);
    if (!l) throw new ObjectError("not_found", "List not found");
    return l;
  }

  private itemRows(listId?: string): ItemRow[] {
    return (
      listId
        ? this.sql.exec<ItemRow>(
            `select id, list_id, text, detail, song_id, position, done_at, done_by_name from list_items
             where list_id = ? and deleted_at is null order by position, id`,
            listId,
          )
        : this.sql.exec<ItemRow>(
            `select id, list_id, text, detail, song_id, position, done_at, done_by_name from list_items
             where deleted_at is null order by list_id, position, id`,
          )
    ).toArray();
  }

  private requireItem(listId: string, id: string): ItemRow {
    const item = this.sql
      .exec<ItemRow>(
        `select id, list_id, text, detail, song_id, position, done_at, done_by_name from list_items
         where id = ? and list_id = ? and deleted_at is null`,
        id,
        listId,
      )
      .toArray()[0];
    if (!item) throw new ObjectError("not_found", "Item not found");
    return item;
  }

  private requireNote(id: string): NoteRow {
    const n = this.sql
      .exec<NoteRow>(
        `select id, body, created_by, author_name, created_at, edited_at from notes
         where id = ? and deleted_at is null`,
        id,
      )
      .toArray()[0];
    if (!n) throw new ObjectError("not_found", "Note not found");
    return n;
  }

  private touchList(listId: string) {
    this.sql.exec(`update lists set updated_at = ? where id = ?`, nowIso(), listId);
  }

  /**
   * `count` positions in order, just after `after` (null: at the top; undefined: at the
   * end) among `rows` (the list in order). Renumbers the list first if the gap is too small.
   */
  private positionsAfter(
    listId: string,
    rows: ItemRow[],
    after: string | null | undefined,
    count: number,
  ): number[] {
    const at =
      after === undefined ? rows.length : after === null ? 0 : rows.findIndex((r) => r.id === after) + 1;
    const lo = at > 0 ? rows[at - 1]!.position : (rows[0]?.position ?? 1) - 1;
    const hi = at < rows.length ? rows[at]!.position : lo + count + 1;
    const step = (hi - lo) / (count + 1);
    if (step < 1e-6) {
      rows.forEach((r, i) => {
        r.position = i + 1;
        this.sql.exec(`update list_items set position = ? where id = ?`, i + 1, r.id);
      });
      return this.positionsAfter(listId, rows, after, count);
    }
    return Array.from({ length: count }, (_, i) => lo + step * (i + 1));
  }

  private insertItems(
    listId: string,
    items: ListItemInput[],
    after: string | null | undefined,
    actor: Actor,
    ts: string,
  ): string[] {
    if (after) this.requireItem(listId, after);
    const positions = this.positionsAfter(listId, this.itemRows(listId), after, items.length);
    return items.map((item, i) => {
      const id = this.newId("list_items", item.id);
      this.sql.exec(
        `insert into list_items (id, list_id, text, detail, song_id, position, created_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        listId,
        item.text,
        item.detail,
        item.song_id ?? null,
        positions[i]!,
        actor.userId,
        ts,
        ts,
      );
      return id;
    });
  }

  /** Any change to events or people counts as a change to the gig (version, updated_at). */
  private touch(gigId: string) {
    this.sql.exec(`update gig set version = version + 1, updated_at = ? where id = ?`, nowIso(), gigId);
  }

  /** A cancelled gig keeps its history: events and lineup stay as they were. Money still works. */
  private checkNotCancelled(gig: GigRow) {
    if (gig.status === "cancelled")
      throw new ObjectError("conflict", "This gig is cancelled; its events and lineup can't be changed", {
        reason: "cancelled",
      });
  }

  private checkVersion(gig: GigRow, version: number) {
    if (gig.version !== version)
      throw new ObjectError("conflict", "This gig was changed by someone else; reload and try again", {
        reason: "version_mismatch",
        current_version: gig.version,
      });
  }

  /**
   * The shared shape of every write after create: idempotent, role-checked, audited and
   * announced in one transaction. `change` returns the audit entry, or null for a no-op.
   */
  private async write(
    request: unknown[],
    actor: Actor,
    key: string | null,
    role: "manager" | "player",
    change: (gig: GigRow) => AuditEntry | null,
    opts: { returnView?: boolean } = {},
  ): Promise<BookingView> {
    const hash = await hashOf(request);
    const result = idempotent(this.ctx.storage, key, hash, () => {
      const gig = this.requireGig();
      this.requireRole(actor, role === "manager" ? "manager" : undefined);
      const entry = change(gig);
      if (entry) {
        audit(this.sql, actor, entry);
        bumpAndNote(this.sql);
      }
      return opts.returnView === false ? null : this.viewFor(actor.userId!);
    });
    await this.scheduleDelivery();
    return result as BookingView;
  }

  /** The caller's role on this gig; people not on it get "not found" (no existence leak). */
  private requireRole(actor: Actor, needed?: "manager"): BookingRole {
    const me = actor.userId ? this.personRows().find((p) => p.user_id === actor.userId) : undefined;
    if (!me) throw new ObjectError("not_found", "Gig not found");
    if (needed === "manager" && me.role !== "manager")
      throw new ObjectError("forbidden", "Only the gig's managers can do this");
    return me.role;
  }

  private viewFor(userId: string): BookingView {
    const gig = this.requireGig();
    const allPeople = this.personRows();
    const me = allPeople.find((p) => p.user_id === userId);
    const settings = settingsOf(gig);
    const manager = me?.role === "manager";
    const see = {
      lineup: manager || settings.players_see_lineup,
      fee: manager || settings.players_see_fee,
      shares: manager || settings.players_see_shares,
    };
    // Players who may not see the lineup see themselves and the managers only.
    const people = see.lineup ? allPeople : allPeople.filter((p) => p.id === me?.id || p.role === "manager");
    const names = new Map(allPeople.map((p) => [p.id, p.name]));
    const lineup = this.lineupRows();
    const visible = new Set(people.map((p) => p.id));
    const answers = this.attendanceRows().filter((a) => visible.has(a.person_id));
    return {
      id: gig.id,
      kind: gig.kind,
      title: gig.title,
      event_type: gig.event_type,
      status: gig.status,
      cancel_reason: gig.cancel_reason,
      client: gig.client_name
        ? { name: gig.client_name, phone: gig.client_phone, organisation: gig.client_organisation }
        : null,
      notes: gig.notes,
      collective: gig.collective_tag_id
        ? { id: gig.collective_tag_id, name: gig.collective_name ?? "" }
        : null,
      tags: this.tagRows().map((t) => ({ id: t.tag_id, name: t.name })),
      version: gig.version,
      events: this.eventRows().map((e) => ({
        id: e.id,
        kind: e.kind,
        hold: e.hold === 1,
        title: e.title,
        start_at: e.start_at,
        start_display: formatDateTimeIST(e.start_at),
        end_at: e.end_at,
        end_display: e.end_at ? formatDateTimeIST(e.end_at) : null,
        venue_name: e.venue_name,
        venue_city: e.venue_city,
        notes: e.notes,
        lineup: lineup
          .filter((l) => l.event_id === e.id && (see.lineup || l.person_id === me?.id))
          .map((l) => ({
            id: l.id,
            person_id: l.person_id,
            name: names.get(l.person_id) ?? "",
            part: l.part,
            is_me: l.person_id === me?.id,
            share: see.shares || l.person_id === me?.id ? money(l.share_paise) : null,
          })),
        attendance: answers
          .filter((a) => a.event_id === e.id)
          .map((a) => ({
            person_id: a.person_id,
            name: names.get(a.person_id) ?? "",
            going: a.going === 1,
            is_me: a.person_id === me?.id,
          })),
        my_going: answerOf(answers, e.id, me?.id),
      })),
      people: people.map((p) => ({
        id: p.id,
        user_id: p.user_id,
        name: p.name,
        role: p.role,
        is_me: p.user_id === userId,
        has_account: p.user_id !== null,
      })),
      my_role: me?.role ?? "player",
      settings,
      money: this.moneyFor(gig, me?.id ?? null, see, manager, allPeople, lineup),
      ...this.collabFor(userId, manager || settings.players_edit_lists),
      guest_list: this.guestListFor(gig, me),
      created_at: gig.created_at,
      updated_at: gig.updated_at,
    };
  }

  private collabFor(userId: string, canEdit: boolean) {
    const items = this.itemRows();
    const lists: GigListView[] = this.listRows().map((l) => ({
      id: l.id,
      title: l.title,
      event_id: l.event_id,
      checkable: !!l.checkable,
      items: items
        .filter((x) => x.list_id === l.id)
        .map((x) => ({
          id: x.id,
          text: x.text,
          detail: x.detail,
          song_id: x.song_id,
          done: !!x.done_at,
          done_by: x.done_at ? x.done_by_name : null,
        })),
      created_by: l.created_by_name,
      updated_at: l.updated_at,
    }));
    const notes: GigNoteView[] = this.sql
      .exec<NoteRow>(
        `select id, body, created_by, author_name, created_at, edited_at from notes
         where deleted_at is null order by created_at desc, rowid desc`,
      )
      .toArray()
      .map((n) => ({
        id: n.id,
        body: n.body,
        author: n.author_name,
        is_mine: n.created_by === userId,
        created_at: n.created_at,
        edited_at: n.edited_at,
      }));
    return { lists, shared_notes: notes, can_edit_lists: canEdit };
  }

  private moneyFor(
    gig: GigRow,
    myId: string | null,
    see: { fee: boolean; shares: boolean },
    manager: boolean,
    people: PersonRow[],
    lineup: LineupRow[],
  ): GigMoney {
    const t = this.totals(gig, lineup);
    const payments = this.entryRows("payments");
    const payouts = this.entryRows("payouts");
    const payeeOf = (p: PersonRow): PayeeView => {
      const share = sum(lineup.filter((l) => l.person_id === p.id).map((l) => l.share_paise));
      const mine = payouts.filter((x) => x.person_id === p.id);
      const paid = sum(mine.map((x) => x.amount_paise));
      return {
        person_id: p.id,
        name: p.name,
        is_me: p.id === myId,
        share: money(share),
        paid: money(paid),
        owed: money(share - paid),
        status: paymentStatus(share, paid),
        payouts: entryViews(mine).map((v, i) => ({
          ...v,
          person_id: p.id,
          event_id: mine[i]!.event_id,
        })),
      };
    };
    const me = people.find((p) => p.id === myId);
    const payees = people.map(payeeOf).filter((x) => x.share.amount_paise !== 0 || x.payouts.length > 0);
    return {
      can_manage: manager,
      fee: see.fee ? money(gig.fee_paise) : null,
      kept: see.fee && gig.status === "cancelled" ? money(t.fee) : null,
      received: see.fee ? money(t.received) : null,
      balance: see.fee ? money(t.fee - t.received) : null,
      payment_status: see.fee ? paymentStatus(t.fee, t.received) : null,
      payments: see.fee ? entryViews(payments) : null,
      mine: me
        ? payeeOf(me)
        : {
            person_id: "",
            name: "",
            is_me: true,
            share: money(0),
            paid: money(0),
            owed: money(0),
            status: "paid",
            payouts: [],
          },
      payees: see.shares ? payees : null,
      expenses: manager
        ? this.expenseRows().map((e) => ({
            id: e.id,
            event_id: e.event_id,
            category: e.category,
            amount: money(e.amount_paise),
            spent_on: e.spent_on,
            spent_on_display: formatDateIST(e.spent_on),
            note: e.note,
            created_at: e.created_at,
          }))
        : null,
      expenses_total: manager ? money(t.expenses) : null,
      shares_total: manager ? money(t.shares) : null,
      unallocated: manager ? money(t.fee - t.shares) : null,
      net: manager ? money(t.fee - t.shares - t.expenses) : null,
    };
  }
}

/** How venues and clients are compared for duplicate warnings. */
/** A rehearsal that isn't for a gig has no money (docs/design/rehearsals.md). */
function checkHasMoney(gig: GigRow) {
  if (gig.kind === "rehearsal")
    throw new ObjectError("validation_failed", "A rehearsal has no money; record it on the gig it's for", {
      reason: "rehearsal_no_money",
    });
}

/** Ids in this app are ULIDs (made here or on a device). */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * How many of a guest's group are in after a change: a count (kept within the group's
 * size), true for the whole group, false for none; or as it was, trimmed if the group shrank.
 */
function arrivedCount(g: { arrived_count: number }, heads: number, change: number | boolean | undefined) {
  const next =
    change === undefined ? g.arrived_count : change === true ? heads : change === false ? 0 : change;
  return Math.max(0, Math.min(heads, next));
}

function answerOf(
  rows: { event_id: string; person_id: string; going: number }[],
  eventId: string,
  personId: string | undefined,
): boolean | null {
  const a = personId ? rows.find((r) => r.event_id === eventId && r.person_id === personId) : undefined;
  return a ? a.going === 1 : null;
}

function nameKey(name: string | null): string | null {
  const k = name?.trim().toLowerCase().replace(/\s+/g, " ");
  return k ? k : null;
}

function settingsOf(gig: GigRow): GigSettings {
  let stored: Partial<GigSettings> = {};
  try {
    stored = JSON.parse(gig.settings_json) as Partial<GigSettings>;
  } catch {
    // fall back to the defaults
  }
  return { ...GIG_SETTINGS_DEFAULTS, ...stored };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Payments or payouts as the API shows them, with who reversed what. */
function entryViews(rows: EntryRow[]): GigPaymentView[] {
  const reversedBy = new Map(rows.filter((r) => r.reverses_id).map((r) => [r.reverses_id!, r.id]));
  return rows.map((r) => ({
    id: r.id,
    amount: money(r.amount_paise),
    paid_on: r.paid_on,
    paid_on_display: formatDateIST(r.paid_on),
    method: r.method,
    note: r.note,
    kind: r.kind,
    reverses_id: r.reverses_id,
    reversed_by_id: reversedBy.get(r.id) ?? null,
    created_at: r.created_at,
  }));
}

/** The reversing entry for a payment or payout: same amount, negative, dated today. */
function reversalOf(row: EntryRow, note: string | null): MoneyEntryInput {
  return {
    amount_paise: -row.amount_paise,
    paid_on: isoDateIST(nowIso()),
    method: row.method,
    note,
  };
}

function checkTimes(start: string, end: string | null) {
  if (end && end < start) throw new ObjectError("validation_failed", "An event can't end before it starts");
}

/** One entry per account; later entries for the same account win (so the creator stays a manager). */
function dedupePeople(people: PersonInput[]): PersonInput[] {
  const seen = new Map<string, PersonInput>();
  const out: PersonInput[] = [];
  for (const p of people) {
    if (!p.user_id) {
      out.push(p);
      continue;
    }
    const prev = seen.get(p.user_id);
    if (prev) {
      if (p.role === "manager") prev.role = "manager";
      continue;
    }
    const copy = { ...p };
    seen.set(p.user_id, copy);
    out.push(copy);
  }
  return out;
}

function pickKeys<T extends object>(row: T, next: object): Partial<T> {
  return Object.fromEntries(Object.keys(next).map((k) => [k, row[k as keyof T]])) as Partial<T>;
}

type ListRow = {
  id: string;
  title: string;
  event_id: string | null;
  checkable: number;
  created_by_name: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  list_id: string;
  text: string;
  detail: string | null;
  song_id: string | null;
  position: number;
  done_at: string | null;
  done_by_name: string | null;
};

type NoteRow = {
  id: string;
  body: string;
  created_by: string;
  author_name: string;
  created_at: string;
  edited_at: string | null;
};

type GuestRow = {
  id: string;
  name: string;
  plus_ones: number;
  note: string | null;
  host_person_id: string;
  created_at: string;
  arrived_at: string | null;
  arrived_count: number;
};

type GuestSettings = {
  total_limit: number | null;
  per_person_limit: number | null;
  closes_at: string | null;
  link_hash: string | null;
  link_sealed: string | null;
  link_check_in: boolean;
};

function guestSettingsOf(gig: GigRow): GuestSettings {
  let stored: Partial<GuestSettings> = {};
  try {
    stored = JSON.parse(gig.guest_settings_json) as Partial<GuestSettings>;
  } catch {
    // fall back to the defaults
  }
  return {
    total_limit: null,
    per_person_limit: null,
    closes_at: null,
    link_hash: null,
    link_sealed: null,
    link_check_in: true,
    ...stored,
  };
}

/** Players may change their guests until the closing time, while the gig is still on. */
function guestListOpen(gig: GigRow): boolean {
  if (gig.status === "cancelled" || gig.status === "completed") return false;
  const closes = guestSettingsOf(gig).closes_at;
  return !closes || Date.now() < Date.parse(closes);
}
