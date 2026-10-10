// Sharing cards (docs/design/universal.md §11): the owner's share links and the cards others
// shared with me.
import type {
  CommentView,
  CreatedShare,
  ShareAccess,
  ShareView,
  SharedFormView,
  SharedListView,
  SharedOpened,
  SharedWithMe,
} from "@assistant/shared";
import { ApiError, request } from "../api.ts";
import { dropCache, writeCache } from "../query.svelte.ts";

const enc = encodeURIComponent;

export const SHARED_KEY = "spaces:shared";
export const sharedCardKey = (id: string) => `spaces:shared:${id}`;
export const sharesKey = (recordId: string) => `spaces:shares:${recordId}`;

// online-only: shares are checked by the owner's space when they're made, opened or changed;
// a link or an edit to someone else's card can't wait on this device.
export const sharesApi = {
  list: (targetId: string) => request<ShareView[]>("GET", `/api/shares?target_id=${enc(targetId)}`),
  create: (body: {
    record_id?: string;
    view?: string;
    form?: string;
    include: string[];
    access: ShareAccess;
    hide_fields: string[];
    public?: boolean;
    expires_in_days?: number;
  }) => request<CreatedShare>("POST", "/api/shares", body),
  reset: (shareId: string) => request<CreatedShare>("POST", `/api/shares/${enc(shareId)}/reset`),
  revoke: (shareId: string) => request<{ revoked: string }>("DELETE", `/api/shares/${enc(shareId)}`),
  removePerson: (shareId: string, userId: string) =>
    request<ShareView>("DELETE", `/api/shares/${enc(shareId)}/people/${enc(userId)}`),

  join: (token: string) => request<{ share_id: string; title: string }>("POST", "/api/cards/join", { token }),
  sharedWithMe: () => request<SharedWithMe[]>("GET", "/api/cards"),
  open: (shareId: string, cursor?: string) =>
    request<SharedOpened>("GET", `/api/cards/${enc(shareId)}${cursor ? `?cursor=${enc(cursor)}` : ""}`),
  update: (shareId: string, recordId: string, values: Record<string, unknown>) =>
    request<SharedOpened>("PATCH", `/api/cards/${enc(shareId)}/records/${enc(recordId)}`, { values }),
  add: (shareId: string, section: string, id: string, values: Record<string, unknown>) =>
    request<SharedOpened>("POST", `/api/cards/${enc(shareId)}/records`, { section, id, values }),
  leave: (shareId: string) => request<{ left: string }>("DELETE", `/api/cards/${enc(shareId)}`),

  comments: (shareId: string, recordId: string) =>
    request<CommentView[]>("GET", `/api/cards/${enc(shareId)}/records/${enc(recordId)}/comments`),
  comment: (shareId: string, recordId: string, id: string, body: string) =>
    request<CommentView>("POST", `/api/cards/${enc(shareId)}/records/${enc(recordId)}/comments`, {
      id,
      body,
    }),

  uncomment: (shareId: string, commentId: string) =>
    request<{ deleted: string }>("DELETE", `/api/cards/${enc(shareId)}/comments/${enc(commentId)}`),

  // Link-only views and forms (no sign-in): the token goes in the body, never the address.
  openLink: (token: string, cursor?: string) =>
    request<SharedListView | SharedFormView>("POST", "/api/link/open", { token, cursor }),
  submitLink: (token: string, id: string, values: Record<string, unknown>) =>
    request<{ id: string }>("POST", "/api/link/submit", { token, id, values }),
};

/** The server says this isn't shared with me (any more): not a connection problem. */
export const noLongerShared = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 403);

/** Cards shared with me open at a gig without a connection. */
export async function saveSharedAhead() {
  const list = await sharesApi.sharedWithMe();
  // Cards no longer shared with me (turned off, or I was removed) leave the device.
  dropCache(`${SHARED_KEY}:`);
  writeCache(SHARED_KEY, list);
  for (const s of list.slice(0, 30)) writeCache(sharedCardKey(s.share_id), await sharesApi.open(s.share_id));
}

// online-only: comments are checked by the space that holds the record.
export const commentsApi = {
  list: (recordId: string) => request<CommentView[]>("GET", `/api/records/${enc(recordId)}/comments`),
  add: (recordId: string, id: string, body: string) =>
    request<CommentView>("POST", `/api/records/${enc(recordId)}/comments`, { id, body }),
  remove: (commentId: string) => request<{ deleted: string }>("DELETE", `/api/comments/${enc(commentId)}`),
};
export const commentsKey = (recordId: string) => `spaces:comments:${recordId}`;
