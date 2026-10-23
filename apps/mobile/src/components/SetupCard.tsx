// A setup card people can take in at a glance (owner, 2026-10-24: "This kind of a response is
// a little too much to read … wherever we can to make the user visualize"): each list as a
// block with its fields as chips, a map of how the lists link (drawn, not listed), the cards
// that go on the home, and the rules. Read from the card's own arguments; the words stay the
// fallback for cards without them.
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { G, Path, Rect, Text as SvgText } from "react-native-svg";
import { Text } from "@assistant/cards/native";
import { condWords, type FilterOp } from "@assistant/shared";
import { Mark } from "@/components/Mark";
import { TYPE_WORDS, type DraftField } from "@/components/SetupEditSheet";
import { colourFor, useTheme } from "@/theme";

interface DraftList {
  name: string;
  fields?: DraftField[];
}
interface DraftView {
  name: string;
  collection: string;
  pinned?: boolean;
  add_fields?: string[];
}
interface DraftRule {
  kind: "check" | "unique" | "flow";
  collection: string;
  require?: { field: string; op: FilterOp; value?: unknown }[];
  fields?: string[];
  field?: string;
  moves?: { from: string; to: string[] }[];
}

/** The lists, views and rules a setup card would make; null when the card isn't one. */
export function setupOf(tool: string, args: Record<string, unknown> | undefined) {
  if (!args) return null;
  if (tool === "make_setup" && Array.isArray(args.collections))
    return {
      lists: (args.collections as DraftList[]).map((c) => ({ ...c, fields: c.fields ?? [] })),
      views: (Array.isArray(args.views) ? (args.views as DraftView[]) : []).filter((v) => v?.name),
      rules: Array.isArray(args.rules) ? (args.rules as DraftRule[]) : [],
    };
  if (tool === "create_collection" && typeof args.name === "string")
    return {
      lists: [{ name: args.name, fields: (args.fields as DraftField[]) ?? [] }],
      views: [],
      rules: [],
    };
  return null;
}

const key = (s: string) => s.trim().toLowerCase();

/** A link between two lists in the setup (or from one to a list that already exists). */
interface Link {
  from: number;
  field: string;
  to: number | null;
  target: string;
}

export function SetupCard({ tool, args }: { tool: string; args: Record<string, unknown> | undefined }) {
  const { t, colour, cardTint } = useTheme();
  const setup = setupOf(tool, args);
  if (!setup) return null;
  const { lists, views, rules } = setup;
  const tones = lists.map((l) => colourFor(l.name));
  const links: Link[] = lists.flatMap((l, i) =>
    l.fields.flatMap((f) => {
      if (f.type !== "link") return [];
      const target = String(f.options?.target ?? "");
      if (!target) return [];
      const to = lists.findIndex((x) => key(x.name) === key(target));
      return [{ from: i, field: f.name, to: to < 0 ? null : to, target }];
    }),
  );
  const colourOf = (name: string) => colour(colourFor(name));
  return (
    <View style={s.root}>
      {lists.map((l, i) => (
        <View key={l.name} style={[s.list, { backgroundColor: cardTint(tones[i]!), borderColor: t.hair }]}>
          <View style={s.head}>
            <Mark name={l.name} tone={tones[i]} size={28} />
            <Text style={[s.listName, { color: t.fg }]} numberOfLines={1}>
              {l.name}
            </Text>
            <Text style={[s.count, { color: t.fg2 }]}>
              {l.fields.length} field{l.fields.length === 1 ? "" : "s"}
            </Text>
          </View>
          <View style={s.chips}>
            {l.fields.map((f) => {
              const link = f.type === "link" ? String(f.options?.target ?? "") : "";
              const formula = typeof f.options?.formula === "string" ? f.options.formula : "";
              const rollup = f.options?.rollup && typeof f.options.rollup === "object";
              const tag = link
                ? `→ ${link}`
                : formula
                  ? "= formula"
                  : rollup
                    ? "Σ total"
                    : TYPE_WORDS[f.type];
              return (
                <View key={f.name} style={[s.chip, { backgroundColor: t.cell, borderColor: t.hair }]}>
                  <Text style={[s.chipName, { color: t.fg }]}>{f.name}</Text>
                  <Text style={[s.chipTag, { color: link ? colourOf(link) : t.fg3 }]}>{tag}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}
      {links.length ? (
        <View style={s.section}>
          <Text style={[s.label, { color: t.fg2 }]}>How they connect</Text>
          <LinkMap lists={lists.map((l) => l.name)} links={links} />
        </View>
      ) : null}
      {views.length ? (
        <View style={s.section}>
          <Text style={[s.label, { color: t.fg2 }]}>On the home</Text>
          <View style={s.chips}>
            {views.map((v) => (
              <View
                key={v.name}
                style={[s.chip, { backgroundColor: cardTint(colourFor(v.collection)), borderColor: t.hair }]}
              >
                <Text style={[s.chipName, { color: t.fg }]}>{v.name}</Text>
                <Text style={[s.chipTag, { color: t.fg3 }]}>
                  {v.collection}
                  {v.pinned ? " · shortcut" : ""}
                  {v.add_fields?.length ? " · quick add" : ""}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {rules.length ? (
        <View style={s.section}>
          <Text style={[s.label, { color: t.fg2 }]}>Rules</Text>
          {rules.map((r, i) => (
            <Text key={i} style={[s.rule, { color: t.fg }]}>
              {ruleWords(r)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ruleWords(r: DraftRule): string {
  if (r.kind === "unique") return `No two ${r.collection} share ${(r.fields ?? []).join(" and ")}`;
  if (r.kind === "flow")
    return `${r.field ?? "Status"} in ${r.collection} moves ${(r.moves ?? [])
      .map((m) => `${m.from} → ${m.to.join(" / ")}`)
      .join("; ")}`;
  return `Every record in ${r.collection}: ${(r.require ?? []).map((f) => condWords({ field: f.field, op: f.op, value: f.value })).join(" and ")}`;
}

/**
 * The map: the lists down the left, each link an arc on the right from the list that holds
 * the link field to the list it points at, the field's name on the arc. A target that already
 * exists (not in this setup) gets a dashed box at the end.
 */
function LinkMap({ lists, links }: { lists: string[]; links: Link[] }) {
  const { t, colour, dark } = useTheme();
  const [width, setWidth] = useState(0);
  const outside = [...new Set(links.filter((l) => l.to === null).map((l) => l.target))];
  const names = [...lists, ...outside];
  const ROW = 44;
  const BOX_H = 30;
  const boxW = Math.max(120, Math.min(190, Math.round(width * 0.5)));
  const height = names.length * ROW;
  const y = (i: number) => i * ROW + ROW / 2;
  const edges = links.map((l) => ({
    ...l,
    at: l.to === null ? lists.length + outside.indexOf(l.target) : l.to,
    tone: colour(colourFor(l.target)),
  }));
  // Each arc bulges a little further out than the one before, so they don't lie on each other.
  const bends = edges.map((_, k) => 26 + k * 18);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ alignSelf: "stretch" }}>
      {width ? (
        <Svg width={width} height={height} accessibilityLabel="A map of how the lists link">
          {names.map((n, i) => {
            const ghost = i >= lists.length;
            const tone = colour(colourFor(n));
            return (
              <G key={n}>
                <Rect
                  x={1}
                  y={y(i) - BOX_H / 2}
                  width={boxW}
                  height={BOX_H}
                  rx={9}
                  fill={ghost ? "transparent" : tone + (dark ? "33" : "1f")}
                  stroke={tone}
                  strokeWidth={1}
                  strokeDasharray={ghost ? "4 3" : undefined}
                />
                <SvgText x={12} y={y(i) + 4.5} fontSize={13} fontWeight="700" fill={t.fg}>
                  {n.length > 22 ? `${n.slice(0, 21)}…` : n}
                </SvgText>
              </G>
            );
          })}
          {edges.map((e, k) => {
            const x0 = boxW + 1;
            const y0 = y(e.from);
            const y1 = y(e.at);
            const bend = x0 + bends[k]!;
            const d = `M ${x0} ${y0} C ${bend} ${y0}, ${bend} ${y1}, ${x0 + 8} ${y1}`;
            const my = (y0 + y1) / 2;
            return (
              <G key={`${e.from}-${e.field}`}>
                <Path d={d} stroke={e.tone} strokeWidth={1.6} fill="none" />
                <Path d={`M ${x0 + 9} ${y1} l 7 -4 l 0 8 z`} fill={e.tone} />
                <SvgText x={bend + 6} y={my + 4} fontSize={11.5} fill={t.fg2}>
                  {e.field}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 8, marginTop: 4 },
  list: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  listName: { flex: 1, fontSize: 15, fontWeight: "700", letterSpacing: -0.2 },
  count: { fontSize: 12, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipName: { fontSize: 13, fontWeight: "600" },
  chipTag: { fontSize: 11, fontWeight: "600" },
  section: { gap: 6, marginTop: 2 },
  label: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  rule: { fontSize: 14, lineHeight: 20 },
});
