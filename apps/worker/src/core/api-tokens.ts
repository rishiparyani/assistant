// API tokens for Siri Shortcuts and scripts (T09): made, listed and revoked by a signed-in
// person in Settings (never with a token). Stored as a SHA-256 hash; shown once.
import { z } from "zod";
import {
  ApiTokenRef,
  CreateApiTokenInput,
  ulid,
  type ApiTokenView,
  type CreatedApiTokenView,
} from "@assistant/shared";
import { defineOperation, type OpUserCtx } from "./operations.ts";
import { AppError } from "./errors.ts";
import { hashToken, newToken } from "./tokens.ts";

const MAX_TOKENS = 10;

type Row = { id: string; name: string; scopes: string; created_at: string; last_used_at: string | null };
const view = (r: Row): ApiTokenView => ({
  id: r.id,
  name: r.name,
  scopes: r.scopes.split(" ").filter((s): s is "read" | "write" => s === "read" || s === "write"),
  created_at: r.created_at,
  last_used_at: r.last_used_at,
});

async function listTokens(ctx: OpUserCtx): Promise<ApiTokenView[]> {
  const { results } = await ctx.d1
    .prepare(
      `select id, name, scopes, created_at, last_used_at from access_tokens
       where user_id = ? and kind = 'api' and revoked_at is null order by created_at desc`,
    )
    .bind(ctx.user.id)
    .all<Row>();
  return results.map(view);
}

async function createToken(
  ctx: OpUserCtx,
  input: { name: string; write?: boolean },
): Promise<CreatedApiTokenView> {
  // A retried create can't show the secret again (only its hash is kept): say so.
  if (ctx.idempotencyKey) {
    const same = await ctx.d1
      .prepare(`select id from access_tokens where user_id = ? and kind = 'api' and request_key = ?`)
      .bind(ctx.user.id, ctx.idempotencyKey)
      .first();
    if (same)
      throw new AppError(
        "conflict",
        "This token was already made; revoke it and make a new one if you missed it",
        {
          reason: "already_created",
        },
      );
  }
  if ((await listTokens(ctx)).length >= MAX_TOKENS)
    throw new AppError("conflict", `You can have up to ${MAX_TOKENS} tokens; revoke one first`, {
      reason: "too_many_tokens",
    });
  const token = newToken("ast");
  const id = ulid();
  const now = new Date().toISOString();
  const scopes = input.write ? "read write" : "read";
  await ctx.d1.batch([
    ctx.d1
      .prepare(
        `insert into access_tokens (id, user_id, kind, name, token_hash, scopes, request_key, created_at)
         values (?, ?, 'api', ?, ?, ?, ?, ?)`,
      )
      .bind(id, ctx.user.id, input.name, await hashToken(token), scopes, ctx.idempotencyKey, now),
    ctx.d1
      .prepare(
        `insert into user_audit (id, user_id, source, action, entity_id, detail_json) values (?, ?, ?, 'create_api_token', ?, ?)`,
      )
      .bind(ulid(), ctx.user.id, ctx.source, id, JSON.stringify({ name: input.name, scopes })),
  ]);
  return { ...view({ id, name: input.name, scopes, created_at: now, last_used_at: null }), token };
}

async function revokeToken(ctx: OpUserCtx, tokenId: string): Promise<{ revoked: true }> {
  const res = await ctx.d1
    .prepare(
      `update access_tokens set revoked_at = ? where id = ? and user_id = ? and kind = 'api' and revoked_at is null`,
    )
    .bind(new Date().toISOString(), tokenId, ctx.user.id)
    .run();
  if (!res.meta.changes) {
    const gone = await ctx.d1
      .prepare(`select 1 from access_tokens where id = ? and user_id = ? and kind = 'api'`)
      .bind(tokenId, ctx.user.id)
      .first();
    if (!gone) throw new AppError("not_found", "Token not found");
    return { revoked: true }; // already revoked: same answer
  }
  await ctx.d1
    .prepare(
      `insert into user_audit (id, user_id, source, action, entity_id) values (?, ?, ?, 'revoke_api_token', ?)`,
    )
    .bind(ulid(), ctx.user.id, ctx.source, tokenId)
    .run();
  return { revoked: true };
}

export const apiTokenOperations = [
  defineOperation({
    id: "core.list_api_tokens",
    tool: "list_api_tokens",
    description: "My API tokens (for Siri Shortcuts and scripts).",
    kind: "read",
    sessionOnly: true,
    http: { method: "GET", path: "/me/tokens" },
    input: z.object({}),
    handler: (ctx) => listTokens(ctx),
  }),
  defineOperation({
    id: "core.create_api_token",
    tool: "create_api_token",
    description: "Make an API token; the secret is shown once.",
    kind: "write",
    sessionOnly: true,
    http: { method: "POST", path: "/me/tokens", status: 201 },
    input: CreateApiTokenInput,
    handler: (ctx, input) => createToken(ctx, input),
  }),
  defineOperation({
    id: "core.revoke_api_token",
    tool: "revoke_api_token",
    description: "Revoke an API token; it stops working at once.",
    kind: "write",
    sessionOnly: true,
    confirm: true,
    http: { method: "DELETE", path: "/me/tokens/:token_id" },
    input: ApiTokenRef,
    handler: (ctx, input) => revokeToken(ctx, input.token_id),
  }),
];
