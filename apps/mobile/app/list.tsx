// A whole list (owner, 2026-10-13: "Fine, do it", the Gigs screen of the mock-up): every record
// of one collection, its saved views as chips along the top (Coming up, Unpaid, …; nothing is
// made here, chips only switch), grouped by month when the list has a date, each record a
// small card with its date tile, details and pills. Opened from a card's title, the chat's
// "Open list", search, or the All lists page; back is a swipe. Read online, the last copy kept
// on the device for offline; ticks go through the outbox like everywhere else.
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CollectionView, FieldView, FindResult, RecordView, SavedView } from "@assistant/shared";
import { Text, Tick, act, ACTION_WORDS, shown, tint } from "@assistant/cards/native";
import { isOffline, request } from "@/api";
import { cardFor, tick } from "@/home";
import { readJson, writeJson } from "@/storage";
import { colourFor, radius, useTheme } from "@/theme";

const enc = encodeURIComponent;
const PAGE = 50;
const IST = 330 * 60_000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

type Chip = { id: string; name: string; view: SavedView | null };
type Saved = { collection: CollectionView; views: SavedView[] };
type Kept = { items?: RecordView[]; next_cursor?: string | null };

/** The India-time day of a date or a stored date-time ("2026-10-13"). */
const istDay = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  if (!v.includes("T")) return v.slice(0, 10);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t + IST).toISOString().slice(0, 10);
};

export default function ListPage() {
  const { t, colour } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ collection: string; view?: string }>();
  const key = `gigspree:list:${params.collection}`;
  const [saved, setSaved] = useState<Saved | null>(() => readJson<Saved>(key));
  const [chip, setChip] = useState<string>(params.view ?? "all");
  const [records, setRecords] = useState<RecordView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // The list and its saved views (the chips).
  const loadList = useCallback(async () => {
    try {
      const [cols, views] = await Promise.all([
        request<CollectionView[]>("GET", "/api/collections"),
        request<SavedView[]>("GET", "/api/views"),
      ]);
      const c = cols.find((x) => x.id === params.collection || x.name === params.collection);
      if (!c) return setNote("This list is gone.");
      const next = { collection: c, views: views.filter((v) => v.collection_id === c.id) };
      setSaved(next);
      writeJson(key, next);
    } catch (e) {
      setNote(
        isOffline(e) ? "Offline: showing what this phone kept." : e instanceof Error ? e.message : String(e),
      );
    }
  }, [params.collection, key]);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  const c = saved?.collection ?? null;
  const chips: Chip[] = useMemo(
    () => [
      { id: "all", name: "All", view: null },
      ...(saved?.views ?? []).map((v) => ({ id: v.id, name: v.name, view: v })),
    ],
    [saved],
  );
  const current = chips.find((x) => x.id === chip) ?? chips[0]!;
  // Grouped on the date the records are sorted by, so each month shows once.
  const sortDate = c?.fields.find(
    (f) => f.id === current.view?.sort?.field && (f.type === "date" || f.type === "datetime"),
  )?.id;
  const dateField =
    sortDate ??
    current.view?.card?.row?.date ??
    c?.fields.find((f) => f.type === "date" || f.type === "datetime")?.id ??
    null;

  // The records of the chosen chip, a page at a time; the first page kept for offline.
  const query = useMemo(() => {
    const v = current.view;
    return {
      filters: v?.filters ?? [],
      ...(v?.search ? { search: v.search } : {}),
      sort: v?.sort ?? (dateField ? { field: dateField, dir: "desc" as const } : undefined),
    };
  }, [current, dateField]);
  const pageKey = `${key}:${current.id}`;
  // The first page this phone kept, and whether more come after it (so a partial copy
  // never shows as the whole count or total).
  const restore = useCallback(() => {
    const kept = readJson<Kept>(pageKey);
    setRecords(kept?.items ?? null);
    setCursor(kept?.next_cursor ?? null);
  }, [pageKey]);
  const loadPage = useCallback(
    async (after: string | null) => {
      if (!c) return;
      try {
        const r = await request<FindResult>("POST", `/api/collections/${enc(c.id)}/find`, {
          ...query,
          limit: PAGE,
          ...(after ? { cursor: after } : {}),
        });
        setRecords((prev) => (after ? [...(prev ?? []), ...r.items] : r.items));
        setCursor(r.next_cursor);
        if (!after) writeJson(pageKey, { items: r.items, next_cursor: r.next_cursor });
      } catch (e) {
        if (!after) restore();
        setNote(
          isOffline(e)
            ? "Offline: showing what this phone kept."
            : e instanceof Error
              ? e.message
              : String(e),
        );
      }
    },
    [c, query, pageKey, restore],
  );
  useEffect(() => {
    restore();
    void loadPage(null);
  }, [loadPage, restore]);

  // Grouped by month (when the list has a date), in the order the records came.
  const rows = useMemo(() => {
    const out: ({ kind: "head"; id: string; label: string } | { kind: "rec"; id: string; r: RecordView })[] =
      [];
    let last = "";
    const count = new Map<string, number>();
    for (const r of records ?? []) {
      const d = dateField ? istDay(r.values[dateField]) : null;
      const m = d ? d.slice(0, 7) : dateField ? "none" : "";
      count.set(m, (count.get(m) ?? 0) + 1);
    }
    for (const r of records ?? []) {
      const d = dateField ? istDay(r.values[dateField]) : null;
      const m = d ? d.slice(0, 7) : dateField ? "none" : "";
      if (dateField && m !== last) {
        const n = count.get(m) ?? 0;
        const label =
          m === "none"
            ? `No date · ${n}`
            : `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4) === new Date().getFullYear().toString() ? "" : m.slice(0, 4) + " "}· ${n}`;
        out.push({ kind: "head", id: `h:${m}`, label });
        last = m;
      }
      out.push({ kind: "rec", id: r.id, r });
    }
    return out;
  }, [records, dateField]);

  const ticker = useMemo(() => (c ? cardFor(c, records ?? [], current.view) : null), [c, records, current]);
  const tickField = ticker?.spec.sources[0]?.answer_field ?? null;
  const onTick = (r: RecordView, value: boolean) => {
    if (!ticker) return;
    const next = tick(ticker, r, value);
    setRecords((prev) => (prev ?? []).map((x) => (x.id === r.id ? next : x)));
    // The kept page too, so reopening the list before the change syncs still shows it.
    const kept = readJson<Kept>(pageKey);
    if (kept?.items)
      writeJson(pageKey, { ...kept, items: kept.items.map((x) => (x.id === r.id ? next : x)) });
  };
  const money = c?.fields.filter((f) => f.type === "money") ?? [];
  const total =
    money[0] && records && !cursor
      ? records.reduce(
          (n, r) => n + (typeof r.values[money[0]!.id] === "number" ? (r.values[money[0]!.id] as number) : 0),
          0,
        )
      : null;
  const listColour = colour(colourFor(c?.name ?? ""));
  const askAbout = (text: string) => router.push({ pathname: "/chat", params: { ask: text } });

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 6 }]}>
      {/* On a tablet or laptop the list keeps a readable column. */}
      <View style={s.column}>
        <View style={s.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={[s.back, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
          </Pressable>
        </View>
        <View style={s.head}>
          <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
            {c?.name ?? "…"}
          </Text>
          <Text style={[s.meta, { color: t.fg2 }]} numberOfLines={1}>
            {records ? `${records.length}${cursor ? "+" : ""}` : ""}
            {total !== null ? ` · ₹${(total / 100).toLocaleString("en-IN")}` : ""}
          </Text>
        </View>
        {chips.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chips}
            style={s.chipRow}
          >
            {chips.map((x) => {
              const on = x.id === current.id;
              return (
                <Pressable
                  key={x.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setChip(x.id)}
                  style={[
                    s.chip,
                    on
                      ? { backgroundColor: t.fg, borderColor: t.fg }
                      : { backgroundColor: t.cell, borderColor: t.fill2 },
                  ]}
                >
                  <Text style={[s.chipText, { color: on ? t.page : t.fg }]}>{x.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {note ? <Text style={[s.note, { color: t.fg2 }]}>{note}</Text> : null}
        <FlatList
          data={rows}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 110, gap: 10 }}
          onEndReached={() => cursor && void loadPage(cursor)}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={t.fg2}
              onRefresh={async () => {
                setRefreshing(true);
                await loadList();
                await loadPage(null);
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            records ? <Text style={[s.empty, { color: t.fg2 }]}>Nothing here yet.</Text> : null
          }
          renderItem={({ item }) =>
            item.kind === "head" ? (
              <Text style={[s.month, { color: t.fg2 }]}>{item.label}</Text>
            ) : c ? (
              <Row
                r={item.r}
                c={c}
                view={current.view}
                dateField={dateField}
                tickField={tickField}
                colour={listColour}
                onTick={onTick}
                onOpen={() => askAbout(`About “${item.r.title}” in ${c.name}: `)}
              />
            ) : null
          }
        />
        <View style={[s.bottom, { paddingBottom: insets.bottom + 10, backgroundColor: t.page }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ask about ${c?.name ?? "this list"}`}
            onPress={() => askAbout(`${c?.name ?? ""}: `)}
            style={[s.bar, { backgroundColor: t.ink, shadowColor: t.shadow }]}
          >
            <Text style={[s.barText, { color: t.onInk }]} numberOfLines={1}>
              Add to {c?.name ?? "this list"} or ask about it…
            </Text>
            <View style={[s.send, { backgroundColor: t.accent }]}>
              <Text style={{ color: t.onAccent, fontSize: 17, fontWeight: "800", lineHeight: 19 }}>↑</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** One record as a small card: tick, date tile, title, details, pills, a note and a button. */
function Row({
  r,
  c,
  view,
  dateField,
  tickField,
  colour,
  onTick,
  onOpen,
}: {
  r: RecordView;
  c: CollectionView;
  view: SavedView | null;
  dateField: string | null;
  tickField: string | null;
  colour: string;
  onTick: (r: RecordView, value: boolean) => void;
  onOpen: () => void;
}) {
  const { t, dark } = useTheme();
  const byId = (id: string) => c.fields.find((f) => f.id === id);
  const layout = view?.card?.row ?? null;
  const plain = (f: FieldView) =>
    f.id !== c.title_field_id && f.id !== dateField && ["text", "choice", "link", "person"].includes(f.type);
  const details = (layout?.details.length ? layout.details.map(byId) : c.fields.filter(plain).slice(0, 2))
    .filter((f): f is FieldView => !!f)
    .map((f) => shown(f, r, dateField))
    .filter(Boolean);
  const when = dateField ? shown(byId(dateField)!, r, dateField) : "";
  const pills = (
    layout?.pills.length ? layout.pills.map(byId) : c.fields.filter((f) => f.type === "money").slice(0, 2)
  )
    .filter((f): f is FieldView => !!f)
    .flatMap((f) => {
      const v = shown(f, r, dateField);
      return v ? [v] : [];
    });
  const callout = layout?.callout ? shown(byId(layout.callout.field)!, r, dateField) : "";
  const action = layout?.action
    ? { as: layout.action.as, value: shown(byId(layout.action.field)!, r, dateField) }
    : null;
  const day = dateField ? istDay(r.values[dateField]) : null;
  const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
  const isToday = day === today;
  const past = !!day && day < today;
  const done = tickField ? r.values[tickField] === true : false;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={r.title}
      onPress={onOpen}
      style={({ pressed }) => [
        s.card,
        { backgroundColor: t.cell, shadowColor: t.shadow, opacity: pressed ? 0.92 : 1 },
      ]}
    >
      {tickField ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={`Done: ${r.title}`}
          hitSlop={10}
          onPress={() => onTick(r, !done)}
        >
          <Tick done={done} />
        </Pressable>
      ) : null}
      {day ? (
        <View
          style={[
            s.tile,
            isToday ? { backgroundColor: t.hero } : { backgroundColor: tint(colour, dark ? 0.18 : 0.1) },
            past && { opacity: 0.55 },
          ]}
        >
          <Text style={[s.tileDow, { color: isToday ? t.onHero : colour }]}>
            {isToday ? "TODAY" : DAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]}
          </Text>
          <Text style={[s.tileDay, { color: isToday ? t.onHero : t.fg }]}>{Number(day.slice(8, 10))}</Text>
        </View>
      ) : null}
      <View style={s.words}>
        <Text
          style={[
            s.recTitle,
            { color: done ? t.fg2 : t.fg, textDecorationLine: done ? "line-through" : "none" },
          ]}
          numberOfLines={2}
        >
          {r.title}
        </Text>
        {details.length || when ? (
          <Text style={[s.details, { color: t.fg2 }]} numberOfLines={1}>
            {[
              ...details,
              ...(when && day
                ? [when.split(" · ").slice(1).join(" · ")].filter(Boolean)
                : when
                  ? [when]
                  : []),
            ].join(" · ")}
          </Text>
        ) : null}
        {pills.length ? (
          <View style={s.pills}>
            {pills.map((p) => (
              <Text
                key={p}
                style={[s.pill, { color: t.warn, backgroundColor: tint(t.warn, dark ? 0.2 : 0.12) }]}
              >
                {p}
              </Text>
            ))}
          </View>
        ) : null}
        {callout ? (
          <Text
            style={[s.callout, { color: t.fg, backgroundColor: tint(t.warn, dark ? 0.16 : 0.08) }]}
            numberOfLines={2}
          >
            {layout?.callout?.label ? (
              <Text style={{ fontWeight: "800" }}>{layout.callout.label}: </Text>
            ) : null}
            {callout}
          </Text>
        ) : null}
      </View>
      {action?.value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${ACTION_WORDS[action.as]}: ${action.value}`}
          onPress={() => act(action.as, action.value)}
          style={[s.action, { backgroundColor: t.accentSoft }]}
        >
          <Text style={[s.actionText, { color: t.accent }]}>{ACTION_WORDS[action.as]}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" },
  top: { paddingHorizontal: 16, paddingBottom: 4 },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 20,
  },
  title: { flexShrink: 1, fontSize: 30, fontWeight: "800", letterSpacing: -1 },
  meta: { fontSize: 13, fontWeight: "700" },
  chipRow: { flexGrow: 0, marginTop: 10 },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "700" },
  note: { fontSize: 13, paddingHorizontal: 20, paddingTop: 6 },
  empty: { fontSize: 15, textAlign: "center", paddingTop: 40 },
  month: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingTop: 10,
    paddingHorizontal: 4,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radius.card - 2,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  tile: { width: 50, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tileDow: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  tileDay: { fontSize: 22, fontWeight: "800", letterSpacing: -0.8, lineHeight: 26 },
  words: { flex: 1, minWidth: 0, gap: 3 },
  recTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  details: { fontSize: 13 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 3 },
  pill: {
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: "hidden",
  },
  callout: { marginTop: 4, padding: 8, borderRadius: 12, overflow: "hidden", fontSize: 13 },
  action: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: "center" },
  actionText: { fontSize: 13, fontWeight: "800" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 8, paddingHorizontal: 16 },
  bar: {
    height: 52,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 18,
    paddingRight: 9,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  barText: { flex: 1, fontSize: 15, fontWeight: "600", opacity: 0.75 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
