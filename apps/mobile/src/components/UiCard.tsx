// A card the assistant designed (decision 2026-10-18 "Try A2UI"): drawn by the A2UI player
// with the app's parts. Paths it names as sources are filled with the records of the person's
// lists, fresh each time it shows; a change made on the card to a record's field (a tick, a
// status picked) saves to that record through the outbox, like any card's control.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core";
import { A2uiSurface, A2UI_PARTS, Tap, Text, confirmedJustNow, type } from "@assistant/cards/native";
import { actionWords, cardAction, cardMessages, makeCatalog, type A2Card } from "@assistant/cards/a2ui";
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
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
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
  return `gigspree:ui:${hashOf([live.space_id, live.sources])}`;
}
/** The key before keys were hashed in a fixed order (2026-10-19): read once, then moved. */
function legacyKey(live: UiRef): string {
  const text = JSON.stringify([live.space_id, live.sources]);
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `gigspree:ui:${(h >>> 0).toString(36)}`;
}
function readKept(live: UiRef): Kept {
  const now = readJson<Kept>(savedKey(live));
  if (now) return now;
  const old = readJson<Kept>(legacyKey(live));
  if (old) writeJson(savedKey(live), old);
  return old ?? {};
}
/** Where the card's own settings are kept (a slider, a picked option): the person's, per card. */
function settingsKey(live: UiRef): string {
  return `gigspree:uiset:${hashOf([live.space_id, live.card])}`;
}
/** The same text for the same content whatever order its keys arrive in (the server stores
 *  a card and may hand it back with its keys in another order). */
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;
function hashOf(v: unknown): string {
  const text = JSON.stringify(canonical(v));
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
/** Settings bigger than this aren't kept (a card's settings are a few numbers and words). */
const MAX_SETTINGS = 20_000;

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
    // A button that asks the app to act: shown first, run only after Confirm (decision 2026-10-19
    // "Buttons that act").
    subs.push(
      s.onAction.subscribe(async (a) => {
        if (gone) return;
        const action = cardAction(a.name);
        if (!action) return setNote(`This card asked for something the app doesn't do (${a.name}).`);
        const args = { ...(a.context ?? {}) };
        // Where it goes, in names the person knows (which chat, which record), looked up now: a
        // card can't send to a chat or record that isn't the person's, or hide which one.
        const shown: Record<string, unknown> = { ...args };
        try {
          for (const n of action.names ?? []) {
            const found = await request<Record<string, unknown>>(
              "GET",
              n.path.replace(`:${n.arg}`, enc(String(args[n.arg] ?? ""))) +
                (live.space_id && n.field === "title" ? `?space=${enc(live.space_id)}` : ""),
            );
            shown[n.as] = String(found[n.field] ?? "");
          }
        } catch (e) {
          return setNote(
            isOffline(e)
              ? "That needs a connection; nothing was sent."
              : "That card points at a chat or entry that isn't yours; nothing was sent.",
          );
        }
        if (!gone) setAsking({ name: a.name, args, shown });
      }),
    );
    // The card's own settings come back as the person left them (decision 2026-10-19 "Cards
    // remember their settings"); the lists' records are not settings and always come fresh.
    const own = (k: string) => !live.sources?.[`/${k}`];
    const settings = readJson<Record<string, unknown>>(settingsKey(live));
    if (settings) for (const [k, v] of Object.entries(settings)) if (own(k)) s.dataModel.set(`/${k}`, v);
    let saving: ReturnType<typeof setTimeout> | undefined;
    subs.push(
      s.dataModel.subscribe("/", (all) => {
        clearTimeout(saving);
        saving = setTimeout(() => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries((all ?? {}) as Record<string, unknown>)) if (own(k)) out[k] = v;
          if (JSON.stringify(out).length <= MAX_SETTINGS) writeJson(settingsKey(live), out);
        }, 400);
      }),
      { unsubscribe: () => clearTimeout(saving) },
    );
    // What each path showed last (its list and items), kept on the device for offline opens.
    const kept = readKept(live);
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
          const space = live.space_id ? { space: live.space_id } : {};
          const now = (items as Record<string, unknown>[]).filter((x) => !!x && typeof x === "object");
          const here = new Set(now.map((x) => (typeof x.id === "string" ? x.id : "")));
          // A row the card removed (removeItem) deletes its record; one the card added (addItem)
          // becomes a new one. One at a time: a card that empties or fills a whole list at once
          // is a mistake, and nothing is deleted or added for it.
          const gone = [...known.keys()].filter((id) => !here.has(id));
          const fresh = now.filter((x) => typeof x.id !== "string" || !known.has(x.id));
          if (gone.length > 1 || fresh.length > 1) {
            setNote("A card changes one row at a time; nothing was saved for that.");
            return;
          }
          // Only right after a confirming button's second tap: put the row back otherwise.
          if (gone.length && !confirmedJustNow()) {
            setNote("Deleting needs a button that asks first; nothing was deleted.");
            s.dataModel.set(path, [...now, ...gone.map((id) => ({ ...known.get(id)! }))]);
            return;
          }
          for (const id of gone) {
            const before = known.get(id)!;
            known.delete(id);
            send({
              kind: "spaces.delete_record",
              method: "DELETE",
              path: `/api/records/${enc(id)}${live.space_id ? `?space=${enc(live.space_id)}` : ""}`,
              body: undefined,
              label: `Delete ${String(before.title ?? "")} · ${col.name}`,
            });
          }
          for (const item of fresh) {
            const values: Record<string, StoredValue> = {};
            for (const f of col.fields)
              if (writable(f) && item[f.name] !== undefined && item[f.name] !== null && item[f.name] !== "")
                values[f.id] = item[f.name] as StoredValue;
            if (!Object.keys(values).length) continue;
            // The record's id is made here (offline first), and the row learns it.
            const id = ulid();
            send({
              kind: "spaces.add_record",
              method: "POST",
              path: `/api/collections/${enc(col.id)}/records`,
              body: { id, values, ...space },
              label: `New in ${col.name}`,
            });
            // The row learns its id and its title (rows read "title", the draft fills the field).
            const tf = col.fields.find((f) => f.id === col.title_field_id);
            const title = tf ? str(item[tf.name]) : "";
            known.set(id, { ...item, id, title });
            const at = (items as unknown[]).indexOf(item);
            s.dataModel.set(`${path}/${at}/id`, id);
            if (title) s.dataModel.set(`${path}/${at}/title`, title);
          }
          for (const item of now) {
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
  const [asking, setAsking] = useState<{
    name: string;
    args: Record<string, unknown>;
    /** The args with the looked-up names, for the words. */
    shown: Record<string, unknown>;
  } | null>(null);
  const [doing, setDoing] = useState(false);
  const first = Object.values(live.sources ?? {})[0];
  const act = async () => {
    if (!asking) return;
    const a = cardAction(asking.name);
    if (!a) return;
    const args = { ...asking.args };
    // The address's ":name" parts come from the args; the rest is the body.
    const path = a.path.replace(/:(\w+)/g, (_, k: string) => {
      const v = String(args[k] ?? "");
      delete args[k];
      return enc(v);
    });
    setDoing(true);
    try {
      // online-only: it sends something to other people or another service now.
      await request(a.method, path, {
        ...args,
        ...(live.space_id && !("space" in args) ? { space: live.space_id } : {}),
      });
      setNote(`Done: ${actionWords(asking.name, asking.shown)}.`);
      setAsking(null);
    } catch (e) {
      setNote(
        isOffline(e)
          ? "That needs a connection; nothing was sent."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setDoing(false);
    }
  };
  return (
    <View style={{ gap: 6 }}>
      {surface ? <A2uiSurface surface={surface} parts={A2UI_PARTS} /> : null}
      {asking ? (
        <View
          style={[s.ask, { backgroundColor: t.accentSoft, borderColor: t.accent }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[type.small, { color: t.fg, fontWeight: "700" }]}>
            {actionWords(asking.name, asking.shown)}?
          </Text>
          <View style={s.askRow}>
            <Tap
              accessibilityRole="button"
              onPress={() => setAsking(null)}
              style={[s.askBtn, { backgroundColor: t.cell }]}
            >
              <Text style={[type.label, { color: t.fg, fontSize: 14 }]}>Cancel</Text>
            </Tap>
            <Tap
              accessibilityRole="button"
              disabled={doing}
              onPress={() => void act()}
              haptic="light"
              style={[s.askBtn, { backgroundColor: t.accent }]}
            >
              <Text style={[type.label, { color: t.onAccent, fontSize: 14 }]}>{doing ? "…" : "Confirm"}</Text>
            </Tap>
          </View>
        </View>
      ) : null}
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
  ask: { borderRadius: 16, borderWidth: 1.5, padding: 12, gap: 10 },
  askRow: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  askBtn: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: "center" },
  pin: {
    alignSelf: "flex-end",
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    justifyContent: "center",
  },
});
