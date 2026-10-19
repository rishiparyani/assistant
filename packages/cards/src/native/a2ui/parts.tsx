// How each A2UI part looks in the app (decision 2026-10-18 "Try A2UI"): the app's theme, type
// scale, ticks and tap feedback; 44-point targets. The definitions (names, properties) are in
// "@assistant/cards/a2ui"; this file only draws them.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { PART_APIS, dayOf } from "../../a2ui/catalog.ts";
import { Tap } from "../press.tsx";
import { Text, TextInput } from "../text.tsx";
import { Tick } from "../tick.tsx";
import { radius, type, useTheme } from "../theme.ts";
import {
  DateTile,
  IconBox,
  Initials,
  Pill,
  SERIES,
  colourOf,
  kids,
  markConfirmed,
  num,
  numbers,
  shownValue,
  soft,
  str,
  toneOf,
  type Tone,
} from "./kit.tsx";
import { MORE_VIEWS, Change, Spark } from "./more.tsx";
import type { PartProps, PartView, ChildRef } from "./player.tsx";

export { shownValue } from "./kit.tsx";
const GAP = { none: 0, small: 6, medium: 12, large: 20 } as const;

type ViewFn = (p: PartProps) => ReactNode;

const views: Record<string, ViewFn> = {
  Column: ({ props, child }) => (
    <View style={{ gap: GAP[(props.gap as keyof typeof GAP) ?? "medium"] ?? 12 }}>
      {kids(props).map((c, i) => child(c, i))}
    </View>
  ),
  Row: ({ props, child }) => (
    <View
      style={[
        s.row,
        // Spaced out: what doesn't fit goes to the next line rather than off the card.
        props.align ? { flexWrap: "wrap" } : null,
        {
          justifyContent:
            props.align === "spread"
              ? "space-between"
              : props.align === "center"
                ? "center"
                : props.align === "end"
                  ? "flex-end"
                  : "flex-start",
        },
      ]}
    >
      {kids(props).map((c, i) => (
        <View key={i} style={props.align ? null : s.share}>
          {child(c, i)}
        </View>
      ))}
    </View>
  ),
  Grid: ({ props, child }) => {
    const cols = props.columns === 3 ? 3 : 2;
    const items = kids(props);
    const rows: ChildRef[][] = [];
    for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
    return (
      <View style={{ gap: 10 }}>
        {rows.map((row, r) => (
          <View key={r} style={s.row}>
            {row.map((c, i) => (
              <View key={i} style={s.share}>
                {child(c, r * cols + i)}
              </View>
            ))}
            {Array.from({ length: cols - row.length }, (_, i) => (
              <View key={`pad${i}`} style={s.share} />
            ))}
          </View>
        ))}
      </View>
    );
  },
  Card: ({ props, child }) => {
    const { t, dark } = useTheme();
    // A colour washes the card in it, like the home's cards (decision 2026-10-16 "Soft coloured cards").
    const c = props.colour ? colourOf(t, dark, props.colour) : null;
    return (
      <View
        style={[
          s.card,
          { backgroundColor: t.cell, borderColor: t.hair, shadowColor: t.shadow },
          c && { backgroundColor: soft(c, dark ? 0.16 : 0.08), borderColor: soft(c, dark ? 0.3 : 0.2) },
        ]}
      >
        {props.title || props.subtitle ? (
          <View style={s.head}>
            {props.icon ? <IconBox icon={str(props.icon)} colour={props.colour} size="medium" /> : null}
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              {props.title ? <Text style={[type.heading, { color: t.fg }]}>{str(props.title)}</Text> : null}
              {props.subtitle ? (
                <Text style={[type.caption, { color: t.fg2 }]}>{str(props.subtitle)}</Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {kids(props).map((c, i) => child(c, i))}
      </View>
    );
  },
  Section: ({ props, child }) => {
    const { t } = useTheme();
    const run = props.action as (() => Promise<void>) | undefined;
    return (
      <View style={{ gap: 10 }}>
        <View style={s.kv}>
          <Text style={[s.eyebrow, { color: t.fg2, flexShrink: 1 }]} numberOfLines={1}>
            {props.icon ? `${str(props.icon)}  ` : ""}
            {str(props.title).toUpperCase()}
          </Text>
          {run && props.actionLabel ? (
            <Tap accessibilityRole="button" onPress={() => void run().catch(() => undefined)} style={s.link}>
              <Text style={[type.label, { color: t.accent, fontSize: 14 }]}>{str(props.actionLabel)} ›</Text>
            </Tap>
          ) : null}
        </View>
        {kids(props).map((c, i) => child(c, i))}
      </View>
    );
  },
  Tabs: function Tabs({ props, child }) {
    const { t } = useTheme();
    const tabs = (Array.isArray(props.tabs) ? props.tabs : []) as { title: string; child: string }[];
    const [open, setOpen] = useState(0);
    if (!tabs.length) return null;
    const at = Math.min(open, tabs.length - 1);
    return (
      <View style={{ gap: 14 }}>
        <View style={[s.tabs, { backgroundColor: t.fill }]} accessibilityRole="tablist">
          {tabs.map((tab, i) => (
            <Tap
              key={`${tab.title}${i}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === at }}
              onPress={() => setOpen(i)}
              haptic="selection"
              scale={0.97}
              style={[s.tab, i === at && [s.raised, { backgroundColor: t.cell, shadowColor: t.shadow }]]}
            >
              <Text style={[type.label, { color: i === at ? t.fg : t.fg2, fontSize: 14 }]} numberOfLines={1}>
                {tab.title}
              </Text>
            </Tap>
          ))}
        </View>
        {child(tabs[at]!.child)}
      </View>
    );
  },
  Divider: () => {
    const { t } = useTheme();
    return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.sep }} />;
  },
  Text: ({ props }) => {
    const { t } = useTheme();
    const styles = ["display", "title", "heading", "body", "small", "caption"] as const;
    type Style = (typeof styles)[number];
    const style: Style = (styles as readonly string[]).includes(String(props.style))
      ? (props.style as Style)
      : "body";
    return (
      <Text
        style={[
          style === "display" ? s.display : type[style],
          { color: toneOf(t, props.tone, style === "caption" ? t.fg2 : t.fg) },
          props.align === "center" || props.align === "end"
            ? { textAlign: props.align === "end" ? "right" : "center" }
            : null,
        ]}
      >
        {str(props.text)}
      </Text>
    );
  },
  Stat: ({ props }) => {
    const { t, dark } = useTheme();
    const c = props.colour ? colourOf(t, dark, props.colour) : null;
    const trend = numbers(props.trend, props.trendField);
    return (
      <View style={[s.stat, { backgroundColor: c ? soft(c, dark ? 0.18 : 0.1) : t.fill }]}>
        <View style={s.statHead}>
          {props.icon ? <IconBox icon={str(props.icon)} colour={props.colour} size="small" /> : null}
          <Text style={[type.caption, { color: t.fg2, flex: 1 }]} numberOfLines={1}>
            {str(props.label)}
          </Text>
        </View>
        <Text
          style={[s.figure, { color: toneOf(t, props.tone) }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.55}
        >
          {shownValue(props.value, props.format)}
        </Text>
        {typeof props.change === "number" ? <Change value={props.change} goodWhen={props.goodWhen} /> : null}
        {trend.length > 1 ? <Spark values={trend} colour={c ?? t.accent} height={28} /> : null}
        {props.hint ? (
          <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={2}>
            {str(props.hint)}
          </Text>
        ) : null}
      </View>
    );
  },
  KeyValue: ({ props }) => {
    const { t } = useTheme();
    return (
      <View style={s.kv}>
        <Text style={[type.small, { color: t.fg2, flexShrink: 0 }]}>{str(props.label)}</Text>
        <Text style={[type.small, { color: t.fg, fontWeight: "700", flexShrink: 1, textAlign: "right" }]}>
          {shownValue(props.value, props.format)}
        </Text>
      </View>
    );
  },
  Badge: ({ props }) => (
    <Pill text={str(props.text)} tone={props.tone as Tone} icon={props.icon ? str(props.icon) : undefined} />
  ),
  Progress: ({ props }) => {
    const { t } = useTheme();
    const target = props.target !== undefined ? num(props.target) : null;
    const current = props.current !== undefined ? num(props.current) : null;
    // With a target, the bar is what's used of it, and runs red past it (a budget).
    const raw = target && current !== null ? current / target : num(props.value);
    const v = Math.max(0, Math.min(1, raw));
    const c = raw > 1 ? t.danger : toneOf(t, props.tone, t.accent);
    const right =
      target !== null && current !== null
        ? `${shownValue(current, props.format)} of ${shownValue(target, props.format)}`
        : `${Math.round(v * 100)}%`;
    return (
      <View style={{ gap: 6 }}>
        {props.label || target !== null ? (
          <View style={s.kv}>
            <Text style={[type.small, { color: t.fg2, flexShrink: 1 }]} numberOfLines={1}>
              {str(props.label)}
            </Text>
            <Text style={[type.small, { color: raw > 1 ? t.danger : t.fg, fontWeight: "700" }]}>{right}</Text>
          </View>
        ) : null}
        <View style={[s.track, { backgroundColor: t.fill }]}>
          <View style={[s.bar, { width: `${v * 100}%`, backgroundColor: c }]} />
        </View>
      </View>
    );
  },
  Notice: ({ props }) => {
    const { t } = useTheme();
    const c = toneOf(t, props.tone ?? "accent", t.accent);
    return (
      <View style={[s.notice, { backgroundColor: soft(c, 0.12) }]}>
        {props.icon ? <Text style={s.noticeIcon}>{str(props.icon)}</Text> : null}
        <View style={{ flex: 1, gap: 2 }}>
          {props.title ? (
            <Text style={[type.small, { color: c, fontWeight: "800" }]}>{str(props.title)}</Text>
          ) : null}
          <Text style={[type.small, { color: t.fg }]}>{str(props.text)}</Text>
        </View>
      </View>
    );
  },
  Picker: ({ props }) => {
    const { t } = useTheme();
    const set = props.setValue as ((v: string) => void) | undefined;
    const options = (Array.isArray(props.options) ? props.options : []) as string[];
    return (
      <View style={s.wrap} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = props.value === o;
          return (
            <Tap
              key={o}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => set?.(o)}
              disabled={!set}
              haptic="selection"
              scale={0.95}
              style={[s.chip, { backgroundColor: on ? t.accent : t.fill }, !set && s.off]}
            >
              <Text style={[type.label, { color: on ? t.onAccent : t.fg, fontSize: 14 }]}>{o}</Text>
            </Tap>
          );
        })}
      </View>
    );
  },
  Chips: ({ props }) => {
    const { t } = useTheme();
    const set = props.setValue as ((v: string[]) => void) | undefined;
    const picked = (Array.isArray(props.value) ? props.value : []) as string[];
    const options = (Array.isArray(props.options) ? props.options : []) as string[];
    return (
      <View style={s.wrap}>
        {options.map((o) => {
          const on = picked.includes(o);
          return (
            <Tap
              key={o}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => set?.(on ? picked.filter((x) => x !== o) : [...picked, o])}
              disabled={!set}
              haptic="selection"
              scale={0.95}
              style={[
                s.chip,
                { backgroundColor: on ? t.accentSoft : t.fill, borderColor: on ? t.accent : "transparent" },
                !set && s.off,
              ]}
            >
              <Text style={[type.label, { color: on ? t.accent : t.fg, fontSize: 14 }]}>
                {on ? "✓ " : ""}
                {o}
              </Text>
            </Tap>
          );
        })}
      </View>
    );
  },
  Slider: function Slider({ props }) {
    const { t } = useTheme();
    const min = num(props.min);
    const max = Math.max(min + 1, num(props.max));
    const step = num(props.step) || (max - min) / 100;
    const set = props.setValue as ((v: number) => void) | undefined;
    const value = Math.min(max, Math.max(min, num(props.value)));
    const [width, setWidth] = useState(0);
    const at = (x: number) => {
      if (!width) return;
      const f = Math.min(1, Math.max(0, x / width));
      const v = Math.round((min + f * (max - min)) / step) * step;
      if (v !== value) set?.(Math.min(max, Math.max(min, v)));
    };
    const f = (value - min) / (max - min);
    return (
      <View style={{ gap: 6 }}>
        <View style={s.kv}>
          <Text style={[type.small, { color: t.fg2 }]}>{str(props.label)}</Text>
          <Text style={[type.small, { color: t.fg, fontWeight: "800", fontVariant: ["tabular-nums"] }]}>
            {shownValue(value, props.format)}
          </Text>
        </View>
        <View
          style={[s.sliderHit, !set && s.off]}
          pointerEvents={set ? "auto" : "none"}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => at(e.nativeEvent.locationX)}
          onResponderMove={(e) => at(e.nativeEvent.locationX)}
          accessibilityRole="adjustable"
          accessibilityLabel={str(props.label)}
          accessibilityValue={{ text: shownValue(value, props.format) }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) =>
            set?.(
              Math.min(max, Math.max(min, value + (e.nativeEvent.actionName === "increment" ? step : -step))),
            )
          }
        >
          <View pointerEvents="none" style={[s.sliderTrack, { backgroundColor: t.fill }]}>
            <View style={[s.bar, { width: `${f * 100}%`, backgroundColor: t.accent }]} />
          </View>
          <View
            pointerEvents="none"
            style={[
              s.thumb,
              { left: Math.max(0, f * width - 13), backgroundColor: t.cell, borderColor: t.accent },
            ]}
          />
        </View>
      </View>
    );
  },
  Switch: ({ props }) => {
    const { t } = useTheme();
    const on = props.value === true;
    const set = props.setValue as ((v: boolean) => void) | undefined;
    return (
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        accessibilityLabel={str(props.label)}
        onPress={() => set?.(!on)}
        disabled={!set}
        style={[s.switchRow, !set && s.off]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.small, { color: t.fg, fontWeight: "600" }]}>{str(props.label)}</Text>
          {props.hint ? <Text style={[type.caption, { color: t.fg2 }]}>{str(props.hint)}</Text> : null}
        </View>
        <View style={[s.switch, { backgroundColor: on ? t.accent : t.fill2 }]}>
          <View style={[s.knob, { backgroundColor: "#ffffff", marginLeft: on ? 20 : 2 }]} />
        </View>
      </Pressable>
    );
  },
  Radio: ({ props }) => {
    const { t } = useTheme();
    const set = props.setValue as ((v: string) => void) | undefined;
    const options = (Array.isArray(props.options) ? props.options : []) as string[];
    return (
      <View style={{ gap: 2 }} accessibilityRole="radiogroup">
        {props.label ? (
          <Text style={[type.small, { color: t.fg2, marginBottom: 2 }]}>{str(props.label)}</Text>
        ) : null}
        {options.map((o) => {
          const on = props.value === o;
          return (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => set?.(o)}
              disabled={!set}
              style={[s.radioRow, !set && s.off]}
            >
              <View style={[s.radio, { borderColor: on ? t.accent : t.fg3 }]}>
                {on ? <View style={[s.radioDot, { backgroundColor: t.accent }]} /> : null}
              </View>
              <Text style={[type.body, { color: t.fg }]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  },
  Field: function Field({ props }) {
    const { t } = useTheme();
    const kind = props.kind === "number" || props.kind === "money" ? props.kind : "text";
    const set = props.setValue as ((v: unknown) => void) | undefined;
    const shown =
      props.value === undefined || props.value === null
        ? ""
        : kind === "money"
          ? String(num(props.value) / 100)
          : String(props.value);
    const [text, setText] = useState(shown);
    // Follow the data when it changes from elsewhere (not while typing the same value).
    const last = useRef(shown);
    useEffect(() => {
      if (shown !== last.current) setText(shown);
      last.current = shown;
    }, [shown]);
    return (
      <View style={{ gap: 6 }}>
        <Text style={[type.small, { color: t.fg2 }]}>{str(props.label)}</Text>
        <TextInput
          value={text}
          placeholder={typeof props.placeholder === "string" ? props.placeholder : undefined}
          placeholderTextColor={t.fg3}
          keyboardType={kind === "text" ? "default" : "decimal-pad"}
          onChangeText={(v) => {
            setText(v);
            if (kind === "text") set?.(v);
            else {
              const n = Number(v.replace(/[^0-9.]/g, ""));
              const value = Number.isFinite(n) ? (kind === "money" ? Math.round(n * 100) : n) : 0;
              last.current = kind === "money" ? String(value / 100) : String(value);
              set?.(value);
            }
          }}
          accessibilityLabel={str(props.label)}
          editable={!!set}
          style={[
            type.body,
            s.field,
            !set && s.off,
            { color: t.fg, backgroundColor: t.fill, borderColor: t.hair },
          ]}
        />
      </View>
    );
  },
  Button: function Button({ props }) {
    const { t } = useTheme();
    const run = props.action as (() => Promise<void>) | undefined;
    const [asking, setAsking] = useState(false);
    useEffect(() => {
      if (!asking) return;
      const later = setTimeout(() => setAsking(false), 3500);
      return () => clearTimeout(later);
    }, [asking]);
    const style = props.style === "danger" ? "danger" : props.style === "secondary" ? "secondary" : "primary";
    const bg = style === "primary" ? t.accent : style === "danger" ? soft(t.danger, 0.12) : t.fill;
    const fg = style === "primary" ? t.onAccent : style === "danger" ? t.danger : t.fg;
    return (
      <Tap
        accessibilityRole="button"
        onPress={() => {
          // "confirm": the first tap asks, the second acts.
          if (typeof props.confirm === "string" && props.confirm && !asking) return setAsking(true);
          if (asking) markConfirmed();
          setAsking(false);
          void run?.().catch(() => undefined);
        }}
        haptic="light"
        style={[s.button, { backgroundColor: bg }]}
      >
        <Text style={[type.label, { color: fg }]}>{asking ? str(props.confirm) : str(props.label)}</Text>
      </Tap>
    );
  },
  List: ({ props, child }) => {
    const { t } = useTheme();
    const rows = kids(props);
    // No lines between rows: a row the card hides (a filter) would leave its line behind.
    return (
      <View style={{ gap: 2 }}>
        {rows.map((c, i) => (
          <View key={typeof c === "string" ? c : c.basePath}>{child(c, i)}</View>
        ))}
        {rows.length === 0 ? (
          <Text style={[type.small, { color: t.fg2, paddingVertical: 10 }]}>
            {typeof props.empty === "string" ? props.empty : "Nothing here."}
          </Text>
        ) : null}
      </View>
    );
  },
  ItemRow: ({ props }) => {
    const { t } = useTheme();
    const run = props.action as (() => Promise<void>) | undefined;
    const day = dayOf(props.date);
    const body = (
      <>
        {day ? (
          <DateTile day={day} />
        ) : props.avatar ? (
          <Initials name={str(props.avatar)} />
        ) : props.icon ? (
          <IconBox icon={str(props.icon)} colour={props.colour} />
        ) : null}
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
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {typeof props.amount === "number" ? (
            <Text style={[type.small, { color: t.fg, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>
              {shownValue(props.amount, "money")}
            </Text>
          ) : null}
          {props.badge ? <Pill text={str(props.badge)} tone={props.badgeTone as Tone} /> : null}
        </View>
      </>
    );
    const style = [s.itemRow, props.selected === true && { backgroundColor: t.accentSoft }];
    return run ? (
      <Pressable accessibilityRole="button" onPress={() => void run().catch(() => undefined)} style={style}>
        {body}
      </Pressable>
    ) : (
      <View style={style}>{body}</View>
    );
  },
  CheckRow: ({ props }) => {
    const { t } = useTheme();
    const done = props.checked === true;
    const set = props.setChecked as ((v: boolean) => void) | undefined;
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={str(props.label)}
        onPress={() => set?.(!done)}
        disabled={!set}
        style={[s.checkRow, !set && s.off]}
      >
        <Tick done={done} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.small, { color: done ? t.fg2 : t.fg, fontWeight: "600" }]} numberOfLines={1}>
            {str(props.label)}
          </Text>
          {props.detail ? (
            <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
              {str(props.detail)}
            </Text>
          ) : null}
        </View>
        {typeof props.amount === "number" ? (
          <Text style={[type.small, { color: done ? t.fg2 : t.fg, fontVariant: ["tabular-nums"] }]}>
            {shownValue(props.amount, "money")}
          </Text>
        ) : null}
      </Pressable>
    );
  },
  BarChart: ({ props }) => {
    const { t, dark } = useTheme();
    const bars = series(props, "bars").slice(0, 12);
    const one = colourOf(t, dark, props.colour ?? "accent");
    const top = Math.max(1, ...bars.map((b) => b.value));
    if (!bars.length) return <Text style={[type.small, { color: t.fg2 }]}>Nothing to show yet.</Text>;
    return (
      <View style={{ gap: 8 }}>
        {bars.map((b, i) => (
          <View key={`${b.label}${i}`} style={{ gap: 4 }}>
            <View style={s.kv}>
              <Text style={[type.small, { color: t.fg }]} numberOfLines={1}>
                {b.label}
              </Text>
              <Text style={[type.small, { color: t.fg2, fontVariant: ["tabular-nums"] }]}>
                {shownValue(b.value, props.format)}
              </Text>
            </View>
            <View style={[s.track, { backgroundColor: t.fill }]}>
              <View
                style={[
                  s.bar,
                  {
                    width: `${Math.max(2, (Math.max(0, b.value) / top) * 100)}%`,
                    backgroundColor:
                      props.multicolour === true ? colourOf(t, dark, SERIES[i % SERIES.length]) : one,
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    );
  },
  LineChart: function LineChart({ props }) {
    const { t, dark } = useTheme();
    const c = colourOf(t, dark, props.colour ?? "accent");
    const { width: screen } = useWindowDimensions();
    const [width, setWidth] = useState(Math.min(screen - 64, 600));
    const height = Math.min(260, Math.max(80, num(props.height) || 150));
    const pts = series(props, "points").slice(0, 120);
    if (pts.length < 2) return <Text style={[type.small, { color: t.fg2 }]}>Not enough points to draw.</Text>;
    // A second line (last month, a target), dotted, on the same scale.
    const before = series({ ...props, data: props.compareData }, "compare").slice(0, pts.length);
    const values = [...pts.map((p) => p.value), ...before.map((p) => p.value)];
    const lo = Math.min(0, ...values);
    const hi = Math.max(...values, lo + 1);
    const pad = 8;
    const x = (i: number) => pad + (i / (pts.length - 1)) * (width - pad * 2);
    const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const area = `${line} L${x(pts.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
    const back =
      before.length > 1
        ? before.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")
        : null;
    const last = pts[pts.length - 1]!;
    return (
      <View style={{ gap: 6 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={s.kv}>
          <Text style={[type.caption, { color: t.fg2 }]}>{shownValue(hi, props.format)}</Text>
          <Text style={[type.caption, { color: t.fg }]}>
            {last.label}: {shownValue(last.value, props.format)}
          </Text>
        </View>
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c} stopOpacity={0.28} />
              <Stop offset="1" stopColor={c} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill="url(#fill)" />
          {back ? <Path d={back} stroke={t.fg3} strokeWidth={2} strokeDasharray="5 5" fill="none" /> : null}
          <Path d={line} stroke={c} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
          <Circle
            cx={x(pts.length - 1)}
            cy={y(last.value)}
            r={4.5}
            fill={c}
            stroke={t.cell}
            strokeWidth={2}
          />
        </Svg>
        <View style={s.kv}>
          <Text style={[type.caption, { color: t.fg2 }]}>{pts[0]!.label}</Text>
          <Text style={[type.caption, { color: t.fg2 }]}>{last.label}</Text>
        </View>
        {back ? (
          <View style={s.legend}>
            <View style={[s.swatch, { backgroundColor: c }]} />
            <Text style={[type.caption, { color: t.fg2 }]}>
              {typeof props.label === "string" ? props.label : "Now"}
            </Text>
            <View style={[s.swatch, { backgroundColor: t.fg3, marginLeft: 10 }]} />
            <Text style={[type.caption, { color: t.fg2 }]}>
              {typeof props.compareLabel === "string" ? props.compareLabel : "Before"}
            </Text>
          </View>
        ) : null}
      </View>
    );
  },
  ...MORE_VIEWS,
};

/** A chart's points: its own list, or a data list read by labelField / valueField. */
export function series(props: Record<string, unknown>, own: string): { label: string; value: number }[] {
  const listed = props[own];
  if (Array.isArray(listed) && listed.length)
    return listed.map((p) => ({
      label: str((p as { label?: unknown }).label),
      value: num((p as { value?: unknown }).value),
    }));
  const data = props.data;
  if (!Array.isArray(data)) return [];
  const lf = typeof props.labelField === "string" ? props.labelField : "label";
  const vf = typeof props.valueField === "string" ? props.valueField : "value";
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({ label: str(r[lf]), value: num(r[vf]) }));
}

/** The app's parts for the player: each catalogue entry with its view. */
export const A2UI_PARTS: PartView[] = PART_APIS.flatMap((api) =>
  views[api.name] ? [{ name: api.name, schema: api.schema, View: views[api.name]! }] : [],
);

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  share: { flex: 1, minWidth: 0 },
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 14,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  eyebrow: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.7 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  link: { minHeight: 44, justifyContent: "center", paddingLeft: 8 },
  display: { fontSize: 38, fontWeight: "800", letterSpacing: -1.4, lineHeight: 44 },
  statHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  noticeIcon: { fontSize: 18, lineHeight: 22 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  tabs: { flexDirection: "row", borderRadius: 14, padding: 3, gap: 3 },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  // Only the open tab is raised (a shadow with no opacity still shows on the web).
  raised: { shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } },
  stat: { borderRadius: 16, padding: 12, gap: 3 },
  figure: { fontSize: 24, fontWeight: "800", letterSpacing: -0.8, fontVariant: ["tabular-nums"] },
  kv: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  pill: {
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  bar: { height: "100%", borderRadius: 4 },
  notice: { borderRadius: 14, padding: 12, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  sliderHit: { height: 44, justifyContent: "center" },
  sliderTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  thumb: {
    position: "absolute",
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    ...(Platform.OS === "web" ? { cursor: "grab" as never } : null),
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  switch: { width: 48, height: 30, borderRadius: 15, justifyContent: "center" },
  knob: { width: 26, height: 26, borderRadius: 13 },
  radioRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  field: { minHeight: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
  button: {
    minHeight: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    borderRadius: 12,
  },
  // An input with nothing to write to (bound to a literal): shown, not tappable.
  off: { opacity: 0.5 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 6 },
});
