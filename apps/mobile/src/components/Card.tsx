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
}: {
  card: HomeCard;
  onTick?: (record: RecordView, value: boolean) => void;
  onOpen?: () => void;
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
    case "number":
      body = (
        <View style={s.grow}>
          <Text style={[s.num, { color: t.fg }]}>{formatTotal(card)}</Text>
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

function formatTotal(card: HomeCard) {
  const f = card.spec.sources[0]?.sum_field;
  const field = card.collection.fields.find((x) => x.id === f);
  if (field?.type === "money") return "₹" + Math.round((card.total ?? 0) / 100).toLocaleString("en-IN");
  return String(card.total ?? 0);
}

function secondLine(card: HomeCard, r: RecordView): string {
  // The first readable value that isn't the title: "₹450", "Sat 14 Dec".
  const title = card.collection.fields.find((f) => f.id === card.collection.title_field_id)?.name;
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
