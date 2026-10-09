// One person's chat with the assistant ("chat:<user id>", design §10): the messages the
// model sees (including tool calls and results), what the screen shows, confirm cards
// waiting for a tap, and whether a setup is in progress. Only its owner can read it.
import { DurableObject } from "cloudflare:workers";
import { ulid, type ChatItem } from "@assistant/shared";
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
];

export interface StoredMessage extends ChatMessage {
  /** Shown on screen as this role (null: for the model only). */
  shown?: "user" | "assistant" | "card" | "note" | null;
  card_action_id?: string;
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
          created_at: nowIso(),
        };
        this.sql.exec(
          `insert into messages (id, role, content, tool_calls_json, tool_call_id, shown, card_action_id, level, request_key, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          row.role,
          row.content,
          row.tool_calls_json,
          row.tool_call_id,
          row.shown,
          row.card_action_id,
          row.level,
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
