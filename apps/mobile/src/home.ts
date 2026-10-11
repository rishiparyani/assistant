// What the home shows (docs/design/home-first.md §2): pinned cards, each a `card.v1` spec with
// the records it reads. Until cards are saved on the server, every pinned view becomes a card:
// a list with ticks when its collection has a yes/no field, a number when the card is about
// money, a plain list otherwise. Read online, kept on the device for offline, changed through
// the outbox.
import {
  CardSpec,
  type CollectionView,
  type FindResult,
  type RecordView,
  type SavedView,
  type StoredValue,
} from "@assistant/shared";
import { request } from "./api.ts";
import { send } from "./outbox.ts";
import { readJson, writeJson } from "./storage.ts";
import { colourFor, type CollectionColour } from "./theme.ts";

export interface HomeCard {
  id: string;
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

const KEY = "gigspree:home";
const enc = encodeURIComponent;

const findField = (c: CollectionView, type: string) => c.fields.find((f) => f.type === type);

function specFor(v: SavedView, c: CollectionView): CardSpec {
  const money = findField(c, "money");
  const yesNo = findField(c, "boolean");
  const base = { collection: c.id, filters: v.filters, sort: v.sort ?? null };
  if (yesNo)
    return CardSpec.parse({
      title: v.name,
      arrangement: "list-ticks",
      size: "m",
      sources: [{ ...base, answer_field: yesNo.id }],
    });
  if (money && /spend|spent|total|month|paid|due/i.test(v.name))
    return CardSpec.parse({
      title: v.name,
      arrangement: "number",
      size: "s",
      sources: [{ ...base, sum_field: money.id }],
    });
  return CardSpec.parse({ title: v.name, arrangement: "list-plain", size: "m", sources: [base] });
}

function totalOf(spec: CardSpec, records: RecordView[]): number | null {
  const f = spec.sources[0]?.sum_field;
  if (!f) return spec.arrangement === "number" ? records.length : null;
  return records.reduce((n, r) => n + (typeof r.values[f] === "number" ? (r.values[f] as number) : 0), 0);
}

/** Loads the home from the server; falls back to the copy on the device. */
export async function loadHome(): Promise<HomePage[]> {
  try {
    const [views, collections] = await Promise.all([
      request<SavedView[]>("GET", "/api/views"),
      request<CollectionView[]>("GET", "/api/collections"),
    ]);
    const pinned = views.filter((v) => v.pinned).sort((a, b) => a.position - b.position);
    const cards: HomeCard[] = [];
    for (const v of pinned) {
      const c = collections.find((x) => x.id === v.collection_id);
      if (!c) continue;
      const spec = specFor(v, c);
      const src = spec.sources[0]!;
      const result = await request<FindResult>("POST", `/api/collections/${enc(c.id)}/find`, {
        filters: src.filters ?? [],
        sort: src.sort ?? undefined,
        search: v.search ?? undefined,
        limit: 12,
      });
      cards.push({
        id: v.id,
        spec,
        collection: c,
        colour: colourFor(c.name),
        records: result.items,
        total: totalOf(spec, result.items),
      });
    }
    // Page 1 ("Now") is arranged by the assistant: for now, the cards with something open first.
    const now = [...cards].sort((a, b) => openCount(b) - openCount(a)).slice(0, 4);
    const pages: HomePage[] = [
      { name: "Now", auto: true, cards: now },
      { name: "My day", cards: cards.filter((c) => !now.includes(c)) },
    ];
    writeJson(KEY, pages);
    return pages;
  } catch (e) {
    const saved = readJson<HomePage[]>(KEY);
    if (saved) return saved;
    throw e;
  }
}

const openCount = (c: HomeCard) => {
  const f = c.spec.sources[0]?.answer_field;
  return f ? c.records.filter((r) => r.values[f] !== true).length : c.records.length;
};

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
export function rememberHome(pages: HomePage[]) {
  writeJson(KEY, pages);
}
