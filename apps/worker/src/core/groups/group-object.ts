// One group chat ("group:<id>", chat-first step 7): its members and messages. Only members
// can read or write it; anything else is 404. A message leaves one outbox note; the alarm then
// pings every member's live object (no data in the ping), so open apps fetch again.
import { DurableObject } from "cloudflare:workers";
import {
  ulid,
  type GroupMember,
  type GroupMessage,
  type GroupSummary,
  type PollView,
} from "@assistant/shared";
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
  getMeta,
  setMeta,
  retryDelayMs,
  backupTables,
  exportTables,
  importTables,
  type Actor,
  type ObjectDump,
  type Migrations,
} from "../objects/storage.ts";
import { ObjectError } from "../objects/errors.ts";
import { liveOf } from "../live/live-object.ts";
import { searchOf, type SearchDoc } from "../search/search-object.ts";
import { embed } from "../search/embed.ts";

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
  // Messages someone saved to their lists ("Saved to Gigs ✓"), seen only by that person.
  `create table saves (
     message_id text not null,
     user_id text not null,
     label text not null,
     at text not null,
     primary key (message_id, user_id)
   );
   create index saves_user_idx on saves (user_id);`,
  // Search (decision 2026-10-13 "Saving chat messages, and searching chats"): messages go
  // into each member's own index as short pieces of conversation ("chunks"). The alarm fills
  // them in: chunks to send, people to fill from the start (joined), people to empty (left).
  `create table chunks (id text primary key, last_at text not null, n integer not null, body text not null);
   alter table messages add column chunk_id text;
   create index messages_unchunked_idx on messages (chunk_id, created_at);
   create table chunk_dirty (id text primary key);
   create table index_fill (user_id text primary key);
   create table index_gone (user_id text primary key);`,
  // Answers someone shared from their own assistant chat: each one once, for good.
  `create table shared_answers (
     user_id text not null,
     item_id text not null,
     message_id text not null,
     primary key (user_id, item_id)
   );`,
  // Questions asked of everyone (decision 2026-10-14 "Ask everyone"): the answers to pick from,
  // and each member's pick (one each, changeable).
  `create table polls (message_id text primary key, options_json text not null);
   create table poll_votes (
     message_id text not null,
     user_id text not null,
     name text not null,
     option text not null,
     at text not null,
     primary key (message_id, user_id)
   );`,
];

/** At most this many people in a group, and messages read back at once. */
const MAX_MEMBERS = 100;
const PAGE = 200;
const LIVE_DELAY_MS = 300;
/** A piece of conversation for search: up to this many messages, none further apart than the gap. */
const CHUNK_SIZE = 6;
const CHUNK_GAP_MS = 30 * 60_000;
/** Tries for a search push before giving up on it (a rebuild fills that index again). */
const SEARCH_ATTEMPTS = 5;

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
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql, MIGRATIONS);
      // Messages from before search (or a sync that never ran) get into the index soon.
      const waiting = this.sql
        .exec(`select 1 from messages where chunk_id is null and kind != 'note' limit 1`)
        .toArray().length;
      if (waiting && (await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 1000);
    });
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

  async view(
    userId: string,
    around?: string,
  ): Promise<{
    id: string;
    name: string;
    direct: boolean;
    owner_id: string;
    members: GroupMember[];
    messages: GroupMessage[];
    saved: Record<string, string>;
    shared_answers: string[];
    polls: Record<string, PollView>;
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
    // Around a message: half a page either side of it; else the newest page.
    const at = around
      ? this.sql
          .exec<{ created_at: string }>(`select created_at from messages where id = ?`, around)
          .toArray()[0]?.created_at
      : undefined;
    const messages: GroupMessage[] = at
      ? this.sql
          .exec<MessageRow>(
            `select id, kind, author_id, author, text, created_at from
               (select * from messages where created_at < ? order by created_at desc, id desc limit ?)
             union all
             select id, kind, author_id, author, text, created_at from
               (select * from messages where created_at >= ? order by created_at, id limit ?)
             order by created_at, id`,
            at,
            PAGE / 2,
            at,
            PAGE / 2,
          )
          .toArray()
      : this.sql
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
      saved: Object.fromEntries(
        this.sql
          .exec<{ message_id: string; label: string }>(
            `select message_id, label from saves where user_id = ?`,
            userId,
          )
          .toArray()
          .map((r) => [r.message_id, r.label]),
      ),
      shared_answers: this.sql
        .exec<{ item_id: string }>(`select item_id from shared_answers where user_id = ?`, userId)
        .toArray()
        .map((r) => r.item_id),
      polls: Object.fromEntries(
        messages.filter((m) => m.kind === "poll").map((m) => [m.id, this.poll(m.id, m.text, userId)]),
      ),
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
      const author = input.kind === "assistant" ? `Assistant (shared by ${m.name})` : m.name;
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

  /** One message, for a member (someone saving it to their lists). */
  async message(userId: string, messageId: string): Promise<GroupMessage> {
    this.member(userId);
    const m = this.sql
      .exec<{
        id: string;
        kind: string;
        author_id: string | null;
        author: string;
        text: string;
        created_at: string;
      }>(
        `select id, kind, author_id, author, text, created_at from messages where id = ? and kind != 'note'`,
        messageId,
      )
      .toArray()[0];
    if (!m) throw new ObjectError("not_found", "Message not found");
    return { ...m, kind: m.kind as GroupMessage["kind"] };
  }

  /** Remembers that this person saved a message, and where to (only they see it). */
  async markSaved(
    actor: Actor & { userId: string },
    key: string | null,
    messageId: string,
    label: string,
  ): Promise<{ message_id: string; label: string }> {
    await this.message(actor.userId, messageId);
    return this.write(actor, key, ["saved", messageId, label], (ts) => {
      this.sql.exec(
        `insert into saves (message_id, user_id, label, at) values (?, ?, ?, ?)
         on conflict (message_id, user_id) do update set label = excluded.label, at = excluded.at`,
        messageId,
        actor.userId,
        label,
        ts,
      );
      audit(this.sql, actor, {
        action: "save_group_message",
        entityType: "group_message",
        entityId: messageId,
        after: { label },
      });
      return { message_id: messageId, label };
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

  /**
   * One of a member's own assistant answers, shared here as "Assistant (shared by …)". Each
   * answer once, for good (kept in `shared_answers`, not just under a 24-hour key).
   */
  async shareAnswer(
    actor: Actor & { userId: string },
    itemId: string,
    text: string,
  ): Promise<{ message_id: string; shared: boolean }> {
    const m = this.member(actor.userId);
    const had = this.sql
      .exec<{ message_id: string }>(
        `select message_id from shared_answers where user_id = ? and item_id = ?`,
        actor.userId,
        itemId,
      )
      .toArray()[0];
    if (had) return { message_id: had.message_id, shared: false };
    const ts = nowIso();
    const id = this.ctx.storage.transactionSync(() => {
      const id = this.note("assistant", actor.userId, `Assistant (shared by ${m.name})`, text.trim(), ts);
      this.sql.exec(
        `insert into shared_answers (user_id, item_id, message_id) values (?, ?, ?)`,
        actor.userId,
        itemId,
        id,
      );
      audit(this.sql, actor, { action: "share_answer", entityType: "group_message", entityId: id });
      return id;
    });
    this.changed();
    return { message_id: id, shared: true };
  }

  private poll(messageId: string, question: string, userId: string): PollView {
    const row = this.sql
      .exec<{ options_json: string }>(`select options_json from polls where message_id = ?`, messageId)
      .toArray()[0];
    const options = row ? (JSON.parse(row.options_json) as string[]) : [];
    const votes = this.sql
      .exec<{ user_id: string; name: string; option: string }>(
        `select user_id, name, option from poll_votes where message_id = ? order by at`,
        messageId,
      )
      .toArray();
    return {
      question,
      options,
      votes: options.map((o) => ({
        option: o,
        people: votes.filter((v) => v.option === o).map((v) => v.name),
      })),
      mine: votes.find((v) => v.user_id === userId)?.option ?? null,
    };
  }

  /** A question for everyone here, with the answers to pick from. */
  async createPoll(
    actor: Actor & { userId: string },
    key: string | null,
    question: string,
    options: string[],
  ): Promise<{ message_id: string }> {
    const m = this.member(actor.userId);
    return this.write(actor, key, ["poll", question, options], (ts) => {
      const id = this.note("poll", actor.userId, m.name, question.trim(), ts);
      this.sql.exec(
        `insert into polls (message_id, options_json) values (?, ?)`,
        id,
        JSON.stringify(options),
      );
      audit(this.sql, actor, {
        action: "create_poll",
        entityType: "group_message",
        entityId: id,
        after: { options },
      });
      return { message_id: id };
    });
  }

  /** My answer to a question here (one each; picking again changes it, null takes it back). */
  async vote(
    actor: Actor & { userId: string },
    key: string | null,
    messageId: string,
    option: string | null,
  ): Promise<{ message_id: string; option: string | null }> {
    const m = this.member(actor.userId);
    const row = this.sql
      .exec<{ options_json: string }>(`select options_json from polls where message_id = ?`, messageId)
      .toArray()[0];
    if (!row) throw new ObjectError("not_found", "Question not found");
    if (option !== null && !(JSON.parse(row.options_json) as string[]).includes(option))
      throw new ObjectError("validation_failed", "That isn't one of the answers");
    return this.write(actor, key, ["vote", messageId, option], (ts) => {
      const before =
        this.sql
          .exec<{ option: string }>(
            `select option from poll_votes where message_id = ? and user_id = ?`,
            messageId,
            actor.userId,
          )
          .toArray()[0]?.option ?? null;
      if (option === null)
        this.sql.exec(`delete from poll_votes where message_id = ? and user_id = ?`, messageId, actor.userId);
      else
        this.sql.exec(
          `insert into poll_votes (message_id, user_id, name, option, at) values (?, ?, ?, ?, ?)
           on conflict (message_id, user_id) do update set option = excluded.option, at = excluded.at, name = excluded.name`,
          messageId,
          actor.userId,
          m.name,
          option,
          ts,
        );
      audit(this.sql, actor, {
        action: "vote",
        entityType: "group_message",
        entityId: messageId,
        before: { option: before },
        after: { option },
      });
      return { message_id: messageId, option };
    });
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
      // New people can search what was said before they joined (they can read it too).
      for (const p of fresh) {
        this.sql.exec(`insert or ignore into index_fill (user_id) values (?)`, p.user_id);
        this.sql.exec(`delete from index_gone where user_id = ?`, p.user_id);
      }
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
      // Their search index forgets this chat (by the alarm, like every other change elsewhere).
      this.sql.exec(`insert or ignore into index_gone (user_id) values (?)`, actor.userId);
      this.sql.exec(`delete from index_fill where user_id = ?`, actor.userId);
      audit(this.sql, actor, { action: "leave_group", entityType: "group", entityId: this.group().id });
      return { left: this.group().id };
    });
  }

  /** The search document for one chunk (the chat's name is re-read on every search hit). */
  private chunkDoc(g: GroupRow, c: { id: string; last_at: string; body: string }): SearchDoc {
    return {
      id: `group:${g.id}:${c.id}`,
      space_id: `group:${g.id}`,
      collection_id: "",
      collection: g.direct ? "Chat" : g.name,
      record_id: c.id,
      title: g.direct ? "Chat" : g.name,
      body: c.body,
      updated_at: c.last_at,
    };
  }

  /** Puts new messages into chunks (in order), marking the chunks that changed. */
  private chunkNew() {
    const fresh = this.sql
      .exec<{ id: string; author: string; text: string; created_at: string }>(
        `select id, author, text, created_at from messages
         where chunk_id is null and kind != 'note' order by created_at, id limit 500`,
      )
      .toArray();
    for (const m of fresh) {
      const last = this.sql
        .exec<{ id: string; last_at: string; n: number; body: string }>(
          `select * from chunks order by last_at desc, id desc limit 1`,
        )
        .toArray()[0];
      const line = `${m.author}: ${m.text}`;
      const fits =
        last && last.n < CHUNK_SIZE && Date.parse(m.created_at) - Date.parse(last.last_at) <= CHUNK_GAP_MS;
      const id = fits ? last.id : m.id;
      if (fits)
        this.sql.exec(
          `update chunks set n = n + 1, last_at = ?, body = body || char(10) || ? where id = ?`,
          m.created_at,
          line,
          id,
        );
      else
        this.sql.exec(
          `insert into chunks (id, last_at, n, body) values (?, ?, 1, ?)`,
          id,
          m.created_at,
          line,
        );
      this.sql.exec(`update messages set chunk_id = ? where id = ?`, id, m.id);
      this.sql.exec(`insert or ignore into chunk_dirty (id) values (?)`, id);
    }
    return fresh.length;
  }

  /**
   * Keeps members' search indexes up to date with this chat: changed chunks to everyone in it,
   * every chunk to people who just joined, nothing left for people who left. Writes are
   * replaces, so a retry is harmless. Returns a delay to try again after, or null when done.
   */
  private async syncSearch(): Promise<number | null> {
    const g = this.sql.exec<GroupRow>(`select * from grp`).toArray()[0];
    if (!g) return null;
    while (this.chunkNew() === 500);
    const members = this.members().map((m) => m.user_id);
    const dirty = this.sql
      .exec<{ id: string; last_at: string; body: string }>(
        `select c.id, c.last_at, c.body from chunk_dirty d join chunks c on c.id = d.id`,
      )
      .toArray();
    const fill = this.sql
      .exec<{ user_id: string }>(`select user_id from index_fill`)
      .toArray()
      .map((r) => r.user_id)
      .filter((u) => members.includes(u));
    const gone = this.sql
      .exec<{ user_id: string }>(`select user_id from index_gone`)
      .toArray()
      .map((r) => r.user_id);
    if (!dirty.length && !fill.length && !gone.length) return null;
    const all = fill.length
      ? this.sql
          .exec<{ id: string; last_at: string; body: string }>(`select id, last_at, body from chunks`)
          .toArray()
      : [];
    const send = async (users: string[], chunks: { id: string; last_at: string; body: string }[]) => {
      if (!users.length || !chunks.length) return;
      const docs = chunks.map((c) => this.chunkDoc(g, c));
      // By meaning too when the model answers (best effort: words always work).
      const vectors = await embed(
        { ai: this.env.AI, fake: this.env.AI_FAKE === "1" },
        docs.map((d) => d.body),
      ).catch(() => null);
      await Promise.all(
        users.map(async (u) => {
          const index = searchOf(this.env, u);
          await index.upsert(docs);
          if (vectors?.length)
            await index.upsertVectors(docs.map((d, i) => ({ doc_id: d.id, vec: vectors[i]! })));
        }),
      );
    };
    try {
      await send(
        members.filter((u) => !fill.includes(u)),
        dirty,
      );
      for (let i = 0; i < all.length; i += 100) await send(fill, all.slice(i, i + 100));
      await Promise.all(gone.map((u) => searchOf(this.env, u).removeSpace(`group:${g.id}`)));
      setMeta(this.sql, "search_attempts", "0");
    } catch (e) {
      // A few tries with growing waits, then let it go: that person's search can be filled
      // again with a rebuild, and nothing here retries (or embeds) for ever.
      const attempts = Number(getMeta(this.sql, "search_attempts") ?? "0") + 1;
      console.warn(
        `group search sync failed (attempt ${attempts})`,
        e instanceof Error ? e.message : String(e),
      );
      if (attempts < SEARCH_ATTEMPTS) {
        setMeta(this.sql, "search_attempts", String(attempts));
        return retryDelayMs(attempts);
      }
      setMeta(this.sql, "search_attempts", "0");
    }
    for (const c of dirty) this.sql.exec(`delete from chunk_dirty where id = ?`, c.id);
    for (const u of fill) this.sql.exec(`delete from index_fill where user_id = ?`, u);
    for (const u of gone) this.sql.exec(`delete from index_gone where user_id = ?`, u);
    return null;
  }

  /** Fills one member's index with this whole chat (their search rebuild). */
  async rebuildSearch(userId: string): Promise<number> {
    this.member(userId);
    this.sql.exec(`insert or ignore into index_fill (user_id) values (?)`, userId);
    const retry = await this.syncSearch();
    if (retry !== null) await this.ctx.storage.setAlarm(Date.now() + retry);
    return Number(this.sql.exec<{ n: number }>(`select count(*) as n from chunks`).one().n);
  }

  override async alarm(): Promise<void> {
    // Search first (its own retry), then the live pings.
    const retry = await this.syncSearch();
    if (retry !== null) await this.ctx.storage.setAlarm(Date.now() + retry);
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
