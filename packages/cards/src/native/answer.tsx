// An answer on a card (decision 2026-10-13 "Questions, not SQL"): the table the space worked
// out for a question, drawn as a small table or as bars. Every number here was calculated by
// the space; the card only lays it out.
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { Text } from "./text.tsx";
import type { QueryResult } from "@assistant/shared";
import type { CardSize } from "../spec.ts";
import { tint } from "./rows.tsx";
import { useTheme } from "./theme.ts";
import { UNFLEX } from "./fit.ts";

/** Rows that fit under the title: an M card is one cell tall, an L card two. */
const TABLE_ROWS: Partial<Record<CardSize, number>> = { m: 3, l: 9 };
const BAR_ROWS: Partial<Record<CardSize, number>> = { m: 3, l: 8 };

/** "3 of 5" for the card's header when not every row fits; null when they all do. */
export function answerTag(answer: QueryResult | undefined, size: CardSize, bars: boolean): string | null {
  if (!answer) return null;
  const all = answer.rows.length + answer.more;
  const shown = Math.min(answer.rows.length, (bars ? BAR_ROWS : TABLE_ROWS)[size] ?? 3);
  return shown < all ? `${shown} of ${all}` : null;
}

export function AnswerTable({
  answer,
  size,
  all = false,
}: {
  answer: QueryResult;
  size: CardSize;
  /** Every row, at its natural height (a card that fits its content). */
  all?: boolean;
}) {
  const { t } = useTheme();
  const rows = all ? answer.rows : answer.rows.slice(0, TABLE_ROWS[size] ?? 3);
  // A phone card has room for about four columns; the first ones are the ones asked for.
  const cols = answer.columns.slice(0, 4);
  const left = (i: number) => answer.columns[i]?.kind === "group" || answer.columns[i]?.type === "text";
  return (
    <View style={[s.box, all && UNFLEX]}>
      <View style={[s.row, s.headRow, { borderBottomColor: t.sep }]}>
        {cols.map((c, i) => (
          <Text
            key={c.name}
            style={[
              s.head,
              i === 0 ? s.first : s.cell,
              { color: t.fg2, textAlign: left(i) ? "left" : "right" },
            ]}
            numberOfLines={1}
          >
            {c.name}
          </Text>
        ))}
      </View>
      {rows.map((r, j) => (
        <View key={j} style={[s.row, { borderBottomColor: t.sep }]}>
          {cols.map((c, i) => (
            <Text
              key={c.name}
              style={[
                i === 0 ? s.first : s.cell,
                s.text,
                { color: i === 0 ? t.fg : t.fg, textAlign: left(i) ? "left" : "right" },
                i > 0 && !left(i) ? s.num : null,
              ]}
              numberOfLines={1}
            >
              {r.shown[i]}
            </Text>
          ))}
        </View>
      ))}
      {!answer.rows.length ? <Text style={[s.sub, { color: t.fg2 }]}>Nothing matches yet.</Text> : null}
    </View>
  );
}

export function AnswerBars({
  answer,
  size,
  colour,
  all = false,
}: {
  answer: QueryResult;
  size: CardSize;
  colour: string;
  all?: boolean;
}) {
  const { t, dark } = useTheme();
  // The bars are the first group by the first number column.
  const g = answer.columns.findIndex((c) => c.kind === "group");
  const m = answer.columns.findIndex((c) => c.kind === "measure");
  if (m < 0) return <AnswerTable answer={answer} size={size} all={all} />;
  const rows = all ? answer.rows : answer.rows.slice(0, BAR_ROWS[size] ?? 3);
  const nums = rows.map((r) => (typeof r.cells[m] === "number" ? Math.max(0, r.cells[m] as number) : 0));
  const top = Math.max(1, ...nums);
  return (
    <View style={[s.box, all && UNFLEX]}>
      {rows.map((r, j) => (
        <View key={j} style={s.barRow} accessibilityLabel={`${g >= 0 ? r.shown[g] : ""} ${r.shown[m]}`}>
          <Text style={[s.barLabel, { color: t.fg }]} numberOfLines={1}>
            {g >= 0 ? r.shown[g] : answer.columns[m]!.name}
          </Text>
          <View style={[s.track, { backgroundColor: tint(colour, dark ? 0.16 : 0.1) }]}>
            <Grow to={nums[j]! / top} delay={j * 90} colour={colour} />
          </View>
          <Text style={[s.barValue, { color: t.fg2 }]} numberOfLines={1}>
            {r.shown[m]}
          </Text>
        </View>
      ))}
      {!answer.rows.length ? <Text style={[s.sub, { color: t.fg2 }]}>Nothing matches yet.</Text> : null}
    </View>
  );
}

/** A bar that grows from nothing to its share when it first shows (the motion demo). */
function Grow({ to, delay, colour }: { to: number; delay: number; colour: string }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withDelay(delay, withTiming(to, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [to, delay, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return <Animated.View style={[s.fill, { backgroundColor: colour }, style]} />;
}

const s = StyleSheet.create({
  box: { flex: 1, justifyContent: "flex-start", gap: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 25,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headRow: { minHeight: 20 },
  head: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  first: { flex: 1.4, minWidth: 0 },
  cell: { flex: 1, minWidth: 0 },
  text: { fontSize: 13 },
  num: { fontVariant: ["tabular-nums"], fontWeight: "600" },
  sub: { fontSize: 11.5, fontWeight: "500", marginTop: 2 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 27 },
  barLabel: { width: "30%", fontSize: 13 },
  track: { flex: 1, height: 10, borderRadius: 5, overflow: "hidden" },
  fill: { height: 10, borderRadius: 5 },
  barValue: {
    minWidth: 64,
    textAlign: "right",
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});
