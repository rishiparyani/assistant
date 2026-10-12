// Draws a card from its spec (docs/design/home-first.md §2.3): the arrangement decides the
// layout, the size how much shows, the collection the colour. The model never positions
// anything; this file does.
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { RecordView } from "@assistant/shared";
import type { HomeCard } from "../home.ts";
import { radius, useTheme } from "../theme.ts";

const ROWS = { s: 2, m: 3, l: 8 } as const;

export function Card({
  card,
  onTick,
  onOpen,
  onAnswer,
  onNudge,
  busy,
}: {
  card: HomeCard;
  onTick?: (record: RecordView, value: boolean) => void;
  onOpen?: () => void;
  /** Process cards: my answer to what it waits on me for, or a nudge to the others. */
  onAnswer?: (answer: string) => void;
  onNudge?: () => void;
  busy?: boolean;
}) {
  const { t, colour } = useTheme();
  const c = colour(card.colour);
  const size = card.spec.size;
  const field = card.spec.sources[0]?.answer_field;

  const header = (
    <View style={s.head}>
      <View style={[s.dot, { backgroundColor: c }]} />
      <Text style={[s.title, { color: c }]} numberOfLines={size === "s" ? 2 : 1}>
        {card.spec.title}
      </Text>
      {field ? (
        <Text style={[s.tag, { color: t.fg2, backgroundColor: t.fill }]}>
          {card.records.filter((r) => r.values[field] !== true).length} left
        </Text>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  switch (card.spec.arrangement) {
    case "process": {
      const w = card.waiting!;
      const open = w.on.filter((p) => p.answer === null);
      const answered = w.on.filter((p) => p.answer !== null);
      const askedMe = !!w.share_id && w.mine === null;
      body = (
        <View style={s.grow}>
          <Text style={[s.rowText, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
            {w.record}
          </Text>
          <Text style={[s.sub, { color: t.fg }]} numberOfLines={size === "s" ? 2 : 3}>
            {w.text}
          </Text>
          <Text style={[s.sub, { color: t.fg2 }]} numberOfLines={1}>
            {askedMe
              ? `Waiting on you · asked ${ago(w.asked_at)}`
              : open.length
                ? `Waiting on ${open.map((p) => p.name.split(/\s+/)[0]).join(", ")} · asked ${ago(w.asked_at)}`
                : "Everyone has answered"}
            {answered.length && !askedMe
              ? ` · ${answered.map((p) => `${p.name.split(/\s+/)[0]}: ${p.answer}`).join(", ")}`
              : ""}
          </Text>
          {askedMe && w.choices ? (
            <View style={s.answers}>
              {w.choices.map((choice) => (
                <Pressable
                  key={choice}
                  accessibilityRole="button"
                  accessibilityLabel={`Answer ${choice}`}
                  disabled={busy}
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => undefined);
                    onAnswer?.(choice);
                  }}
                  style={[s.answer, { backgroundColor: c, opacity: busy ? 0.6 : 1 }]}
                >
                  <Text style={[s.answerText, { color: t.onAccent }]}>{choice}</Text>
                </Pressable>
              ))}
            </View>
          ) : askedMe ? (
            <Text style={[s.sub, { color: t.accent }]}>Tap to answer in the chat</Text>
          ) : open.length && onNudge ? (
            <View style={s.answers}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Nudge"
                disabled={busy}
                onPress={onNudge}
                style={[s.answer, { backgroundColor: t.fill, opacity: busy ? 0.6 : 1 }]}
              >
                <Text style={[s.answerText, { color: t.accent }]}>
                  {w.nudges ? `Nudge again (${w.nudges})` : "Nudge"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      );
      break;
    }
    case "number":
      body = (
        <View style={s.grow}>
          <Text
            style={[s.num, { color: t.fg }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {formatTotal(card)}
          </Text>
          <Text style={[s.sub, { color: t.fg2 }]}>{card.records.length} records</Text>
        </View>
      );
      break;
    case "list-ticks":
      body = (
        <View style={s.grow}>
          {card.records.slice(0, ROWS[size]).map((r) => {
            const done = field ? r.values[field] === true : false;
            return (
              <View key={r.id} style={[s.row, { borderBottomColor: t.sep }]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  accessibilityLabel={r.title}
                  hitSlop={10}
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => undefined);
                    onTick?.(r, !done);
                  }}
                  style={[s.circle, { borderColor: done ? c : t.fg3 }]}
                >
                  {done ? <View style={[s.circleIn, { backgroundColor: c }]} /> : null}
                </Pressable>
                <Text
                  style={[
                    s.rowText,
                    { color: done ? t.fg2 : t.fg, textDecorationLine: done ? "line-through" : "none" },
                  ]}
                  numberOfLines={1}
                >
                  {r.title}
                </Text>
              </View>
            );
          })}
          {card.records.length === 0 ? (
            <Text style={[s.sub, { color: t.fg2 }]}>Nothing here. Nice.</Text>
          ) : null}
        </View>
      );
      break;
    default:
      body = (
        <View style={s.grow}>
          {card.records.slice(0, ROWS[size]).map((r) => (
            <View key={r.id} style={[s.row, { borderBottomColor: t.sep }]}>
              <Text style={[s.rowText, { color: t.fg }]} numberOfLines={1}>
                {r.title}
              </Text>
              <Text style={[s.end, { color: t.fg2 }]} numberOfLines={1}>
                {secondLine(card, r)}
              </Text>
            </View>
          ))}
          {card.records.length === 0 ? <Text style={[s.sub, { color: t.fg2 }]}>Nothing yet.</Text> : null}
        </View>
      );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={card.spec.title}
      onPress={onOpen}
      style={({ pressed }) => [
        s.card,
        { backgroundColor: t.cell, shadowColor: t.shadow, borderColor: t.hair },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      {header}
      {body}
    </Pressable>
  );
}

/** "just now", "2 h ago", "3 days ago". */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatTotal(card: HomeCard) {
  const f = card.spec.sources[0]?.sum_field;
  const field = card.collection?.fields.find((x) => x.id === f);
  if (field?.type === "money") return "₹" + Math.round((card.total ?? 0) / 100).toLocaleString("en-IN");
  return String(card.total ?? 0);
}

function secondLine(card: HomeCard, r: RecordView): string {
  // The first readable value that isn't the title: "₹450", "Sat 14 Dec".
  if (!card.collection) return "";
  const title = card.collection.fields.find((f) => f.id === card.collection!.title_field_id)?.name;
  for (const f of card.collection.fields) {
    if (f.name === title) continue;
    const v = r.named[f.name];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

const s = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.card,
    padding: 14,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    overflow: "hidden",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 18 },
  dot: { width: 9, height: 9, borderRadius: 3 },
  title: { fontSize: 12, fontWeight: "700", letterSpacing: -0.1, flexShrink: 1 },
  tag: {
    marginLeft: "auto",
    fontSize: 10.5,
    fontWeight: "700",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  grow: { flex: 1, justifyContent: "flex-end" },
  answers: { flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" },
  answer: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  answerText: { fontSize: 14, fontWeight: "700" },
  num: { fontSize: 30, fontWeight: "800", letterSpacing: -1.2, fontVariant: ["tabular-nums"] },
  sub: { fontSize: 12, fontWeight: "500" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 32,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, fontSize: 13.5 },
  end: { fontSize: 11.5, fontVariant: ["tabular-nums"] },
  circle: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  circleIn: { width: 13, height: 13, borderRadius: 7 },
});
