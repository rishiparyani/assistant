// A card the assistant designed (decision 2026-10-18 "Try A2UI"): drawn by the A2UI player
// with the app's parts. Paths it names as sources are filled with the records of the person's
// lists, fresh each time it shows; a change made on the card to a record's field (a tick, a
// status picked) saves to that record through the outbox, like any card's control.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core";
import { A2uiSurface, A2UI_PARTS, Tap, Text, type } from "@assistant/cards/native";
import { cardMessages, makeCatalog, type A2Card } from "@assistant/cards/a2ui";
import {
  nameKey,
  ulid,
  type CollectionView,
  type FieldView,
  type LiveRef,
  type RecordView,
  type SavedView,
  type StoredValue,
} from "@assistant/shared";
import { isOffline, request } from "../api.ts";
import { send } from "../outbox.ts";
import { findAll, homeChanged } from "../home.ts";
import { readJson, writeJson } from "../storage.ts";
import { useTheme } from "../theme.ts";

type UiRef = Extract<LiveRef, { kind: "ui" }>;
const enc = encodeURIComponent;
/** At most this many records fill one path (a card, not a full list). */
const MAX_ITEMS = 200;

/** The fields a card may change on a record: plain values the person could type. */
const writable = (f: FieldView) =>
  ["text", "long_text", "number", "money", "date", "datetime", "boolean", "choice"].includes(f.type) &&
  !(f.options as { formula?: unknown; personal?: unknown }).formula &&
  !(f.options as { personal?: unknown }).personal;

/** A record as one item of a card's data: its id, its title, and each field by name. */
function itemOf(c: CollectionView, r: RecordView): Record<string, unknown> {
  const item: Record<string, unknown> = { id: r.id, title: r.title };
  for (const f of c.fields) {
    if (f.type === "link" || f.type === "person") {
      const n = r.named[f.name];
      item[f.name] = Array.isArray(n) ? n.join(", ") : (n ?? null);
    } else item[f.name] = r.values[f.id] ?? null;
  }
  return item;
}

type Kept = Record<string, { col: CollectionView; items: Record<string, unknown>[] }>;

/** A space's lists (the person's own when null), read once while the app is open. */
const colsBySpace = new Map<string, Promise<CollectionView[]>>();
function readCols(space: string | null): Promise<CollectionView[]> {
  const k = space ?? "";
  let p = colsBySpace.get(k);
  if (!p) {
    p = request<CollectionView[]>("GET", `/api/collections${space ? `?space=${enc(space)}` : ""}`);
    p.catch(() => colsBySpace.delete(k));
    colsBySpace.set(k, p);
  }
  return p;
}

/** Where the last records a card showed are kept, so it opens with them offline (rule 17).
 *  Cleared with everything else of the person's at sign-out (the "gigspree:" prefix). */
function savedKey(live: UiRef): string {
  const text = JSON.stringify([live.space_id, live.sources]);
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `gigspree:ui:${(h >>> 0).toString(36)}`;
}

export function UiCard({
  live: given,
  pinnable = false,
}: {
  live: UiRef;
  /** In the chat: offer "Pin to home" (a card that reads a list). */
  pinnable?: boolean;
}) {
  // The same card arrives as a new object on every draw of the chat or home: keep one per
  // content, or the card would be built again (and a tap lost) each time.
  const key = JSON.stringify(given);
  const live = useMemo(() => given, [key]);
  const { t } = useTheme();
  const [surface, setSurface] = useState<SurfaceModel | null>(null);
  const [loading, setLoading] = useState(!!live.sources && Object.keys(live.sources).length > 0);
  const [note, setNote] = useState("");

  useEffect(() => {
    let gone = false;
    const id = `ui${Math.random().toString(36).slice(2)}`;
    const processor = new MessageProcessor([makeCatalog()]);
    try {
      processor.processMessages(cardMessages(live.card as unknown as A2Card, id) as never);
    } catch (e) {
      setNote(
        e instanceof Error
          ? `This card can't be drawn: ${e.message.slice(0, 160)}`
          : "This card can't be drawn",
      );
      return;
    }
    const s = processor.model.surfacesMap.get(id) ?? null;
    setSurface(s);
    if (!s) return;
    const subs: { unsubscribe(): void }[] = [];
    // What each path showed last (its list and items), kept on the device for offline opens.
    const kept = readJson<Kept>(savedKey(live)) ?? {};
    const last = new Map<string, Map<string, Record<string, unknown>>>();
    const colOf = new Map<string, CollectionView>();
    const watched = new Set<string>();
    // A change made on the card to a record's plain field saves to that record. Watched once
    // the path has data (the core keeps no watcher for a path that isn't there yet).
    const watch = (path: string) => {
      if (watched.has(path)) return;
      watched.add(path);
      subs.push(
        s.dataModel.subscribe(path, (items) => {
          const col = colOf.get(path);
          const known = last.get(path);
          if (!col || !known || !Array.isArray(items)) return;
          for (const item of items as Record<string, unknown>[]) {
            const before = typeof item?.id === "string" ? known.get(item.id) : undefined;
            if (!before) continue;
            const values: Record<string, StoredValue> = {};
            for (const f of col.fields)
              if (writable(f) && f.name in item && item[f.name] !== before[f.name])
                values[f.id] = item[f.name] as StoredValue;
            if (!Object.keys(values).length) continue;
            known.set(String(item.id), { ...before, ...item });
            send({
              kind: "spaces.update_record",
              method: "PATCH",
              path: `/api/records/${enc(String(item.id))}`,
              body: { values, ...(live.space_id ? { space: live.space_id } : {}) },
              label: `${String(before.title ?? "")} · ${col.name}`,
            });
          }
          kept[path] = { col, items: items as Record<string, unknown>[] };
          writeJson(savedKey(live), kept);
        }),
      );
    };
    const show = (path: string, col: CollectionView, items: Record<string, unknown>[]) => {
      colOf.set(path, col);
      // Set before the data, so drawing what's already saved isn't taken for a change. Copies:
      // the core changes the items it holds in place.
      last.set(path, new Map(items.map((i) => [String(i.id), { ...i }])));
      s.dataModel.set(path, items);
      watch(path);
    };
    for (const [path, k] of Object.entries(kept)) if (live.sources?.[path]) show(path, k.col, k.items);
    if (Object.keys(kept).length) setLoading(false);
    (async () => {
      const cols = await readCols(live.space_id);
      for (const [path, src] of Object.entries(live.sources ?? {})) {
        const col = cols.find((c) => c.id === src.collection_id);
        if (!col) {
          setNote(`The list ${src.name} isn't there any more.`);
          continue;
        }
        const records = await findAll(
          col.id,
          {
            ...(live.space_id ? { space: live.space_id } : {}),
            filters: src.filters ?? [],
            ...(src.sort ? { sort: src.sort } : {}),
          },
          MAX_ITEMS,
        );
        if (gone) return;
        const items = records.slice(0, MAX_ITEMS).map((r) => itemOf(col, r));
        show(path, col, items);
        kept[path] = { col, items };
      }
      writeJson(savedKey(live), kept);
    })()
      .catch((e: unknown) => {
        if (!gone)
          setNote(
            isOffline(e)
              ? Object.keys(kept).length
                ? "As last seen: needs a connection to refresh."
                : "Needs a connection to read the lists."
              : e instanceof Error
                ? e.message
                : String(e),
          );
      })
      .finally(() => !gone && setLoading(false));
    return () => {
      gone = true;
      subs.forEach((x) => x.unsubscribe());
    };
  }, [live]);

  const [pinned, setPinned] = useState(false);
  const first = Object.values(live.sources ?? {})[0];
  return (
    <View style={{ gap: 6 }}>
      {surface ? <A2uiSurface surface={surface} parts={A2UI_PARTS} /> : null}
      {loading ? <ActivityIndicator color={t.fg3} style={s.spin} /> : null}
      {note ? <Text style={[type.caption, { color: t.fg2 }]}>{note}</Text> : null}
      {pinnable && first ? (
        <Tap
          accessibilityRole="button"
          disabled={pinned}
          onPress={() => {
            setPinned(true);
            void pin(live, first.collection_id);
          }}
          haptic="light"
          style={[s.pin, { backgroundColor: pinned ? t.fill : t.accent }]}
        >
          <Text style={[type.label, { color: pinned ? t.fg2 : t.onAccent, fontSize: 14 }]}>
            {pinned ? "On your home ✓" : "Pin to home"}
          </Text>
        </Tap>
      ) : null}
    </View>
  );
}

/** A name no other view in the space has: the card's title, or "title 2", "title 3"… */
async function freeName(live: UiRef): Promise<string> {
  const base = live.title.slice(0, 54);
  try {
    const q = live.space_id ? `?space=${enc(live.space_id)}` : "";
    const taken = new Set((await request<SavedView[]>("GET", `/api/views${q}`)).map((v) => nameKey(v.name)));
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${base} ${n}`;
      if (!taken.has(nameKey(name))) return name;
    }
  } catch {
    // Offline: the time keeps it apart from an earlier pin of the same card.
    return `${base} ${new Date().toTimeString().slice(0, 5)}`;
  }
}

/** Keeps the card on the home: a pinned view of its first list that draws this card. */
async function pin(live: UiRef, collection: string) {
  send({
    kind: "spaces.save_view",
    method: "POST",
    path: "/api/views",
    body: {
      ...(live.space_id ? { space: live.space_id } : {}),
      id: ulid(),
      name: await freeName(live),
      collection,
      pinned: true,
      card: { ui: { parts: live.card.parts, data: live.card.data, sources: live.sources } },
    },
    label: `Pin · ${live.title}`,
  });
  homeChanged();
}

const s = StyleSheet.create({
  spin: { marginTop: -4 },
  pin: {
    alignSelf: "flex-end",
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    justifyContent: "center",
  },
});
