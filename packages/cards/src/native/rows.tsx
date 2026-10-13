// Rich rows for list cards (decision 2026-10-13 "Cards get rich rows"): a calendar tile for a
// date, the title, a line of details with colour dots for choices, highlighted pills, a
// callout box for a note and a button that acts on a field (directions, call, open). Every
// part is a field of the list; this file decides how it looks.
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { FieldView, RecordView, StoredValue } from "@assistant/shared";
import type { HomeCard } from "./model.ts";
import { COLLECTION_COLOURS, useTheme, type CollectionColour } from "./theme.ts";
import { Control, INLINE } from "./controls.tsx";

type Row = NonNullable<HomeCard["spec"]["row"]>;
const IST = 330 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Choice colours, by the choice's place in the field's list. */
const DOTS: CollectionColour[] = ["people", "time", "music", "flow", "money", "home", "neutral"];

/** How many rich rows fit: a callout or pills make a row taller. */
export function richRows(size: string, row: Row, belowControls = false): number {
  // A row is about 44 points, 70 with pills, more with a callout or a line of chips.
  const tall = !!row.callout || row.pills.length > 0 || belowControls;
  if (size === "l") return tall ? 3 : 5;
  if (size === "m") return tall ? 1 : 2;
  return 1;
}

/** A date or a stored date-time (UTC ISO) as India-time parts. */
function when(v: unknown): { y: number; m: number; d: number; dow: number; time: string | null } | null {
  if (typeof v !== "string" || !v) return null;
  const timed = v.includes("T");
  const t = timed ? Date.parse(v) + IST : Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const x = new Date(t);
  let time: string | null = null;
  if (timed) {
    const h = x.getUTCHours();
    const min = x.getUTCMinutes();
    time = `${h % 12 || 12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
  }
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay(), time };
}

/** A value as the row shows it ("₹5,000", "Sat · 6 pm", "Vibe Tribe"); "" when there's nothing. */
export function shown(f: FieldView, r: RecordView, tileField: string | null): string {
  // Links and people live in `named` (their titles), not in `values`.
  if (f.type === "link" || f.type === "person") {
    const n = r.named[f.name];
    return Array.isArray(n) ? n.join(", ") : typeof n === "string" ? n : "";
  }
  const v = r.values[f.id];
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "money":
      return typeof v === "number" ? `₹${(v / 100).toLocaleString("en-IN")}` : String(v);
    case "date":
    case "datetime": {
      const w = when(v);
      if (!w) return "";
      // Beside its own date tile, the day and time say enough.
      const day = f.id === tileField ? DAYS[w.dow]! : `${DAYS[w.dow]} ${w.d} ${MONTHS[w.m]}`;
      return w.time ? `${day} · ${w.time}` : day;
    }
    case "boolean":
      return v === true ? f.name : "";
    case "multi_choice":
      return Array.isArray(v) ? v.join(", ") : String(v);
    default:
      return String(v);
  }
}

/** A colour with some transparency (for soft backgrounds). */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const ACTION_WORDS = { directions: "Directions", call: "Call", open: "Open" } as const;
function act(as: keyof typeof ACTION_WORDS, value: string) {
  const url =
    as === "directions"
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`
      : as === "call"
        ? `tel:${value.replace(/[^\d+]/g, "")}`
        : /^https?:\/\//i.test(value)
          ? value
          : `https://${value}`;
  void Haptics.selectionAsync().catch(() => undefined);
  void Linking.openURL(url).catch(() => undefined);
}

export function RichRows({
  card,
  colour,
  limit,
  onTick,
  onSet,
}: {
  card: HomeCard;
  colour: string;
  limit: number;
  onTick?: (record: RecordView, value: boolean) => void;
  onSet?: (record: RecordView, fieldId: string, value: StoredValue) => void;
}) {
  const { t, dark } = useTheme();
  const row = card.spec.row!;
  const fields = card.collection?.fields ?? [];
  const byId = (id: string | null | undefined) => (id ? fields.find((f) => f.id === id) : undefined);
  const tickField = card.spec.arrangement === "list-ticks" ? card.spec.sources[0]?.answer_field : null;
  const controls = (card.spec.controls ?? []).flatMap((ctl) => {
    const f = byId(ctl.field);
    return f ? [{ ctl, f }] : [];
  });
  // Ticks, switches, steppers, stars and buttons sit at the end of the row; chips and sliders
  // take a line under the row's text.
  const inline = controls.filter((x) => INLINE.has(x.ctl.as));
  const below = controls.filter((x) => !INLINE.has(x.ctl.as));
  const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
  const palette = COLLECTION_COLOURS[dark ? "dark" : "light"];

  return (
    <View style={s.list}>
      {card.records.slice(0, limit).map((r) => {
        const tile = row.date ? when(r.values[row.date]) : null;
        const tileDay = tile
          ? `${tile.y}-${String(tile.m + 1).padStart(2, "0")}-${String(tile.d).padStart(2, "0")}`
          : "";
        const past = !!tile && tileDay < today;
        const isToday = tileDay === today;
        const details = row.details.flatMap((id) => {
          const f = byId(id);
          const text = f ? shown(f, r, row.date) : "";
          if (!f || !text) return [];
          const at = f.type === "choice" ? (f.options.choices ?? []).indexOf(String(r.values[f.id])) : -1;
          return [{ id, text, dot: at >= 0 ? palette[DOTS[at % DOTS.length]!] : null }];
        });
        const pills = row.pills.flatMap((id) => {
          const f = byId(id);
          const text = f ? shown(f, r, row.date) : "";
          return f && text ? [{ id, text }] : [];
        });
        const calloutField = byId(row.callout?.field);
        const callout = calloutField ? shown(calloutField, r, null) : "";
        const actionField = byId(row.action?.field);
        const actionValue = actionField ? shown(actionField, r, null) : "";
        const done = tickField ? r.values[tickField] === true : false;
        return (
          <View key={r.id} style={[s.row, { borderBottomColor: t.sep }]}>
            {tickField ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={r.title}
                hitSlop={10}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  onTick?.(r, !done);
                }}
                style={[s.circle, { borderColor: done ? colour : t.fg3 }]}
              >
                {done ? <View style={[s.circleIn, { backgroundColor: colour }]} /> : null}
              </Pressable>
            ) : null}
            {row.date ? (
              <View
                style={[
                  s.tile,
                  {
                    borderColor: isToday ? colour : t.sep,
                    backgroundColor: isToday ? tint(colour, 0.12) : t.cell,
                    opacity: past ? 0.55 : 1,
                  },
                ]}
                accessibilityLabel={tile ? `${tile.d} ${MONTHS[tile.m]}` : "No date"}
              >
                <View style={[s.tileTop, { backgroundColor: isToday ? colour : t.fill }]}>
                  <Text style={[s.tileMonth, { color: isToday ? t.onAccent : t.fg2 }]}>
                    {tile ? MONTHS[tile.m]!.toUpperCase() : "—"}
                  </Text>
                </View>
                <Text style={[s.tileDay, { color: t.fg }]}>{tile ? tile.d : ""}</Text>
              </View>
            ) : null}
            <View style={s.main}>
              <Text
                style={[
                  s.title,
                  { color: done ? t.fg2 : t.fg, textDecorationLine: done ? "line-through" : "none" },
                ]}
                numberOfLines={1}
              >
                {r.title}
              </Text>
              {details.length ? (
                <View style={s.details}>
                  {details.map((d, i) => (
                    <View key={d.id} style={s.detail}>
                      {/* A colour dot already parts it from the one before. */}
                      {i && !d.dot ? <Text style={[s.sep, { color: t.fg3 }]}>·</Text> : null}
                      {d.dot ? <View style={[s.dot, { backgroundColor: d.dot }]} /> : null}
                      <Text style={[s.detailText, { color: t.fg2 }]} numberOfLines={1}>
                        {d.text}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {pills.length ? (
                <View style={s.pills}>
                  {pills.map((p) => (
                    <Text key={p.id} style={[s.pill, { color: colour, backgroundColor: tint(colour, 0.14) }]}>
                      {p.text}
                    </Text>
                  ))}
                </View>
              ) : null}
              {callout ? (
                <View style={[s.callout, { backgroundColor: tint(palette.time, dark ? 0.16 : 0.14) }]}>
                  <Text style={[s.calloutText, { color: t.fg }]} numberOfLines={2}>
                    {row.callout?.label ? (
                      <Text style={[s.calloutLabel, { color: dark ? palette.time : "#9a6408" }]}>
                        {row.callout.label}:{" "}
                      </Text>
                    ) : null}
                    {callout}
                  </Text>
                </View>
              ) : null}
              {below.length ? (
                // One line that scrolls sideways (wrapped chips would be cut off at the card's edge).
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.below}>
                  {below.map(({ ctl, f }) => (
                    <Control
                      key={`${ctl.field}:${ctl.as}`}
                      control={ctl}
                      field={f}
                      value={r.values[f.id]}
                      colour={colour}
                      label={`${r.title} · ${f.name}`}
                      onSet={(v) => onSet?.(r, f.id, v)}
                    />
                  ))}
                </ScrollView>
              ) : null}
            </View>
            {inline.map(({ ctl, f }) => (
              <Control
                key={`${ctl.field}:${ctl.as}:${ctl.label ?? ""}`}
                control={ctl}
                field={f}
                value={r.values[f.id]}
                colour={colour}
                label={`${r.title} · ${f.name}`}
                onSet={(v) => onSet?.(r, f.id, v)}
              />
            ))}
            {row.action && actionValue ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${ACTION_WORDS[row.action.as]}: ${actionValue}`}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                onPress={() => act(row.action!.as, actionValue)}
                style={[s.action, { backgroundColor: t.fill }]}
              >
                <Text style={[s.actionText, { color: colour }]}>{ACTION_WORDS[row.action.as]}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {card.records.length === 0 ? <Text style={[s.empty, { color: t.fg2 }]}>Nothing yet.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  list: { flex: 1, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tile: {
    width: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  tileTop: { alignSelf: "stretch", alignItems: "center", paddingVertical: 2 },
  tileMonth: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  tileDay: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.6,
    paddingVertical: 2,
    fontVariant: ["tabular-nums"],
  },
  main: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 14.5, fontWeight: "700", letterSpacing: -0.2 },
  details: { flexDirection: "row", alignItems: "center", flexWrap: "nowrap", overflow: "hidden" },
  detail: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, marginRight: 6 },
  sep: { fontSize: 12, marginRight: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  detailText: { fontSize: 12, flexShrink: 1 },
  pills: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  pill: {
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 7,
    overflow: "hidden",
    fontVariant: ["tabular-nums"],
  },
  callout: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 6 },
  calloutText: { fontSize: 12, lineHeight: 16 },
  calloutLabel: { fontWeight: "800" },
  action: { paddingHorizontal: 10, height: 28, borderRadius: 14, justifyContent: "center" },
  actionText: { fontSize: 12, fontWeight: "700" },
  circle: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  circleIn: { width: 13, height: 13, borderRadius: 7 },
  empty: { fontSize: 12, fontWeight: "500" },
  below: { gap: 8, alignItems: "center" },
});
