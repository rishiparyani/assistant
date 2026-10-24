// What the home shows (docs/design/home-first.md §2): pinned cards, each a `card.v1` spec with
// the records it reads. Until cards are saved on the server, every pinned view becomes a card:
// a list with ticks when its collection has a yes/no field, a number when the card is about
// money, a plain list otherwise. Read online, kept on the device for offline, changed through
// the outbox.
import {
  CARD_VERSION,
  ARRANGEMENT_SIZES,
  CardSpec,
  cardProblems,
  type Arrangement,
  type CardSignals,
  type CardSize,
  DEFAULT_CARD_SIZE,
} from "@assistant/cards";
import { colourFor, type HomeCard } from "@assistant/cards/native";
import {
  findInRecords,
  ulid,
  type ChatCard,
  formatDateIST,
  formatDateTimeIST,
  type CollectionView,
  type GroupView,
  type LiveRef,
  type QueryResult,
  type FindResult,
  type Memory,
  type RecordView,
  type SavedView,
  type SharedOpened,
  type SharedWithMe,
  type SpaceView,
  type StoredValue,
  type WaitingItem,
} from "@assistant/shared";
import { ApiError, request } from "./api.ts";
import { outboxState, send } from "./outbox.ts";
import { readJson, writeJson } from "./storage.ts";

export type { HomeCard };

export interface HomePage {
  name: string;
  /** The page's card keys as arranged (decision 2026-10-16 "A home you arrange"), including any
   * that can't be shown right now; `cards` is what shows. */
  keys: string[];
  cards: HomeCard[];
}

// The device copy is per person: another account on the same device never sees it.
const keyFor = (userId: string) => `gigspree:home:${userId}`;
const catalogKeyFor = (userId: string) => `gigspree:catalog:${userId}`;
const enc = encodeURIComponent;
const LIST_ROWS = 12;
const MAX_PAGES = 25;

/** All matching records, page by page (a total must count every record, not the first page). */
export async function findAll(
  collectionId: string,
  query: object,
  limit: number | null,
): Promise<RecordView[]> {
  const items: RecordView[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const result: FindResult = await request<FindResult>(
      "POST",
      `/api/collections/${enc(collectionId)}/find`,
      {
        ...query,
        limit: Math.min(limit ?? 100, 100),
        ...(cursor ? { cursor } : {}),
      },
    );
    items.push(...result.items);
    cursor = result.next_cursor;
    if (!cursor || (limit !== null && items.length >= limit)) break;
  }
  return items;
}

const findField = (c: CollectionView, type: string) => c.fields.find((f) => f.type === type);

function specFor(v: SavedView, c: CollectionView): CardSpec {
  const money = findField(c, "money");
  const yesNo = findField(c, "boolean");
  const base = { collection: c.id, filters: v.filters, sort: v.sort ?? null };
  const spec = yesNo
    ? CardSpec.parse({
        title: v.name,
        arrangement: "list-ticks",
        size: "m",
        sources: [{ ...base, answer_field: yesNo.id }],
      })
    : money && /spend|spent|total|month|paid|due/i.test(v.name)
      ? CardSpec.parse({
          title: v.name,
          arrangement: "number",
          size: "xs",
          sources: [{ ...base, sum_field: money.id }],
        })
      : CardSpec.parse({ title: v.name, arrangement: "list-plain", size: "m", sources: [base] });
  // A card the person (or the assistant) chose: its arrangement, with the fields it needs
  // picked from the list, when the list has them; and the controls on its rows.
  // Controls and row layouts live on a list's rows: such a card is drawn as a list.
  const LISTS = ["list-plain", "list-ticks", "next"];
  const listRows = !!v.card?.controls.length || !!v.card?.row;
  const wanted =
    listRows && !LISTS.includes(v.card?.arrangement ?? spec.arrangement)
      ? "list-plain"
      : (v.card?.arrangement ?? null);
  const chosen = wanted ? chosenSpec(v, c, wanted) : null;
  const out = chosen ?? spec;
  if (v.card?.controls.length) out.controls = v.card.controls;
  if (v.card?.row) out.row = v.card.row;
  if (v.card?.grid) out.grid = v.card.grid;
  // A designed card (A2UI) takes the whole width and draws itself as tall as it needs.
  if (v.card?.ui) {
    out.size = "l";
    return out;
  }
  // A quick add: full width, as tall as its rows and add box.
  if (v.add_fields?.length) {
    out.size = "l";
    return out;
  }
  // The person's size wins when the arrangement can be drawn at it; else the size that fits
  // the content (a number half width, a list full, a table tall), never one flat default.
  if (v.card_size && sizesFor(out).includes(v.card_size)) out.size = v.card_size;
  else
    out.size = sizesFor(out).includes(DEFAULT_CARD_SIZE[out.arrangement])
      ? DEFAULT_CARD_SIZE[out.arrangement]
      : sizesFor(out)[0]!;
  return out;
}

function chosenSpec(v: SavedView, c: CollectionView, arrangement: Arrangement): CardSpec | null {
  const of = (...types: string[]) => c.fields.find((f) => types.includes(f.type))?.id ?? null;
  const base = { collection: c.id, filters: v.filters, sort: v.sort ?? null };
  const source = {
    ...base,
    sum_field: arrangement === "number" ? of("money", "number") : null,
    answer_field: arrangement === "list-ticks" || arrangement === "progress" ? of("boolean") : null,
    date_field: arrangement === "next" || arrangement === "countdown" ? of("date", "datetime") : null,
  };
  const parsed = CardSpec.safeParse({
    title: v.name,
    arrangement,
    size: ARRANGEMENT_SIZES[arrangement][0],
    sources: [source],
    ...(v.card?.grid ? { grid: v.card.grid } : {}),
  });
  return parsed.success && !cardProblems(parsed.data).length ? parsed.data : null;
}

/** The sizes this card can be drawn at. */
export const sizesFor = (spec: CardSpec): readonly CardSize[] => ARRANGEMENT_SIZES[spec.arrangement];

/** A card for a saved view (its spec from the view) or for a list the chat shows (no view). */
export function cardFor(
  c: CollectionView,
  records: RecordView[],
  view: SavedView | null,
  title?: string,
): HomeCard {
  const spec = view
    ? specFor(view, c)
    : specFor(
        {
          id: `list:${c.id}`,
          name: title ?? c.name,
          collection_id: c.id,
          collection: c.name,
          filters: [],
          search: null,
          sort: null,
          add_fields: [],
          mode: "list",
          pinned: false,
          position: 0,
          card_size: null,
          card: null,
          updated_at: "",
        },
        c,
      );
  return {
    id: view?.id ?? `list:${c.id}:${title ?? ""}`,
    view,
    spec,
    collection: c,
    colour: colourFor(c.name),
    records,
    total: totalOf(spec, records),
  };
}

function totalOf(spec: CardSpec, records: RecordView[]): number | null {
  const f = spec.sources[0]?.sum_field;
  if (!f) return spec.arrangement === "number" ? records.length : null;
  return records.reduce((n, r) => n + (typeof r.values[f] === "number" ? (r.values[f] as number) : 0), 0);
}

/**
 * The soonest records still to come on a dated card (for "Next up"), asked by date: the card's
 * own rows are its first page in its own order, so the soonest may not be among them.
 */
async function upcomingOf(
  c: CollectionView,
  spec: CardSpec,
  query: { filters: unknown[]; search?: string; space?: string },
): Promise<RecordView[] | undefined> {
  const src = spec.sources[0];
  const date =
    spec.row?.date ?? src?.date_field ?? c.fields.find((f) => f.type === "datetime" || f.type === "date")?.id;
  if (!date) return undefined;
  const done = src?.answer_field;
  return request<FindResult>("POST", `/api/collections/${enc(c.id)}/find`, {
    ...(query.space ? { space: query.space } : {}),
    filters: [
      ...query.filters,
      { field: date, op: "period", value: "future" },
      ...(done ? [{ field: done, op: "ne", value: true }] : []),
    ],
    ...(query.search ? { search: query.search } : {}),
    sort: { field: date, dir: "asc" },
    limit: 3,
  })
    .then((r) => r.items)
    .catch(() => undefined);
}

/**
 * A space's pinned views as cards. Without `space`, the person's own; with it, another space
 * they're in (a chat's home), whose requests say which space.
 */
async function cardsFor(
  views: SavedView[],
  collections: CollectionView[],
  space?: string,
): Promise<HomeCard[]> {
  // Changes to views still waiting in the outbox (made offline) win over what the server
  // says until they are sent; otherwise a load would undo them on the screen.
  const known = withWaitingViewChanges(views);
  const pinned = known.filter((v) => v.pinned).sort((a, b) => a.position - b.position);
  const cards: HomeCard[] = [];
  for (const v of pinned) {
    const c = collections.find((x) => x.id === v.collection_id);
    if (!c) continue;
    const spec = specFor(v, c);
    // An answer card: the space works the question out (never the device).
    if (v.card?.question) {
      const answer = await request<QueryResult>("POST", "/api/query", {
        ...(space ? { space } : {}),
        from: c.id,
        where: v.filters,
        ...v.card.question,
        title: v.name,
      }).catch(() => undefined);
      cards.push({ ...answerCard(c, answer, v), spec, ...(space ? { space } : {}) });
      continue;
    }
    const src = spec.sources[0]!;
    const query = {
      ...(space ? { space } : {}),
      filters: src.filters ?? [],
      sort: src.sort ?? undefined,
      search: v.search ?? undefined,
    };
    // A number card adds up every matching record; a list shows the first rows.
    const records = await findAll(c.id, query, spec.arrangement === "number" ? null : LIST_ROWS);
    cards.push({
      ...(space ? { space } : {}),
      id: v.id,
      view: v,
      spec,
      collection: c,
      colour: colourFor(c.name),
      records: spec.arrangement === "number" ? records.slice(0, LIST_ROWS) : records,
      total: totalOf(spec, records),
      upcoming: await upcomingOf(c, spec, query),
    });
  }
  return cards;
}

/** A chat's home (decision 2026-10-14 "A home for each chat"): its pinned cards, read online. */
export async function loadSpaceCards(space: string): Promise<HomeCard[]> {
  const q = `?space=${enc(space)}`;
  const [views, collections] = await Promise.all([
    request<SavedView[]>("GET", `/api/views${q}`),
    request<CollectionView[]>("GET", `/api/collections${q}`),
  ]);
  return cardsFor(views, collections, space);
}

// --- The home you arrange (decision 2026-10-16 "A home you arrange") -----------------------
// Like a phone's home screen: the person's own pages of cards, nothing pre-built. Every list,
// saved view, shared thing and waiting question has a card in the library; a new one lands on
// the last page by itself (it's "seen" from then on), and taking a card off a page leaves it
// in the library. Lists and views are where the data lives; the pages only arrange cards.

/** Something that can be a card, by its key in the layout ("view:p:…", "share:…", "now"). */
export interface CatalogEntry {
  key: string;
  title: string;
  /** The library's group: "Your lists", a space's name, "Shared with you", "Waiting", "From the app". */
  group: string;
  kind: "view" | "list" | "share" | "wait" | "now" | "memory";
  /** A space other than Personal. */
  space?: string;
  view?: SavedView;
  collection?: CollectionView;
  share?: SharedWithMe;
  waiting?: WaitingItem;
}
export interface Catalog {
  entries: CatalogEntry[];
  waiting: WaitingItem[];
  memories: Memory[] | null;
  /** The layout as saved (or still waiting to be sent from this device); null: never arranged. */
  layout: { pages: string[][]; seen: string[] } | null;
  /** Everything answered: keys that are gone can be cleared from the pages. */
  complete: boolean;
  /**
   * The person's spaces with no lists yet: no card can show them, so the library lists them
   * with a way to start (owner, 2026-10-17: a space was made but "I can't see anything").
   */
  emptySpaces: { id: string; name: string }[];
}

const PERSONAL = "p";
const PER_PAGE = 12;

/** Every card the person could have, cheaply: names and where they come from, no rows. */
export async function loadCatalog(): Promise<Catalog> {
  let complete = true;
  const soft = <T>(p: Promise<T>, fallback: T) =>
    p.catch(() => {
      complete = false;
      return fallback;
    });
  const [views, collections, waiting, shares, memories, spaces, groups, saved] = await Promise.all([
    request<SavedView[]>("GET", "/api/views"),
    request<CollectionView[]>("GET", "/api/collections"),
    soft(request<WaitingItem[]>("GET", "/api/waiting"), [] as WaitingItem[]),
    soft(request<SharedWithMe[]>("GET", "/api/cards"), [] as SharedWithMe[]),
    // null: no assistant for this person (or offline): no memory card.
    request<Memory[]>("GET", "/api/memories").catch(() => null),
    soft(request<SpaceView[]>("GET", "/api/spaces"), [] as SpaceView[]),
    soft(request<GroupView[]>("GET", "/api/groups"), [] as GroupView[]),
    request<{ pages: string[][]; seen: string[] } | null>("GET", "/api/me/home"),
  ]);
  const entries: CatalogEntry[] = [{ key: "now", title: "Now", group: "From the app", kind: "now" }];
  if (memories)
    entries.push({ key: "memory", title: "What it remembers", group: "From the app", kind: "memory" });
  const add = (vs: SavedView[], cs: CollectionView[], space: string | undefined, group: string) => {
    const tag = space ?? PERSONAL;
    for (const v of withWaitingViewChanges(vs)) {
      const c = cs.find((x) => x.id === v.collection_id);
      if (c)
        entries.push({
          key: `view:${tag}:${v.id}`,
          title: v.name,
          group,
          kind: "view",
          view: v,
          collection: c,
          ...(space ? { space } : {}),
        });
    }
    // A list nobody made a view of still has its own card: the whole list.
    for (const c of cs)
      if (!vs.some((v) => v.collection_id === c.id))
        entries.push({
          key: `list:${tag}:${c.id}`,
          title: c.name,
          group,
          kind: "list",
          collection: c,
          ...(space ? { space } : {}),
        });
  };
  add(views, collections, undefined, "Your lists");
  // The person's other spaces (not a chat's home: that lives in the chat; not a practice run).
  const chatHomes = new Set(groups.map((g) => g.space_id).filter((x): x is string => !!x));
  const own = spaces.filter((sp) => sp.kind !== "personal" && !chatHomes.has(sp.id) && !sp.practice_of);
  const emptySpaces: { id: string; name: string }[] = [];
  // Every space at once, not one after another (owner, 2026-10-24: the library "takes a long
  // time to load").
  const perSpace = await Promise.all(
    own.slice(0, MAX_PAGES).map((sp) => {
      const q = `?space=${enc(sp.id)}`;
      return Promise.all([
        request<SavedView[]>("GET", `/api/views${q}`),
        request<CollectionView[]>("GET", `/api/collections${q}`),
      ]).catch(() => {
        complete = false;
        return null;
      });
    }),
  );
  own.slice(0, MAX_PAGES).forEach((sp, i) => {
    const got = perSpace[i];
    if (got) add(got[0], got[1], sp.id, sp.name);
    if (got && !got[1].length) emptySpaces.push({ id: sp.id, name: sp.name });
  });
  const fromProcess = new Set(waiting.map((w) => w.share_id).filter((x): x is string => !!x));
  for (const sh of shares)
    if (!fromProcess.has(sh.share_id))
      entries.push({
        key: `share:${sh.share_id}`,
        title: sh.title,
        group: "Shared with you",
        kind: "share",
        share: sh,
      });
  for (const w of waiting)
    entries.push({
      key: `wait:${w.id}`,
      title: `${w.workflow}: ${w.text}`,
      group: "Waiting",
      kind: "wait",
      waiting: w,
    });
  return { entries, waiting, memories, layout: waitingLayout() ?? saved, complete, emptySpaces };
}

/** A layout change made on this device and not sent yet wins over what the server has. */
export function waitingLayout(): { pages: string[][]; seen: string[] } | null {
  const w = [...outboxState().waiting].reverse().find((c) => c.kind === "home.layout");
  return w ? (w.body as { pages: string[][]; seen: string[] }) : null;
}

/** Saves the layout through the outbox (arranging works offline); the latest replaces older ones. */
export function saveLayout(layout: { pages: string[][]; seen: string[] }) {
  send({
    kind: "home.layout",
    method: "PUT",
    path: "/api/me/home",
    body: { pages: layout.pages.filter((p) => p.length).slice(0, 20), seen: layout.seen.slice(-2000) },
    label: "Arrange the home",
  });
}

/** The card for one entry, with its rows (its key is its id). Null when it can't be read now. */
export async function cardOf(e: CatalogEntry, cat: Catalog): Promise<HomeCard | null> {
  const keyed = (c: HomeCard | null) => (c ? { ...c, id: e.key } : null);
  try {
    if (e.kind === "now")
      return {
        id: "now",
        view: null,
        // Tall: the "Next up" card it draws needs the room.
        spec: { version: CARD_VERSION, title: "Now", arrangement: "list-plain", size: "l", sources: [] },
        collection: null,
        colour: colourFor("Now"),
        records: [],
        total: null,
      };
    if (e.kind === "memory") return keyed(cat.memories ? memoryCard(cat.memories) : null);
    if (e.kind === "wait") return keyed(processCard(e.waiting!));
    if (e.kind === "share") {
      const o = await request<SharedOpened>("GET", `/api/cards/${enc(e.share!.share_id)}`);
      return keyed(sharedCard(e.share!, o, cat.waiting));
    }
    if (e.kind === "view")
      return keyed((await cardsFor([{ ...e.view!, pinned: true }], [e.collection!], e.space))[0] ?? null);
    const c = e.collection!;
    const records = await findAll(c.id, e.space ? { space: e.space } : {}, LIST_ROWS);
    return keyed({ ...cardFor(c, records, null), ...(e.space ? { space: e.space } : {}) });
  } catch {
    return null;
  }
}

/**
 * The layout to show: the saved one with what's new added on the last page (and answered
 * questions or gone cards cleared), or, the first time, what the old home showed: Now and the
 * pinned cards on one page (nothing at all for someone new). Saved when it changed.
 */
export function arrange(cat: Catalog): { pages: string[][]; seen: string[] } {
  const keys = new Set(cat.entries.map((e) => e.key));
  if (!cat.layout) {
    const was = cat.entries.filter(
      (e) => (e.kind === "view" && e.view!.pinned && !e.space) || e.kind === "share" || e.kind === "wait",
    );
    const first = was.length ? ["now", ...was.map((e) => e.key)] : [];
    const layout = { pages: first.length ? [first.slice(0, 40)] : [], seen: [...keys] };
    saveLayout(layout);
    return layout;
  }
  const seen = new Set(cat.layout.seen);
  let changed = false;
  // A question that was answered goes; anything else gone goes only when everything was read.
  let pages = cat.layout.pages.map((p) =>
    p.filter((k) => keys.has(k) || (!cat.complete && !k.startsWith("wait:"))),
  );
  if (pages.flat().length !== cat.layout.pages.flat().length) changed = true;
  const fresh = cat.entries.filter((e) => !seen.has(e.key) && e.kind !== "now");
  if (fresh.length) {
    changed = true;
    for (const e of fresh) {
      seen.add(e.key);
      const last = pages[pages.length - 1];
      if (last && last.length < PER_PAGE) last.push(e.key);
      else pages = [...pages, [e.key]];
    }
  }
  pages = pages.filter((p) => p.length);
  // A home with nothing on it while there are cards to show is never right (owner, 2026-10-24:
  // "My home just became empty out of nowhere"): every key was in `seen`, so nothing came back
  // by itself. Put the cards back: the pinned views, shares and questions, else every list.
  if (!pages.some((p) => p.some((k) => k !== "now"))) {
    const back = firstPage(cat);
    if (back.length) {
      pages = [back.slice(0, PER_PAGE)];
      changed = true;
    }
  }
  const layout = { pages, seen: [...seen] };
  if (changed) saveLayout(layout);
  return layout;
}

/** What a home shows when it has to be rebuilt: Now, then what was pinned, shared or asked, else every list. */
function firstPage(cat: Catalog): string[] {
  const was = cat.entries.filter(
    (e) => (e.kind === "view" && e.view!.pinned) || e.kind === "share" || e.kind === "wait",
  );
  const lists = was.length ? was : cat.entries.filter((e) => e.kind === "list" || e.kind === "view");
  return lists.length ? ["now", ...lists.map((e) => e.key)] : [];
}

/** Loads the home: the catalog, the arranged pages, each card with its rows; the device copy offline. */
export async function loadHome(userId: string): Promise<HomePage[]> {
  try {
    const cat = await loadCatalog();
    const layout = arrange(cat);
    // Remembered with the layout as arranged, so the library's saved copy needs no arranging
    // (arranging saves; from a stale copy that could undo a change waiting to be sent, Codex on
    // PR 191).
    rememberCatalog(userId, { ...cat, layout });
    const byKey = new Map(cat.entries.map((e) => [e.key, e]));
    const pages = await Promise.all(
      layout.pages.map(async (keys, i): Promise<HomePage> => {
        const cards = await Promise.all(keys.map((k) => (byKey.has(k) ? cardOf(byKey.get(k)!, cat) : null)));
        return { name: `Page ${i + 1}`, keys, cards: cards.filter((c): c is HomeCard => !!c) };
      }),
    );
    lastSeen = layout.seen;
    // Every list, for the bar's search (it finds lists whether or not they have a card).
    const lists = new Map<string, { id: string; name: string; space?: string; space_name?: string }>();
    for (const e of cat.entries)
      if (e.collection && !lists.has(e.collection.id))
        lists.set(e.collection.id, {
          id: e.collection.id,
          name: e.collection.name,
          ...(e.space ? { space: e.space, space_name: e.group } : {}),
        });
    lastLists = [...lists.values()];
    writeJson(keyFor(userId), pages);
    return pages;
  } catch (e) {
    const saved = readJson<HomePage[]>(keyFor(userId));
    if (saved) return saved;
    throw e;
  }
}

let lastLists: { id: string; name: string; space?: string; space_name?: string }[] = [];
/** Every list the person has (from the last load), for the bar's search. */
export const homeLists = () => lastLists;

/** Every card key the home has shown (kept with the layout when the pages change on screen). */
let lastSeen: string[] = [];
/** Saves the pages as they are on screen now. */
export function savePages(pages: HomePage[]) {
  saveLayout({
    pages: pages.map((p) => p.keys),
    seen: lastSeen.length ? lastSeen : pages.flatMap((p) => p.keys),
  });
}

function withWaitingViewChanges(views: SavedView[]): SavedView[] {
  const byId = new Map(views.map((v) => [v.id, { ...v }]));
  for (const c of outboxState().waiting) {
    if (c.kind !== "spaces.update_view") continue;
    const id = decodeURIComponent(c.path.slice("/api/views/".length));
    const v = byId.get(id);
    if (!v) continue;
    const body = c.body as Partial<Pick<SavedView, "card_size" | "pinned" | "position">>;
    if (body.card_size !== undefined) v.card_size = body.card_size;
    if (body.pinned !== undefined) v.pinned = body.pinned;
    if (body.position !== undefined) v.position = body.position;
  }
  return [...byId.values()];
}

/** One shared thing as a card, or null when it has nothing to show on the home. */
export function sharedCard(share: SharedWithMe, o: SharedOpened, waiting: WaitingItem[]): HomeCard | null {
  const fromProcess = new Set(waiting.map((w) => w.share_id).filter((x): x is string => !!x));
  const base = { share_id: share.share_id, kind: share.kind, access: share.access, owner: share.owner };
  if (o.share.kind === "view" && "records" in o) {
    // A shared list is drawn like one of mine: the share stands in for the collection.
    const fields = o.fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      options: f.options,
      required: f.required,
      aliases: [] as string[],
    }));
    const collection: CollectionView = {
      id: `share:${share.share_id}`,
      name: share.title,
      description: null,
      title_field_id: fields.find((f) => f.type === "text")?.id ?? "",
      fields,
      linked_from: [],
      updated_at: "",
    };
    // The field says whether I may set it: a personal yes/no is mine to answer even on a
    // view-only share, and a plain one is editable only when the share is.
    const tick = o.fields.find((f) => f.type === "boolean" && f.editable);
    const spec: CardSpec = {
      version: CARD_VERSION,
      title: share.title,
      arrangement: tick ? "list-ticks" : "list-plain",
      size: "m",
      sources: [{ collection: collection.id, ...(tick ? { answer_field: tick.id } : {}) }],
    };
    const records = o.records.map((r): RecordView => ({
      id: r.id,
      collection_id: collection.id,
      title: r.title,
      values: Object.fromEntries(r.fields.map((f) => [f.id, f.value])),
      named: Object.fromEntries(r.fields.map((f) => [f.name, f.display])),
      links: {},
      created_at: "",
      updated_at: "",
      version: 0,
    }));
    return {
      id: `share:${share.share_id}`,
      view: null,
      spec,
      collection,
      colour: colourFor(share.title),
      records,
      total: null,
      shared: base,
    };
  } else if (o.share.kind === "card" && "record" in o) {
    return {
      id: `share:${share.share_id}`,
      view: null,
      spec: {
        version: CARD_VERSION,
        title: o.record.title,
        arrangement: "list-plain",
        size: "m",
        sources: [],
      },
      collection: null,
      colour: colourFor(share.title),
      records: [],
      total: null,
      shared: {
        ...base,
        fields: o.record.fields
          .filter((f) => !f.title && f.display !== null && f.display !== "")
          .slice(0, 4)
          .map((f) => ({
            name: f.name,
            display: Array.isArray(f.display) ? f.display.join(", ") : f.display!,
          })),
      },
    };
  } else if (o.share.kind === "question" && "choices" in o) {
    // A process's question is already on the home as the step waiting on me.
    if (fromProcess.has(share.share_id) || o.closed) return null;
    return {
      ...processCard({
        id: share.share_id,
        space_id: "",
        workflow_id: "",
        workflow: `Question from ${share.asked_by ?? share.owner}`,
        record_id: "",
        record: "",
        text: o.text,
        choices: o.choices,
        on: [{ user_id: "me", name: "you", answer: o.mine }],
        asked_at: share.joined_at,
        nudges: 0,
        next_nudge_at: null,
        share_id: share.share_id,
        mine: o.mine,
      }),
      id: `share:${share.share_id}`,
      shared: base,
    };
  } else if (o.share.kind === "form") {
    return {
      id: `share:${share.share_id}`,
      view: null,
      spec: {
        version: CARD_VERSION,
        title: share.title,
        arrangement: "list-plain",
        size: "s",
        sources: [],
      },
      collection: null,
      colour: colourFor(share.title),
      records: [],
      total: null,
      shared: {
        ...base,
        fields: [{ name: `Form from ${share.owner}`, display: "Fill it in on the website" }],
      },
    };
  }
  return null;
}

/**
 * Records pinned to a chat (decision 2026-10-14 "Chat about this"), as cards: each opened
 * through the chat, so everyone in it (the record's owner too) sees what the share shows. One
 * that no longer opens (taken off, or turned off by its owner) is left out.
 */
export async function loadChatCards(groupId: string, pinned: ChatCard[]): Promise<HomeCard[]> {
  const opened = await Promise.all(
    pinned.map((c) =>
      request<SharedOpened>("GET", `/api/groups/${enc(groupId)}/cards/${enc(c.share_id)}`)
        .then((o) => chatCard(c, o))
        // Gone (taken off, turned off): left out. No connection or a server error: the caller
        // says so and keeps what it showed.
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }),
    ),
  );
  return opened.filter((c): c is HomeCard => c !== null);
}

/** A pinned record: its shown fields, then what's linked to it (a set list's songs). */
function chatCard(c: ChatCard, o: SharedOpened): HomeCard | null {
  if (o.share.kind !== "card" || !("record" in o)) return null;
  const text = (d: string | string[] | null) => (Array.isArray(d) ? d.join(", ") : (d ?? ""));
  // Dates in words ("Sat, 12 Dec 2026"), like everywhere else in the app.
  const shown = (f: (typeof o.record.fields)[number]) =>
    (f.type === "date" || f.type === "datetime") && typeof f.value === "string"
      ? f.type === "date"
        ? formatDateIST(f.value)
        : formatDateTimeIST(f.value)
      : text(f.display);
  const fields = [
    ...o.record.fields
      .filter((f) => !f.title && text(f.display) !== "")
      .map((f) => ({ name: f.name, display: shown(f) })),
    ...o.sections.map((x) => ({
      name: x.title,
      display:
        x.records
          .slice(0, 6)
          .map((r) => r.title)
          .join(", ") || "None yet",
    })),
  ].slice(0, 10);
  return {
    id: `chat-card:${c.share_id}`,
    view: null,
    // Large: a pinned record is what the chat is about, so it shows up to eight rows.
    spec: { version: CARD_VERSION, title: o.record.title, arrangement: "list-plain", size: "l", sources: [] },
    collection: null,
    colour: colourFor(o.record.title),
    records: [],
    total: null,
    shared: { share_id: c.share_id, kind: "card", access: o.share.access, owner: c.owner, fields },
  };
}

/** A process step waiting on people, drawn as a card: the question, who, and a way to answer. */
export function processCard(w: WaitingItem): HomeCard {
  return {
    id: `wait:${w.id}`,
    view: null,
    spec: { version: CARD_VERSION, title: w.workflow, arrangement: "process", size: "m", sources: [] },
    collection: null,
    colour: colourFor(w.workflow),
    records: [],
    total: null,
    waiting: w,
  };
}

/** Something on another screen changed what the home shows (a memory forgotten): read again. */
const homeListeners = new Set<() => void>();
export function onHomeChanged(l: () => void): () => void {
  homeListeners.add(l);
  return () => homeListeners.delete(l);
}
export const homeChanged = () => homeListeners.forEach((l) => l());

export function memoryCard(memories: Memory[]): HomeCard {
  return {
    id: "memory",
    view: null,
    spec: {
      version: CARD_VERSION,
      title: "What it remembers",
      arrangement: "memory",
      size: "m",
      sources: [],
    },
    collection: null,
    colour: colourFor("Memory"),
    records: [],
    total: null,
    memory: memories,
  };
}

/** What a card has going on, from the records it shows (dates from its first date field). */
export function signalsOf(c: HomeCard, today = new Date()): CardSignals {
  const s: CardSignals = { open: 0, overdue: 0, due_today: 0, due_soon: 0, waiting: 0 };
  // A process waits on someone: me (my answer is the next step) or people I asked.
  if (c.waiting) return { ...s, waiting: c.waiting.on.some((p) => p.answer === null) ? 1 : 0 };
  if (!c.collection) return s;
  const done = c.spec.sources[0]?.answer_field;
  const dateField = c.collection.fields.find((f) => f.type === "date" || f.type === "datetime");
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const t0 = day(today);
  for (const r of c.records) {
    if (done && r.values[done] === true) continue;
    if (done) s.open++;
    const v = dateField ? r.values[dateField.id] : null;
    if (typeof v !== "string" || !v) continue;
    const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
    if (Number.isNaN(d.getTime())) continue;
    const days = Math.round((day(d) - t0) / 86_400_000);
    if (days < 0) s.overdue++;
    else if (days === 0) s.due_today++;
    else if (days <= 7) s.due_soon++;
  }
  return s;
}

/** A tick on a list-ticks card: shows at once, syncs through the outbox. */
export function tick(card: HomeCard, record: RecordView, value: boolean): RecordView {
  const field = card.spec.sources[0]?.answer_field;
  if (!field) return record;
  return setValue(card, record, field, value);
}

/**
 * Whether a row still belongs on its card after a change (the card's saved filters, run on the
 * device like the server would). A "Paid" button on an "Unpaid" card takes the row off.
 */
export function stillShown(card: HomeCard, record: RecordView, userId: string | null): boolean {
  if (!card.collection || !card.view?.filters.length) return true;
  try {
    return findInRecords(card.collection, [record], { filters: card.view.filters }, { userId }).length > 0;
  } catch {
    return true; // a filter the device can't run: leave the row until the next read
  }
}

/** One field of a record of my own list, changed from a chat card: shown at once, sent through the outbox. */
export function writeValue(
  collection: CollectionView,
  record: RecordView,
  field: string,
  value: StoredValue,
): RecordView {
  const values: Record<string, StoredValue> = { [field]: value };
  send({
    kind: "spaces.update_record",
    method: "PATCH",
    path: `/api/records/${enc(record.id)}`,
    body: { values },
    label: `${record.title} · ${collection.name}`,
  });
  return { ...record, values: { ...record.values, ...values } };
}

/** A control on a card changed one field of a row: shown at once, sent through the outbox. */
export function setValue(card: HomeCard, record: RecordView, field: string, value: StoredValue): RecordView {
  if (!card.collection) return record;
  const values: Record<string, StoredValue> = { [field]: value };
  // A row of a list shared with me goes through the share (the owner's object checks it).
  send(
    card.shared
      ? {
          kind: "spaces.update_shared_record",
          method: "PATCH",
          path: `/api/cards/${enc(card.shared.share_id)}/records/${enc(record.id)}`,
          body: { values },
          label: `${record.title} · ${card.collection.name}`,
        }
      : {
          kind: "spaces.update_record",
          method: "PATCH",
          path: `/api/records/${enc(record.id)}`,
          body: { values, ...(card.space ? { space: card.space } : {}) },
          label: `${record.title} · ${card.collection.name}`,
        },
  );
  return { ...record, values: { ...record.values, ...values } };
}

// online-only: answering a process question and nudging are handled by the space's object
// (the run goes on from there), so they need a connection; the card says so when there is none.
/** My answer to the question a process is waiting on me for. */
export function answerWaiting(w: WaitingItem, answer: string): Promise<unknown> {
  if (!w.share_id) return Promise.reject(new Error("This one isn't waiting on you"));
  return request("POST", `/api/cards/${enc(w.share_id)}/answer`, { answer });
}
/** Asks again, now, the people a process of mine is waiting on. */
export function nudgeWaiting(w: WaitingItem): Promise<WaitingItem> {
  const space = w.space_id ? `?space=${enc(w.space_id)}` : "";
  return request<WaitingItem>("POST", `/api/waiting/${enc(w.id)}/nudge${space}`);
}

/** Keeps the device copy in step with what the screen shows after a change. */
/** The home as it was last shown on this device (offline-first rule 17: shown first, refreshed after). */
export function savedHome(userId: string): HomePage[] | null {
  return readJson<HomePage[]>(keyFor(userId));
}

export function rememberHome(userId: string, pages: HomePage[]) {
  writeJson(keyFor(userId), pages);
}

/**
 * The catalog as this device last loaded it (the home loads it on every open), so the library
 * draws at once from it and refreshes after (offline-first rule 17; owner, 2026-10-24: the
 * library "takes a long time to load").
 */
export function savedCatalog(userId: string): Catalog | null {
  const cat = readJson<Catalog>(catalogKeyFor(userId));
  return cat && Array.isArray(cat.entries) ? cat : null;
}

export function rememberCatalog(userId: string, cat: Catalog) {
  if (cat.complete) writeJson(catalogKeyFor(userId), cat);
}

/**
 * The views on the home as this device last showed it: the chat's "Pin to home" buttons check
 * it, so a card already pinned says so when its chat is opened again.
 */
export function pinnedViews(userId: string | null): SavedView[] {
  if (!userId) return [];
  return (savedHome(userId) ?? []).flatMap((p) => p.cards).flatMap((c) => (c.view ? [c.view] : []));
}

/** The same text for the same content whatever order its keys arrive in (the server stores
 *  a card and may hand it back with its keys in another order). */
export const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;

const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** An answer from the chat that is already on the home: a view asking the same question. */
export function answerPinned(userId: string | null, ref: Extract<LiveRef, { kind: "query" }>): boolean {
  const { from, where, group_by, measures } = ref.query;
  return pinnedViews(userId).some(
    (v) =>
      v.collection === from &&
      !!v.card?.question &&
      same(v.filters ?? [], where ?? []) &&
      same(v.card.question.group_by ?? [], group_by ?? []) &&
      same(v.card.question.measures, measures?.length ? measures : [{ fn: "count" }]),
  );
}

const viewChange = (card: HomeCard, body: object, label: string) =>
  card.view &&
  send({
    kind: "spaces.update_view",
    method: "PATCH",
    path: `/api/views/${enc(card.view.id)}`,
    body,
    label: `${label} · ${card.spec.title}`,
  });

/** A new size from the card's menu: drawn at once, saved on the view through the outbox. */
export function resize(card: HomeCard, size: CardSize): HomeCard {
  if (!card.view || !sizesFor(card.spec).includes(size) || size === card.spec.size) return card;
  viewChange(card, { card_size: size }, "Size");
  return { ...card, view: { ...card.view, card_size: size }, spec: { ...card.spec, size } };
}

/** A card for an answer: a table, or bars when it's one breakdown by one number. */
export function answerCard(
  c: CollectionView,
  answer: QueryResult | undefined,
  view: SavedView | null,
  title?: string,
): HomeCard {
  const groups = answer?.columns.filter((x) => x.kind === "group").length ?? 0;
  const first = answer?.columns.find((x) => x.kind === "measure");
  const kept = view?.card?.arrangement;
  const arrangement: Arrangement =
    kept === "table" || kept === "bars"
      ? kept
      : groups === 1 &&
          first &&
          first.type !== "date" &&
          first.type !== "datetime" &&
          (answer?.rows.length ?? 0) >= 2
        ? "bars"
        : "table";
  const rows = answer?.rows.length ?? 0;
  const size: CardSize =
    view?.card_size && ARRANGEMENT_SIZES[arrangement].includes(view.card_size)
      ? view.card_size
      : rows > 3
        ? "l"
        : "m";
  return {
    id: view?.id ?? `answer:${c.id}:${title ?? answer?.title ?? ""}`,
    view,
    spec: CardSpec.parse({
      title: view?.name ?? title ?? answer?.title ?? c.name,
      arrangement,
      size,
      sources: [{ collection: c.id, filters: view?.filters ?? [] }],
    }),
    collection: c,
    colour: colourFor(c.name),
    records: [],
    total: null,
    answer,
  };
}

/**
 * Keeps an answer from the chat on the home: a saved view of its list and filters whose card
 * asks the same question each time it shows. Through the outbox (made on the device).
 */
export function pinAnswer(ref: Extract<LiveRef, { kind: "query" }>, card: HomeCard): void {
  const { from, where, group_by, measures, sort, limit } = ref.query;
  send({
    kind: "spaces.save_view",
    method: "POST",
    path: "/api/views",
    body: {
      ...(ref.space_id ? { space: ref.space_id } : {}),
      id: ulid(),
      name: ref.title.slice(0, 60),
      collection: from,
      filters: where ?? [],
      pinned: true,
      card_size: card.spec.size,
      card: {
        arrangement: card.spec.arrangement,
        question: {
          group_by: group_by ?? [],
          measures: measures?.length ? measures : [{ fn: "count" }],
          ...(sort ? { sort } : {}),
          ...(limit ? { limit: Math.min(limit, 20) } : {}),
        },
      },
    },
    label: `Pin · ${ref.title}`,
  });
  homeChanged();
}

/** Takes the card off the home (the view stays; the chat can pin it again). */
export function unpin(card: HomeCard): void {
  viewChange(card, { pinned: false }, "Unpin");
}

/** The order after a drag: each moved card gets its new position (1-based), through the outbox. */
export function saveOrder(cards: HomeCard[]): HomeCard[] {
  return cards.map((card, i) => {
    const position = i + 1;
    if (!card.view || card.view.position === position) return card;
    viewChange(card, { position }, "Move");
    return { ...card, view: { ...card.view, position } };
  });
}

/** The same card on every page it appears on (Now shows some of My cards' cards). */
export function replaceCard(pages: HomePage[], next: HomeCard): HomePage[] {
  return pages.map((p) => ({ ...p, cards: p.cards.map((c) => (c.id === next.id ? next : c)) }));
}
