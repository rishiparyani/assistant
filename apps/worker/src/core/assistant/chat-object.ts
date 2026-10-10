// One person's chat with the assistant ("chat:<user id>", design §10): the messages the
// model sees (including tool calls and results), what the screen shows, confirm cards
// waiting for a tap, and whether a setup is in progress. Only its owner can read it.
import { DurableObject } from "cloudflare:workers";
import { ulid, type ChatItem, type LiveRef } from "@assistant/shared";
import { BASE_TABLES, getMeta, migrate, nowIso, setMeta, type Migrations } from "../objects/storage.ts";
import { ObjectError } from "../objects/errors.ts";
import type { ChatMessage, ToolCall } from "./client.ts";

const MIGRATIONS: Migrations = [
  BASE_TABLES,
  `
  create table messages (
    id text primary key,
    role text not null,
    content text,
    tool_calls_json text,
    tool_call_id text,
    -- What the screen shows: user, assistant, card or note; null = for the model only.
    shown text,
    card_action_id text,
    level integer,
    request_key text,
    created_at text not null
  );
  create index messages_key_idx on messages (request_key);
  create table actions (
    id text primary key,
    tool text not null,
    args_json text not null,
    title text not null,
    details_json text not null,
    status text not null,
    result text,
    created_at text not null
  );
  `,
  // One row per send's Idempotency-Key, claimed before any model or tool runs.
  `
  create table requests (
    key text primary key,
    status text not null,
    created_at text not null
  );
  create index requests_created_idx on requests (created_at);
  `,
  // Live cards (chat-first step 2): what a "live" message points at.
  `alter table messages add column live_json text;`,
  // Several chats and memory (chat-first step 3). Kept in the person's main chat only:
  // the list of their other chats, and what the assistant remembers for them.
  `
  create table chats (
    id text primary key,
    title text not null,
    created_at text not null,
    updated_at text not null,
    deleted_at text
  );
  create index chats_updated_idx on chats (deleted_at, updated_at);
  create table memories (
    id text primary key,
    text text not null,
    source text not null,
    created_at text not null,
    deleted_at text
  );
  create index memories_created_idx on memories (deleted_at, created_at);
  `,
];

/** What the assistant remembers for a person (chat-first step 3). */
export type MemoryRow = {
  id: string;
  text: string;
  source: string;
  created_at: string;
};

export type ChatRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

const MAX_MEMORIES = 200;
const MAX_CHATS = 200;

export interface StoredMessage extends ChatMessage {
  /** Shown on screen as this role (null: for the model only). */
  shown?: "user" | "assistant" | "card" | "note" | "live" | null;
  card_action_id?: string;
  live?: LiveRef;
  level?: number;
}

export interface ActionRow {
  id: string;
  tool: string;
  /** The tool's arguments as JSON (exactly what the card showed). */
  args_json: string;
  title: string;
  details: string[];
  status: "waiting" | "running" | "done" | "cancelled" | "failed" | "expired";
  result: string | null;
  created_at: string;
}

type MessageRow = {
  id: string;
  role: ChatMessage["role"];
  content: string | null;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  shown: string | null;
  card_action_id: string | null;
  level: number | null;
  live_json?: string | null;
  created_at: string;
};

/** Confirm cards expire like MCP confirm tokens. */
const ACTION_MINUTES = 30;

export class ChatObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql, MIGRATIONS));
  }

  /** The first caller owns the chat; anyone else gets "not found". */
  private own(userId: string) {
    const owner = getMeta(this.sql, "owner");
    if (!owner) setMeta(this.sql, "owner", userId);
    else if (owner !== userId) throw new ObjectError("not_found", "Chat not found");
  }

  async items(userId: string, limit = 60): Promise<ChatItem[]> {
    this.own(userId);
    const rows = this.sql
      .exec<MessageRow>(`select * from messages where shown is not null order by rowid desc limit ?`, limit)
      .toArray()
      .reverse();
    return rows.map((r) => this.itemOf(r));
  }

  /** The recent conversation as the model sees it (whole turns only). */
  async context(userId: string, limit = 24): Promise<ChatMessage[]> {
    this.own(userId);
    const rows = this.sql
      .exec<MessageRow>(
        `select * from messages where shown is null or shown in ('user', 'assistant', 'note')
         order by rowid desc limit ?`,
        limit,
      )
      .toArray()
      .reverse();
    // Start at a person's message, so no tool result is left without its call.
    const start = rows.findIndex((r) => r.role === "user");
    return (start < 0 ? [] : rows.slice(start)).map((r) => ({
      role: r.role,
      content: r.content,
      ...(r.tool_calls_json ? { tool_calls: JSON.parse(r.tool_calls_json) as ToolCall[] } : {}),
      ...(r.tool_call_id ? { tool_call_id: r.tool_call_id } : {}),
    }));
  }

  /**
   * Claims a send's key before anything runs: "new" (go ahead), "done" (answered already)
   * or "running" (another copy of this send is still being answered). Kept 24 hours.
   */
  async claim(userId: string, key: string): Promise<"new" | "done" | "running"> {
    this.own(userId);
    this.sql.exec(
      `delete from requests where created_at < ?`,
      new Date(Date.now() - 86400_000).toISOString(),
    );
    const row = this.sql
      .exec<{ status: string }>(`select status from requests where key = ?`, key)
      .toArray()[0];
    if (row) return row.status === "done" ? "done" : "running";
    this.sql.exec(`insert into requests (key, status, created_at) values (?, 'running', ?)`, key, nowIso());
    return "new";
  }

  /** The send finished (or failed: the key is released so a retry can run). */
  async release(userId: string, key: string, done: boolean) {
    this.own(userId);
    if (done) this.sql.exec(`update requests set status = 'done' where key = ?`, key);
    else this.sql.exec(`delete from requests where key = ?`, key);
  }

  /** Items already made for this request key (a repeated send gets the same answer). */
  async forKey(userId: string, key: string): Promise<ChatItem[] | null> {
    this.own(userId);
    const first = this.sql
      .exec<{ n: number }>(
        `select rowid as n from messages where request_key = ? order by rowid limit 1`,
        key,
      )
      .toArray()[0];
    if (!first) return null;
    return this.sql
      .exec<MessageRow>(
        `select * from messages where shown is not null and rowid >= ? order by rowid`,
        first.n,
      )
      .toArray()
      .map((r) => this.itemOf(r));
  }

  async append(userId: string, messages: StoredMessage[], key: string | null = null): Promise<ChatItem[]> {
    this.own(userId);
    const out: ChatItem[] = [];
    this.ctx.storage.transactionSync(() => {
      for (const m of messages) {
        const row: MessageRow = {
          id: ulid(),
          role: m.role,
          content: m.content,
          tool_calls_json: m.tool_calls?.length ? JSON.stringify(m.tool_calls) : null,
          tool_call_id: m.tool_call_id ?? null,
          shown: m.shown ?? null,
          card_action_id: m.card_action_id ?? null,
          level: m.level ?? null,
          live_json: m.live ? JSON.stringify(m.live) : null,
          created_at: nowIso(),
        };
        this.sql.exec(
          `insert into messages (id, role, content, tool_calls_json, tool_call_id, shown, card_action_id, level, live_json, request_key, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          row.role,
          row.content,
          row.tool_calls_json,
          row.tool_call_id,
          row.shown,
          row.card_action_id,
          row.level,
          row.live_json ?? null,
          key,
          row.created_at,
        );
        if (row.shown) out.push(this.itemOf(row));
      }
      // Keep the last 500 messages.
      this.sql.exec(
        `delete from messages where rowid in (select rowid from messages order by rowid desc limit -1 offset 500)`,
      );
    });
    return out;
  }

  async setupInProgress(userId: string, set?: boolean): Promise<boolean> {
    this.own(userId);
    if (set !== undefined) setMeta(this.sql, "setup", set ? "1" : "0");
    return getMeta(this.sql, "setup") === "1";
  }

  async addAction(
    userId: string,
    a: { tool: string; args: Record<string, unknown>; title: string; details: string[] },
  ): Promise<string> {
    this.own(userId);
    const id = ulid();
    this.sql.exec(
      `insert into actions (id, tool, args_json, title, details_json, status, created_at) values (?, ?, ?, ?, ?, 'waiting', ?)`,
      id,
      a.tool,
      JSON.stringify(a.args),
      a.title,
      JSON.stringify(a.details),
      nowIso(),
    );
    return id;
  }

  /** Takes a waiting action for running (once): it's marked so a second tap can't run it again. */
  async takeAction(userId: string, id: string): Promise<ActionRow> {
    this.own(userId);
    const a = this.action(id);
    if (a.status !== "waiting") throw new ObjectError("conflict", "This was already answered");
    if (Date.parse(a.created_at) < Date.now() - ACTION_MINUTES * 60_000) {
      this.sql.exec(`update actions set status = 'expired' where id = ?`, id);
      throw new ObjectError("conflict", "This waited too long; ask again");
    }
    this.sql.exec(`update actions set status = 'running' where id = ?`, id);
    return a;
  }

  async finishAction(userId: string, id: string, status: ActionRow["status"], result: string | null) {
    this.own(userId);
    this.sql.exec(`update actions set status = ?, result = ? where id = ?`, status, result, id);
  }

  // --- The person's chats (main chat only) ---------------------------------------------

  async chats(userId: string): Promise<ChatRow[]> {
    this.own(userId);
    return this.sql
      .exec<ChatRow>(
        `select id, title, created_at, updated_at from chats where deleted_at is null order by updated_at desc limit ?`,
        MAX_CHATS,
      )
      .toArray();
  }

  async addChat(userId: string, id: string): Promise<ChatRow> {
    this.own(userId);
    const n = this.sql
      .exec<{ n: number }>(`select count(*) as n from chats where deleted_at is null`)
      .one().n;
    if (n >= MAX_CHATS)
      throw new ObjectError("conflict", `Up to ${MAX_CHATS} chats; delete an old one first`);
    const now = nowIso();
    this.sql.exec(
      `insert into chats (id, title, created_at, updated_at) values (?, 'New chat', ?, ?) on conflict (id) do nothing`,
      id,
      now,
      now,
    );
    return this.chatRow(id);
  }

  /** A chat got a message: it moves to the top; its first message names it. */
  async touchChat(userId: string, id: string, firstText: string | null): Promise<void> {
    this.own(userId);
    const row = this.sql.exec<{ title: string }>(`select title from chats where id = ?`, id).toArray()[0];
    if (!row) return;
    const title =
      row.title === "New chat" && firstText ? firstText.trim().replace(/\s+/g, " ").slice(0, 60) : row.title;
    this.sql.exec(`update chats set title = ?, updated_at = ? where id = ?`, title, nowIso(), id);
  }

  async hasChat(userId: string, id: string): Promise<boolean> {
    this.own(userId);
    return this.sql.exec(`select 1 from chats where id = ? and deleted_at is null`, id).toArray().length > 0;
  }

  async deleteChat(userId: string, id: string): Promise<void> {
    this.own(userId);
    this.sql.exec(`update chats set deleted_at = ? where id = ? and deleted_at is null`, nowIso(), id);
  }

  private chatRow(id: string): ChatRow {
    const r = this.sql
      .exec<ChatRow>(`select id, title, created_at, updated_at from chats where id = ?`, id)
      .toArray()[0];
    if (!r) throw new ObjectError("not_found", "Chat not found");
    return r;
  }

  // --- What the assistant remembers (main chat only) --------------------------------------

  async memories(userId: string): Promise<MemoryRow[]> {
    this.own(userId);
    return this.sql
      .exec<MemoryRow>(
        `select id, text, source, created_at from memories where deleted_at is null order by created_at desc limit ?`,
        MAX_MEMORIES,
      )
      .toArray();
  }

  async remember(userId: string, text: string, source: string): Promise<MemoryRow> {
    this.own(userId);
    const clean = text.trim().replace(/\s+/g, " ");
    const same = this.sql
      .exec<MemoryRow>(
        `select id, text, source, created_at from memories where deleted_at is null and lower(text) = lower(?)`,
        clean,
      )
      .toArray()[0];
    if (same) return same;
    const n = this.sql
      .exec<{ n: number }>(`select count(*) as n from memories where deleted_at is null`)
      .one().n;
    if (n >= MAX_MEMORIES)
      throw new ObjectError("conflict", `It remembers up to ${MAX_MEMORIES} things; forget something first`);
    const row: MemoryRow = { id: ulid(), text: clean, source, created_at: nowIso() };
    this.sql.exec(
      `insert into memories (id, text, source, created_at) values (?, ?, ?, ?)`,
      row.id,
      row.text,
      row.source,
      row.created_at,
    );
    return row;
  }

  async forget(userId: string, id: string): Promise<MemoryRow> {
    this.own(userId);
    const r = this.sql
      .exec<MemoryRow>(
        `select id, text, source, created_at from memories where id = ? and deleted_at is null`,
        id,
      )
      .toArray()[0];
    if (!r) throw new ObjectError("not_found", "Nothing remembered with that id");
    this.sql.exec(`update memories set deleted_at = ? where id = ?`, nowIso(), id);
    return r;
  }

  async clear(userId: string): Promise<void> {
    this.own(userId);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`delete from messages`);
      this.sql.exec(`update actions set status = 'cancelled' where status = 'waiting'`);
      setMeta(this.sql, "setup", "0");
    });
  }

  private action(id: string): ActionRow {
    const r = this.sql
      .exec<{
        id: string;
        tool: string;
        args_json: string;
        title: string;
        details_json: string;
        status: ActionRow["status"];
        result: string | null;
        created_at: string;
      }>(`select * from actions where id = ?`, id)
      .toArray()[0];
    if (!r) throw new ObjectError("not_found", "Not found");
    return {
      id: r.id,
      tool: r.tool,
      args_json: r.args_json,
      title: r.title,
      details: JSON.parse(r.details_json) as string[],
      status: r.status,
      result: r.result,
      created_at: r.created_at,
    };
  }

  private itemOf(r: MessageRow): ChatItem {
    const item: ChatItem = {
      id: r.id,
      role: (r.shown ?? "note") as ChatItem["role"],
      text: r.content ?? "",
      created_at: r.created_at,
      ...(r.level ? { level: r.level } : {}),
      ...(r.live_json ? { live: JSON.parse(r.live_json) as LiveRef } : {}),
    };
    if (r.card_action_id) {
      const a = this.action(r.card_action_id);
      item.card = {
        action_id: a.id,
        tool: a.tool,
        title: a.title,
        details: a.details,
        status:
          a.status === "waiting" && Date.parse(a.created_at) < Date.now() - ACTION_MINUTES * 60_000
            ? "expired"
            : a.status === "running"
              ? "waiting"
              : a.status,
        ...(a.result ? { result: a.result } : {}),
      };
    }
    return item;
  }
}
