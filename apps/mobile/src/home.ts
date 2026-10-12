// What the home shows (docs/design/home-first.md §2): pinned cards, each a `card.v1` spec with
// the records it reads. Until cards are saved on the server, every pinned view becomes a card:
// a list with ticks when its collection has a yes/no field, a number when the card is about
// money, a plain list otherwise. Read online, kept on the device for offline, changed through
// the outbox.
import {
  ARRANGEMENT_SIZES,
  CardSpec,
  nowScore,
  type CardSignals,
  type CardSize,
  type CollectionView,
  type FindResult,
  type RecordView,
  type SavedView,
  type StoredValue,
} from "@assistant/shared";
import { request } from "./api.ts";
import { outboxState, send } from "./outbox.ts";
import { readJson, writeJson } from "./storage.ts";
import { colourFor, type CollectionColour } from "./theme.ts";

export interface HomeCard {
  id: string;
  /** The saved view this card shows (its order and size live there). */
  view: SavedView;
  spec: CardSpec;
  collection: CollectionView;
  colour: CollectionColour;
  records: RecordView[];
  total: number | null;
}
export interface HomePage {
  name: string;
  auto?: boolean;
  cards: HomeCard[];
}

// The device copy is per person: another account on the same device never sees it.
const keyFor = (userId: string) => `gigspree:home:${userId}`;
const enc = encodeURIComponent;
const LIST_ROWS = 12;
const MAX_PAGES = 25;

/** All matching records, page by page (a total must count every record, not the first page). */
async function findAll(collectionId: string, query: object, limit: number | null): Promise<RecordView[]> {
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
          size: "s",
          sources: [{ ...base, sum_field: money.id }],
        })
      : CardSpec.parse({ title: v.name, arrangement: "list-plain", size: "m", sources: [base] });
  // The person's size wins when the arrangement can be drawn at it.
  if (v.card_size && sizesFor(spec).includes(v.card_size)) spec.size = v.card_size;
  return spec;
}

/** The sizes this card can be drawn at. */
export const sizesFor = (spec: CardSpec): readonly CardSize[] => ARRANGEMENT_SIZES[spec.arrangement];

function totalOf(spec: CardSpec, records: RecordView[]): number | null {
  const f = spec.sources[0]?.sum_field;
  if (!f) return spec.arrangement === "number" ? records.length : null;
  return records.reduce((n, r) => n + (typeof r.values[f] === "number" ? (r.values[f] as number) : 0), 0);
}

/** Loads the home from the server; falls back to the copy on the device. */
export async function loadHome(userId: string): Promise<HomePage[]> {
  try {
    const [views, collections] = await Promise.all([
      request<SavedView[]>("GET", "/api/views"),
      request<CollectionView[]>("GET", "/api/collections"),
    ]);
    // Changes to views still waiting in the outbox (made offline) win over what the server
    // says until they are sent; otherwise a load would undo them on the screen.
    const waiting = withWaitingViewChanges(views);
    const pinned = waiting.filter((v) => v.pinned).sort((a, b) => a.position - b.position);
    const cards: HomeCard[] = [];
    for (const v of pinned) {
      const c = collections.find((x) => x.id === v.collection_id);
      if (!c) continue;
      const spec = specFor(v, c);
      const src = spec.sources[0]!;
      const query = {
        filters: src.filters ?? [],
        sort: src.sort ?? undefined,
        search: v.search ?? undefined,
      };
      // A number card adds up every matching record; a list shows the first rows.
      const records = await findAll(c.id, query, spec.arrangement === "number" ? null : LIST_ROWS);
      cards.push({
        id: v.id,
        view: v,
        spec,
        collection: c,
        colour: colourFor(c.name),
        records: spec.arrangement === "number" ? records.slice(0, LIST_ROWS) : records,
        total: totalOf(spec, records),
      });
    }
    // Page 1 ("Now") is arranged by the assistant: the cards with something going on, in
    // order of urgency (nowScore); the person's first cards when nothing is. Page 2 ("My day")
    // is the person's: every pinned card, in the order they keep.
    const scored = cards
      .map((c) => ({ c, score: nowScore(signalsOf(c)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
    const now = (scored.length ? scored : cards).slice(0, 4);
    const pages: HomePage[] = [
      { name: "Now", auto: true, cards: now },
      { name: "My day", cards },
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

/** What a card has going on, from the records it shows (dates from its first date field). */
export function signalsOf(c: HomeCard, today = new Date()): CardSignals {
  const done = c.spec.sources[0]?.answer_field;
  const dateField = c.collection.fields.find((f) => f.type === "date" || f.type === "datetime");
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const t0 = day(today);
  const s: CardSignals = { open: 0, overdue: 0, due_today: 0, due_soon: 0, waiting: 0 };
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
  const values: Record<string, StoredValue> = { [field]: value };
  send({
    kind: "spaces.update_record",
    method: "PATCH",
    path: `/api/records/${enc(record.id)}`,
    body: { values },
    label: `${record.title} · ${card.collection.name}`,
  });
  return { ...record, values: { ...record.values, ...values } };
}

/** Keeps the device copy in step with what the screen shows after a change. */
export function rememberHome(userId: string, pages: HomePage[]) {
  writeJson(keyFor(userId), pages);
}

const viewChange = (card: HomeCard, body: object, label: string) =>
  send({
    kind: "spaces.update_view",
    method: "PATCH",
    path: `/api/views/${enc(card.view.id)}`,
    body,
    label: `${label} · ${card.spec.title}`,
  });

/** A new size from the card's menu: drawn at once, saved on the view through the outbox. */
export function resize(card: HomeCard, size: CardSize): HomeCard {
  if (!sizesFor(card.spec).includes(size) || size === card.spec.size) return card;
  viewChange(card, { card_size: size }, "Size");
  return { ...card, view: { ...card.view, card_size: size }, spec: { ...card.spec, size } };
}

/** Takes the card off the home (the view stays; the chat can pin it again). */
export function unpin(card: HomeCard): void {
  viewChange(card, { pinned: false }, "Unpin");
}

/** The order after a drag: each moved card gets its new position (1-based), through the outbox. */
export function saveOrder(cards: HomeCard[]): HomeCard[] {
  return cards.map((card, i) => {
    const position = i + 1;
    if (card.view.position === position) return card;
    viewChange(card, { position }, "Move");
    return { ...card, view: { ...card.view, position } };
  });
}

/** The same card on every page it appears on (Now shows some of My day's cards). */
export function replaceCard(pages: HomePage[], next: HomeCard): HomePage[] {
  return pages.map((p) => ({ ...p, cards: p.cards.map((c) => (c.id === next.id ? next : c)) }));
}
