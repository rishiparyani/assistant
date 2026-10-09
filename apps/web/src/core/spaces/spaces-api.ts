// The universal engine from the web app (docs/design/universal.md): typed calls, plus the
// record changes that work offline. No logic here beyond showing a waiting change: values
// are checked with the same shared rules the server uses (`normalizeValue`).
import {
  displayValue,
  formatDateIST,
  formatDateTimeIST,
  normalizeValue,
  ulid,
  type CollectionView,
  type FieldOptions,
  type FieldType,
  type FieldView,
  type Filter,
  type FindResult,
  type LinkedRef,
  type OpenedView,
  type SavedView,
  type Period,
  type RecordView,
  type SpaceView,
  type StoredValue,
} from "@assistant/shared";
import { request } from "../api.ts";
import { applyWith, send, type Change } from "../outbox.svelte.ts";
import { readCache, writeCache } from "../query.svelte.ts";

const enc = encodeURIComponent;

export interface FindQuery {
  filters?: Filter[];
  search?: string;
  sort?: { field: string; dir: "asc" | "desc" };
  limit?: number;
  cursor?: string;
}

export interface FieldSpec {
  name: string;
  type: FieldType;
  options?: FieldOptions & { target?: string | null };
  required?: boolean;
  aliases?: string[];
}

/** Field types as people read them. */
export const TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  money: "Money (₹)",
  date: "Date",
  datetime: "Date and time",
  boolean: "Yes / no",
  choice: "Choice",
  multi_choice: "Several choices",
  person: "Person",
  link: "Link to records",
};

/** Periods as people read them. */
export const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  yesterday: "Yesterday",
  this_week: "This week",
  next_week: "Next week",
  last_week: "Last week",
  this_month: "This month",
  next_month: "Next month",
  last_month: "Last month",
  next_7_days: "Next 7 days",
  last_7_days: "Last 7 days",
  next_30_days: "Next 30 days",
  last_30_days: "Last 30 days",
  past: "Past",
  future: "Upcoming",
};

const OP_LABELS: Record<string, string> = {
  eq: "is",
  ne: "isn't",
  lt: "under",
  lte: "at most",
  gt: "over",
  gte: "at least",
  contains: "has",
  in: "is one of",
  empty: "is empty",
  not_empty: "is filled in",
  period: "is in",
};

/** "Amount at least ₹500", "Date is in this month". */
export function filterLabel(c: CollectionView, f: Filter): string {
  const field = c.fields.find((x) => x.id === f.field);
  const name = field?.name ?? f.field;
  const value =
    f.op === "period"
      ? (PERIOD_LABELS[f.value as Period] ?? String(f.value)).toLowerCase()
      : field?.type === "money" && f.value !== undefined
        ? `₹${String(f.value)}`
        : f.value === undefined
          ? ""
          : String(f.value);
  return [name, OP_LABELS[f.op] ?? f.op, value].filter(Boolean).join(" ");
}

export const spacesApi = {
  spaces: () => request<SpaceView[]>("GET", "/api/spaces"),
  collections: () => request<CollectionView[]>("GET", "/api/collections"),
  collection: (ref: string) => request<CollectionView>("GET", `/api/collections/${enc(ref)}`),
  record: (id: string) => request<RecordView>("GET", `/api/records/${enc(id)}`),
  // online-only: a read sent as POST (filters are JSON); offline, the saved results show.
  find: (collection: string, q: FindQuery = {}, quiet = false) =>
    request<FindResult>("POST", `/api/collections/${enc(collection)}/find`, q, { quiet }),

  // Setups are made at home; records (below) work offline.
  // online-only: a new setup needs the server (names are checked across the space).
  createCollection: (body: { name: string; description?: string | null; fields: FieldSpec[] }) =>
    request<CollectionView>("POST", "/api/collections", body),
  // online-only: changing a setup needs the server.
  updateCollection: (ref: string, body: { name?: string; description?: string | null }) =>
    request<CollectionView>("PATCH", `/api/collections/${enc(ref)}`, body),
  // online-only: changing a setup needs the server.
  addField: (ref: string, field: FieldSpec) =>
    request<CollectionView>("POST", `/api/collections/${enc(ref)}/fields`, { field }),
  // online-only: changing a setup needs the server.
  updateField: (ref: string, field: string, body: Partial<FieldSpec>) =>
    request<CollectionView>("PATCH", `/api/collections/${enc(ref)}/fields/${enc(field)}`, body),
  // online-only: changing a setup needs the server.
  removeField: (ref: string, field: string) =>
    request<CollectionView>("DELETE", `/api/collections/${enc(ref)}/fields/${enc(field)}`),

  views: () => request<SavedView[]>("GET", "/api/views"),
  openView: (id: string, quiet = false) =>
    request<OpenedView>("GET", `/api/views/${enc(id)}`, undefined, { quiet }),
  // online-only: a saved view is part of the setup (names are checked across the space).
  saveView: (body: ViewBody & { name: string; collection: string; pinned?: boolean }) =>
    request<SavedView>("POST", "/api/views", body),
  // online-only: a saved view is part of the setup.
  updateView: (id: string, body: Partial<ViewBody> & { name?: string; pinned?: boolean }) =>
    request<SavedView>("PATCH", `/api/views/${enc(id)}`, body),
  // online-only: a saved view is part of the setup.
  deleteView: (id: string) => request<{ deleted: string }>("DELETE", `/api/views/${enc(id)}`),
};

/** What a saved view keeps: the collection page's filters, search, sort and layout. */
export interface ViewBody {
  filters: Filter[];
  search: string | null;
  sort: { field: string; dir: "asc" | "desc" } | null;
  mode: "list" | "table";
}

export const VIEWS_KEY = "spaces:views";

/** A saved view's query exactly as the collection page builds it (same cache key). */
export function viewQuery(v: Pick<SavedView, "filters" | "search" | "sort">): FindQuery {
  return {
    ...(v.filters.length ? { filters: v.filters } : {}),
    ...(v.search ? { search: v.search } : {}),
    ...(v.sort ? { sort: { field: v.sort.field, dir: v.sort.dir } } : {}),
  };
}
export const viewKey = (id: string) => `spaces:view:${id}`;

// --- Cache keys -----------------------------------------------------------------------------
// A collection's screens share one prefix, so a waiting change shows on all of them.
export const scopeOf = (collectionId: string) => `space:${collectionId}`;
export const listKey = (collectionId: string, q: FindQuery = {}) =>
  `${scopeOf(collectionId)}|list|${JSON.stringify(q)}`;
export const recordKey = (collectionId: string, recordId: string) =>
  `${scopeOf(collectionId)}|record|${recordId}`;
export const COLLECTIONS_KEY = "spaces:collections";

/** The collections saved on this device (for names and fields while offline). */
export const savedCollections = () => readCache<CollectionView[]>(COLLECTIONS_KEY);

/** Saves setups and each collection's first page ahead, so they open offline. */
export async function saveSpacesAhead() {
  const cols = await spacesApi.collections();
  writeCache(COLLECTIONS_KEY, cols);
  for (const c of cols.slice(0, 30)) {
    writeCache(`spaces:collection:${c.id}`, c);
    writeCache(listKey(c.id), await spacesApi.find(c.id, {}, true));
  }
  // Pinned views open offline too.
  const views = await spacesApi.views();
  writeCache(VIEWS_KEY, views);
  for (const v of views.filter((x) => x.pinned).slice(0, 12)) {
    const opened = await spacesApi.openView(v.id, true);
    writeCache(viewKey(v.id), opened);
    // Also where the full view reads it (Open from the pop-up works offline).
    writeCache(listKey(v.collection_id, viewQuery(v)), opened.result);
  }
}

// --- Values on screen -----------------------------------------------------------------------

/** How a stored value reads on screen (dates in India time). */
export function showValue(f: Pick<FieldView, "type">, v: StoredValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (f.type === "date" && typeof v === "string") return formatDateIST(v);
  if (f.type === "datetime" && typeof v === "string") return formatDateTimeIST(v);
  const d = displayValue(f.type, v);
  return Array.isArray(d) ? d.join(", ") : (d ?? "");
}

/** A record's line under its title: its first few filled-in values. */
export function summaryOf(c: CollectionView, r: RecordView, max = 3, skip?: string): string {
  const out: string[] = [];
  for (const f of c.fields) {
    if (f.id === c.title_field_id || f.id === skip || out.length >= max) continue;
    const text =
      f.type === "link"
        ? (r.links[f.id] ?? []).map((l) => l.title).join(", ")
        : f.type === "long_text"
          ? ""
          : showValue(f, r.values[f.id]);
    if (text) out.push(text);
  }
  return out.join(" · ");
}

// --- Record changes (offline first: the outbox sends them, appliers show them) --------------

/** What a form produced: stored values by field id, and links by field id. */
export interface RecordInput {
  values: Record<string, StoredValue>;
  links: Record<string, LinkedRef[]>;
}

/** Checks form values with the shared rules; throws a ValueError with the field's name. */
export function readForm(fields: FieldView[], raw: Record<string, unknown>): Record<string, StoredValue> {
  const out: Record<string, StoredValue> = {};
  for (const f of fields) if (f.type !== "link" && f.id in raw) out[f.id] = normalizeValue(f, raw[f.id]);
  return out;
}

/**
 * The request body: values by field id as the server reads input (money in rupees, as text,
 * so it isn't taken for paise), links as record ids.
 */
const body = (c: CollectionView, input: RecordInput) => ({
  ...Object.fromEntries(
    Object.entries(input.values).map(([k, v]) => [
      k,
      typeof v === "number" && c.fields.find((f) => f.id === k)?.type === "money" ? String(v / 100) : v,
    ]),
  ),
  ...Object.fromEntries(Object.entries(input.links).map(([k, refs]) => [k, refs.map((r) => r.id)])),
});

export function addRecord(c: CollectionView, input: RecordInput, id = ulid()) {
  return send<FindResult | undefined>({
    kind: "spaces.add_record",
    scope: scopeOf(c.id),
    method: "POST",
    path: `/api/collections/${enc(c.id)}/records`,
    body: { id, values: body(c, input) },
    args: { id, collection_id: c.id, title_field_id: c.title_field_id, ...input },
    label: `New in ${c.name}`,
  }).then(() => id);
}

export function updateRecord(c: CollectionView, r: Pick<RecordView, "id" | "title">, input: RecordInput) {
  return send<RecordView | undefined>({
    kind: "spaces.update_record",
    scope: scopeOf(c.id),
    method: "PATCH",
    path: `/api/records/${enc(r.id)}`,
    body: { values: body(c, input) },
    args: { id: r.id, title_field_id: c.title_field_id, ...input },
    label: `${r.title} · ${c.name}`,
  });
}

export function deleteRecord(c: CollectionView, r: Pick<RecordView, "id" | "title">) {
  return send<unknown>({
    kind: "spaces.delete_record",
    scope: scopeOf(c.id),
    method: "DELETE",
    path: `/api/records/${enc(r.id)}`,
    body: undefined,
    args: { id: r.id },
    label: `Delete ${r.title} · ${c.name}`,
  });
}

// --- Appliers -------------------------------------------------------------------------------
type Args = RecordInput & { id: string; collection_id?: string; title_field_id: string };
const isList = (d: unknown): d is FindResult => !!d && typeof d === "object" && "items" in d;
const isRecord = (d: unknown, id: string): d is RecordView =>
  !!d && typeof d === "object" && (d as RecordView).id === id;

function changed(r: RecordView, a: Args, c: Change): RecordView {
  const values = { ...r.values, ...a.values };
  for (const [k, v] of Object.entries(values)) if (v === null) delete values[k];
  const title = values[a.title_field_id];
  return {
    ...r,
    title: typeof title === "string" && title ? title : "Untitled",
    values,
    links: { ...r.links, ...a.links },
    updated_at: new Date(c.at).toISOString(),
    pending: true,
  } as RecordView;
}

/** A list screen showing the whole collection (no filters or search): new records belong there. */
function wholeList(key: string): boolean {
  const q = key.split("|list|")[1];
  if (q === undefined) return false;
  try {
    const query = JSON.parse(q) as FindQuery;
    return !query.filters?.length && !query.search;
  } catch {
    return false;
  }
}

// A new record shows only on unfiltered lists (it may not match a filter; it appears
// everywhere it belongs once synced).
applyWith("spaces.add_record", (data, c, key) => {
  const a = c.args as unknown as Args;
  if (!isList(data) || !wholeList(key) || data.items.some((r) => r.id === a.id)) return data;
  const at = new Date(c.at).toISOString();
  const blank: RecordView = {
    id: a.id,
    collection_id: a.collection_id ?? "",
    title: "",
    values: {},
    named: {},
    links: {},
    created_at: at,
    updated_at: at,
    version: 0,
  };
  return { ...data, items: [changed(blank, a, c), ...data.items] };
});

applyWith("spaces.update_record", (data, c) => {
  const a = c.args as unknown as Args;
  if (isList(data)) return { ...data, items: data.items.map((r) => (r.id === a.id ? changed(r, a, c) : r)) };
  return isRecord(data, a.id) ? changed(data, a, c) : data;
});

applyWith("spaces.delete_record", (data, c) => {
  const id = (c.args as { id: string }).id;
  if (isList(data)) return { ...data, items: data.items.filter((r) => r.id !== id) };
  return isRecord(data, id) ? { ...data, deleted: true } : data;
});

/** Marked by an applier: waiting to sync. */
export const isPending = (r: RecordView) => (r as RecordView & { pending?: boolean }).pending === true;
