// Sharing cards (docs/design/universal.md §11): the owner's share links and the cards others
// shared with me.
import type { CreatedShare, ShareAccess, ShareView, SharedCardView, SharedWithMe } from "@assistant/shared";
import { request } from "../api.ts";
import { writeCache } from "../query.svelte.ts";

const enc = encodeURIComponent;

export const SHARED_KEY = "spaces:shared";
export const sharedCardKey = (id: string) => `spaces:shared:${id}`;
export const sharesKey = (recordId: string) => `spaces:shares:${recordId}`;

// online-only: shares are checked by the owner's space when they're made, opened or changed;
// a link or an edit to someone else's card can't wait on this device.
export const sharesApi = {
  list: (recordId: string) => request<ShareView[]>("GET", `/api/shares?record_id=${enc(recordId)}`),
  create: (body: {
    record_id: string;
    include: string[];
    access: ShareAccess;
    hide_fields: string[];
    expires_in_days?: number;
  }) => request<CreatedShare>("POST", "/api/shares", body),
  reset: (shareId: string) => request<CreatedShare>("POST", `/api/shares/${enc(shareId)}/reset`),
  revoke: (shareId: string) => request<{ revoked: string }>("DELETE", `/api/shares/${enc(shareId)}`),
  removePerson: (shareId: string, userId: string) =>
    request<ShareView>("DELETE", `/api/shares/${enc(shareId)}/people/${enc(userId)}`),

  join: (token: string) => request<{ share_id: string; title: string }>("POST", "/api/cards/join", { token }),
  sharedWithMe: () => request<SharedWithMe[]>("GET", "/api/cards"),
  open: (shareId: string) => request<SharedCardView>("GET", `/api/cards/${enc(shareId)}`),
  update: (shareId: string, recordId: string, values: Record<string, unknown>) =>
    request<SharedCardView>("PATCH", `/api/cards/${enc(shareId)}/records/${enc(recordId)}`, { values }),
  add: (shareId: string, section: string, id: string, values: Record<string, unknown>) =>
    request<SharedCardView>("POST", `/api/cards/${enc(shareId)}/records`, { section, id, values }),
  leave: (shareId: string) => request<{ left: string }>("DELETE", `/api/cards/${enc(shareId)}`),
};

/** Cards shared with me open at a gig without a connection. */
export async function saveSharedAhead() {
  const list = await sharesApi.sharedWithMe();
  writeCache(SHARED_KEY, list);
  for (const s of list.slice(0, 30)) writeCache(sharedCardKey(s.share_id), await sharesApi.open(s.share_id));
}
