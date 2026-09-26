// Turns "client_id or client_name" (and venue) into an id. Never guesses
// (architecture rule 10): a name must match exactly one record, otherwise the
// caller gets candidates to choose from.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { OpCtx } from "../../../core/operations.ts";
import { AppError } from "../../../core/errors.ts";
import { clients, venues } from "../schema.ts";
import { contains } from "./shared.ts";

type Kind = "client" | "venue";
const TABLES = { client: clients, venue: venues } as const;

/** undefined = not given (leave as is), null = clear, string = resolved id. */
export async function resolveRef(
  ctx: OpCtx,
  kind: Kind,
  id: string | null | undefined,
  name: string | undefined,
): Promise<string | null | undefined> {
  if (id !== undefined && name !== undefined) {
    throw new AppError("validation_failed", `Give ${kind}_id or ${kind}_name, not both`);
  }
  const t = TABLES[kind];
  const scope = and(eq(t.workspaceId, ctx.workspace.id), isNull(t.deletedAt));
  if (id === null) return null;
  if (id !== undefined) {
    const [row] = await ctx.db
      .select({ id: t.id })
      .from(t)
      .where(and(scope, eq(t.id, id)))
      .limit(1);
    if (!row) throw new AppError("not_found", `${kind === "client" ? "Client" : "Venue"} not found`);
    return row.id;
  }
  if (name === undefined) return undefined;

  const exact = await ctx.db
    .select({ id: t.id, name: t.name })
    .from(t)
    .where(and(scope, sql`lower(${t.name}) = ${name.toLowerCase()}`))
    .orderBy(asc(t.id))
    .limit(10);
  if (exact.length === 1) return exact[0]!.id;
  const candidates = exact.length
    ? exact
    : await ctx.db
        .select({ id: t.id, name: t.name })
        .from(t)
        .where(and(scope, contains(t.name, name)))
        .orderBy(asc(t.name))
        .limit(10);
  if (candidates.length) {
    throw new AppError(
      "ambiguous",
      exact.length
        ? `More than one ${kind} is called "${name}". Pick one by ${kind}_id.`
        : `No ${kind} is called exactly "${name}". Did you mean one of these? Use its ${kind}_id.`,
      { field: `${kind}_name`, candidates },
    );
  }
  throw new AppError("not_found", `No ${kind} matches "${name}". Create it first (create_${kind}).`, {
    field: `${kind}_name`,
    candidates: [],
  });
}
