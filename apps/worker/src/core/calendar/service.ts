// Private calendar feed (T08): one secret link per person that calendar apps poll. The
// link is looked up by hash; it's also kept sealed so the settings page can show it again.
import { ulid, type CalendarFeedView } from "@assistant/shared";
import type { OpUserCtx } from "../operations.ts";
import type { ModuleDefinition } from "../module.ts";
import { objectBindings } from "../context.ts";
import { hashToken, newToken } from "../tokens.ts";
import { buildIcs } from "./ics.ts";

type Row = {
  id: string;
  sealed: string | null;
  created_at: string;
  last_used_at: string | null;
  request_key: string | null;
};

const feedUrl = (baseUrl: string, token: string) => `${baseUrl}/api/calendar/${token}.ics`;

async function view(ctx: OpUserCtx, row: Row | null): Promise<CalendarFeedView> {
  if (!row?.sealed)
    return { enabled: false, url: null, webcal_url: null, created_at: null, last_used_at: null };
  const url = feedUrl(ctx.baseUrl, await ctx.sealer.unseal(row.sealed));
  return {
    enabled: true,
    url,
    webcal_url: url.replace(/^https?:/, "webcal:"),
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };
}

const current = (ctx: OpUserCtx) =>
  ctx.d1
    .prepare(
      `select id, sealed, created_at, last_used_at, request_key from access_tokens
       where user_id = ? and kind = 'calendar' and revoked_at is null order by created_at desc limit 1`,
    )
    .bind(ctx.user.id)
    .first<Row>();

/** Audit entry with what changed (link ids only, never the secret) and the request's key. */
const audit = (ctx: OpUserCtx, action: string, entityId: string, detail: Record<string, string | null>) =>
  ctx.d1
    .prepare(
      `insert into user_audit (id, user_id, source, action, entity_id, detail_json, request_key)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(ulid(), ctx.user.id, ctx.source, action, entityId, JSON.stringify(detail), ctx.idempotencyKey);

export async function getCalendarFeed(ctx: OpUserCtx) {
  return view(ctx, await current(ctx));
}

/** Switches the feed on (or returns the existing link); `reset` makes a new link. */
export async function enableCalendarFeed(ctx: OpUserCtx, reset = false) {
  // A retried request returns what the first one made.
  if (ctx.idempotencyKey) {
    const same = await ctx.d1
      .prepare(
        `select id, sealed, created_at, last_used_at, request_key from access_tokens
         where user_id = ? and kind = 'calendar' and request_key = ?`,
      )
      .bind(ctx.user.id, ctx.idempotencyKey)
      .first<Row>();
    if (same) return view(ctx, (await current(ctx)) ?? same);
  }
  const existing = await current(ctx);
  if (existing && !reset) return view(ctx, existing);

  const token = newToken("cal");
  const id = ulid();
  const now = new Date().toISOString();
  await ctx.d1.batch([
    ctx.d1
      .prepare(
        `update access_tokens set revoked_at = ? where user_id = ? and kind = 'calendar' and revoked_at is null`,
      )
      .bind(now, ctx.user.id),
    ctx.d1
      .prepare(
        `insert into access_tokens (id, user_id, kind, name, token_hash, sealed, request_key, created_at)
         values (?, ?, 'calendar', 'Calendar feed', ?, ?, ?, ?)`,
      )
      .bind(id, ctx.user.id, await hashToken(token), await ctx.sealer.seal(token), ctx.idempotencyKey, now),
    audit(ctx, existing ? "reset_calendar_feed" : "enable_calendar_feed", id, {
      before: existing?.id ?? null,
      after: id,
    }),
  ]);
  return view(ctx, await current(ctx));
}

export async function disableCalendarFeed(ctx: OpUserCtx) {
  // A late repeat of this request must not switch off a link made after it.
  if (ctx.idempotencyKey) {
    const done = await ctx.d1
      .prepare(
        `select 1 from user_audit where user_id = ? and request_key = ? and action = 'disable_calendar_feed'`,
      )
      .bind(ctx.user.id, ctx.idempotencyKey)
      .first();
    if (done) return view(ctx, await current(ctx));
  }
  const existing = await current(ctx);
  if (existing) {
    await ctx.d1.batch([
      ctx.d1
        .prepare(
          `update access_tokens set revoked_at = ? where user_id = ? and kind = 'calendar' and revoked_at is null`,
        )
        .bind(new Date().toISOString(), ctx.user.id),
      audit(ctx, "disable_calendar_feed", existing.id, { before: existing.id, after: null }),
    ]);
  }
  return view(ctx, null);
}

const DAY_MS = 86400_000;

/**
 * The feed itself (no sign-in: the link is the key). Unknown or revoked links get 404.
 * Returns null for those so the route can answer without saying why.
 */
export async function calendarFeed(
  env: Env,
  modules: readonly ModuleDefinition[],
  token: string,
): Promise<string | null> {
  if (!/^cal_[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const row = await env.DB.prepare(
    `select id, user_id, last_used_at from access_tokens
     where token_hash = ? and kind = 'calendar' and revoked_at is null`,
  )
    .bind(await hashToken(token))
    .first<{ id: string; user_id: string; last_used_at: string | null }>();
  if (!row) return null;
  // "Last used" is shown in settings; recorded at most once a day (calendar apps poll often).
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > DAY_MS)
    await env.DB.prepare(`update access_tokens set last_used_at = ? where id = ?`)
      .bind(new Date().toISOString(), row.id)
      .run();
  const ctx = { d1: env.DB, objects: objectBindings(env), baseUrl: env.BASE_URL };
  const events = (
    await Promise.all(modules.map((m) => (m.calendar ? m.calendar(ctx, row.user_id) : Promise.resolve([]))))
  ).flat();
  events.sort((a, b) => a.start.localeCompare(b.start));
  return buildIcs("Gigs (Gigspree)", events);
}
