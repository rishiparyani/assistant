// The "Next up" card at the top of Now (decision 2026-10-13 "A warmer home"): the soonest
// thing still to come across the home's cards, big: when (a countdown), a date tile, its
// title and details, highlighted amounts and states, and its button (directions, call, open).
// Every part comes from the record's fields and the card's row layout; nothing is made up.
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FieldView } from "@assistant/shared";
import { countdown, type NextUp } from "../next-up.ts";
import { ACTION_WORDS, act, shown } from "./rows.tsx";
import { useTheme } from "./theme.ts";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const IST = 330 * 60_000;

export function HeroCard({ next, onOpen, now }: { next: NextUp; onOpen?: () => void; now?: number }) {
  const { t } = useTheme();
  const { card, record, field } = next;
  const c = card.collection!;
  const row = card.spec.row ?? null;
  const byId = (id: string) => c.fields.find((f) => f.id === id);
  const day = new Date(next.at + IST);
  const when = shown(byId(field)!, record, field);
  // Details: the row's own, else the first plain fields that aren't the title or the date.
  const plain = (f: FieldView) =>
    f.id !== c.title_field_id && f.id !== field && ["text", "choice", "link", "person"].includes(f.type);
  const details = (row?.details.length ? row.details.map(byId) : c.fields.filter(plain).slice(0, 2))
    .filter((f): f is FieldView => !!f)
    .map((f) => shown(f, record, field))
    .filter(Boolean);
  // Pills: the row's, else the money on the record ("Fee ₹20,000").
  const pills = (
    row?.pills.length ? row.pills.map(byId) : c.fields.filter((f) => f.type === "money").slice(0, 3)
  )
    .filter((f): f is FieldView => !!f)
    .flatMap((f) => {
      const v = shown(f, record, field);
      return v ? [f.type === "money" ? `${f.name} ${v}` : v] : [];
    });
  const action = row?.action
    ? { as: row.action.as, value: shown(byId(row.action.field)!, record, field) }
    : null;
  return (
    <View style={[s.card, { backgroundColor: t.hero, shadowColor: t.hero }]}>
      <View style={s.top}>
        <Text style={[s.eyebrow, { color: t.onHero }]} numberOfLines={1}>
          Next up · {countdown(next, now)}
        </Text>
        <Text style={[s.kind, { color: t.onHero }]} numberOfLines={1}>
          {c.name}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${record.title}, ${when}`}
        onPress={onOpen}
        style={s.main}
      >
        <View style={[s.tile, { backgroundColor: t.onHero }]}>
          <Text style={[s.month, { color: t.warn }]}>{MONTHS[day.getUTCMonth()]}</Text>
          <Text style={[s.day, { color: t.tileInk }]}>{day.getUTCDate()}</Text>
        </View>
        <View style={s.words}>
          <Text style={[s.title, { color: t.onHero }]} numberOfLines={2}>
            {record.title}
          </Text>
          <Text style={[s.sub, { color: t.onHero }]} numberOfLines={2}>
            {[when, ...details].join(" · ")}
          </Text>
        </View>
      </Pressable>
      {pills.length ? (
        <View style={s.pills}>
          {pills.map((p) => (
            <Text key={p} style={[s.pill, { color: t.onHero }]} numberOfLines={1}>
              {p}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={s.buttons}>
        {action?.value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${ACTION_WORDS[action.as]}: ${action.value}`}
            onPress={() => act(action.as, action.value)}
            style={({ pressed }) => [
              s.btn,
              s.btnMain,
              { backgroundColor: t.onHero, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[s.btnText, { color: t.hero }]}>{ACTION_WORDS[action.as]}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${record.title}`}
          onPress={onOpen}
          style={({ pressed }) => [
            s.btn,
            !action?.value && s.btnMain,
            s.btnSoft,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[s.btnText, { color: t.onHero }]}>Open</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 26,
    padding: 18,
    gap: 14,
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  eyebrow: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    opacity: 0.78,
  },
  kind: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  main: { flexDirection: "row", alignItems: "center", gap: 14 },
  tile: { width: 58, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  month: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  day: { fontSize: 26, fontWeight: "800", lineHeight: 28, letterSpacing: -1 },
  words: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 21, fontWeight: "800", letterSpacing: -0.5 },
  sub: { fontSize: 14, opacity: 0.82 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  buttons: { flexDirection: "row", gap: 8 },
  btn: {
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  btnMain: { flex: 1 },
  btnSoft: { backgroundColor: "rgba(255,255,255,0.16)" },
  btnText: { fontSize: 15, fontWeight: "800" },
});
