// One group chat ("group:<id>", chat-first step 7): its members and messages. Only members
// can read or write it; anything else is 404. A message leaves one outbox note; the alarm then
// pings every member's live object (no data in the ping), so open apps fetch again.
import { DurableObject } from "cloudflare:workers";
import { ulid, type GroupMember, type GroupMessage, type GroupSummary } from "@assistant/shared";
import {
  BASE_TABLES,
  audit,
  bumpAndNote,
  clearOutbox,
  hashOf,
  idempotent,
  migrate,
  nowIso,
  outboxFailed,
  outboxNote,
  backupTables,
  exportTables,
  importTables,
  type Actor,
  type ObjectDump,
  type Migrations,
} from "../objects/storage.ts";
import { ObjectError } from "../objects/errors.ts";
import { liveOf } from "../live/live-object.ts";

const MIGRATIONS: Migrations = [
  BASE_TABLES,
  `
  create table grp (
    id text primary key,
    name text not null,
    owner_user_id text not null,
    created_at text not null,
    updated_at text not null
  );
  create table members (
    user_id text primary key,
    name text not null,
    role text not null,
    added_at text not null,
    left_at text
  );
  create table messages (
    id text primary key,
    kind text not null,
    author_id text,
    author text not null,
    text text not null,
    created_at text not null
  );
  create index messages_created_idx on messages (created_at);
  -- People who just left still get one ping, so their open app drops the group.
  create table live_extra (user_id text primary key);
  `,
  // Every audit entry gets a ULID (architecture rule 4): "what changed" names entries by it.
  `alter table _audit add column change_id text;
   create index _audit_change_idx on _audit (change_id);`,
  // Chats with one person, and where each member has read up to (decision 2026-10-13 "Chats
  // with people").
  `alter table grp add column direct integer not null default 0;
   alter table members add column read_at text;`,
  // Everything sent before unread counts existed counts as read, so nobody gets a pile of old
  // messages marked new.
  `update members set read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where read_at is null;`,
];

/** At most this many people in a group, and messages read back at once. */
const MAX_MEMBERS = 100;
const PAGE = 200;
const LIVE_DELAY_MS = 300;

type MemberRow = {
  user_id: string;
  name: string;
  role: "owner" | "member";
  left_at: string | null;
  read_at: string | null;
};
type GroupRow = { id: string; name: string; owner_user_id: string; updated_at: string; direct: number };

export class GroupObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  /** Everything needed to restore this group (not idempotency records or the outbox). */
  async exportData(): Promise<ObjectDump | null> {
    if (!this.sql.exec(`select 1 from grp`).toArray().length) return null;
    return exportTables(this.sql, backupTables(this.sql));
  }

  /** Restores a backup into this group if it's empty; never overwrites anything. */
  async importData(dump: ObjectDump): Promise<boolean> {
    if (this.sql.exec(`select 1 from grp`).toArray().length) return false;
    importTables(this.ctx.storage, dump, Object.keys(dump.tables), MIGRATIONS);
    return true;
  }

  /**
   * Sets the group up once. A repeat by the same owner with the same name is harmless (a
   * retry); anything else with an id that's taken is refused.
   */
  async init(
    actor: Actor & { userId: string },
    input: { id: string; name: string; owner: GroupMember; members: GroupMember[]; direct?: boolean },
  ): Promise<void> {
    const have = this.sql.exec<GroupRow>(`select * from grp`).toArray()[0];
    if (have) {
      if (
        have.owner_user_id === input.owner.user_id &&
        have.name === input.name.trim() &&
        !!have.direct === !!input.direct
      )
        return;
      throw new ObjectError("conflict", "That group id is already taken");
    }
    const ts = nowIso();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `insert into grp (id, name, owner_user_id, created_at, updated_at, direct) values (?, ?, ?, ?, ?, ?)`,
        input.id,
        input.name.trim(),
        input.owner.user_id,
        ts,
        ts,
        input.direct ? 1 : 0,
      );
      for (const m of [input.owner, ...input.members.filter((x) => x.user_id !== input.owner.user_id)])
        this.sql.exec(
          // Read up to when they joined: what came before isn't news to them.
          `insert or ignore into members (user_id, name, role, added_at, read_at) values (?, ?, ?, ?, ?)`,
          m.user_id,
          m.name,
          m.user_id === input.owner.user_id ? "owner" : "member",
          ts,
          ts,
        );
      if (!input.direct) this.note("note", null, "Group", `${input.owner.name} made the group`, ts);
      audit(this.sql, actor, {
        action: "create_group",
        entityType: "group",
        entityId: input.id,
        after: { name: input.name, direct: !!input.direct, members: input.members.map((m) => m.user_id) },
      });
      // Everyone in it hears about the new group (their open apps add it to the list).
      this.changed();
    });
  }

  private group(): GroupRow {
    const g = this.sql.exec<GroupRow>(`select * from grp`).toArray()[0];
    if (!g) throw new ObjectError("not_found", "Group not found");
    return g;
  }

  /** A current member, else 404 (people outside the group never learn it exists). */
  private member(userId: string | null): MemberRow {
    const m = userId
      ? this.sql
          .exec<MemberRow>(`select * from members where user_id = ? and left_at is null`, userId)
          .toArray()[0]
      : undefined;
    if (!m) throw new ObjectError("not_found", "Group not found");
    return m;
  }

  private members(): GroupMember[] {
    return this.sql
      .exec<MemberRow>(
        `select * from members where left_at is null order by role = 'owner' desc, added_at, name`,
      )
      .toArray()
      .map((m) => ({ user_id: m.user_id, name: m.name, role: m.role }));
  }

  /** What the reader calls this chat: a group's name, or the other person in a chat for two. */
  private nameFor(g: GroupRow, userId: string): string {
    if (!g.direct) return g.name;
    const other = this.sql
      .exec<{ name: string }>(`select name from members where user_id != ? order by added_at limit 1`, userId)
      .toArray()[0];
    return other?.name ?? "Chat";
  }

  private note(
    kind: GroupMessage["kind"],
    authorId: string | null,
    author: string,
    text: string,
    ts: string,
  ) {
    const id = ulid();
    this.sql.exec(
      `insert into messages (id, kind, author_id, author, text, created_at) values (?, ?, ?, ?, ?, ?)`,
      id,
      kind,
      authorId,
      author,
      text,
      ts,
    );
    this.sql.exec(`update grp set updated_at = ?`, ts);
    return id;
  }

  private changed() {
    bumpAndNote(this.sql);
    void this.ctx.storage.setAlarm(Date.now() + LIVE_DELAY_MS);
  }

  private async write<T>(
    actor: Actor,
    key: string | null,
    request: unknown,
    run: (ts: string) => T,
  ): Promise<T> {
    const hash = await hashOf(request);
    return idempotent(this.ctx.storage, key, hash, () => {
      const out = run(nowIso());
      this.changed();
      return out;
    });
  }

  async view(userId: string): Promise<{
    id: string;
    name: string;
    direct: boolean;
    owner_id: string;
    members: GroupMember[];
    messages: GroupMessage[];
  }> {
    this.member(userId);
    const g = this.group();
    type MessageRow = {
      id: string;
      kind: GroupMessage["kind"];
      author_id: string | null;
      author: string;
      text: string;
      created_at: string;
    };
    const messages: GroupMessage[] = this.sql
      .exec<MessageRow>(
        `select id, kind, author_id, author, text, created_at from
           (select * from messages order by created_at desc, id desc limit ?) order by created_at, id`,
        PAGE,
      )
      .toArray();
    return {
      id: g.id,
      name: this.nameFor(g, userId),
      direct: !!g.direct,
      owner_id: g.owner_user_id,
      members: this.members(),
      messages,
    };
  }

  async summary(userId: string): Promise<GroupSummary> {
    const me = this.member(userId);
    const g = this.group();
    const unread =
      this.sql
        .exec<{ n: number }>(
          `select count(*) as n from messages
           where kind != 'note' and (author_id is null or author_id != ?) and created_at > ?`,
          userId,
          me.read_at ?? "",
        )
        .toArray()[0]?.n ?? 0;
    const last = this.sql
      .exec<{ author: string; text: string; created_at: string }>(
        `select author, text, created_at from messages where kind != 'note' order by created_at desc, id desc limit 1`,
      )
      .toArray()[0];
    return {
      id: g.id,
      name: this.nameFor(g, userId),
      direct: !!g.direct,
      members: this.members().length,
      unread,
      last: last ? { author: last.author, text: last.text.slice(0, 120), at: last.created_at } : null,
      updated_at: g.updated_at,
    };
  }

  /** A person's message, or the assistant's answer to someone (kind "assistant"). */
  async post(
    actor: Actor & { userId: string },
    key: string | null,
    input: { kind: "person" | "assistant"; text: string; asked_by?: string },
  ): Promise<GroupMessage> {
    const m = this.member(actor.userId);
    return this.write(actor, key, ["post", input], (ts) => {
      const author = input.kind === "assistant" ? `Assistant (asked by ${m.name})` : m.name;
      const id = this.note(input.kind, actor.userId, author, input.text.trim(), ts);
      audit(this.sql, actor, { action: "post_group_message", entityType: "group_message", entityId: id });
      return {
        id,
        kind: input.kind,
        author_id: actor.userId,
        author,
        text: input.text.trim(),
        created_at: ts,
      };
    });
  }

  /**
   * Marks everything up to now as read by this person. A read marker only (nothing anyone
   * else sees changes), so it isn't audited or keyed; repeating it is harmless.
   */
  async markRead(userId: string): Promise<void> {
    this.member(userId);
    this.sql.exec(`update members set read_at = ? where user_id = ?`, nowIso(), userId);
  }

  /** The owner adds people (they appear in the group at once). */
  async addPeople(
    actor: Actor & { userId: string },
    key: string | null,
    people: GroupMember[],
  ): Promise<GroupMember[]> {
    const me = this.member(actor.userId);
    if (this.group().direct)
      throw new ObjectError("conflict", "This is a chat for two; make a group to talk with more people");
    if (me.role !== "owner") throw new ObjectError("forbidden", "Only the group's owner can add people");
    return this.write(actor, key, ["add", people.map((p) => p.user_id)], (ts) => {
      const count = this.members().length;
      const fresh = people.filter(
        (p) =>
          !this.sql.exec(`select 1 from members where user_id = ? and left_at is null`, p.user_id).toArray()
            .length,
      );
      if (count + fresh.length > MAX_MEMBERS)
        throw new ObjectError("validation_failed", `A group can have up to ${MAX_MEMBERS} people`);
      for (const p of fresh) {
        this.sql.exec(
          `insert into members (user_id, name, role, added_at, read_at) values (?, ?, 'member', ?, ?)
           on conflict (user_id) do update set left_at = null, name = excluded.name, read_at = excluded.read_at`,
          p.user_id,
          p.name,
          ts,
          ts,
        );
      }
      if (fresh.length)
        this.note("note", null, "Group", `${me.name} added ${fresh.map((p) => p.name).join(", ")}`, ts);
      audit(this.sql, actor, {
        action: "add_group_people",
        entityType: "group",
        entityId: this.group().id,
        after: fresh,
      });
      return this.members();
    });
  }

  /** Leaving (the owner can't leave their own group; they'd delete it later). */
  async leave(actor: Actor & { userId: string }, key: string | null): Promise<{ left: string }> {
    const me = this.member(actor.userId);
    if (this.group().direct) throw new ObjectError("conflict", "A chat for two can't be left");
    if (me.role === "owner") throw new ObjectError("conflict", "You made this group, so you can't leave it");
    return this.write(actor, key, ["leave"], (ts) => {
      this.sql.exec(`update members set left_at = ? where user_id = ?`, ts, actor.userId);
      this.sql.exec(`insert or ignore into live_extra (user_id) values (?)`, actor.userId);
      this.note("note", null, "Group", `${me.name} left`, ts);
      audit(this.sql, actor, { action: "leave_group", entityType: "group", entityId: this.group().id });
      return { left: this.group().id };
    });
  }

  override async alarm(): Promise<void> {
    const note = outboxNote(this.sql);
    if (!note) return;
    const g = this.sql.exec<GroupRow>(`select * from grp`).toArray()[0];
    const people = this.sql
      .exec<{ user_id: string }>(
        `select user_id from members where left_at is null union select user_id from live_extra`,
      )
      .toArray()
      .map((r) => r.user_id);
    try {
      await Promise.all(
        people.map((u) =>
          liveOf(this.env, u).ping({ type: "group_changed", group_id: g?.id ?? "", seq: note.seq }),
        ),
      );
    } catch (e) {
      console.warn("group live ping failed", e);
      await this.ctx.storage.setAlarm(Date.now() + outboxFailed(this.sql));
      return;
    }
    for (const u of people) this.sql.exec(`delete from live_extra where user_id = ?`, u);
    if (!clearOutbox(this.sql, note.seq)) await this.ctx.storage.setAlarm(Date.now() + LIVE_DELAY_MS);
  }
}
