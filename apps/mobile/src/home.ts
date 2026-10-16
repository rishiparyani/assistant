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
  nowScore,
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
  auto?: boolean;
  cards: HomeCard[];
  /** The last page: every list the person has, each opening its whole list. */
  lists?: { id: string; name: string }[];
  /** A page that is one of the person's spaces (decision 2026-10-16 "Spaces"): its cards
   * and lists; the bar asks in that space's chat. Absent: Personal's pages. */
  space?: { id: string; name: string; practice?: boolean };
}

// The device copy is per person: another account on the same device never sees it.
const keyFor = (userId: string) => `gigspree:home:${userId}`;
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
        limit: limit ?? 100,
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

/**
 * A page per space of the person's own (decision 2026-10-16 "Spaces"): not Personal (its
 * pages are the home), not a chat's home (that lives on the chat's Home tab). A space that
 * can't be read right now is left out rather than failing the home.
 */
async function loadSpacePages(spaces: SpaceView[], groups: GroupView[]): Promise<HomePage[]> {
  const chatHomes = new Set(groups.map((g) => g.space_id).filter((x): x is string => !!x));
  const own = spaces.filter((sp) => sp.kind !== "personal" && !chatHomes.has(sp.id)).slice(0, MAX_PAGES);
  const pages = await Promise.all(
    own.map(async (sp): Promise<HomePage | null> => {
      try {
        const q = `?space=${enc(sp.id)}`;
        const [views, collections] = await Promise.all([
          request<SavedView[]>("GET", `/api/views${q}`),
          request<CollectionView[]>("GET", `/api/collections${q}`),
        ]);
        return {
          name: sp.name,
          space: { id: sp.id, name: sp.name, practice: !!sp.practice_of },
          cards: await cardsFor(views, collections, sp.id),
          lists: collections.map((c) => ({ id: c.id, name: c.name })),
        };
      } catch {
        return null;
      }
    }),
  );
  return pages.filter((p): p is HomePage => !!p);
}

/** Loads the home from the server; falls back to the copy on the device. */
export async function loadHome(userId: string): Promise<HomePage[]> {
  try {
    const [views, collections, waiting, shares, memories, spaces, groups] = await Promise.all([
      request<SavedView[]>("GET", "/api/views"),
      request<CollectionView[]>("GET", "/api/collections"),
      // What processes are waiting on (mine, and others' on me); the home works without it.
      request<WaitingItem[]>("GET", "/api/waiting").catch(() => [] as WaitingItem[]),
      // What's shared with me: a collaborator's whole home, an owner's third page.
      request<SharedWithMe[]>("GET", "/api/cards").catch(() => [] as SharedWithMe[]),
      // What the assistant remembers (null: no assistant for this person, or offline).
      request<Memory[]>("GET", "/api/memories").catch(() => null),
      // The person's spaces, and the chats whose homes are spaces (those have the Chats screen).
      request<SpaceView[]>("GET", "/api/spaces").catch(() => [] as SpaceView[]),
      request<GroupView[]>("GET", "/api/groups").catch(() => [] as GroupView[]),
    ]);
    const spacePages = await loadSpacePages(spaces, groups);
    const cards = await cardsFor(views, collections);
    // Page 1 ("Now") is arranged by the assistant: the cards with something going on, in
    // order of urgency (nowScore); the person's first cards when nothing is. Page 2 ("My cards")
    // is the person's: every pinned card, in the order they keep.
    const sharedCards = await loadShared(shares, waiting);
    const scored = [...waiting.map(processCard), ...cards, ...sharedCards]
      .map((c) => ({ c, score: nowScore(signalsOf(c)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
    const now = (scored.length ? scored : [...cards, ...sharedCards]).slice(0, 4);
    // Memory is visible (home-first.md §2 point 16): its card ends My cards for anyone with the
    // assistant; it never competes for Now.
    const mine = memories ? [...cards, memoryCard(memories)] : cards;
    const pages: HomePage[] = [
      { name: "Now", auto: true, cards: now },
      // A person with nothing of their own (a collaborator) has no page to arrange.
      ...(mine.length || !sharedCards.length ? [{ name: "My cards", cards: mine }] : []),
      ...(sharedCards.length ? [{ name: "Shared with you", cards: sharedCards }] : []),
      // A page for each space of the person's own (a band, a trip), after Personal's pages.
      ...spacePages,
      // Every list, so one without a card is still a tap away (owner, 2026-10-13).
      ...(collections.length
        ? [
            {
              name: "All lists",
              cards: [],
              lists: collections.map((c) => ({ id: c.id, name: c.name })),
            },
          ]
        : []),
    ];
    writeJson(keyFor(userId), pages);
    return pages;
  } catch (e) {
    const saved = readJson<HomePage[]>(keyFor(userId));
    if (saved) return saved;
    throw e;
  }
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

const SHARED_CARDS = 12;

/**
 * What's shared with me, as cards: lists to tick, records to read, questions to answer. Shares
 * are opened a dozen at a time until a dozen cards can be shown: a question that is closed (its
 * share stays) or already on the home as a process step takes no slot.
 */
async function loadShared(shares: SharedWithMe[], waiting: WaitingItem[]): Promise<HomeCard[]> {
  const out: HomeCard[] = [];
  for (let at = 0; at < shares.length && out.length < SHARED_CARDS; at += SHARED_CARDS) {
    const opened = await Promise.all(
      shares.slice(at, at + SHARED_CARDS).map((share) =>
        request<SharedOpened>("GET", `/api/cards/${enc(share.share_id)}`)
          .then((o) => ({ share, o }))
          .catch(() => null),
      ),
    );
    for (const x of opened) {
      if (!x || out.length >= SHARED_CARDS) break;
      const card = sharedCard(x.share, x.o, waiting);
      if (card) out.push(card);
    }
  }
  return out;
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
        workflow: `Question from ${share.owner}`,
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
