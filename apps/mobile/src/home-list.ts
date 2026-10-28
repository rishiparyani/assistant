// The Chats home's one list (docs/design/chats-home.md, "What the owner chose" 3): spaces and
// chats together, newest activity first, no sections. A chat whose home is a space folds into
// that space's tile (its last message and unread count are the space's); the rest are chats
// with one person or a group. Spaces nothing has happened in yet keep the order they were last
// opened in, after the rest.
import type { HomeCard } from "@/home";
import type { GroupSummary } from "@/chats";
import type { SpaceRow, UpNextItem } from "@/today";

export interface SpaceEntry {
  kind: "space";
  key: string;
  space: SpaceRow;
  /** The newest message in any of its chats, ms (0: none yet). */
  at: number;
  unread: number;
  last: GroupSummary["last"];
  /** Questions and forms waiting on me in it. */
  waiting: number;
  /** Dated things in it this week. */
  soon: number;
}
export interface ChatEntry {
  kind: "chat";
  key: string;
  chat: GroupSummary;
  at: number;
}
export type HomeEntry = SpaceEntry | ChatEntry;
export type HomeFilter = "all" | "unread" | "spaces" | "chats";

const time = (iso: string | undefined) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(n) ? 0 : n;
};

export function homeEntries(o: {
  spaces: SpaceRow[];
  chats: GroupSummary[];
  needs: HomeCard[];
  upnext: UpNextItem[];
}): HomeEntry[] {
  const ids = new Set(o.spaces.map((sp) => sp.spaceId));
  const spaces: SpaceEntry[] = o.spaces.map((sp) => {
    const own = o.chats.filter((c) => c.space_id === sp.spaceId);
    const newest = own.reduce<GroupSummary | null>(
      (a, c) => (!a || time(c.last?.at ?? c.updated_at) > time(a.last?.at ?? a.updated_at) ? c : a),
      null,
    );
    return {
      kind: "space",
      key: `space:${sp.id}`,
      space: sp,
      at: newest ? time(newest.last?.at ?? newest.updated_at) : 0,
      unread: own.reduce((n, c) => n + c.unread, 0),
      last: newest?.last ?? null,
      waiting: o.needs.filter((c) => !c.shared && (sp.personal ? !c.space : c.space === sp.spaceId)).length,
      soon: o.upnext.filter((u) => !u.shared && (sp.personal ? !u.space : u.space === sp.spaceId)).length,
    };
  });
  const chats: ChatEntry[] = o.chats
    .filter((c) => !c.space_id || !ids.has(c.space_id))
    .map((c) => ({ kind: "chat", key: `chat:${c.id}`, chat: c, at: time(c.last?.at ?? c.updated_at) }));
  // A stable sort: spaces with no activity keep their last-opened order behind the rest.
  return [...spaces, ...chats].sort((a, b) => b.at - a.at);
}

export function filterEntries(list: HomeEntry[], f: HomeFilter): HomeEntry[] {
  if (f === "all") return list;
  if (f === "spaces") return list.filter((e) => e.kind === "space");
  if (f === "chats") return list.filter((e) => e.kind === "chat");
  return list.filter((e) => (e.kind === "space" ? e.unread > 0 : e.chat.unread > 0));
}

/** A plain match on the name and the last message (the search box's rows, before the rest). */
export function matchEntries(list: HomeEntry[], q: string): HomeEntry[] {
  const n = q.trim().toLowerCase();
  if (!n) return list;
  return list.filter((e) => {
    const name = e.kind === "space" ? e.space.name : e.chat.name;
    const last = e.kind === "space" ? e.last?.text : e.chat.last?.text;
    return `${name} ${last ?? ""}`.toLowerCase().includes(n);
  });
}

/** The assistant card's line: the next two dated things ("electricity Mon, society meeting Wed"). */
export function watchingWords(upnext: UpNextItem[], words: (u: UpNextItem) => string): string {
  const next = upnext.slice(0, 2).map((u) => `${u.title} ${words(u)}`.trim());
  return next.length ? `Coming up: ${next.join(", ")}` : "Ask, add or arrange anything";
}
