// One person's chat with the assistant ("chat:<user id>", design §10): the messages the
// model sees (including tool calls and results), what the screen shows, confirm cards
// waiting for a tap, and whether a setup is in progress. Only its owner can read it.
import { DurableObject } from "cloudflare:workers";
import { ulid, type ChatItem, type LiveRef } from "@assistant/shared";
import {
  BASE_TABLES,
  audit,
  bumpAndNote,
  clearOutbox,
  getMeta,
  hashOf,
  idempotent,
  migrate,
  nowIso,
  outboxFailed,
  outboxNote,
  setMeta,
  backupTables,
  exportTables,
  importTables,
  hasData,
  type ObjectDump,
  type Actor,
  type Migrations,
} from "../objects/storage.ts";
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
  // Every audit entry gets a ULID (architecture rule 4): "what changed" names entries by it.
  `alter table _audit add column change_id text;
   create index _audit_change_idx on _audit (change_id);`,
  // A card that waits for the person (This week's proposals) lasts longer than a confirm card.
  `alter table actions add column expires_at text;`,
  // Connectors (decision 2026-10-12 "Connectors start with Google Calendar"): the person's own
  // access to an outside service, sealed with the app's secret; a consent in progress.
  `
  create table connectors (
    kind text primary key,
    sealed text not null,
    account text,
    connected_at text not null
  );
  create table oauth_states (
    state text primary key,
    kind text not null,
    expires_at text not null
  );
  create index oauth_states_expires_idx on oauth_states (expires_at);
  `,
  // Spaces (decision 2026-10-16): a chat belongs to a space (null: Personal), and a memory can
  // be for one space only (null: everywhere).
  `alter table chats add column space_id text;
   alter table memories add column space_id text;`,
];

export type ConnectorRow = {
  kind: string;
  sealed: string;
  account: string | null;
  connected_at: string;
};

/** What the assistant remembers for a person (chat-first step 3). */
export type MemoryRow = {
  id: string;
  text: string;
  source: string;
  created_at: string;
  /** For one space only; null for everywhere. */
  space_id: string | null;
};

export type ChatRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** The space the chat is in; null for Personal. */
  space_id: string | null;
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
  /** When it stops being tappable (null: ACTION_MINUTES after created_at). */
  expires_at: string | null;
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
const expired = (a: { created_at: string; expires_at: string | null }) =>
  Date.parse(a.expires_at ?? "") < Date.now() ||
  (!a.expires_at && Date.parse(a.created_at) < Date.now() - ACTION_MINUTES * 60_000);

/** Cards whose arguments the person may change before Confirm (setups, never money or deletes). */
export const EDITABLE_CARDS: ReadonlySet<string> = new Set([
  "make_setup",
  "create_collection",
  "add_field",
  "update_field",
  "save_view",
  "update_view",
]);

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

  /**
   * The conversation as the model sees it (decision 2026-10-16 "Chats like Claude"): the
   * whole chat, never cut at a count. Once a chat is long, its older part lives on as a
   * summary (`summary`, up to row `summary_upto`) and only what came after travels verbatim.
   */
  async context(userId: string): Promise<ChatMessage[]> {
    this.own(userId);
    const rows = this.contextRows();
    // Start at a person's message, so no tool result is left without its call.
    const start = rows.findIndex((r) => r.role === "user");
    const summary = getMeta(this.sql, "summary");
    const earlier: ChatMessage[] = summary
      ? [
          { role: "user", content: `(Earlier in this conversation, summarised:\n${summary})` },
          { role: "assistant", content: "Noted, I have the earlier part in mind." },
        ]
      : [];
    return [
      ...earlier,
      ...(start < 0 ? [] : rows.slice(start)).map((r) => ({
        role: r.role,
        content: r.content,
        ...(r.tool_calls_json ? { tool_calls: JSON.parse(r.tool_calls_json) as ToolCall[] } : {}),
        ...(r.tool_call_id ? { tool_call_id: r.tool_call_id } : {}),
      })),
    ];
  }

  /** The model-facing rows after the summary cut, oldest first, with their row numbers. */
  private contextRows(): (MessageRow & { n: number })[] {
    const upto = Number(getMeta(this.sql, "summary_upto") ?? 0);
    return this.sql
      .exec<MessageRow & { n: number }>(
        `select rowid as n, * from messages
         where rowid > ? and (shown is null or shown in ('user', 'assistant', 'note'))
         order by rowid`,
        upto,
      )
      .toArray();
  }

  /** How much the model reads each time, in characters (the summary counts too). */
  async contextSize(userId: string): Promise<number> {
    this.own(userId);
    const rows = this.contextRows();
    return (
      (getMeta(this.sql, "summary")?.length ?? 0) +
      rows.reduce((n, r) => n + (r.content?.length ?? 0) + (r.tool_calls_json?.length ?? 0), 0)
    );
  }

  /**
   * The older part of the conversation, ready to summarise: every whole turn after the last
   * cut except the newest `keepTurns`, as a plain transcript, and the row the cut would move
   * to. Null when there's too little to fold away.
   */
  async olderTurns(
    userId: string,
    keepTurns: number,
  ): Promise<{ transcript: string; upto: number; previous: string | null } | null> {
    this.own(userId);
    const rows = this.contextRows();
    const starts = rows.map((r, i) => (r.role === "user" ? i : -1)).filter((i) => i >= 0);
    if (starts.length <= keepTurns + 1) return null;
    const cut = starts[starts.length - keepTurns]!;
    const older = rows.slice(starts[0], cut);
    const lines = older.map((r) => {
      if (r.role === "tool") return `tool result: ${(r.content ?? "").slice(0, 300)}`;
      if (r.tool_calls_json) {
        const calls = JSON.parse(r.tool_calls_json) as ToolCall[];
        return `assistant did: ${calls.map((c) => `${c.function.name}(${c.function.arguments.slice(0, 200)})`).join("; ")}`;
      }
      return `${r.role === "user" ? "person" : "assistant"}: ${r.content ?? ""}`;
    });
    return { transcript: lines.join("\n"), upto: older.at(-1)!.n, previous: getMeta(this.sql, "summary") };
  }

  /** The summary that stands for everything up to row `upto` from now on. */
  async setSummary(userId: string, text: string, upto: number): Promise<void> {
    this.own(userId);
    this.ctx.storage.transactionSync(() => {
      setMeta(this.sql, "summary", text);
      setMeta(this.sql, "summary_upto", String(upto));
    });
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
  /**
   * For a write this person makes outside any object (e.g. a D1 admin table): the stored
   * result of an earlier request with this key (null when new); a key reused for a
   * different request is refused. `keepResult` stores the result afterwards (24 h).
   */
  async recallResult(userId: string, key: string, hash: string): Promise<unknown> {
    this.own(userId);
    this.sql.exec(
      `delete from _idempotency where created_at < ?`,
      new Date(Date.now() - 86400_000).toISOString(),
    );
    const row = this.sql
      .exec<{ request_hash: string; response_json: string }>(
        `select request_hash, response_json from _idempotency where key = ?`,
        key,
      )
      .toArray()[0];
    if (!row) return null;
    if (row.request_hash !== hash)
      throw new ObjectError("conflict", "This Idempotency-Key was already used for a different request", {
        reason: "idempotency_key_reused",
      });
    return JSON.parse(row.response_json) as unknown;
  }

  async keepResult(userId: string, key: string, hash: string, result: unknown): Promise<void> {
    this.own(userId);
    this.sql.exec(
      `insert or ignore into _idempotency (key, request_hash, response_json, created_at) values (?, ?, ?, ?)`,
      key,
      hash,
      JSON.stringify(result),
      nowIso(),
    );
  }

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
    return this.ctx.storage.transactionSync(() => this.insert(messages, key));
  }

  /**
   * A live card the app puts in the chat (no model), once per idempotency key: a retry gives
   * the same card, and the key reused for a different card is refused.
   */
  async showLive(actor: Actor & { userId: string }, key: string | null, live: LiveRef): Promise<void> {
    this.own(actor.userId);
    const hash = await hashOf(["show_live", live]);
    idempotent(this.ctx.storage, key, hash, () => {
      this.insert([{ role: "assistant", content: "", shown: "live", live }], key);
      return { shown: true };
    });
  }

  private insert(messages: StoredMessage[], key: string | null): ChatItem[] {
    const out: ChatItem[] = [];
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
    return out;
  }

  async setupInProgress(userId: string, set?: boolean): Promise<boolean> {
    this.own(userId);
    if (set !== undefined) setMeta(this.sql, "setup", set ? "1" : "0");
    return getMeta(this.sql, "setup") === "1";
  }

  /** Claims a once-only key (this week's proposals): false when it was claimed before. */
  async claimOnce(userId: string, key: string): Promise<boolean> {
    this.own(userId);
    if (getMeta(this.sql, `claim:${key}`)) return false;
    setMeta(this.sql, `claim:${key}`, nowIso());
    return true;
  }

  /**
   * A card someone else sends (a shared setup): the card and its message in one write, once
   * per key. A retry after a crash either finds it delivered or delivers it whole.
   */
  async deliverCard(
    userId: string,
    onceKey: string,
    a: { tool: string; args: Record<string, unknown>; title: string; details: string[] },
    message: string,
    ttlMinutes: number,
  ): Promise<boolean> {
    this.own(userId);
    return this.ctx.storage.transactionSync(() => {
      if (getMeta(this.sql, `claim:${onceKey}`)) return false;
      setMeta(this.sql, `claim:${onceKey}`, nowIso());
      const id = ulid();
      this.sql.exec(
        `insert into actions (id, tool, args_json, title, details_json, status, created_at, expires_at) values (?, ?, ?, ?, ?, 'waiting', ?, ?)`,
        id,
        a.tool,
        JSON.stringify(a.args),
        a.title,
        JSON.stringify(a.details),
        nowIso(),
        new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      );
      this.insert(
        [
          { role: "assistant", content: message, shown: "assistant" },
          { role: "assistant", content: a.title, shown: "card", card_action_id: id },
        ],
        null,
      );
      return true;
    });
  }

  async addAction(
    userId: string,
    a: { tool: string; args: Record<string, unknown>; title: string; details: string[] },
    /** How long it can be tapped; the confirm-card default when left out. */
    ttlMinutes: number | null = null,
  ): Promise<string> {
    this.own(userId);
    const id = ulid();
    this.sql.exec(
      `insert into actions (id, tool, args_json, title, details_json, status, created_at, expires_at) values (?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      id,
      a.tool,
      JSON.stringify(a.args),
      a.title,
      JSON.stringify(a.details),
      nowIso(),
      ttlMinutes ? new Date(Date.now() + ttlMinutes * 60_000).toISOString() : null,
    );
    return id;
  }

  /** Takes a waiting action for running (once): it's marked so a second tap can't run it again. */
  async takeAction(userId: string, id: string): Promise<ActionRow> {
    this.own(userId);
    const a = this.action(id);
    if (a.status !== "waiting") throw new ObjectError("conflict", "This was already answered");
    if (expired(a)) {
      this.sql.exec(`update actions set status = 'expired' where id = ?`, id);
      throw new ObjectError("conflict", "This waited too long; ask again");
    }
    this.sql.exec(`update actions set status = 'running' where id = ?`, id);
    return a;
  }

  /** The person changed a setup card by hand: what runs (and shows) is the changed version. */
  async reviseAction(userId: string, id: string, argsJson: string, details: string[]) {
    this.own(userId);
    this.sql.exec(
      `update actions set args_json = ?, details_json = ? where id = ?`,
      argsJson,
      JSON.stringify(details),
      id,
    );
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
        `select id, title, created_at, updated_at, space_id from chats where deleted_at is null order by updated_at desc limit ?`,
        MAX_CHATS,
      )
      .toArray();
  }

  /**
   * The chat to open: the newest if it was used within `gapMs` or is still empty, else a new
   * one made here and now. One step inside this object, so two apps asking at once (a double
   * tap, a retry) get the same chat, never two empty ones.
   */
  async currentChat(userId: string, gapMs: number, spaceId: string | null = null): Promise<string> {
    this.own(userId);
    const latest = this.sql
      .exec<ChatRow>(
        `select id, title, created_at, updated_at, space_id from chats
         where deleted_at is null and space_id is ? order by updated_at desc limit 1`,
        spaceId,
      )
      .toArray()[0];
    if (latest && (latest.title === "New chat" || Date.now() - Date.parse(latest.updated_at) < gapMs))
      return latest.id;
    const id = ulid();
    const now = nowIso();
    this.sql.exec(
      `insert into chats (id, title, created_at, updated_at, space_id) values (?, 'New chat', ?, ?, ?)`,
      id,
      now,
      now,
      spaceId,
    );
    return id;
  }

  /** The space a chat is in (null: Personal); not found when it isn't this person's. */
  async chatSpace(userId: string, id: string): Promise<string | null> {
    this.own(userId);
    return this.chatRow(id).space_id;
  }

  async addChat(userId: string, id: string, spaceId: string | null = null): Promise<ChatRow> {
    this.own(userId);
    const n = this.sql
      .exec<{ n: number }>(`select count(*) as n from chats where deleted_at is null`)
      .one().n;
    if (n >= MAX_CHATS)
      throw new ObjectError("conflict", `Up to ${MAX_CHATS} chats; delete an old one first`);
    const now = nowIso();
    this.sql.exec(
      `insert into chats (id, title, created_at, updated_at, space_id) values (?, 'New chat', ?, ?, ?) on conflict (id) do nothing`,
      id,
      now,
      now,
      spaceId,
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

  /**
   * Hides a chat from the list (soft delete: its messages stay in its own object). A retry
   * with the same key gets the same answer (rule 8).
   */
  async deleteChat(
    actor: Actor & { userId: string },
    key: string | null,
    id: string,
  ): Promise<{ deleted: string }> {
    this.own(actor.userId);
    const hash = await hashOf(["delete_chat", id]);
    return idempotent(this.ctx.storage, key, hash, () => {
      const row = this.sql
        .exec<{ title: string }>(`select title from chats where id = ? and deleted_at is null`, id)
        .toArray()[0];
      if (!row) throw new ObjectError("not_found", "Chat not found");
      this.sql.exec(`update chats set deleted_at = ? where id = ?`, nowIso(), id);
      audit(this.sql, actor, {
        action: "delete_chat",
        entityType: "chat",
        entityId: id,
        before: { title: row.title },
      });
      return { deleted: id };
    });
  }

  // --- One chat's own title and its place in the list (any chat but main) -----------------
  // The list lives in the main chat. A chat records its first message as its title here, and
  // an outbox note; the alarm then updates the list (rule 16: a failure there can't touch
  // the send that caused it, and it's retried until it lands).

  async touched(userId: string, text: string): Promise<void> {
    this.own(userId);
    if (!getMeta(this.sql, "title"))
      setMeta(this.sql, "title", text.trim().replace(/\s+/g, " ").slice(0, 60));
    bumpAndNote(this.sql);
    await this.ctx.storage.setAlarm(Date.now() + 100);
  }

  /** The title this chat gave itself (its first message), if it has one. */
  async ownTitle(userId: string): Promise<string | null> {
    this.own(userId);
    return getMeta(this.sql, "title");
  }

  /** Everything needed to restore this chat (not idempotency records or the outbox). */
  async exportData(): Promise<ObjectDump | null> {
    const used =
      this.sql.exec(`select 1 from messages limit 1`).toArray().length ||
      this.sql.exec(`select 1 from sqlite_master where name = 'chats'`).toArray().length;
    if (!used) return null;
    return exportTables(this.sql, backupTables(this.sql));
  }

  /** Restores a backup into this chat if it holds nothing yet; never overwrites anything. */
  async importData(dump: ObjectDump): Promise<boolean> {
    // Not just messages: a cleared chat still keeps memories, its list of chats and history.
    if (hasData(this.sql)) return false;
    importTables(this.ctx.storage, dump, Object.keys(dump.tables), MIGRATIONS);
    return true;
  }

  /** The other chats' ids (for backups). */
  async chatIds(): Promise<string[]> {
    return this.sql
      .exec<{ id: string }>(`select id from chats`)
      .toArray()
      .map((r) => r.id);
  }

  override async alarm(): Promise<void> {
    const note = outboxNote(this.sql);
    const name = this.ctx.id.name ?? "";
    const m = /^chat:([^:]+):([^:]+)$/.exec(name);
    if (!note || !m) return;
    const [, userId, chatId] = m;
    try {
      await this.env.CHATS.getByName(`chat:${userId}`).touchChat(
        userId!,
        chatId!,
        getMeta(this.sql, "title"),
      );
    } catch (e) {
      console.warn("chat list update failed", e);
      await this.ctx.storage.setAlarm(Date.now() + outboxFailed(this.sql));
      return;
    }
    if (!clearOutbox(this.sql, note.seq)) await this.ctx.storage.setAlarm(Date.now() + 100);
  }

  private chatRow(id: string): ChatRow {
    const r = this.sql
      .exec<ChatRow>(`select id, title, created_at, updated_at, space_id from chats where id = ?`, id)
      .toArray()[0];
    if (!r) throw new ObjectError("not_found", "Chat not found");
    return r;
  }

  // --- Connectors (main chat only) ----------------------------------------------------------

  /** A one-use consent state for `kind`, good for 10 minutes. */
  async startConsent(userId: string, kind: string): Promise<string> {
    this.own(userId);
    this.sql.exec(`delete from oauth_states where expires_at < ?`, nowIso());
    const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    this.sql.exec(
      `insert into oauth_states (state, kind, expires_at) values (?, ?, ?)`,
      state,
      kind,
      new Date(Date.now() + 10 * 60_000).toISOString(),
    );
    return state;
  }

  /** Takes a consent state back (once): its kind, or null when unknown or expired. */
  async takeConsent(userId: string, state: string): Promise<string | null> {
    this.own(userId);
    const r = this.sql
      .exec<{ kind: string; expires_at: string }>(
        `select kind, expires_at from oauth_states where state = ?`,
        state,
      )
      .toArray()[0];
    this.sql.exec(`delete from oauth_states where state = ?`, state);
    return r && Date.parse(r.expires_at) > Date.now() ? r.kind : null;
  }

  async connectors(userId: string): Promise<ConnectorRow[]> {
    this.own(userId);
    return this.sql
      .exec<ConnectorRow>(`select kind, sealed, account, connected_at from connectors`)
      .toArray();
  }

  async saveConnector(
    actor: Actor & { userId: string },
    kind: string,
    sealed: string,
    account: string | null,
  ) {
    this.own(actor.userId);
    this.sql.exec(
      `insert into connectors (kind, sealed, account, connected_at) values (?, ?, ?, ?)
       on conflict (kind) do update set sealed = excluded.sealed, account = excluded.account, connected_at = excluded.connected_at`,
      kind,
      sealed,
      account,
      nowIso(),
    );
    // The token itself never goes in the audit log.
    audit(this.sql, actor, {
      action: "connect",
      entityType: "connector",
      entityId: kind,
      after: { account },
    });
  }

  /** A write this person made at a connected service (an event added), in their audit log. */
  async auditConnector(actor: Actor & { userId: string }, kind: string, action: string, after: unknown) {
    this.own(actor.userId);
    audit(this.sql, actor, { action, entityType: "connector", entityId: kind, after });
  }

  /** Forgets a connector; returns what was kept (to revoke it with the service). */
  async removeConnector(actor: Actor & { userId: string }, kind: string): Promise<ConnectorRow | null> {
    this.own(actor.userId);
    const r = this.sql
      .exec<ConnectorRow>(`select kind, sealed, account, connected_at from connectors where kind = ?`, kind)
      .toArray()[0];
    if (!r) return null;
    this.sql.exec(`delete from connectors where kind = ?`, kind);
    audit(this.sql, actor, {
      action: "disconnect",
      entityType: "connector",
      entityId: kind,
      before: { account: r.account },
    });
    return r;
  }

  // --- What the assistant remembers (main chat only) --------------------------------------

  /**
   * What it remembers: everything kept for everywhere, plus what's kept for `spaceId` when
   * one is given (null: the Personal space's chats see only the everywhere ones). With
   * `all`, every memory whatever its space (the memory screen).
   */
  async memories(userId: string, spaceId: string | null = null, all = false): Promise<MemoryRow[]> {
    this.own(userId);
    return this.sql
      .exec<MemoryRow>(
        all
          ? `select id, text, source, created_at, space_id from memories where deleted_at is null order by created_at desc limit ?`
          : `select id, text, source, created_at, space_id from memories
             where deleted_at is null and (space_id is null or space_id is ?) order by created_at desc limit ?`,
        ...(all ? [MAX_MEMORIES] : [spaceId, MAX_MEMORIES]),
      )
      .toArray();
  }

  async remember(
    actor: Actor & { userId: string },
    key: string | null,
    text: string,
    source: string,
    spaceId: string | null = null,
  ): Promise<MemoryRow> {
    this.own(actor.userId);
    const clean = text.trim().replace(/\s+/g, " ");
    const hash = await hashOf(["remember", clean, spaceId]);
    return idempotent(this.ctx.storage, key, hash, () => this.rememberNow(actor, clean, source, spaceId));
  }

  private rememberNow(actor: Actor, clean: string, source: string, spaceId: string | null): MemoryRow {
    const same = this.sql
      .exec<MemoryRow>(
        `select id, text, source, created_at, space_id from memories
         where deleted_at is null and lower(text) = lower(?) and space_id is ?`,
        clean,
        spaceId,
      )
      .toArray()[0];
    if (same) return same;
    const n = this.sql
      .exec<{ n: number }>(`select count(*) as n from memories where deleted_at is null`)
      .one().n;
    if (n >= MAX_MEMORIES)
      throw new ObjectError("conflict", `It remembers up to ${MAX_MEMORIES} things; forget something first`);
    const row: MemoryRow = { id: ulid(), text: clean, source, created_at: nowIso(), space_id: spaceId };
    this.sql.exec(
      `insert into memories (id, text, source, created_at, space_id) values (?, ?, ?, ?, ?)`,
      row.id,
      row.text,
      row.source,
      row.created_at,
      row.space_id,
    );
    audit(this.sql, actor, { action: "remember", entityType: "memory", entityId: row.id, after: row });
    return row;
  }

  async forget(actor: Actor & { userId: string }, key: string | null, id: string): Promise<MemoryRow> {
    this.own(actor.userId);
    const hash = await hashOf(["forget", id]);
    return idempotent(this.ctx.storage, key, hash, () => {
      const r = this.sql
        .exec<MemoryRow>(
          `select id, text, source, created_at, space_id from memories where id = ? and deleted_at is null`,
          id,
        )
        .toArray()[0];
      if (!r) throw new ObjectError("not_found", "Nothing remembered with that id");
      this.sql.exec(`update memories set deleted_at = ? where id = ?`, nowIso(), id);
      audit(this.sql, actor, { action: "forget", entityType: "memory", entityId: id, before: r });
      return r;
    });
  }

  async clear(userId: string): Promise<void> {
    this.own(userId);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`delete from messages`);
      this.sql.exec(`update actions set status = 'cancelled' where status = 'waiting'`);
      setMeta(this.sql, "setup", "0");
      setMeta(this.sql, "summary", "");
      setMeta(this.sql, "summary_upto", "0");
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
        expires_at: string | null;
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
      expires_at: r.expires_at ?? null,
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
          a.status === "waiting" && expired(a) ? "expired" : a.status === "running" ? "waiting" : a.status,
        ...(a.result ? { result: a.result } : {}),
        // A setup still waiting can be changed by hand before Confirm.
        ...(a.status === "waiting" && !expired(a) && EDITABLE_CARDS.has(a.tool)
          ? { args: JSON.parse(a.args_json) as Record<string, unknown>, editable: true }
          : {}),
      };
    }
    return item;
  }
}
