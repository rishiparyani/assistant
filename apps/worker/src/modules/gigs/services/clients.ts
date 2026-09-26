import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { ulid, type ClientView, type GigView, type Page } from "@assistant/shared";
import type { z } from "zod";
import type { CreateClientInput, FindClientsInput, UpdateClientInput } from "@assistant/shared";
import type { OpCtx } from "../../../core/operations.ts";
import { AppError } from "../../../core/errors.ts";
import { clients, gigs } from "../schema.ts";
import { afterCursor, changedFields, contains, nowIso, toPage, updateStatement } from "./shared.ts";
import { gigViewQuery, toGigView } from "./gigs.ts";

type ClientRow = typeof clients.$inferSelect;

export function toClientView(r: ClientRow): ClientView {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    organisation: r.organisation,
    notes: r.notes,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export async function loadClient(ctx: OpCtx, id: string): Promise<ClientRow> {
  const [row] = await ctx.db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.workspaceId, ctx.workspace.id), isNull(clients.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Client not found");
  return row;
}

export async function createClient(
  ctx: OpCtx,
  input: z.output<typeof CreateClientInput>,
): Promise<ClientView> {
  const id = ulid();
  const ts = nowIso();
  const row: ClientRow = {
    id,
    workspaceId: ctx.workspace.id,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    organisation: input.organisation ?? null,
    notes: input.notes ?? null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  await ctx.commit(
    [
      ctx.d1
        .prepare(
          `insert into clients (id, workspace_id, name, phone, email, organisation, notes, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, row.workspaceId, row.name, row.phone, row.email, row.organisation, row.notes, ts, ts),
    ],
    { entityType: "client", entityId: id, after: toClientView(row) },
  );
  return toClientView(row);
}

export async function findClients(
  ctx: OpCtx,
  input: z.output<typeof FindClientsInput>,
): Promise<Page<ClientView>> {
  const nameKey = sql`lower(${clients.name})`;
  const rows = await ctx.db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.workspaceId, ctx.workspace.id),
        isNull(clients.deletedAt),
        input.q
          ? or(
              contains(clients.name, input.q),
              contains(clients.phone, input.q),
              contains(clients.organisation, input.q),
            )
          : undefined,
        afterCursor(nameKey, clients.id, input.cursor),
      ),
    )
    .orderBy(asc(nameKey), asc(clients.id))
    .limit(input.limit + 1);
  return toPage(rows, input.limit, (r) => [r.name.toLowerCase(), r.id], toClientView);
}

export async function updateClient(
  ctx: OpCtx,
  input: z.output<typeof UpdateClientInput>,
): Promise<ClientView> {
  const before = await loadClient(ctx, input.client_id);
  const fields = changedFields(input, {
    name: "name",
    phone: "phone",
    email: "email",
    organisation: "organisation",
    notes: "notes",
  });
  if (!fields.length) return toClientView(before);
  await ctx.commit([updateStatement(ctx.d1, "clients", fields, before.id, ctx.workspace.id)], {
    entityType: "client",
    entityId: before.id,
    before: toClientView(before),
    after: Object.fromEntries(fields),
  });
  return toClientView(await loadClient(ctx, before.id));
}

export async function deleteClient(ctx: OpCtx, clientId: string) {
  const before = await loadClient(ctx, clientId);
  const ts = nowIso();
  await ctx.commit(
    [
      ctx.d1
        .prepare(`update clients set deleted_at = ?, updated_at = ? where id = ? and workspace_id = ?`)
        .bind(ts, ts, before.id, ctx.workspace.id),
    ],
    { entityType: "client", entityId: before.id, before: toClientView(before) },
  );
  return { deleted: true, client: { id: before.id, name: before.name } };
}

/** A client with their gigs, newest first. Balances arrive with payments (T05). */
export async function clientHistory(
  ctx: OpCtx,
  clientId: string,
): Promise<{ client: ClientView; gigs: GigView[] }> {
  const client = await loadClient(ctx, clientId);
  const rows = await gigViewQuery(ctx)
    .where(and(eq(gigs.workspaceId, ctx.workspace.id), eq(gigs.clientId, client.id), isNull(gigs.deletedAt)))
    .orderBy(desc(gigs.startAt), desc(gigs.id))
    .limit(500);
  return { client: toClientView(client), gigs: rows.map(toGigView) };
}
