// One gig's own database (docs/design/gig-centric.md §5): the gig, its events and people,
// and (from step 3) its money. Everything that must be exactly consistent lives here and
// is changed one request at a time. Changes others must hear about go through the outbox:
// the note is written with the change, then handed to the summaries queue by the alarm.
import { DurableObject } from "cloudflare:workers";
import { formatDateTimeIST, isoDateIST, ulid, type BookingRole, type BookingView } from "@assistant/shared";
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
import type { GigSummaries, IndexCard, PersonEventSummary, SummaryMessage } from "./types.ts";

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
export interface CreateGigInput {
  gig_id: string;
  title: string;
  event_type?: string | null;
  status?: "enquiry" | "confirmed";
  client?: ClientInput | null;
  notes?: string | null;
  events: EventInput[];
  people: PersonInput[];
}
export interface UpdateGigInput {
  version: number;
  title?: string;
  event_type?: string | null;
  client?: ClientInput | null;
  notes?: string | null;
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
           created_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.gig_id,
        input.title,
        input.event_type ?? null,
        input.status ?? "enquiry",
        input.client?.name ?? null,
        input.client?.phone ?? null,
        input.client?.organisation ?? null,
        input.notes ?? null,
        actor.userId,
        ts,
        ts,
      );
      input.events.forEach((e, i) => this.insertEvent(e, i));
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
      };
      this.sql.exec(
        `update gig set title = ?, event_type = ?, client_name = ?, client_phone = ?, client_organisation = ?,
           notes = ?, version = version + 1, updated_at = ? where id = ?`,
        next.title,
        next.event_type,
        next.client_name,
        next.client_phone,
        next.client_organisation,
        next.notes,
        nowIso(),
        gig.id,
      );
      return {
        action: "update_gig",
        entityType: "gig",
        entityId: gig.id,
        before: pickKeys(gig, next),
        after: next,
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
        this.sql.exec(`update people set removed_at = ? where id = ?`, nowIso(), p.id);
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

    const peopleOut: Record<string, PersonEventSummary[]> = {};
    const monthsOut: Record<string, IndexCard[]> = {};
    if (!deleted) {
      for (const p of people) {
        if (!p.user_id) continue;
        peopleOut[p.user_id] = events.map((e) => ({
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
        }));
      }
      const managers = people.filter((p) => p.role === "manager" && p.user_id).map((p) => p.user_id!);
      for (const e of events) {
        const ym = monthOf(e.start_at);
        (monthsOut[ym] ??= []).push({
          gig_id: gig.id,
          event_id: e.id,
          start_at: e.start_at,
          date: isoDateIST(e.start_at),
          venue_key: e.venue_name ? e.venue_name.trim().toLowerCase() : null,
          status: gig.status,
          manager_user_ids: managers,
        });
      }
    }
    // Everyone who ever got rows hears about removals (an empty list), and is remembered.
    for (const { kind, key } of this.sql.exec<{ kind: string; key: string }>(
      `select kind, key from _targets`,
    )) {
      if (kind === "person") peopleOut[key] ??= [];
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
    const people = this.personRows();
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
      })),
      people: people.map((p) => ({
        id: p.id,
        user_id: p.user_id,
        name: p.name,
        role: p.role,
        is_me: p.user_id === userId,
        has_account: p.user_id !== null,
      })),
      my_role: people.find((p) => p.user_id === userId)?.role ?? "player",
      created_at: gig.created_at,
      updated_at: gig.updated_at,
    };
  }
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
