// A card the assistant designed (decision 2026-10-18 "Try A2UI"): drawn by the A2UI player
// with the app's parts. Paths it names as sources are filled with the records of the person's
// lists, fresh each time it shows; a change made on the card to a record's field (a tick, a
// status picked) saves to that record through the outbox, like any card's control.
import { useEffect, useState } from "react";
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

/** The person's lists, read once per screen when the host doesn't pass them. */
let sharedCols: Promise<CollectionView[]> | null = null;
const readCols = () =>
  (sharedCols ??= request<CollectionView[]>("GET", "/api/collections").catch((e: unknown) => {
    sharedCols = null;
    throw e;
  }));

export function UiCard({
  live,
  collections = readCols,
  pinnable = false,
}: {
  live: UiRef;
  collections?: () => Promise<CollectionView[]>;
  /** In the chat: offer "Pin to home" (a card that reads a list). */
  pinnable?: boolean;
}) {
  const { t } = useTheme();
  const [surface, setSurface] = useState<SurfaceModel | null>(null);
  const [loading, setLoading] = useState(!!live.sources && Object.keys(live.sources).length > 0);
  const [note, setNote] = useState("");
  const key = JSON.stringify(live);

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
    (async () => {
      const cols = await collections();
      for (const [path, src] of Object.entries(live.sources ?? {})) {
        const col = cols.find((c) => c.id === src.collection_id);
        if (!col) {
          setNote(`The list ${src.name} isn't there any more.`);
          continue;
        }
        const records = await findAll(
          col.id,
          { filters: src.filters ?? [], ...(src.sort ? { sort: src.sort } : {}) },
          MAX_ITEMS,
        );
        if (gone) return;
        const byId = new Map(records.map((r) => [r.id, r]));
        // What each record holds now, so only a real change is saved.
        const last = new Map(records.map((r) => [r.id, itemOf(col, r)]));
        s.dataModel.set(
          path,
          records.slice(0, MAX_ITEMS).map((r) => itemOf(col, r)),
        );
        subs.push(
          s.dataModel.subscribe(path, (items) => {
            if (!Array.isArray(items)) return;
            for (const item of items as Record<string, unknown>[]) {
              const record = typeof item?.id === "string" ? byId.get(item.id) : undefined;
              const before = record ? last.get(record.id) : undefined;
              if (!record || !before) continue;
              const values: Record<string, StoredValue> = {};
              for (const f of col.fields)
                if (writable(f) && f.name in item && item[f.name] !== before[f.name])
                  values[f.id] = item[f.name] as StoredValue;
              if (!Object.keys(values).length) continue;
              last.set(record.id, { ...before, ...item });
              send({
                kind: "spaces.update_record",
                method: "PATCH",
                path: `/api/records/${enc(record.id)}`,
                body: { values, ...(live.space_id ? { space: live.space_id } : {}) },
                label: `${record.title} · ${col.name}`,
              });
            }
          }),
        );
      }
    })()
      .catch((e: unknown) => {
        if (!gone)
          setNote(
            isOffline(e)
              ? "Needs a connection to read the lists."
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
    // The card's content is the dependency (a new object each render otherwise).
  }, [key, live, collections]);

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
