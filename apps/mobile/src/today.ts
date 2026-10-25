// Today (docs/design/from-scratch.md §2.2, FS1): the first screen, sorted by what needs the
// person. Needs you (open questions and forms for me), Up next (records with a date in the
// next seven days, across spaces), then chats and spaces. Nobody arranges it, so it can never go
// blank. Read from the catalogue the library also uses; the device keeps the last copy
// (offline-first rule 17) and shows it first.
import type { CollectionView, RecordView, SpaceView } from "@assistant/shared";
import {
  cardOf,
  findAll,
  loadCatalog,
  rememberCatalog,
  type Catalog,
  type CatalogEntry,
  type HomeCard,
} from "./home.ts";
import { readJson, writeJson } from "./storage.ts";

export interface UpNextItem {
  key: string;
  /** When, in ms; for an all-day date, midnight in India. */
  at: number;
  allDay: boolean;
  title: string;
  /** "Bills · ₹2,340", the list and one other value. */
  sub: string;
  collection: CollectionView;
  record: RecordView;
  /** The space, when not the personal one. */
  space?: string;
  spaceName: string;
  view?: string;
  /** A record on a card shared with me: it has no list of mine to open. */
  shared?: boolean;
}

export interface SpaceList {
  key: string;
  title: string;
  collection: string;
  view?: string;
}

export interface SpaceRow {
  /** "p" for the personal space (the catalogue's key), else the space's id. */
  id: string;
  /** The space's own id, the personal one's too (for its page's calls). */
  spaceId: string;
  name: string;
  personal: boolean;
  lists: SpaceList[];
}

export interface Today {
  /** Process questions waiting on me first, then the rest, then questions and forms shared with me. */
  needs: HomeCard[];
  upnext: UpNextItem[];
  /** Lists and records shared with me, as cards (the only way to open them on the phone). */
  shared: HomeCard[];
  spaces: SpaceRow[];
  /** Every list, for the bar's search. */
  lists: { id: string; name: string; space?: string; space_name?: string }[];
  complete: boolean;
}

const IST = 330 * 60_000;
const DAY = 86_400_000;
/** How many Today shows; the whole week is kept, so a space's page finds its own (Codex, PR 205). */
export const UP_NEXT = 12;
const PER_LIST = 6;

/** The key the catalogue gives the personal space's entries. */
const PERSONAL = "p";

const todayKey = (userId: string) => `gigspree:today:${userId}`;
export const savedToday = (userId: string): Today | null => {
  const t = readJson<Today>(todayKey(userId));
  return t && Array.isArray(t.needs) ? t : null;
};
const rememberToday = (userId: string, t: Today) => {
  if (t.complete) writeJson(todayKey(userId), t);
};

export async function loadToday(userId: string): Promise<Today> {
  const cat = await loadCatalog();
  // The library and the chat's action pills read the same catalogue from the device.
  rememberCatalog(userId, cat);
  const [needs, upnext, shared] = await Promise.all([needsOf(cat), upNextOf(cat), sharedOf(cat)]);
  const spaces = spacesOf(cat);
  const lists = new Map<string, Today["lists"][number]>();
  for (const e of cat.entries)
    if (e.collection && !lists.has(e.collection.id))
      lists.set(e.collection.id, {
        id: e.collection.id,
        name: e.collection.name,
        ...(e.space ? { space: e.space, space_name: e.group } : {}),
      });
  const today: Today = { needs, upnext, shared, spaces, lists: [...lists.values()], complete: cat.complete };
  rememberToday(userId, today);
  return today;
}

/** Questions a process is asking me, then ones waiting on others, then questions and forms shared with me. */
async function needsOf(cat: Catalog): Promise<HomeCard[]> {
  const waits = cat.entries.filter((e) => e.kind === "wait");
  const mine = waits.filter((e) => e.waiting!.share_id);
  const others = waits.filter((e) => !e.waiting!.share_id);
  const shared = cat.entries.filter(
    (e) => e.kind === "share" && (e.share!.kind === "question" || e.share!.kind === "form"),
  );
  const cards = await Promise.all([...mine, ...others, ...shared].map((e) => cardOf(e, cat)));
  return cards.filter((c): c is HomeCard => !!c);
}

/** A record on a shared card, for the record sheet. */
export function sharedItem(card: HomeCard, record: RecordView): UpNextItem {
  return {
    key: `${card.id}:${record.id}`,
    at: 0,
    allDay: true,
    title: record.title,
    sub: card.spec.title,
    collection: card.collection!,
    record,
    spaceName: card.shared?.owner ?? "Shared with you",
    shared: true,
  };
}

/** Lists and records shared with me (questions and forms are in Needs you). */
async function sharedOf(cat: Catalog): Promise<HomeCard[]> {
  const shares = cat.entries.filter(
    (e) => e.kind === "share" && (e.share!.kind === "view" || e.share!.kind === "card"),
  );
  const cards = await Promise.all(shares.map((e) => cardOf(e, cat)));
  return cards.filter((c): c is HomeCard => !!c);
}

/** Records with a date in the next seven days, across every list that has a date, soonest first. */
async function upNextOf(cat: Catalog): Promise<UpNextItem[]> {
  const seen = new Set<string>();
  const sources: { e: CatalogEntry; field: string; type: "date" | "datetime" }[] = [];
  for (const e of cat.entries) {
    const c = e.collection;
    if (!c || seen.has(c.id)) continue;
    const f = c.fields.find((x) => x.type === "datetime") ?? c.fields.find((x) => x.type === "date");
    if (!f) continue;
    seen.add(c.id);
    sources.push({ e, field: f.id, type: f.type as "date" | "datetime" });
  }
  const now = Date.now();
  // Times are stored as UTC ISO text, so "from now on" is a text comparison; a day has no
  // time, so today's all-day records stay (the period starts at today's midnight).
  const fromNow = new Date(now).toISOString();
  const found = await Promise.all(
    sources.map(async ({ e, field, type }) => {
      try {
        const records = await findAll(
          e.collection!.id,
          {
            filters: [
              { field, op: "period", value: "next_7_days" },
              ...(type === "datetime" ? [{ field, op: "gte", value: fromNow }] : []),
            ],
            sort: { field, dir: "asc" },
            ...(e.space ? { space: e.space } : {}),
          },
          PER_LIST,
        );
        return records.flatMap((r): UpNextItem[] => {
          const v = r.values[field];
          if (typeof v !== "string" || !v) return [];
          const allDay = !v.includes("T");
          const at = allDay ? Date.parse(`${v.slice(0, 10)}T00:00:00Z`) - IST : Date.parse(v);
          if (Number.isNaN(at)) return [];
          // Still to come: a day from today on, a time from now on.
          if (allDay ? istDay(at) < istDay(now) : at < now) return [];
          return [
            {
              key: `${e.collection!.id}:${r.id}`,
              at,
              allDay,
              title: r.title,
              sub: subOf(e, r, field),
              collection: e.collection!,
              record: r,
              ...(e.space ? { space: e.space } : {}),
              spaceName: e.space ? e.group : "Personal",
              ...(e.view ? { view: e.view.id } : {}),
            },
          ];
        });
      } catch {
        return [];
      }
    }),
  );
  return found.flat().sort((a, b) => a.at - b.at);
}

const istDay = (ms: number) => Math.floor((ms + IST) / DAY);

/** "Bills · ₹2,340": the list, then the first other value worth a word. */
function subOf(e: CatalogEntry, r: RecordView, dateField: string): string {
  const c = e.collection!;
  const skip = new Set([c.title_field_id, dateField]);
  const extra = c.fields.find((f) => {
    if (skip.has(f.id) || f.type === "long_text" || f.type === "person") return false;
    const v = r.named[f.name];
    return typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) && v.length > 0;
  });
  const v = extra ? r.named[extra.name] : null;
  const words = Array.isArray(v) ? v.join(", ") : v;
  return words ? `${c.name} · ${words}` : c.name;
}

/** Each space with its lists (the personal one first). */
function spacesOf(cat: Catalog): SpaceRow[] {
  const rows: SpaceRow[] = cat.spaces.map((sp: SpaceView) => ({
    id: sp.kind === "personal" ? PERSONAL : sp.id,
    spaceId: sp.id,
    name: sp.kind === "personal" ? "Personal" : sp.name,
    personal: sp.kind === "personal",
    lists: [],
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const e of cat.entries) {
    if (e.kind !== "view" && e.kind !== "list") continue;
    const row = byId.get(e.space ?? PERSONAL);
    if (!row) continue;
    row.lists.push({
      key: e.key,
      title: e.title,
      collection: e.collection!.id,
      ...(e.view ? { view: e.view.id } : {}),
    });
  }
  return rows;
}

/** "Today", "Tomorrow", "Sat 25", with the time for a timed record. */
export function whenWords(item: UpNextItem, now = Date.now()): string {
  const d = istDay(item.at) - istDay(now);
  const t = new Date(item.at + IST);
  const day = d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${DAYS[t.getUTCDay()]} ${t.getUTCDate()}`;
  if (item.allDay) return day;
  const h = t.getUTCHours();
  const m = t.getUTCMinutes();
  const time = `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
  return `${day}, ${time}`;
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The date tile: "SAT" over "25". */
export function tileOf(item: UpNextItem): { dow: string; day: number } {
  const t = new Date(item.at + IST);
  return { dow: DAYS[t.getUTCDay()]!.toUpperCase(), day: t.getUTCDate() };
}

// The switcher (design §4): the three spaces used last sit on Today; the rest are in More.
const recentKey = (userId: string) => `gigspree:today:recent:${userId}`;
export const recentSpaces = (userId: string): string[] => readJson<string[]>(recentKey(userId)) ?? [];
export function touchSpace(userId: string, id: string) {
  if (id === "all") return;
  writeJson(recentKey(userId), [id, ...recentSpaces(userId).filter((x) => x !== id)].slice(0, 8));
}
