// The richer A2UI parts (owner, 2026-10-19: "this is not looking like ChatGPT level"): headline
// figures, rings, donuts, columns, heatmaps, tables, timelines, a calendar, a board, and the
// controls a planner needs (a compact switch, search, − +, stars, a day picker). Drawn in the
// app's theme with 44-point targets; definitions are in "@assistant/cards/a2ui".
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { dayOf, localDay } from "../../a2ui/catalog.ts";
import { Tap } from "../press.tsx";
import { Text, TextInput } from "../text.tsx";
import { type, useTheme } from "../theme.ts";
import {
  IconBox,
  Initials,
  SERIES,
  colourOf,
  dayWords,
  kids,
  monthName,
  num,
  numbers,
  shortValue,
  shownValue,
  soft,
  str,
} from "./kit.tsx";
import type { PartProps } from "./player.tsx";

type ViewFn = (p: PartProps) => ReactNode;
type Item = Record<string, unknown>;
const itemsOf = (v: unknown): Item[] =>
  Array.isArray(v) ? v.filter((x): x is Item => !!x && typeof x === "object") : [];

/** A change in percent, as a small pill: ↑ 12% in green when up is good, red when it isn't. */
export function Change({ value, goodWhen, label }: { value: number; goodWhen?: unknown; label?: string }) {
  const { t } = useTheme();
  const up = value > 0;
  const flat = Math.abs(value) < 0.05;
  const good = flat ? null : goodWhen === "down" ? !up : up;
  const c = good === null ? t.fg2 : good ? t.good : t.danger;
  return (
    <View style={m.changeRow}>
      <Text style={[m.change, { color: c, backgroundColor: soft(c, 0.13) }]}>
        {flat ? "→" : up ? "↑" : "↓"} {Math.abs(Math.round(value * 10) / 10)}%
      </Text>
      {label ? <Text style={[type.caption, { color: t.fg2 }]}>{label}</Text> : null}
    </View>
  );
}

/** A small trend line with no axes. */
export function Spark({
  values,
  colour,
  height = 36,
}: {
  values: number[];
  colour: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values, lo + 1e-9);
  const pad = 3;
  const x = (i: number) => pad + (i / (values.length - 1)) * Math.max(1, width - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width ? (
        <Svg width={width} height={height}>
          <Path
            d={`${d} L${x(values.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`}
            fill={soft(colour, 0.14)}
          />
          <Path
            d={d}
            stroke={colour}
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={3} fill={colour} />
        </Svg>
      ) : null}
    </View>
  );
}

/** A month of days to pick from or to mark (the Calendar and the DateField share it). */
function MonthGrid({
  month,
  onMonth,
  marks,
  selected,
  onPick,
  colour,
}: {
  month: string;
  onMonth: (m: string) => void;
  marks?: Map<string, number>;
  selected?: string | null;
  onPick?: (day: string) => void;
  colour: string;
}) {
  const { t } = useTheme();
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const first = new Date(y, mo - 1, 1);
  const days = new Date(y, mo, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);
  const today = localDay(new Date());
  const shift = (by: number) => {
    const d = new Date(y, mo - 1 + by, 1);
    onMonth(localDay(d).slice(0, 7));
  };
  return (
    <View style={{ gap: 6 }}>
      <View style={m.monthHead}>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => shift(-1)}
          style={m.arrow}
        >
          <Text style={[type.heading, { color: t.fg2 }]}>‹</Text>
        </Tap>
        <Text style={[type.label, { color: t.fg }]}>
          {monthName(mo - 1)} {y}
        </Text>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={() => shift(1)}
          style={m.arrow}
        >
          <Text style={[type.heading, { color: t.fg2 }]}>›</Text>
        </Tap>
      </View>
      <View style={m.week}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <Text key={i} style={[m.weekDay, { color: t.fg3 }]}>
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={m.week}>
          {cells.slice(r * 7, r * 7 + 7).map((day, i) => {
            if (!day) return <View key={i} style={m.dayCell} />;
            const on = day === selected;
            const count = marks?.get(day) ?? 0;
            const isToday = day === today;
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`${dayWords(day)}${count ? `, ${count}` : ""}`}
                accessibilityState={{ selected: on }}
                onPress={onPick ? () => onPick(day) : undefined}
                disabled={!onPick}
                style={m.dayCell}
              >
                <View
                  style={[
                    m.dayDot,
                    on && { backgroundColor: colour },
                    !on && isToday && { borderWidth: 1.5, borderColor: colour },
                  ]}
                >
                  <Text style={[m.dayNum, { color: on ? "#ffffff" : t.fg }]}>{Number(day.slice(8))}</Text>
                </View>
                <View style={[m.mark, { backgroundColor: count && !on ? colour : "transparent" }]} />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export const MORE_VIEWS: Record<string, ViewFn> = {
  Accordion: function Accordion({ props, child }) {
    const { t } = useTheme();
    const [open, setOpen] = useState(props.open === true);
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          style={m.accHead}
        >
          {props.icon ? <IconBox icon={str(props.icon)} size="small" /> : null}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[type.small, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
              {str(props.title)}
            </Text>
            {props.subtitle ? (
              <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
                {str(props.subtitle)}
              </Text>
            ) : null}
          </View>
          <Text style={[type.heading, { color: t.fg3, transform: [{ rotate: open ? "90deg" : "0deg" }] }]}>
            ›
          </Text>
        </Pressable>
        {open ? (
          <View style={{ gap: 10, paddingBottom: 8 }}>{kids(props).map((c, i) => child(c, i))}</View>
        ) : null}
      </View>
    );
  },
  Hero: ({ props }) => {
    const { t, dark } = useTheme();
    const c = colourOf(t, dark, props.colour ?? "accent");
    const trend = numbers(props.trend, props.trendField);
    return (
      <View style={{ gap: 6 }}>
        <View style={m.heroHead}>
          {props.icon ? <IconBox icon={str(props.icon)} colour={props.colour} size="small" /> : null}
          <Text style={[m.heroLabel, { color: t.fg2 }]} numberOfLines={1}>
            {str(props.label).toUpperCase()}
          </Text>
        </View>
        <Text
          style={[m.heroFigure, { color: t.fg }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {shownValue(props.value, props.format)}
        </Text>
        {typeof props.change === "number" ? (
          <Change
            value={props.change}
            goodWhen={props.goodWhen}
            label={props.changeLabel ? str(props.changeLabel) : undefined}
          />
        ) : null}
        {trend.length > 1 ? <Spark values={trend} colour={c} height={44} /> : null}
      </View>
    );
  },
  Tile: ({ props }) => {
    const { t, dark } = useTheme();
    const c = colourOf(t, dark, props.colour ?? "accent");
    const run = props.action as (() => Promise<void>) | undefined;
    const body = (
      <>
        {props.icon ? <IconBox icon={str(props.icon)} colour={props.colour} size="small" /> : null}
        {props.value !== undefined ? (
          <Text
            style={[m.tileFigure, { color: t.fg }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {shownValue(props.value, props.format)}
          </Text>
        ) : null}
        <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={2}>
          {str(props.label)}
        </Text>
      </>
    );
    const style = [m.tile, { backgroundColor: soft(c, dark ? 0.18 : 0.1) }];
    return run ? (
      <Tap accessibilityRole="button" onPress={() => void run().catch(() => undefined)} style={style}>
        {body}
      </Tap>
    ) : (
      <View style={style}>{body}</View>
    );
  },
  Icon: ({ props }) => <IconBox icon={str(props.icon)} colour={props.colour} size={props.size} />,
  Avatar: ({ props }) => <Initials name={str(props.name)} size={props.size} />,
  AvatarStack: ({ props }) => {
    const { t } = useTheme();
    const names = (Array.isArray(props.names) ? props.names : []).map(str).filter(Boolean);
    const max = Math.max(1, Math.min(8, num(props.max) || 5));
    return (
      <View style={m.stack} accessibilityLabel={names.join(", ")}>
        {names.slice(0, max).map((n, i) => (
          // Each circle tucks only a little under the next, so the initials stay readable.
          <View key={`${n}${i}`} style={{ marginLeft: i ? -7 : 0 }}>
            <Initials name={n} size={36} ring={t.cell} />
          </View>
        ))}
        {names.length > max ? (
          <Text style={[type.caption, { color: t.fg2, marginLeft: 6 }]}>+{names.length - max}</Text>
        ) : null}
      </View>
    );
  },
  ProgressRing: ({ props }) => {
    const { t, dark } = useTheme();
    const v = Math.max(0, Math.min(1, num(props.value)));
    const c = colourOf(t, dark, props.colour ?? "accent");
    const size = props.size === "small" ? 64 : props.size === "large" ? 132 : 96;
    const stroke = size / 9;
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    return (
      <View
        style={{ alignItems: "center", gap: 6 }}
        accessibilityLabel={`${str(props.label)} ${Math.round(v * 100)}%`}
      >
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.fill} strokeWidth={stroke} fill="none" />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={c}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circ * v} ${circ}`}
            />
          </Svg>
          <View style={[StyleSheet.absoluteFill, m.centre]}>
            <Text style={[m.ringText, { color: t.fg, fontSize: size / 4.6 }]} numberOfLines={1}>
              {props.centre !== undefined ? str(props.centre) : `${Math.round(v * 100)}%`}
            </Text>
          </View>
        </View>
        {props.label ? (
          <Text style={[type.caption, { color: t.fg2, textAlign: "center" }]} numberOfLines={2}>
            {str(props.label)}
          </Text>
        ) : null}
      </View>
    );
  },
  Countdown: ({ props }) => {
    const { t, dark } = useTheme();
    const c = colourOf(t, dark, props.colour ?? "accent");
    const day = dayOf(props.date);
    const days = day
      ? Math.round(
          (Date.parse(`${day}T00:00:00`) - Date.parse(`${localDay(new Date())}T00:00:00`)) / 86_400_000,
        )
      : null;
    const big =
      days === null
        ? "–"
        : days === 0
          ? "Today"
          : days === 1
            ? "Tomorrow"
            : days < 0
              ? `${-days} days ago`
              : `${days} days`;
    return (
      <View style={[m.countdown, { backgroundColor: soft(c, dark ? 0.18 : 0.1) }]}>
        {props.icon ? <IconBox icon={str(props.icon)} colour={props.colour} size="large" /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
            {str(props.label)}
          </Text>
          <Text style={[m.countFigure, { color: c }]}>{big}</Text>
          {day ? <Text style={[type.caption, { color: t.fg2 }]}>{dayWords(day)}</Text> : null}
        </View>
      </View>
    );
  },
  Steps: ({ props }) => {
    const { t } = useTheme();
    const steps = (Array.isArray(props.steps) ? props.steps : []) as { title: string; detail?: string }[];
    const now = Math.round(num(props.current));
    return (
      <View style={{ gap: 0 }}>
        {steps.map((st, i) => {
          const done = i < now;
          const here = i === now;
          const c = done || here ? t.accent : t.fill2;
          return (
            <View key={`${st.title}${i}`} style={m.stepRow}>
              <View style={{ alignItems: "center" }}>
                <View
                  style={[
                    m.stepDot,
                    { backgroundColor: done ? t.accent : here ? t.cell : t.fill, borderColor: c },
                  ]}
                >
                  <Text style={[m.stepNum, { color: done ? t.onAccent : here ? t.accent : t.fg2 }]}>
                    {done ? "✓" : i + 1}
                  </Text>
                </View>
                {i < steps.length - 1 ? (
                  <View style={[m.stepLine, { backgroundColor: done ? t.accent : t.fill2 }]} />
                ) : null}
              </View>
              <View style={{ flex: 1, paddingTop: 3, paddingBottom: 14, gap: 2 }}>
                <Text style={[type.small, { color: done ? t.fg2 : t.fg, fontWeight: here ? "800" : "600" }]}>
                  {st.title}
                </Text>
                {st.detail ? <Text style={[type.caption, { color: t.fg2 }]}>{st.detail}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    );
  },
  Segmented: ({ props }) => {
    const { t } = useTheme();
    const set = props.setValue as ((v: string) => void) | undefined;
    const options = (Array.isArray(props.options) ? props.options : []) as string[];
    return (
      <View style={[m.segments, { backgroundColor: t.fill }]} accessibilityRole="tablist">
        {options.map((o) => {
          const on = props.value === o;
          return (
            <Tap
              key={o}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => set?.(o)}
              disabled={!set}
              haptic="selection"
              scale={0.97}
              style={[m.segment, on && [m.raised, { backgroundColor: t.cell, shadowColor: t.shadow }]]}
            >
              <Text style={[type.label, { color: on ? t.fg : t.fg2, fontSize: 14 }]} numberOfLines={1}>
                {o}
              </Text>
            </Tap>
          );
        })}
      </View>
    );
  },
  Search: ({ props }) => {
    const { t } = useTheme();
    const set = props.setValue as ((v: string) => void) | undefined;
    const value = str(props.value);
    return (
      <View style={[m.search, { backgroundColor: t.fill }]}>
        <Text style={{ fontSize: 15, opacity: 0.6 }}>🔍</Text>
        <TextInput
          value={value}
          onChangeText={(v) => set?.(v)}
          editable={!!set}
          placeholder={typeof props.placeholder === "string" ? props.placeholder : "Search"}
          placeholderTextColor={t.fg3}
          accessibilityLabel={typeof props.placeholder === "string" ? props.placeholder : "Search"}
          style={[type.body, m.searchInput, { color: t.fg }]}
        />
        {value ? (
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Clear"
            onPress={() => set?.("")}
            style={m.clear}
          >
            <Text style={[type.label, { color: t.fg2 }]}>×</Text>
          </Tap>
        ) : null}
      </View>
    );
  },
  Stepper: ({ props }) => {
    const { t } = useTheme();
    const set = props.setValue as ((v: number) => void) | undefined;
    const step = num(props.step) || 1;
    const min = props.min !== undefined ? num(props.min) : -Infinity;
    const max = props.max !== undefined ? num(props.max) : Infinity;
    const v = num(props.value);
    const go = (by: number) => set?.(Math.min(max, Math.max(min, Math.round((v + by) * 1e6) / 1e6)));
    return (
      <View style={m.stepper}>
        <Text style={[type.small, { color: t.fg, flex: 1, fontWeight: "600" }]}>{str(props.label)}</Text>
        <Tap
          accessibilityRole="button"
          accessibilityLabel={`Less ${str(props.label)}`}
          onPress={() => go(-step)}
          disabled={!set || v <= min}
          haptic="light"
          style={[m.stepBtn, { backgroundColor: t.fill }, (!set || v <= min) && m.off]}
        >
          <Text style={[m.stepSign, { color: t.fg }]}>−</Text>
        </Tap>
        <Text style={[m.stepValue, { color: t.fg }]}>{shownValue(v, props.format)}</Text>
        <Tap
          accessibilityRole="button"
          accessibilityLabel={`More ${str(props.label)}`}
          onPress={() => go(step)}
          disabled={!set || v >= max}
          haptic="light"
          style={[m.stepBtn, { backgroundColor: t.fill }, (!set || v >= max) && m.off]}
        >
          <Text style={[m.stepSign, { color: t.fg }]}>+</Text>
        </Tap>
      </View>
    );
  },
  Stars: ({ props }) => {
    const { t } = useTheme();
    const set = props.setValue as ((v: number) => void) | undefined;
    const max = Math.max(3, Math.min(10, num(props.max) || 5));
    const v = Math.round(num(props.value));
    return (
      <View style={{ gap: 4 }}>
        {props.label ? <Text style={[type.small, { color: t.fg2 }]}>{str(props.label)}</Text> : null}
        <View style={m.stars} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max, now: v }}>
          {Array.from({ length: max }, (_, i) => (
            <Pressable
              key={i}
              accessibilityLabel={`${i + 1} of ${max}`}
              onPress={() => set?.(i + 1 === v ? 0 : i + 1)}
              disabled={!set}
              style={m.star}
            >
              <Text style={{ fontSize: 26, color: i < v ? "#f5a524" : t.fill2 }}>★</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  },
  DateField: function DateField({ props }) {
    const { t } = useTheme();
    const set = props.setValue as ((v: string) => void) | undefined;
    const day = dayOf(props.value);
    const [open, setOpen] = useState(false);
    const [month, setMonth] = useState((day ?? localDay(new Date())).slice(0, 7));
    return (
      <View style={{ gap: 6 }}>
        <Text style={[type.small, { color: t.fg2 }]}>{str(props.label)}</Text>
        <Tap
          accessibilityRole="button"
          accessibilityLabel={`${str(props.label)}: ${day ? dayWords(day) : "none"}`}
          onPress={() => setOpen(!open)}
          disabled={!set}
          style={[
            m.dateBtn,
            { backgroundColor: t.fill, borderColor: open ? t.accent : t.hair },
            !set && m.off,
          ]}
        >
          <Text style={[type.body, { color: day ? t.fg : t.fg3, flex: 1 }]}>
            {day ? dayWords(day) : "Pick a day"}
          </Text>
          <Text style={{ fontSize: 16 }}>📅</Text>
        </Tap>
        {open ? (
          <MonthGrid
            month={month}
            onMonth={setMonth}
            selected={day}
            colour={t.accent}
            onPick={(d) => {
              set?.(d);
              setOpen(false);
            }}
          />
        ) : null}
      </View>
    );
  },
  Calendar: function Calendar({ props }) {
    const { t, dark } = useTheme();
    const c = colourOf(t, dark, props.colour ?? "accent");
    const set = props.setValue as ((v: string) => void) | undefined;
    const given = typeof props.month === "string" && /^\d{4}-\d{2}$/.test(props.month) ? props.month : null;
    const [month, setMonth] = useState(given ?? localDay(new Date()).slice(0, 7));
    const marks = new Map<string, number>();
    const df = typeof props.dateField === "string" ? props.dateField : "date";
    for (const r of itemsOf(props.data)) {
      const d = dayOf(r[df]);
      if (d) marks.set(d, (marks.get(d) ?? 0) + 1);
    }
    const picked = dayOf(props.value);
    return (
      <MonthGrid
        month={month}
        onMonth={setMonth}
        marks={marks}
        selected={picked}
        colour={c}
        onPick={set ? (d) => set(d === picked ? "" : d) : undefined}
      />
    );
  },
  ColumnChart: function ColumnChart({ props }) {
    const { t, dark } = useTheme();
    const rows = itemsOf(props.data).slice(-12);
    const lf = str(props.labelField) || "label";
    const fields =
      Array.isArray(props.fields) && props.fields.length
        ? (props.fields as { field: string; label: string; colour?: string }[])
        : [
            {
              field: str(props.valueField) || "value",
              label: "",
              colour: props.colour as string | undefined,
            },
          ];
    const colours = fields.map((f, i) =>
      colourOf(
        t,
        dark,
        f.colour ?? (fields.length > 1 ? SERIES[i % SERIES.length] : (props.colour ?? "accent")),
      ),
    );
    const totals = rows.map((r) => fields.reduce((s2, f) => s2 + Math.max(0, num(r[f.field])), 0));
    const top = Math.max(1, ...totals);
    const height = Math.min(280, Math.max(100, num(props.height) || 160));
    if (!rows.length) return <Text style={[type.small, { color: t.fg2 }]}>Nothing to show yet.</Text>;
    return (
      <View style={{ gap: 8 }}>
        <View style={[m.columns, { height }]}>
          <Text style={[m.axisTop, { color: t.fg3 }]}>{shortValue(top, props.format)}</Text>
          <View style={[m.gridLine, { borderColor: t.sep, top: 14 }]} />
          <View style={[m.gridLine, { borderColor: t.sep, top: 14 + (height - 14) / 2 }]} />
          {rows.map((r, i) => (
            <View
              key={i}
              style={m.column}
              accessibilityLabel={`${str(r[lf])}: ${shownValue(totals[i], props.format)}`}
            >
              <View style={{ flex: 1, justifyContent: "flex-end", width: "62%", maxWidth: 34 }}>
                {fields
                  .map((f, j) => ({ f, j }))
                  .reverse()
                  .map(({ f, j }) => (
                    <View
                      key={f.field}
                      style={{
                        height: `${(Math.max(0, num(r[f.field])) / top) * 100}%`,
                        backgroundColor: colours[j],
                        borderTopLeftRadius: j === fields.length - 1 || fields.length === 1 ? 6 : 0,
                        borderTopRightRadius: j === fields.length - 1 || fields.length === 1 ? 6 : 0,
                        minHeight: num(r[f.field]) > 0 ? 2 : 0,
                      }}
                    />
                  ))}
              </View>
            </View>
          ))}
        </View>
        <View style={m.columnLabels}>
          {rows.map((r, i) => (
            <Text key={i} style={[m.columnLabel, { color: t.fg2 }]} numberOfLines={1}>
              {str(r[lf])}
            </Text>
          ))}
        </View>
        {fields.length > 1 ? (
          <View style={m.legendWrap}>
            {fields.map((f, j) => (
              <View key={f.field} style={m.legendItem}>
                <View style={[m.swatch, { backgroundColor: colours[j] }]} />
                <Text style={[type.caption, { color: t.fg2 }]}>{f.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  },
  PieChart: ({ props }) => {
    const { t, dark } = useTheme();
    const listed = Array.isArray(props.slices) && props.slices.length ? props.slices : null;
    const lf = str(props.labelField) || "label";
    const vf = str(props.valueField) || "value";
    const all = (
      listed
        ? itemsOf(listed).map((x) => ({ label: str(x.label), value: num(x.value) }))
        : itemsOf(props.data).map((x) => ({ label: str(x[lf]), value: num(x[vf]) }))
    )
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value);
    // Six slices at most; the rest together as "Other".
    const slices =
      all.length > 6
        ? [...all.slice(0, 5), { label: "Other", value: all.slice(5).reduce((a, b) => a + b.value, 0) }]
        : all;
    const total = slices.reduce((a, b) => a + b.value, 0);
    if (!total) return <Text style={[type.small, { color: t.fg2 }]}>Nothing to show yet.</Text>;
    const donut = props.donut !== false;
    const size = 150;
    const stroke = donut ? 24 : size / 2;
    const r = donut ? (size - stroke) / 2 : size / 4;
    const circ = 2 * Math.PI * r;
    let at = 0;
    return (
      <View style={m.pie}>
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
            {slices.map((sl, i) => {
              const len = (sl.value / total) * circ;
              const gap = slices.length > 1 && donut ? 2 : 0;
              const el = (
                <Circle
                  key={sl.label + i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={colourOf(t, dark, SERIES[i % SERIES.length])}
                  strokeWidth={stroke}
                  fill="none"
                  strokeDasharray={`${Math.max(0.5, len - gap)} ${circ}`}
                  strokeDashoffset={-at}
                />
              );
              at += len;
              return el;
            })}
          </Svg>
          {donut ? (
            <View style={[StyleSheet.absoluteFill, m.centre]}>
              <Text style={[type.caption, { color: t.fg2 }]}>Total</Text>
              <Text style={[m.pieTotal, { color: t.fg }]} numberOfLines={1} adjustsFontSizeToFit>
                {props.centre !== undefined ? str(props.centre) : shortValue(total, props.format)}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 140, gap: 8 }}>
          {slices.map((sl, i) => (
            <View key={sl.label + i} style={m.legendRow}>
              <View style={[m.swatch, { backgroundColor: colourOf(t, dark, SERIES[i % SERIES.length]) }]} />
              <Text style={[type.small, { color: t.fg, flex: 1 }]} numberOfLines={1}>
                {sl.label}
              </Text>
              <Text style={[type.small, { color: t.fg2, fontVariant: ["tabular-nums"] }]}>
                {Math.round((sl.value / total) * 100)}%
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  },
  Sparkline: ({ props }) => {
    const { t, dark } = useTheme();
    return (
      <Spark
        values={numbers(props.data, props.valueField)}
        colour={colourOf(t, dark, props.colour ?? "accent")}
        height={Math.min(80, Math.max(20, num(props.height) || 36))}
      />
    );
  },
  Heatmap: function Heatmap({ props }) {
    const { t, dark } = useTheme();
    const c = colourOf(t, dark, props.colour ?? "green");
    const weeks = Math.max(4, Math.min(26, num(props.weeks) || 12));
    const [width, setWidth] = useState(0);
    const per = new Map<string, number>();
    const df = str(props.dateField) || "date";
    const vf = typeof props.valueField === "string" ? props.valueField : null;
    for (const r of itemsOf(props.data)) {
      const d = dayOf(r[df]);
      if (d) per.set(d, (per.get(d) ?? 0) + (vf ? num(r[vf]) : 1));
    }
    const top = Math.max(1, ...per.values());
    // Columns are weeks (Monday first), the last one this week.
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7);
    const gap = 3;
    const cell = width ? Math.min(22, Math.floor((width - gap * (weeks - 1)) / weeks)) : 0;
    const todayKey = localDay(today);
    return (
      <View style={{ gap: 6 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {props.label ? <Text style={[type.caption, { color: t.fg2 }]}>{str(props.label)}</Text> : null}
        {cell ? (
          <View style={{ flexDirection: "row", gap }}>
            {Array.from({ length: weeks }, (_, w) => (
              <View key={w} style={{ gap }}>
                {Array.from({ length: 7 }, (_, d) => {
                  const at = new Date(start);
                  at.setDate(start.getDate() + w * 7 + d);
                  const key = localDay(at);
                  const v = per.get(key) ?? 0;
                  const future = key > todayKey;
                  return (
                    <View
                      key={d}
                      style={{
                        width: cell,
                        height: cell,
                        borderRadius: cell / 4,
                        backgroundColor: future
                          ? "transparent"
                          : v
                            ? soft(c, 0.25 + 0.75 * (v / top))
                            : t.fill,
                      }}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}
        <View style={m.heatLegend}>
          <Text style={[type.caption, { color: t.fg3 }]}>Less</Text>
          {[0, 0.35, 0.65, 1].map((f) => (
            <View
              key={f}
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                backgroundColor: f ? soft(c, 0.25 + 0.75 * f) : t.fill,
              }}
            />
          ))}
          <Text style={[type.caption, { color: t.fg3 }]}>More</Text>
        </View>
      </View>
    );
  },
  Table: ({ props }) => {
    const { t } = useTheme();
    const cols = (Array.isArray(props.columns) ? props.columns : []) as {
      label: string;
      field: string;
      format?: string;
      align?: string;
    }[];
    const all = itemsOf(props.data);
    const rows = all.slice(0, Math.max(1, Math.min(100, num(props.max) || 20)));
    const right = (c: (typeof cols)[number]) =>
      c.align === "end" ||
      (c.align !== "start" && (c.format === "money" || c.format === "number" || c.format === "percent"));
    const flexOf = (i: number) => (i === 0 ? 1.6 : 1);
    if (!rows.length)
      return (
        <Text style={[type.small, { color: t.fg2 }]}>
          {typeof props.empty === "string" ? props.empty : "Nothing here."}
        </Text>
      );
    return (
      <View>
        <View style={[m.tr, { borderBottomColor: t.sep, borderBottomWidth: StyleSheet.hairlineWidth }]}>
          {cols.map((c, i) => (
            <Text
              key={c.field + i}
              style={[m.th, { color: t.fg2, flex: flexOf(i), textAlign: right(c) ? "right" : "left" }]}
              numberOfLines={1}
            >
              {c.label.toUpperCase()}
            </Text>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View key={ri} style={[m.tr, ri % 2 === 1 && { backgroundColor: soft(t.fg, 0.03) }]}>
            {cols.map((c, i) => (
              <Text
                key={c.field + i}
                style={[
                  type.small,
                  m.td,
                  { color: i === 0 ? t.fg : t.fg2, flex: flexOf(i), textAlign: right(c) ? "right" : "left" },
                  i === 0 && { fontWeight: "600" },
                  right(c) && { fontVariant: ["tabular-nums"] },
                ]}
                numberOfLines={1}
              >
                {shownValue(r[c.field], c.format)}
              </Text>
            ))}
          </View>
        ))}
        {props.total === true ? (
          <View style={[m.tr, { borderTopColor: t.sep, borderTopWidth: 1 }]}>
            {cols.map((c, i) => {
              const sums = c.format === "money" || c.format === "number";
              return (
                <Text
                  key={c.field + i}
                  style={[
                    type.small,
                    m.td,
                    {
                      color: t.fg,
                      fontWeight: "800",
                      flex: flexOf(i),
                      textAlign: right(c) ? "right" : "left",
                    },
                  ]}
                  numberOfLines={1}
                >
                  {i === 0
                    ? "Total"
                    : sums
                      ? shownValue(
                          all.reduce((a, r) => a + num(r[c.field]), 0),
                          c.format,
                        )
                      : ""}
                </Text>
              );
            })}
          </View>
        ) : null}
        {all.length > rows.length ? (
          <Text style={[type.caption, { color: t.fg3, paddingTop: 6 }]}>
            and {all.length - rows.length} more
          </Text>
        ) : null}
      </View>
    );
  },
  Timeline: ({ props }) => {
    const { t } = useTheme();
    const rows = itemsOf(props.data).slice(0, Math.max(1, Math.min(50, num(props.max) || 8)));
    const tf = str(props.titleField) || "title";
    if (!rows.length)
      return (
        <Text style={[type.small, { color: t.fg2 }]}>
          {typeof props.empty === "string" ? props.empty : "Nothing here."}
        </Text>
      );
    return (
      <View>
        {rows.map((r, i) => (
          <View key={i} style={m.tlRow}>
            <View style={{ alignItems: "center", width: 14 }}>
              <View
                style={[m.tlDot, { backgroundColor: i === 0 ? t.accent : t.cell, borderColor: t.accent }]}
              />
              {i < rows.length - 1 ? <View style={[m.tlLine, { backgroundColor: t.fill2 }]} /> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2, paddingBottom: 14 }}>
              {typeof props.dateField === "string" && r[props.dateField] ? (
                <Text style={[type.caption, { color: t.fg2 }]}>{dayWords(r[props.dateField])}</Text>
              ) : null}
              <Text style={[type.small, { color: t.fg, fontWeight: "700" }]} numberOfLines={2}>
                {str(r[tf])}
              </Text>
              {typeof props.detailField === "string" && r[props.detailField] ? (
                <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={2}>
                  {str(r[props.detailField])}
                </Text>
              ) : null}
            </View>
            {typeof props.amountField === "string" &&
            r[props.amountField] !== undefined &&
            r[props.amountField] !== null ? (
              <Text style={[type.small, { color: t.fg, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>
                {shownValue(r[props.amountField], "money")}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    );
  },
  Board: ({ props }) => {
    const { t, dark } = useTheme();
    const set = props.setData as ((v: Item[]) => void) | undefined;
    const all = itemsOf(props.data);
    const gf = str(props.groupField);
    const tf = str(props.titleField) || "title";
    const columns = (Array.isArray(props.columns) ? props.columns : []).map(str);
    const move = (r: Item) => {
      const at = columns.indexOf(str(r[gf]));
      const next = columns[(at + 1) % columns.length]!;
      set?.(all.map((x) => (x === r ? { ...x, [gf]: next } : x)));
    };
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={m.board}>
        {columns.map((col, ci) => {
          const c = colourOf(t, dark, SERIES[ci % SERIES.length]);
          const here = all.filter((r) => str(r[gf]) === col || (ci === 0 && !columns.includes(str(r[gf]))));
          return (
            <View key={col} style={[m.boardCol, { backgroundColor: t.fill }]}>
              <View style={m.boardHead}>
                <View style={[m.swatch, { backgroundColor: c }]} />
                <Text style={[type.label, { color: t.fg, flex: 1, fontSize: 14 }]} numberOfLines={1}>
                  {col}
                </Text>
                <Text style={[type.caption, { color: t.fg2 }]}>{here.length}</Text>
              </View>
              {here.slice(0, 20).map((r, i) => (
                <View key={i} style={[m.boardCard, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={[type.small, { color: t.fg, fontWeight: "700" }]} numberOfLines={2}>
                      {str(r[tf])}
                    </Text>
                    {typeof props.subtitleField === "string" && r[props.subtitleField] ? (
                      <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
                        {shownValue(
                          r[props.subtitleField],
                          dayOf(r[props.subtitleField]) ? "date" : undefined,
                        )}
                      </Text>
                    ) : null}
                    {typeof props.amountField === "string" && r[props.amountField] ? (
                      <Text style={[type.caption, { color: t.fg, fontWeight: "700" }]}>
                        {shownValue(r[props.amountField], "money")}
                      </Text>
                    ) : null}
                  </View>
                  {set ? (
                    <Tap
                      accessibilityRole="button"
                      accessibilityLabel={`Move ${str(r[tf])} to ${columns[(columns.indexOf(str(r[gf])) + 1) % columns.length]}`}
                      onPress={() => move(r)}
                      haptic="light"
                      style={m.moveBtn}
                    >
                      <Text style={[type.label, { color: t.accent }]}>→</Text>
                    </Tap>
                  ) : null}
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    );
  },
};

const m = StyleSheet.create({
  changeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  change: {
    fontSize: 12.5,
    fontWeight: "800",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  accHead: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 6 },
  heroHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroLabel: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.7, flex: 1 },
  heroFigure: {
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: -1.6,
    fontVariant: ["tabular-nums"],
    lineHeight: 46,
  },
  tile: { borderRadius: 18, padding: 12, gap: 6, minHeight: 96, justifyContent: "flex-end" },
  tileFigure: { fontSize: 20, fontWeight: "800", letterSpacing: -0.6, fontVariant: ["tabular-nums"] },
  stack: { flexDirection: "row", alignItems: "center" },
  centre: { alignItems: "center", justifyContent: "center" },
  ringText: { fontWeight: "800", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  countdown: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 18, padding: 14 },
  countFigure: { fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
  stepRow: { flexDirection: "row", gap: 12 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNum: { fontSize: 13, fontWeight: "800" },
  stepLine: { width: 2, flex: 1, minHeight: 12, marginVertical: 2 },
  segments: { flexDirection: "row", borderRadius: 12, padding: 3, gap: 3, alignSelf: "stretch" },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  raised: { shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingLeft: 12,
    minHeight: 44,
  },
  searchInput: { flex: 1, minHeight: 44, paddingVertical: 0 },
  clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  stepSign: { fontSize: 22, fontWeight: "700", lineHeight: 26 },
  stepValue: {
    minWidth: 48,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  off: { opacity: 0.4 },
  stars: { flexDirection: "row" },
  star: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dateBtn: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  monthHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  week: { flexDirection: "row" },
  weekDay: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700" },
  dayCell: { flex: 1, alignItems: "center", minHeight: 44, justifyContent: "center" },
  dayDot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  mark: { width: 5, height: 5, borderRadius: 3, marginTop: 1 },
  columns: { flexDirection: "row", alignItems: "flex-end", gap: 4, paddingTop: 14 },
  column: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  axisTop: { position: "absolute", top: 0, left: 0, fontSize: 10.5, fontWeight: "700" },
  gridLine: { position: "absolute", left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth },
  columnLabels: { flexDirection: "row", gap: 4 },
  columnLabel: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "600" },
  legendWrap: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  pie: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 18 },
  pieTotal: { fontSize: 20, fontWeight: "800", letterSpacing: -0.5, maxWidth: 96 },
  heatLegend: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end" },
  tr: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 4 },
  th: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  td: { paddingVertical: 8 },
  tlRow: { flexDirection: "row", gap: 12 },
  tlDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, marginTop: 3 },
  tlLine: { width: 2, flex: 1, marginVertical: 2 },
  board: { gap: 10, paddingRight: 4 },
  boardCol: { width: 230, borderRadius: 16, padding: 10, gap: 8 },
  boardHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  boardCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    padding: 10,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  moveBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -6 },
});
