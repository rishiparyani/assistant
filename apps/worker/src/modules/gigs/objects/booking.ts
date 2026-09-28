// One gig's own database (docs/design/gig-centric.md §5): the gig, its events and people,
// and (from step 3) its money. Everything that must be exactly consistent lives here and
// is changed one request at a time. Changes others must hear about go through the outbox:
// the note is written with the change, then handed to the summaries queue by the alarm.
import { DurableObject } from "cloudflare:workers";
import { isoDateIST, ulid } from "@assistant/shared";
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
];

export interface EventInput {
  title?: string | null;
  start_at: string;
  end_at?: string | null;
  venue_name?: string | null;
}
export interface PersonInput {
  user_id?: string | null;
  name: string;
  email?: string | null;
  role: "manager" | "player";
}
export interface CreateGigInput {
  gig_id: string;
  title: string;
  status?: "enquiry" | "confirmed";
  events: EventInput[];
  people: PersonInput[];
}

export interface BookingView {
  id: string;
  title: string;
  status: string;
  version: number;
  events: {
    id: string;
    title: string | null;
    start_at: string;
    end_at: string | null;
    venue_name: string | null;
  }[];
  people: { id: string; user_id: string | null; name: string; role: "manager" | "player" }[];
  my_role: "manager" | "player";
}

type GigRow = { id: string; title: string; status: string; version: number; created_by: string };
type EventRow = BookingView["events"][number] & { position: number };
type PersonRow = BookingView["people"][number] & { email: string | null };

export class BookingObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  // --- Writes ------------------------------------------------------------------------

  async create(input: CreateGigInput, actor: Actor, key: string | null): Promise<BookingView> {
    if (!actor.userId) throw new ObjectError("forbidden", "Sign in to create a gig");
    if (!input.events.length) throw new ObjectError("validation_failed", "A gig needs at least one event");
    const hash = await hashOf(["create", input]);
    const view = idempotent(this.ctx.storage, key, hash, () => {
      if (this.gigRow()) throw new ObjectError("conflict", "This gig already exists");
      const ts = nowIso();
      this.sql.exec(
        `insert into gig (id, title, status, created_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?)`,
        input.gig_id,
        input.title,
        input.status ?? "enquiry",
        actor.userId,
        ts,
        ts,
      );
      input.events.forEach((e, i) =>
        this.sql.exec(
          `insert into events (id, title, start_at, end_at, venue_name, position) values (?, ?, ?, ?, ?, ?)`,
          ulid(),
          e.title ?? null,
          e.start_at,
          e.end_at ?? null,
          e.venue_name ?? null,
          i,
        ),
      );
      // The creator is always a manager.
      const people = input.people.some((p) => p.user_id === actor.userId)
        ? input.people.map((p) => (p.user_id === actor.userId ? { ...p, role: "manager" as const } : p))
        : [{ user_id: actor.userId, name: "", role: "manager" as const }, ...input.people];
      for (const p of people) {
        this.sql.exec(
          `insert into people (id, user_id, name, email, role, added_by, created_at) values (?, ?, ?, ?, ?, ?, ?)`,
          ulid(),
          p.user_id ?? null,
          p.name,
          "email" in p ? (p.email ?? null) : null,
          p.role,
          actor.userId,
          ts,
        );
      }
      const after = this.viewFor(actor.userId!);
      audit(this.sql, actor, { action: "create_gig", entityType: "gig", entityId: input.gig_id, after });
      bumpAndNote(this.sql);
      return after;
    });
    await this.scheduleDelivery();
    return view;
  }

  /** Renames the gig if it hasn't changed since `version` (optimistic concurrency). */
  async rename(title: string, version: number, actor: Actor, key: string | null): Promise<BookingView> {
    const hash = await hashOf(["rename", title, version]);
    const view = idempotent(this.ctx.storage, key, hash, () => {
      const gig = this.requireGig();
      this.requireRole(actor, "manager");
      if (gig.version !== version)
        throw new ObjectError("conflict", "This gig was changed by someone else; reload and try again", {
          reason: "version_mismatch",
          current_version: gig.version,
        });
      this.sql.exec(
        `update gig set title = ?, version = version + 1, updated_at = ? where id = ?`,
        title,
        nowIso(),
        gig.id,
      );
      audit(this.sql, actor, {
        action: "update_gig",
        entityType: "gig",
        entityId: gig.id,
        before: { title: gig.title },
        after: { title },
      });
      bumpAndNote(this.sql);
      return this.viewFor(actor.userId!);
    });
    await this.scheduleDelivery();
    return view;
  }

  // --- Reads -------------------------------------------------------------------------

  async view(actor: Actor): Promise<BookingView> {
    this.requireGig();
    this.requireRole(actor);
    return this.viewFor(actor.userId!);
  }

  /** What this gig tells people's Homes and the month indexes, at the current sequence. */
  async summaries(): Promise<GigSummaries | null> {
    const gig = this.gigRow();
    if (!gig) return null;
    const events = this.eventRows();
    const people = this.personRows();
    const deleted =
      this.sql.exec(`select deleted_at from gig where id = ?`, gig.id).one().deleted_at !== null;

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
    return (
      this.sql.exec<GigRow>(`select id, title, status, version, created_by from gig limit 1`).toArray()[0] ??
      null
    );
  }

  private requireGig(): GigRow {
    const gig = this.gigRow();
    if (!gig) throw new ObjectError("not_found", "Gig not found");
    return gig;
  }

  private eventRows(): EventRow[] {
    return this.sql
      .exec<EventRow>(
        `select id, title, start_at, end_at, venue_name, position from events where deleted_at is null order by position`,
      )
      .toArray();
  }

  private personRows(): PersonRow[] {
    return this.sql
      .exec<PersonRow>(
        `select id, user_id, name, email, role from people where removed_at is null order by rowid`,
      )
      .toArray();
  }

  /** The caller's role on this gig; people not on it get "not found" (no existence leak). */
  private requireRole(actor: Actor, needed?: "manager"): "manager" | "player" {
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
      status: gig.status,
      version: gig.version,
      events: this.eventRows().map(({ position: _position, ...e }) => e),
      people: people.map(({ email: _email, ...p }) => p),
      my_role: people.find((p) => p.user_id === userId)?.role ?? "player",
    };
  }
}
