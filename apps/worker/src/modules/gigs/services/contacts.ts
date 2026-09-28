// Address book (docs/design/gig-centric.md §2): my own clients, venues and people, kept in
// my person object. Filled in from gigs I manage, and edited by me.
import type { ContactKind } from "@assistant/shared";
import type { OpUserCtx } from "../../../core/operations.ts";
import type { Actor } from "../../../core/objects/storage.ts";
import { personName } from "../objects/names.ts";

const actorOf = (ctx: OpUserCtx): Actor => ({ userId: ctx.user.id, source: ctx.source });
const me = (ctx: OpUserCtx) => ctx.objects.PEOPLE.getByName(personName(ctx.user.id));

export const findContacts = (ctx: OpUserCtx, q: { kind?: ContactKind; q?: string; limit?: number }) =>
  me(ctx).contacts({ kind: q.kind, search: q.q || undefined, limit: q.limit });

export const saveContact = (
  ctx: OpUserCtx,
  input: {
    kind: ContactKind;
    name: string;
    phone?: string | null;
    email?: string | null;
    city?: string | null;
    notes?: string | null;
  },
) => me(ctx).saveContact(actorOf(ctx), ctx.idempotencyKey, input);

export const updateContact = (
  ctx: OpUserCtx,
  input: {
    contact_id: string;
    name?: string;
    phone?: string | null;
    email?: string | null;
    city?: string | null;
    notes?: string | null;
  },
) => me(ctx).updateContact(actorOf(ctx), ctx.idempotencyKey, input);

export const removeContact = (ctx: OpUserCtx, contactId: string) =>
  me(ctx).removeContact(actorOf(ctx), ctx.idempotencyKey, contactId);
