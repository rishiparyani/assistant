// The find language run on records the device already has (design §12 "Offline and sync"),
// with the same meaning as the space object's SQL: filters by field (id, name or alias),
// title-word search, sort with empty values last, newest first by default.
import {
  nameKey,
  normalizeValue,
  periodRange,
  type CollectionView,
  type FieldView,
  type Filter,
  type Period,
  type PersonValue,
  type RecordView,
  type StoredValue,
} from "./spaces.ts";

/** Title words as the server indexes them. */
export const titleWords = (s: string) => [
  ...new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 0)
      .slice(0, 20),
  ),
];

function fieldOf(c: CollectionView, ref: string): FieldView | undefined {
  const k = nameKey(ref);
  return (
    c.fields.find((f) => f.id === ref || nameKey(f.name) === k) ??
    c.fields.find((f) => f.aliases.some((a) => nameKey(a) === k))
  );
}

const NUMERIC = new Set(["number", "money", "boolean"]);

/** The comparable keys of a stored value, as the server's index keeps them. */
function keysOf(f: FieldView, v: StoredValue | undefined): (number | string)[] {
  if (v === null || v === undefined) return [];
  switch (f.type) {
    case "number":
    case "money":
      return [v as number];
    case "boolean":
      return [v ? 1 : 0];
    case "multi_choice":
      return v as string[];
    case "person": {
      const p = v as PersonValue;
      return [p.user_id ? `user:${p.user_id}` : `name:${nameKey(p.name)}`];
    }
    case "text":
    case "long_text":
      return [(v as string).toLowerCase()];
    default:
      return [String(v)];
  }
}

function filterValue(f: FieldView, raw: unknown, userId: string | null): number | string {
  if (f.type === "person") {
    if (raw === "me") return `user:${userId}`;
    return `name:${nameKey(String(raw))}`;
  }
  const v = normalizeValue(f, raw);
  if (v === null) throw new RangeError(`${f.name}: a value is needed`);
  return keysOf(f, Array.isArray(v) ? v[0]! : v)[0]!;
}

function matches(f: FieldView, r: RecordView, flt: Filter, userId: string | null, now: number): boolean {
  if (f.type === "link") {
    const linked = (r.links[f.id] ?? []).map((l) => l.id);
    if (flt.op === "empty") return linked.length === 0;
    if (flt.op === "not_empty") return linked.length > 0;
    const want = (Array.isArray(flt.value) ? flt.value : [flt.value]).map(String);
    return linked.some((id) => want.includes(id));
  }
  const keys = keysOf(f, r.values[f.id]);
  if (flt.op === "empty") return keys.length === 0;
  if (flt.op === "not_empty") return keys.length > 0;
  if (flt.op === "period") {
    const p = periodRange(String(flt.value) as Period, now);
    const [from, to] = f.type === "date" ? [p.fromDate, p.toDate] : [p.from, p.to];
    return keys.some((k) => (!from || String(k) >= from) && (!to || String(k) < to));
  }
  if (flt.op === "contains") {
    const needle = String(flt.value ?? "").toLowerCase();
    return keys.some((k) => String(k).toLowerCase().includes(needle));
  }
  if (flt.op === "in") {
    const list = (Array.isArray(flt.value) ? flt.value : [flt.value]).map((x) => filterValue(f, x, userId));
    return keys.some((k) => list.includes(k));
  }
  const want = filterValue(f, flt.value, userId);
  const cmp = (k: number | string) =>
    NUMERIC.has(f.type)
      ? Number(k) - Number(want)
      : String(k) < String(want)
        ? -1
        : String(k) > String(want)
          ? 1
          : 0;
  switch (flt.op) {
    case "eq":
      return keys.some((k) => cmp(k) === 0);
    case "ne":
      return !keys.some((k) => cmp(k) === 0);
    case "lt":
      return keys.some((k) => cmp(k) < 0);
    case "lte":
      return keys.some((k) => cmp(k) <= 0);
    case "gt":
      return keys.some((k) => cmp(k) > 0);
    case "gte":
      return keys.some((k) => cmp(k) >= 0);
  }
  return false;
}

export interface LocalQuery {
  filters?: Filter[];
  search?: string;
  sort?: { field: string; dir: "asc" | "desc" };
  limit?: number;
}

/** Records of one collection that match the query, in the server's order. */
export function findInRecords(
  c: CollectionView,
  records: RecordView[],
  q: LocalQuery,
  opts: { userId: string | null; now?: number },
): RecordView[] {
  const now = opts.now ?? Date.now();
  const filters = (q.filters ?? []).map((flt) => {
    const f = fieldOf(c, flt.field);
    if (!f) throw new RangeError(`No field "${flt.field}"`);
    return [f, flt] as const;
  });
  const search = titleWords(q.search ?? "").slice(0, 5);
  let out = records.filter(
    (r) =>
      r.collection_id === c.id &&
      filters.every(([f, flt]) => matches(f, r, flt, opts.userId, now)) &&
      (!search.length ||
        search.every((w) => {
          const tw = titleWords(r.title);
          return tw.some((t) => t.startsWith(w));
        })),
  );
  const sortField = q.sort ? fieldOf(c, q.sort.field) : undefined;
  const desc = q.sort?.dir === "desc";
  out = [...out].sort((a, b) => {
    if (!sortField)
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1;
    if (sortField.id === c.title_field_id) {
      const x = nameKey(a.title);
      const y = nameKey(b.title);
      return x !== y ? (x < y ? -1 : 1) * (desc ? -1 : 1) : a.id < b.id ? -1 : 1;
    }
    const ka = keysOf(sortField, a.values[sortField.id])[0];
    const kb = keysOf(sortField, b.values[sortField.id])[0];
    if (ka === undefined || kb === undefined) return ka === undefined ? (kb === undefined ? 0 : 1) : -1;
    const d = NUMERIC.has(sortField.type)
      ? Number(ka) - Number(kb)
      : String(ka) < String(kb)
        ? -1
        : String(ka) > String(kb)
          ? 1
          : 0;
    return d ? d * (desc ? -1 : 1) : a.id < b.id ? -1 : 1;
  });
  return out.slice(0, q.limit ?? 100);
}
