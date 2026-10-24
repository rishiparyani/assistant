// A whole list (owner, 2026-10-13: "Fine, do it", the Gigs screen of the mock-up): every record
// of one collection, its saved views as chips along the top (Coming up, Unpaid, …; nothing is
// made here, chips only switch), grouped by month when the list has a date, each record a
// small card with its date tile, details and pills. Opened from a card's title, the chat's
// "Open list", search, or the All lists page; back is a swipe. Read online, the last copy kept
// on the device for offline; ticks go through the outbox like everywhere else.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Sheet } from "@/components/Sheet";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  CollectionView,
  FieldView,
  FindResult,
  RecordView,
  SavedView,
  StoredValue,
} from "@assistant/shared";
import {
  EditableGrid,
  Text,
  Tick,
  act,
  ACTION_WORDS,
  highlightColour,
  highlightOf,
  shown,
  tint,
} from "@assistant/cards/native";
import { Boundary, Tap } from "@assistant/cards/native";
import { isOffline, request } from "@/api";
import { openChat } from "@/chat-open";
import { Composer } from "@/components/Composer";
import { API_URL } from "@/config";
import { cardFor, setValue, tick } from "@/home";
import { readJson, writeJson } from "@/storage";
import { useLive } from "@/live-socket";
import { outboxState } from "@/outbox";
import { colourFor, radius, useTheme } from "@/theme";
import { ChatAboutSheet } from "@/components/ChatAboutSheet";
import { RecordSheet } from "@/components/RecordSheet";

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
  // `space`: a list in one of the person's own spaces (decision 2026-10-16 "Spaces").
  const params = useLocalSearchParams<{ collection: string; view?: string; space?: string }>();
  const space = params.space || undefined;
  const inSpace = space ? `?space=${enc(space)}` : "";
  const key = `gigspree:list:${space ? `${space}:` : ""}${params.collection}`;
  const [saved, setSaved] = useState<Saved | null>(() => readJson<Saved>(key));
  const [chip, setChip] = useState<string>(params.view ?? "all");
  const [records, setRecords] = useState<RecordView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // A held row: what to do with it; then the chat-about sheet for it.
  const [held, setHeld] = useState<RecordView | null>(null);
  // The list's ⋯ menu: Recently deleted, the plain setup screen (hidden here on purpose,
  // decision 2026-10-15 "Chat makes, screens can fix"), the CSV file on the website.
  const [menu, setMenu] = useState(false);
  const [chatAbout, setChatAbout] = useState<RecordView | null>(null);
  // A row tapped: the record opened (it used to open the chat about it; owner, 2026-10-24).
  const [opened, setOpened] = useState<RecordView | null>(null);

  // The list and its saved views (the chips).
  const loadList = useCallback(async () => {
    try {
      const [cols, views] = await Promise.all([
        request<CollectionView[]>("GET", `/api/collections${inSpace}`),
        request<SavedView[]>("GET", `/api/views${inSpace}`),
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
  }, [params.collection, key, inSpace]);
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
  // Kept by its content: the list's details arriving again (new objects, same query) don't
  // ask for the same records twice.
  const queryText = JSON.stringify({
    filters: current.view?.filters ?? [],
    ...(current.view?.search ? { search: current.view.search } : {}),
    sort: current.view?.sort ?? (dateField ? { field: dateField, dir: "desc" as const } : undefined),
  });
  const query = useMemo(() => JSON.parse(queryText) as Record<string, unknown>, [queryText]);
  const pageKey = `${key}:${current.id}`;
  // The first page this phone kept, and whether more come after it (so a partial copy
  // never shows as the whole count or total).
  const restore = useCallback(() => {
    const kept = readJson<Kept>(pageKey);
    setRecords(kept?.items ?? null);
    setCursor(kept?.next_cursor ?? null);
  }, [pageKey]);
  // By the list's id (or the name it was opened by): the records are asked for at the same time
  // as the list's fields, not after them, and the list's details coming back (a new object)
  // doesn't ask for the same records again (owner, 2026-10-20: "when I open all the lists, it
  // takes some time to open").
  const listId = c?.id ?? params.collection;
  // A view opened by its link waits for its filters (asking early would fetch the wrong rows).
  const viewUnknown = !!params.view && !saved?.views.some((v) => v.id === params.view);
  // Only the newest first-page answer counts: an early one that comes back last mustn't
  // replace the real one (Codex on PR 173).
  const generation = useRef(0);
  const loadPage = useCallback(
    async (after: string | null) => {
      if (!listId || viewUnknown) return;
      const mine = after ? generation.current : ++generation.current;
      try {
        const r = await request<FindResult>("POST", `/api/collections/${enc(listId)}/find`, {
          ...query,
          ...(space ? { space } : {}),
          limit: PAGE,
          ...(after ? { cursor: after } : {}),
        });
        if (mine !== generation.current) return;
        setRecords((prev) => (after ? [...(prev ?? []), ...r.items] : r.items));
        setCursor(r.next_cursor);
        if (!after) writeJson(pageKey, { items: r.items, next_cursor: r.next_cursor });
      } catch (e) {
        if (mine !== generation.current) return;
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
    [listId, viewUnknown, query, pageKey, restore, space],
  );
  useEffect(() => {
    restore();
    void loadPage(null);
  }, [loadPage, restore]);
  // Live: a change elsewhere (another phone, a bandmate) loads the first page again, unless
  // my own changes are still on their way.
  const liveLoad = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLive((m) => {
    if (m.type !== "space_changed" && m.type !== "reconnected") return;
    clearTimeout(liveLoad.current);
    liveLoad.current = setTimeout(() => {
      if (!outboxState().waiting.length) void loadPage(null);
    }, 400);
  });

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

  // The card the ticks go through carries the space, so the outbox sends them there.
  const ticker = useMemo(
    () => (c ? { ...cardFor(c, records ?? [], current.view), ...(space ? { space } : {}) } : null),
    [c, records, current, space],
  );
  const tickField = ticker?.spec.sources[0]?.answer_field ?? null;
  // The sheet (decision 2026-10-15 "Toward Excel", 5): the view's grid columns, or the row
  // layout's fields, or the first few; switched with the button at the top.
  const [sheet, setSheet] = useState<boolean | null>(null);
  const asSheet = sheet ?? current.view?.card?.arrangement === "grid";
  const columns = useMemo(() => {
    if (!c) return [];
    const byId = (id: string) => c.fields.find((f) => f.id === id);
    const chosen = current.view?.card?.grid?.fields.map(byId).filter((f): f is FieldView => !!f) ?? [];
    if (chosen.length) return chosen;
    const title = byId(c.title_field_id);
    const layout = current.view?.card?.row;
    const fromRow = layout ? [...layout.details, ...layout.pills, ...(layout.date ? [layout.date] : [])] : [];
    const rest = fromRow.length
      ? fromRow.map(byId).filter((f): f is FieldView => !!f)
      : c.fields.filter((f) => f.id !== c.title_field_id).slice(0, 6);
    return [...(title ? [title] : []), ...rest.filter((f) => f.id !== c.title_field_id)];
  }, [c, current]);
  const onSetCell = (r: RecordView, fieldId: string, value: StoredValue) => {
    if (!ticker) return;
    const next = setValue(ticker, r, fieldId, value);
    setRecords((prev) => (prev ?? []).map((x) => (x.id === r.id ? next : x)));
    const kept = readJson<Kept>(pageKey);
    if (kept?.items)
      writeJson(pageKey, { ...kept, items: kept.items.map((x) => (x.id === r.id ? next : x)) });
  };
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
  // The chat about this list, or one of its records (the chip says which; decision 2026-10-24
  // "The chat from any screen").
  const chatIn = space ? { space } : {};
  const askRecord = (title: string) => openChat(chatIn, { kind: "record", title, in: c?.name ?? "" });

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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={asSheet ? "Show as a list" : "Show as a sheet"}
            accessibilityState={{ selected: asSheet }}
            onPress={() => setSheet(!asSheet)}
            style={[s.deleted, { backgroundColor: asSheet ? t.fg : t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: asSheet ? t.page : t.fg2, fontSize: 14, fontWeight: "700" }}>
              {asSheet ? "List" : "Sheet"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More"
            onPress={() => setMenu(true)}
            style={[s.deleted, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg2, fontSize: 18, fontWeight: "800", lineHeight: 20 }}>⋯</Text>
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
        {asSheet ? (
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 110 }}
            keyboardShouldPersistTaps="handled"
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
          >
            <View style={[s.sheet, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
              <EditableGrid
                fields={columns}
                records={records ?? []}
                colour={listColour}
                onSet={onSetCell}
                onOpen={(r) => setOpened(r)}
              />
            </View>
            {cursor ? (
              <Pressable accessibilityRole="button" onPress={() => void loadPage(cursor)} style={s.more}>
                <Text style={{ color: t.accent, fontWeight: "700" }}>More</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(x) => x.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 110, gap: 8 }}
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
                <Boundary where="list row">
                  <Row
                    r={item.r}
                    c={c}
                    view={current.view}
                    dateField={dateField}
                    tickField={tickField}
                    colour={listColour}
                    onTick={onTick}
                    onOpen={() => setOpened(item.r)}
                    onHold={() => setHeld(item.r)}
                  />
                </Boundary>
              ) : null
            }
          />
        )}
        <Composer about={{ kind: "list", title: c?.name ?? "this list" }} params={chatIn} />
      </View>
      <Sheet open={menu} onClose={() => setMenu(false)} gap={8} accessibilityLabel="More">
        {[
          {
            label: "Recently deleted",
            run: () => router.push({ pathname: "/trash", params: c ? { collection: c.name } : {} }),
          },
          {
            label: "Fields and cards",
            run: () => router.push({ pathname: "/setup", params: c ? { collection: c.name } : {} }),
          },
          ...(Platform.OS === "web" && c
            ? [
                {
                  label: "Download as CSV",
                  run: () =>
                    void Linking.openURL(
                      `${API_URL}/api/export/${enc(c.name)}.csv${current.view ? `?view=${enc(current.view.id)}` : ""}`,
                    ),
                },
              ]
            : []),
        ].map((x) => (
          <Tap
            key={x.label}
            accessibilityRole="button"
            onPress={() => {
              setMenu(false);
              x.run();
            }}
            scale={0.985}
            style={[s.menuRow, { backgroundColor: t.cell }]}
          >
            <Text style={{ color: t.fg, fontSize: 16, fontWeight: "600" }}>{x.label}</Text>
          </Tap>
        ))}
      </Sheet>
      <Sheet open={!!held} onClose={() => setHeld(null)} gap={8} accessibilityLabel={held?.title}>
        <Text style={[s.menuTitle, { color: t.fg }]} numberOfLines={1}>
          {held?.title}
        </Text>
        {[
          {
            label: "Ask about this",
            run: () => held && c && askRecord(held.title),
          },
          { label: "Chat with people about this", run: () => setChatAbout(held) },
        ].map((x) => (
          <Tap
            key={x.label}
            accessibilityRole="button"
            onPress={() => {
              setHeld(null);
              x.run();
            }}
            scale={0.985}
            style={[s.menuRow, { backgroundColor: t.cell }]}
          >
            <Text style={[s.menuText, { color: t.fg }]}>{x.label}</Text>
          </Tap>
        ))}
      </Sheet>
      <RecordSheet
        record={opened}
        collection={c ?? null}
        onClose={() => setOpened(null)}
        onAsk={() => {
          const r = opened;
          setOpened(null);
          if (r) askRecord(r.title);
        }}
      />
      <ChatAboutSheet
        record={chatAbout}
        onClose={() => setChatAbout(null)}
        onStarted={(id) => {
          setChatAbout(null);
          router.push({ pathname: "/talk", params: { id, tab: "home" } });
        }}
      />
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
  onHold,
}: {
  r: RecordView;
  c: CollectionView;
  view: SavedView | null;
  dateField: string | null;
  tickField: string | null;
  colour: string;
  onTick: (r: RecordView, value: boolean) => void;
  onOpen: () => void;
  /** Held: more things to do with it (chat about it with people). */
  onHold: () => void;
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
  const dateF = dateField ? byId(dateField) : undefined;
  const when = dateF ? shown(dateF, r, dateField) : "";
  const pills = (
    layout?.pills.length ? layout.pills.map(byId) : c.fields.filter((f) => f.type === "money").slice(0, 2)
  )
    .filter((f): f is FieldView => !!f)
    .flatMap((f) => {
      const v = shown(f, r, dateField);
      return v ? [v] : [];
    });
  const calloutF = layout?.callout ? byId(layout.callout.field) : undefined;
  const callout = calloutF ? shown(calloutF, r, dateField) : "";
  const actionF = layout?.action ? byId(layout.action.field) : undefined;
  const action =
    layout?.action && actionF ? { as: layout.action.as, value: shown(actionF, r, dateField) } : null;
  const day = dateField ? istDay(r.values[dateField]) : null;
  const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
  const isToday = day === today;
  const past = !!day && day < today;
  const done = tickField ? r.values[tickField] === true : false;
  // A row that stands out (decision 2026-10-15 "Toward Excel", 4): a coloured edge and a word.
  const hit = highlightOf(c.fields, r, layout?.highlights);
  const hitColour = hit ? highlightColour(hit.colour, t, dark) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hit?.label ? `${hit.label}: ${r.title}` : r.title}
      onPress={onOpen}
      onLongPress={onHold}
      accessibilityHint="Hold for more, like chatting about it with people"
      accessibilityActions={[{ name: "longpress", label: "More" }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === "longpress" && onHold()}
      style={({ pressed }) => [
        s.card,
        { backgroundColor: t.cell, borderColor: t.hair, opacity: pressed ? 0.92 : 1 },
        hitColour
          ? {
              borderLeftWidth: 4,
              borderLeftColor: hitColour,
              backgroundColor: tint(hitColour, dark ? 0.14 : 0.07),
            }
          : null,
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
        {pills.length || hit?.label ? (
          <View style={s.pills}>
            {hit?.label && hitColour ? (
              <Text
                style={[s.pill, { color: hitColour, backgroundColor: tint(hitColour, dark ? 0.2 : 0.12) }]}
              >
                {hit.label}
              </Text>
            ) : null}
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
  menuTitle: { fontSize: 15, fontWeight: "800", paddingHorizontal: 4, paddingBottom: 4 },
  menuRow: { minHeight: 52, borderRadius: 16, justifyContent: "center", paddingHorizontal: 16 },
  menuText: { fontSize: 16, fontWeight: "700" },
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" },
  top: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  deleted: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
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
  // flexShrink 0: on the web the list below would squeeze the chips to a sliver.
  chipRow: { flexGrow: 0, flexShrink: 0, marginTop: 10 },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "700" },
  note: { fontSize: 13, paddingHorizontal: 20, paddingTop: 6 },
  empty: { fontSize: 15, textAlign: "center", paddingTop: 40 },
  sheet: {
    borderRadius: radius.card,
    paddingHorizontal: 4,
    paddingVertical: 6,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  more: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 8 },
  month: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingTop: 10,
    paddingHorizontal: 4,
  },
  // A quiet row (decision 2026-10-22 "The chat reads like Claude's"): a hairline edge, no shadow.
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radius.row,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tile: { width: 50, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tileDow: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  tileDay: { fontSize: 22, fontWeight: "800", letterSpacing: -0.8, lineHeight: 26 },
  words: { flex: 1, minWidth: 0, gap: 3 },
  recTitle: { fontSize: 16, lineHeight: 21, fontWeight: "600", letterSpacing: -0.1 },
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
});
