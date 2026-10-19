// A live card in the chat: a record (its values), or a list / saved view drawn like a home
// card (ticks work). Loaded when shown; "Open" hands the card to the chat as context.
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import { Tap, Text, Tick, faceOf, shown, tint, type } from "@assistant/cards/native";
import type { CollectionView, FieldView, LiveRef, RecordView } from "@assistant/shared";
import { ApiError, isOffline } from "../api.ts";
import { answerPinned, pinAnswer, setValue, stillShown, tick, writeValue, type HomeCard } from "../home.ts";
import { useSession } from "../session.tsx";
import { loadLive, type LiveData } from "../live.ts";
import { colourFor, radius, useTheme } from "../theme.ts";
import { Card, cardHeight } from "@assistant/cards/native";
import { UiCard } from "./UiCard.tsx";
import { quickAddFor } from "./QuickAdd.tsx";

export function LiveCard(props: {
  live: LiveRef;
  collections: (fresh?: boolean) => Promise<CollectionView[]>;
  /** The chat's space (null: the person's own). */
  space?: string | null;
  onAsk?: (title: string) => void;
}) {
  // A card the assistant designed draws itself (its own data and lists).
  if (props.live.kind === "ui") return <UiCard live={props.live} pinnable />;
  return <LoadedCard {...props} />;
}

function LoadedCard({
  live,
  collections,
  space = null,
  onAsk,
}: {
  live: LiveRef;
  collections: (fresh?: boolean) => Promise<CollectionView[]>;
  space?: string | null;
  onAsk?: (title: string) => void;
}) {
  const { t } = useTheme();
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState("");
  const key = JSON.stringify(live);
  useEffect(() => {
    let gone = false;
    setData(null);
    setError("");
    loadLive(live, collections, space)
      .then((d) => {
        if (!gone) setData(d);
      })
      .catch((e: unknown) => {
        if (gone) return;
        const msg = e instanceof Error ? e.message : String(e);
        // A record the chat showed and that was removed since (deleted, or an add undone).
        setError(problemWords(e, msg));
      });
    return () => {
      gone = true;
    };
    // The ref's content is the dependency (a new object each render otherwise).
  }, [key, live, collections, space]);

  if (error)
    return (
      <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.sub, { color: t.fg2 }]}>{error}</Text>
      </View>
    );
  if (!data)
    return (
      <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair, alignItems: "center" }]}>
        <ActivityIndicator color={t.fg3} />
      </View>
    );
  if (data.kind === "plain")
    return (
      <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.title, { color: t.fg }]}>{data.title}</Text>
        {data.subtitle ? <Text style={[s.sub, { color: t.fg2 }]}>{data.subtitle}</Text> : null}
      </View>
    );
  if (data.kind === "workflow") return <WorkflowCard data={data} />;
  if (data.kind === "record")
    return <RecordsWidget items={[{ record: data.record, collection: data.collection }]} onAsk={onAsk} />;
  if (data.kind === "answer") return <AnswerCard data={data} onAsk={onAsk} />;
  return <ListCard card={data.card} more={data.more} onAsk={onAsk} />;
}

/** What went wrong, in words for the person (never the server's own message, which is for us). */
function problemWords(e: unknown, msg: string): string {
  if (isOffline(e)) return "Needs a connection.";
  if (e instanceof ApiError) return e.status === 404 ? "This one is gone now." : "Couldn't show this one.";
  return msg;
}

type RecordItem = { record: RecordView; collection: CollectionView };

/**
 * Records in the chat as one widget (owner, 2026-10-15: "vanilla, blending in with the chat"):
 * the list's colour on a header strip, a date tile, the done tick live, one row per record;
 * tap opens the list, "Ask about it" starts a message. Several records the assistant made or
 * found in one go share a widget.
 */
export function LiveRecords({
  refs,
  collections,
  space = null,
  onAsk,
}: {
  refs: LiveRef[];
  collections: (fresh?: boolean) => Promise<CollectionView[]>;
  space?: string | null;
  onAsk?: (title: string) => void;
}) {
  const { t } = useTheme();
  const [items, setItems] = useState<RecordItem[] | null>(null);
  const [error, setError] = useState("");
  // Reload only when the records it points at change, not on every re-render of the chat
  // (each send used to put a spinner on every widget in the list).
  const key = JSON.stringify(refs);
  useEffect(() => {
    let gone = false;
    setItems(null);
    setError("");
    const wanted = JSON.parse(key) as LiveRef[];
    Promise.all(wanted.map((r) => loadLive(r, collections, space)))
      .then((all) => {
        if (gone) return;
        const got = all.filter((d): d is Extract<LiveData, { kind: "record" }> => d.kind === "record");
        if (!got.length) setError("These are gone now.");
        else setItems(got.map((d) => ({ record: d.record, collection: d.collection })));
      })
      .catch((e: unknown) => {
        if (gone) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(problemWords(e, msg));
      });
    return () => {
      gone = true;
    };
  }, [key, collections, space]);
  if (error)
    return (
      <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.sub, { color: t.fg2 }]}>{error}</Text>
      </View>
    );
  if (!items)
    return (
      <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair, alignItems: "center" }]}>
        <ActivityIndicator color={t.fg3} />
      </View>
    );
  return <RecordsWidget items={items} onAsk={onAsk} />;
}

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const IST = 330 * 60_000;
const dayOf = (v: unknown): { dow: string; day: number } | null => {
  if (typeof v !== "string" || !v) return null;
  const t = v.includes("T") ? Date.parse(v) + IST : Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return { dow: DAYS[d.getUTCDay()]!, day: d.getUTCDate() };
};

function RecordsWidget({ items, onAsk }: { items: RecordItem[]; onAsk?: (title: string) => void }) {
  const { t, dark, colour } = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState(items);
  useEffect(() => setRows(items), [items]);
  const collection = items[0]!.collection;
  const c = colour(colourFor(collection.name));
  const fields = collection.fields;
  const dateField = fields.find((f) => f.type === "date" || f.type === "datetime") ?? null;
  const doneField = fields.find((f) => f.type === "boolean" && !f.options.formula) ?? null;
  const moneyField = fields.find((f) => f.type === "money") ?? null;
  const detailFields = fields
    .filter(
      (f) =>
        f.id !== collection.title_field_id &&
        f.id !== dateField?.id &&
        f.id !== doneField?.id &&
        f.id !== moneyField?.id &&
        ["text", "choice", "link", "person"].includes(f.type),
    )
    .slice(0, 2);
  const open = () => router.push({ pathname: "/list", params: { collection: collection.id } });
  const toggle = (item: RecordItem) => {
    if (!doneField) return;
    void Haptics.selectionAsync().catch(() => undefined);
    const next = writeValue(
      item.collection,
      item.record,
      doneField.id,
      item.record.values[doneField.id] !== true,
    );
    setRows((xs) => xs.map((x) => (x.record.id === item.record.id ? { ...x, record: next } : x)));
  };
  return (
    <View style={[s.widget, { backgroundColor: t.cell, borderColor: t.hair, shadowColor: t.shadow }]}>
      <Tap
        accessibilityRole="link"
        accessibilityLabel={`Open ${collection.name}`}
        onPress={open}
        scale={0.99}
        style={[s.strip, { backgroundColor: tint(c, dark ? 0.2 : 0.1) }]}
      >
        {/* The strip is already in the card's colour: no mark needed. */}
        <Text style={[s.stripName, { color: t.fg }]} numberOfLines={1}>
          {collection.name}
        </Text>
        {rows.length > 1 ? (
          <Text style={[s.stripCount, { color: c, backgroundColor: tint(c, dark ? 0.24 : 0.14) }]}>
            {rows.length}
          </Text>
        ) : null}
        <Text style={[s.stripOpen, { color: c }]}>Open ›</Text>
      </Tap>
      {rows.map((item, i) => {
        const r = item.record;
        const done = doneField ? r.values[doneField.id] === true : false;
        const when = dateField ? shown(dateField, r, null) : "";
        const day = dateField ? dayOf(r.values[dateField.id]) : null;
        const details = [
          ...detailFields.map((f: FieldView) => shown(f, r, null)).filter(Boolean),
          ...(when ? [when] : []),
        ];
        const money = moneyField ? shown(moneyField, r, null) : "";
        return (
          <Tap
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={r.title}
            accessibilityHint="Opens the list; hold to ask about it"
            onPress={open}
            onLongPress={() => onAsk?.(r.title)}
            scale={0.99}
            dim={0.3}
            style={[s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep }]}
          >
            {doneField ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={`${doneField.name}: ${r.title}`}
                hitSlop={10}
                onPress={() => toggle(item)}
              >
                <Tick done={done} />
              </Pressable>
            ) : null}
            {day ? (
              <View style={[s.tile, { backgroundColor: tint(c, dark ? 0.18 : 0.1) }]}>
                <Text style={[s.tileDow, { color: c }]}>{day.dow}</Text>
                <Text style={[s.tileDay, { color: t.fg }]}>{day.day}</Text>
              </View>
            ) : null}
            <View style={s.words}>
              <Text
                style={[
                  s.rowTitle,
                  { color: done ? t.fg2 : t.fg, textDecorationLine: done ? "line-through" : "none" },
                ]}
                numberOfLines={2}
              >
                {r.title}
              </Text>
              {details.length ? (
                <Text style={[s.rowDetails, { color: t.fg2 }]} numberOfLines={1}>
                  {details.join(" · ")}
                </Text>
              ) : null}
            </View>
            {money ? (
              <Text style={[s.money, { color: t.warn, backgroundColor: tint(t.warn, dark ? 0.2 : 0.12) }]}>
                {money}
              </Text>
            ) : null}
          </Tap>
        );
      })}
      {onAsk ? (
        <View style={s.widgetFoot}>
          <Tap
            accessibilityRole="button"
            onPress={() => onAsk(rows.length === 1 ? rows[0]!.record.title : collection.name)}
            hitSlop={6}
            style={s.askBtn}
          >
            <Text style={[s.askText, { color: t.accent }]}>
              Ask about {rows.length === 1 ? "it" : "these"}
            </Text>
          </Tap>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A card in the chat is as tall as what it holds (owner, 2026-10-18: "it's not fully visible"),
 * every row shown; only the half-height ones keep their size (one figure, nothing to grow).
 */
const heightIn = (card: HomeCard) =>
  card.spec.size === "xs" || card.spec.size === "bar" ? { height: cardHeight(card) } : null;

function ListCard({
  card: given,
  more,
  onAsk,
}: {
  card: HomeCard;
  more: boolean;
  onAsk?: (title: string) => void;
}) {
  const { me } = useSession();
  const [card, setCard] = useState(given);
  useEffect(() => setCard(given), [given]);
  return (
    <View style={{ gap: 4 }}>
      <View style={heightIn(card)}>
        <Card
          card={card}
          fit
          footer={quickAddFor(card)}
          onTick={(record, value) =>
            setCard((c) => ({
              ...c,
              records: c.records.map((r) => (r.id === record.id ? tick(c, r, value) : r)),
            }))
          }
          onSet={(record, field, value) =>
            setCard((c) => ({
              ...c,
              records: c.records.flatMap((r) => {
                if (r.id !== record.id) return [r];
                const next = setValue(c, r, field, value);
                return stillShown(c, next, me?.user.id ?? null) ? [next] : [];
              }),
            }))
          }
          onOpen={() => onAsk?.(card.spec.title)}
        />
      </View>
      {card.collection ? <OpenList collection={card.collection.id} view={card.view?.id} more={more} /> : null}
    </View>
  );
}

/** "Open list ›": the whole list on its own screen (owner, 2026-10-13). */
function OpenList({ collection, view, more }: { collection: string; view?: string; more?: boolean }) {
  const { t } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push({ pathname: "/list", params: { collection, ...(view ? { view } : {}) } })}
      hitSlop={8}
      style={s.openList}
    >
      <Text style={[s.openListText, { color: t.accent }]}>{more ? "See all ›" : "Open list ›"}</Text>
    </Pressable>
  );
}

/**
 * A workflow in the chat: what it does in words and whether it's on; tap opens its screen,
 * where it can be rehearsed before it's turned on (a new one is saved off).
 */
function WorkflowCard({ data }: { data: Extract<LiveData, { kind: "workflow" }> }) {
  const { t } = useTheme();
  const router = useRouter();
  return (
    <Tap
      accessibilityRole="link"
      accessibilityLabel={`Open ${data.name}`}
      accessibilityHint="Shows the workflow, to rehearse it or turn it on"
      onPress={() =>
        router.push({
          pathname: "/process",
          params: { id: data.id, ...(data.space ? { space: data.space } : {}) },
        })
      }
      scale={0.99}
      style={[s.box, { backgroundColor: t.cell, borderColor: t.hair }]}
    >
      <View style={s.head}>
        <Text style={[s.kicker, { color: data.enabled ? t.accent : t.fg3 }]}>
          {data.enabled ? "Workflow · on" : "Workflow · off"}
        </Text>
      </View>
      <Text style={[s.title, { color: t.fg }]}>{data.name}</Text>
      {data.words.slice(0, 4).map((w, i) => (
        <Text key={i} style={[s.sub, { color: t.fg2 }]} numberOfLines={2}>
          {w}
        </Text>
      ))}
      {data.words.length > 4 ? (
        <Text style={[s.sub, { color: t.fg3 }]}>and {data.words.length - 4} more</Text>
      ) : null}
      <Text style={[s.openListText, { color: t.accent }]}>
        {data.enabled ? "Open ›" : "Rehearse or turn on ›"}
      </Text>
    </Tap>
  );
}

/** An answer in the chat: the table or bars, and a button that keeps it on the home. */
function AnswerCard({
  data,
  onAsk,
}: {
  data: Extract<LiveData, { kind: "answer" }>;
  onAsk?: (title: string) => void;
}) {
  const { t } = useTheme();
  const { card, ref } = data;
  // Already on the home: the button says so when the chat is opened again.
  const userId = useSession().me?.user.id ?? null;
  const [pinned, setPinned] = useState(() => answerPinned(userId, ref));
  // Pinning: the card dips toward the home and springs back, with a tap (the motion demo).
  const dip = useSharedValue(1);
  const dipStyle = useAnimatedStyle(() => ({
    transform: [{ scale: dip.value }, { translateY: (1 - dip.value) * 120 }],
  }));
  return (
    <View style={{ gap: 6 }}>
      <Animated.View style={[heightIn(card), dipStyle]}>
        <Card card={card} fit onOpen={() => onAsk?.(card.spec.title)} />
      </Animated.View>
      <View style={s.actions}>
        {card.answer ? (
          <Text style={[s.sub, { color: t.fg3, flex: 1 }]} numberOfLines={2}>
            {card.answer.words}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pinned ? "Pinned to your home" : "Pin to home"}
          disabled={pinned}
          onPress={() => {
            pinAnswer(ref, card);
            setPinned(true);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
            dip.value = withSequence(withTiming(0.9, { duration: 160 }), withSpring(1, { damping: 11 }));
          }}
          style={({ pressed }) => [
            s.pin,
            { backgroundColor: pinned ? t.fill : t.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          {pinned ? (
            <Animated.Text
              entering={FadeInDown.springify().damping(14)}
              style={[s.pinText, { color: t.fg2 }, faceOf(s.pinText)]}
            >
              On your home ✓
            </Animated.Text>
          ) : (
            <Text style={[s.pinText, { color: t.onAccent }]}>Pin to home</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  widget: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    ...(Platform.OS === "ios"
      ? { shadowOpacity: 1, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }
      : Platform.OS === "android"
        ? { elevation: 2 }
        : null),
  },
  strip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, minHeight: 44 },
  stripName: { ...type.heading, fontSize: 15, flexShrink: 1 },
  stripCount: {
    ...type.caption,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 9,
    overflow: "hidden",
  },
  stripOpen: { ...type.caption, marginLeft: "auto" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    minHeight: 56,
    paddingVertical: 8,
  },
  tile: { width: 42, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  tileDow: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
  tileDay: { fontSize: 16, fontWeight: "800", letterSpacing: -0.4, marginTop: -1 },
  words: { flex: 1, gap: 1 },
  rowTitle: { ...type.small, fontWeight: "700" },
  rowDetails: { ...type.caption, fontWeight: "500" },
  money: { ...type.caption, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden" },
  widgetFoot: { flexDirection: "row", paddingHorizontal: 8, paddingBottom: 4 },
  askBtn: { minHeight: 36, justifyContent: "center", paddingHorizontal: 6 },
  askText: { ...type.caption, fontSize: 13 },
  openList: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center", paddingHorizontal: 6 },
  openListText: { fontSize: 14, fontWeight: "800" },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 },
  pin: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: "center" },
  pinText: { fontSize: 14, fontWeight: "700" },
  box: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 6,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  kicker: { fontSize: 12, fontWeight: "700" },
  title: { fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
  sub: { fontSize: 13 },
});
