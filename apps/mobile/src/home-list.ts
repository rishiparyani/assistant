// The Chats home's one list (docs/design/chats-home.md, "What the owner chose" 3): spaces and
// chats together, newest activity first, no sections. A chat whose home is a space is the
// container (docs/design/chats-base.md, step 2): the space folds into the chat's row, which
// shows its lists as chips. A space with several chats (a community, step 5), one with no chat,
// and Personal keep a tile for now. Spaces nothing has happened in yet keep the order they were
// last opened in, after the rest.
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
  /** The chat's home, when it has one: its lists show as chips on the chat's row. */
  space?: SpaceRow;
  /** Questions and forms waiting on me in its home. */
  waiting: number;
}
export type HomeEntry = SpaceEntry | ChatEntry;
export type HomeFilter = "all" | "unread";

/**
 * On me: a question or form shared with me, or a flow's step that asks me and I haven't answered.
 * The rest (a step I started, waiting on others) is shown apart, with Nudge.
 */
export const onMe = (c: HomeCard) => !c.waiting || (!!c.waiting.share_id && c.waiting.mine === null);

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
  const waitingIn = (sp: SpaceRow) =>
    o.needs.filter((c) => {
      if (c.shared || !onMe(c)) return false;
      const at = c.space ?? c.waiting?.space_id;
      return sp.personal ? !at || at === sp.spaceId : at === sp.spaceId;
    }).length;
  // A space that is the home of exactly one of my chats (none started inside it) is that chat's.
  const homeOf = new Map<string, GroupSummary>();
  for (const sp of o.spaces) {
    if (sp.personal) continue;
    const own = o.chats.filter((c) => c.space_id === sp.spaceId);
    if (own.length === 1 && !own[0]!.in_space) homeOf.set(sp.spaceId, own[0]!);
  }
  const ids = new Set(o.spaces.map((sp) => sp.spaceId));
  const spaces: SpaceEntry[] = o.spaces
    .filter((sp) => !homeOf.has(sp.spaceId))
    .map((sp) => {
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
        // A workflow's question names its space on `waiting`; other cards on `space` (none: personal).
        waiting: waitingIn(sp),
        soon: o.upnext.filter((u) => !u.shared && (sp.personal ? !u.space : u.space === sp.spaceId)).length,
      };
    });
  const byId = new Map(o.spaces.map((sp) => [sp.spaceId, sp]));
  const chats: ChatEntry[] = o.chats
    .filter((c) => !c.space_id || !ids.has(c.space_id) || homeOf.get(c.space_id) === c)
    .map((c) => {
      const space = c.space_id && homeOf.get(c.space_id) === c ? byId.get(c.space_id) : undefined;
      return {
        kind: "chat",
        key: `chat:${c.id}`,
        chat: c,
        at: time(c.last?.at ?? c.updated_at),
        ...(space ? { space } : {}),
        waiting: space ? waitingIn(space) : 0,
      };
    });
  // A stable sort: spaces with no activity keep their last-opened order behind the rest.
  return [...spaces, ...chats].sort((a, b) => b.at - a.at);
}

export function filterEntries(list: HomeEntry[], f: HomeFilter): HomeEntry[] {
  if (f === "all") return list;
  return list.filter((e) => (e.kind === "space" ? e.unread > 0 : e.chat.unread > 0));
}

/** A plain match on the name and the last message (the search box's rows, before the rest). */
export function matchEntries(list: HomeEntry[], q: string): HomeEntry[] {
  const n = q.trim().toLowerCase();
  if (!n) return list;
  return list.filter((e) => {
    const name = e.kind === "space" ? e.space.name : e.chat.name;
    const last = e.kind === "space" ? e.last?.text : e.chat.last?.text;
    // A chat's lists are its words too ("Dues" finds the society's chat).
    const lists = e.kind === "chat" ? (e.space?.lists ?? []).map((l) => l.title).join(" ") : "";
    return `${name} ${last ?? ""} ${lists}`.toLowerCase().includes(n);
  });
}

/** The assistant card's line: the next two dated things ("electricity Mon, society meeting Wed"). */
export function watchingWords(upnext: UpNextItem[], words: (u: UpNextItem) => string): string {
  const next = upnext.slice(0, 2).map((u) => `${u.title} ${words(u)}`.trim());
  return next.length ? `Coming up: ${next.join(", ")}` : "Ask, add or arrange anything";
}
