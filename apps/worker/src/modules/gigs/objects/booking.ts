// One gig's own database (docs/design/gig-centric.md §5): the gig, its events and people,
// and (from step 3) its money. Everything that must be exactly consistent lives here and
// is changed one request at a time. Changes others must hear about go through the outbox:
// the note is written with the change, then handed to the summaries queue by the alarm.
import { DurableObject } from "cloudflare:workers";
import {
  GIG_SETTINGS_DEFAULTS,
  formatDateIST,
  formatDateTimeIST,
  isoDateIST,
  money,
  paymentStatus,
  ulid,
  type BookingRole,
  type BookingView,
  type GigMoney,
  type GigPaymentView,
  type GigSettings,
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
  type Actor,
  type AuditEntry,
  type Migrations,
} from "../../../core/objects/storage.ts";
import { ObjectError } from "../../../core/objects/errors.ts";
import { createdMonthOf, monthName, monthOf, pendingName, pendingShard } from "./names.ts";
import type { GigSummaries, IndexCard, PersonGigSummary, SummaryMessage } from "./types.ts";

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
];

/** Already validated and normalised by the Worker (packages/shared booking.ts schemas). */
export interface EventInput {
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
/** A tag from the D1 registry (the Worker resolves names to ids). */
export interface TagRef {
  id: string;
  name: string;
}

export interface CreateGigInput {
  gig_id: string;
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
    const hash = await hashOf(["create", input]);
    const view = idempotent(this.ctx.storage, key, hash, () => {
      if (this.gigRow()) throw new ObjectError("conflict", "This gig already exists");
      const ts = nowIso();
      this.sql.exec(
        `insert into gig (id, title, event_type, status, client_name, client_phone, client_organisation, notes,
           fee_paise, settings_json, collective_tag_id, collective_name, created_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.gig_id,
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

  async setStatus(
    action: "confirm" | "complete" | "cancel",
    reason: string | null,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["status", action, reason], actor, key, "manager", (gig) => {
      const t = TRANSITIONS[action];
      if (gig.status === t.to) return null; // already there: nothing to do
      if (!t.from.includes(gig.status))
        throw new ObjectError("conflict", `A ${gig.status} gig can't be changed to ${t.to}`, {
          reason: "invalid_transition",
          status: gig.status,
        });
      this.sql.exec(
        `update gig set status = ?, cancel_reason = ?, version = version + 1, updated_at = ? where id = ?`,
        t.to,
        action === "cancel" ? reason : gig.cancel_reason,
        nowIso(),
        gig.id,
      );
      return {
        action: `${action}_gig`,
        entityType: "gig",
        entityId: gig.id,
        before: { status: gig.status },
        after: { status: t.to, reason: action === "cancel" ? reason : undefined },
      };
    });
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
      const count = this.eventRows().length;
      if (count >= 20) throw new ObjectError("validation_failed", "A gig can have at most 20 events");
      const id = this.insertEvent(input, count);
      this.touch(gig.id);
      return { action: "add_event", entityType: "event", entityId: id, after: input };
    });
  }

  async updateEvent(
    eventId: string,
    input: UpdateEventInput,
    actor: Actor,
    key: string | null,
  ): Promise<BookingView> {
    return this.write(["update_event", eventId, input], actor, key, "manager", (gig) => {
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
      const e = this.requireEvent(eventId);
      if (this.eventRows().length <= 1)
        throw new ObjectError("conflict", "A gig needs at least one event; delete the gig instead", {
          reason: "last_event",
        });
      this.sql.exec(`update events set deleted_at = ? where id = ?`, nowIso(), e.id);
      this.sql.exec(`delete from lineup where event_id = ?`, e.id);
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
        after: { role: next.role, name: next.name },
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
      audit(
        this.sql,
        { userId, source: "system" },
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
      this.checkVersion(gig, version);
      const e = this.requireEvent(eventId);
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

  // --- Reads -------------------------------------------------------------------------

  async view(actor: Actor): Promise<BookingView> {
    this.requireGig();
    this.requireRole(actor);
    return this.viewFor(actor.userId!);
  }

  /** The gig's history of changes (managers only). */
  async history(
    actor: Actor,
  ): Promise<{ at: string; actor_user_id: string | null; source: string; action: string }[]> {
    this.requireGig();
    this.requireRole(actor, "manager");
    return this.sql
      .exec<{ at: string; actor_user_id: string | null; source: string; action: string }>(
        `select at, actor_user_id, source, action from _audit order by id desc limit 200`,
      )
      .toArray();
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
      const settings = settingsOf(gig);
      for (const p of people) {
        if (!p.user_id) continue;
        const mine = lineup.filter((l) => l.person_id === p.id);
        const manager = p.role === "manager";
        const gigRow: PersonGigSummary = {
          gig_id: gig.id,
          gig_title: gig.title,
          event_type: gig.event_type,
          client_name: gig.client_name,
          status: gig.status,
          role: p.role,
          first_start_at: events[0]?.start_at ?? gig.created_at,
          share_paise: sum(mine.map((l) => l.share_paise)),
          paid_paise: this.paidTo(p.id),
          fee_paise: manager ? gig.fee_paise : null,
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
        };
        const rows = events.map((e) => ({
          gig_id: gig.id,
          event_id: e.id,
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
      for (const e of events) {
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
        `select id, amount_paise, paid_on, method, note, reverses_id, created_at${extra}
         from ${table} order by paid_on, created_at, rowid`,
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
    return { fee: gig.fee_paise, received, expenses, shares, payouts };
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
        `select id, title, start_at, end_at, venue_name, venue_city, notes, position
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
      `insert into events (id, title, start_at, end_at, venue_name, venue_city, notes, position)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
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

  /** Any change to events or people counts as a change to the gig (version, updated_at). */
  private touch(gigId: string) {
    this.sql.exec(`update gig set version = version + 1, updated_at = ? where id = ?`, nowIso(), gigId);
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
    return {
      id: gig.id,
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
      created_at: gig.created_at,
      updated_at: gig.updated_at,
    };
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
      fee: see.fee ? money(t.fee) : null,
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
