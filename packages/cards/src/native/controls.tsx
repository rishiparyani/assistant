// The controls a card's rows can have (decision 2026-10-12 "Cards have controls"): each is
// bound to one field and writes it when used. Built from React Native's own parts (no new
// dependency), themed, at least 44 points to tap, and quick: the change shows at once and
// goes through the outbox, so it works offline.
import { useState } from "react";
import { Pressable, Switch, Text, View, StyleSheet, type LayoutChangeEvent } from "react-native";
import * as Haptics from "expo-haptics";
import type { FieldView, StoredValue } from "@assistant/shared";
import type { CardControl } from "@assistant/shared";
import { useTheme } from "./theme.ts";

const tap = () => void Haptics.selectionAsync().catch(() => undefined);
const SLOP = { top: 10, bottom: 10, left: 6, right: 6 };

export interface ControlProps {
  control: CardControl;
  field: FieldView;
  value: StoredValue | undefined;
  colour: string;
  onSet: (value: StoredValue) => void;
  label: string;
}

/** Controls that sit at the end of a row (the rest take a line of their own). */
export const INLINE: ReadonlySet<CardControl["as"]> = new Set([
  "tick",
  "switch",
  "stepper",
  "stars",
  "button",
]);

export function Control(p: ControlProps) {
  switch (p.control.as) {
    case "tick":
      return <Tick {...p} />;
    case "switch":
      return <Toggle {...p} />;
    case "chips":
      return <Chips {...p} />;
    case "stepper":
      return <Stepper {...p} />;
    case "stars":
      return <Stars {...p} />;
    case "slider":
      return <Slider {...p} />;
    case "button":
      return <Button {...p} />;
  }
}

function Tick({ value, colour, onSet, label }: ControlProps) {
  const { t } = useTheme();
  const on = value === true;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      hitSlop={12}
      onPress={() => {
        tap();
        onSet(!on);
      }}
      style={[s.circle, { borderColor: on ? colour : t.fg3 }]}
    >
      {on ? <View style={[s.circleIn, { backgroundColor: colour }]} /> : null}
    </Pressable>
  );
}

function Toggle({ value, colour, onSet, label }: ControlProps) {
  const { t } = useTheme();
  return (
    <Switch
      accessibilityLabel={label}
      value={value === true}
      onValueChange={(v) => {
        tap();
        onSet(v);
      }}
      trackColor={{ false: t.fill2, true: colour }}
      thumbColor="#ffffff"
      // react-native-web colours the "on" thumb separately.
      {...({ activeThumbColor: "#ffffff" } as object)}
      // Smaller than the system default so a row stays one line; still 44 points to tap.
      style={s.switch}
    />
  );
}

function Chips({ value, field, colour, onSet, label }: ControlProps) {
  const { t } = useTheme();
  const choices = field.options.choices ?? [];
  return (
    <View style={s.chips} accessibilityLabel={label}>
      {choices.slice(0, 6).map((c) => {
        const on = value === c;
        return (
          <Pressable
            key={c}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label}: ${c}`}
            hitSlop={SLOP}
            onPress={() => {
              tap();
              onSet(on ? null : c);
            }}
            style={[s.chip, { backgroundColor: on ? colour : t.fill, borderColor: on ? colour : t.hair }]}
          >
            <Text style={[s.chipText, { color: on ? t.onAccent : t.fg }]} numberOfLines={1}>
              {c}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stepper({ value, control, colour, onSet, label }: ControlProps) {
  const { t } = useTheme();
  const n = typeof value === "number" ? value : 0;
  const step = control.step ?? 1;
  const clamp = (x: number) =>
    Math.min(control.max ?? Number.POSITIVE_INFINITY, Math.max(control.min ?? Number.NEGATIVE_INFINITY, x));
  const go = (d: number) => () => {
    tap();
    onSet(clamp(Math.round((n + d) * 1000) / 1000));
  };
  return (
    <View style={[s.stepper, { backgroundColor: t.fill }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: less`}
        hitSlop={SLOP}
        onPress={go(-step)}
        style={s.stepBtn}
      >
        <Text style={[s.stepSign, { color: colour }]}>−</Text>
      </Pressable>
      <Text style={[s.stepValue, { color: t.fg }]} accessibilityLabel={`${label}: ${n}`}>
        {n}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: more`}
        hitSlop={SLOP}
        onPress={go(step)}
        style={s.stepBtn}
      >
        <Text style={[s.stepSign, { color: colour }]}>+</Text>
      </Pressable>
    </View>
  );
}

function Stars({ value, control, colour, onSet, label }: ControlProps) {
  const { t } = useTheme();
  const n = typeof value === "number" ? value : 0;
  const max = control.max ?? 5;
  return (
    <View style={s.stars} accessibilityLabel={`${label}: ${n} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <Pressable
          key={i}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${i + 1}`}
          hitSlop={{ top: 12, bottom: 12, left: 1, right: 1 }}
          onPress={() => {
            tap();
            onSet(n === i + 1 ? 0 : i + 1);
          }}
          style={s.star}
        >
          <Text style={[s.starText, { color: i < n ? colour : t.fg3 }]}>{i < n ? "★" : "☆"}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Slider({ value, control, colour, onSet, label }: ControlProps) {
  const { t } = useTheme();
  const [w, setW] = useState(0);
  const min = control.min ?? 0;
  const max = control.max ?? 100;
  const step = control.step ?? (max - min > 20 ? 5 : 1);
  const n = typeof value === "number" ? Math.min(max, Math.max(min, value)) : min;
  const share = (n - min) / (max - min);
  return (
    <View style={s.sliderRow}>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: n }}
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        onPress={(e) => {
          if (!w) return;
          const raw = min + (e.nativeEvent.locationX / w) * (max - min);
          tap();
          onSet(Math.min(max, Math.max(min, Math.round(raw / step) * step)));
        }}
        style={s.sliderHit}
      >
        <View style={[s.track, { backgroundColor: t.fill }]}>
          <View style={[s.trackIn, { backgroundColor: colour, width: `${Math.round(share * 100)}%` }]} />
        </View>
        <View
          style={[
            s.knob,
            { left: `${Math.round(share * 100)}%`, backgroundColor: t.cell, borderColor: colour },
          ]}
        />
      </Pressable>
      <Text style={[s.sliderValue, { color: t.fg2 }]}>{n}</Text>
    </View>
  );
}

function Button({ value, control, colour, onSet, label }: ControlProps) {
  const { t } = useTheme();
  const done = value === control.value;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${control.label}: ${label}`}
      accessibilityState={{ selected: done }}
      hitSlop={SLOP}
      onPress={() => {
        tap();
        onSet(control.value ?? null);
      }}
      style={[s.button, { backgroundColor: done ? t.fill : colour }]}
    >
      <Text style={[s.buttonText, { color: done ? t.fg2 : t.onAccent }]} numberOfLines={1}>
        {done ? `✓ ${control.label}` : control.label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  circleIn: { width: 13, height: 13, borderRadius: 7 },
  switch: { transform: [{ scale: 0.8 }], marginVertical: -6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", borderRadius: 14, height: 28 },
  stepBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  stepSign: { fontSize: 18, fontWeight: "700", lineHeight: 20 },
  stepValue: {
    minWidth: 22,
    textAlign: "center",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  stars: { flexDirection: "row" },
  star: { paddingHorizontal: 1 },
  starText: { fontSize: 17, lineHeight: 20 },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sliderHit: { flex: 1, height: 28, justifyContent: "center" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  trackIn: { height: 6 },
  knob: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    marginLeft: -8,
    top: 6,
  },
  sliderValue: { width: 30, textAlign: "right", fontSize: 12, fontVariant: ["tabular-nums"] },
  button: { paddingHorizontal: 12, height: 28, borderRadius: 14, justifyContent: "center" },
  buttonText: { fontSize: 12.5, fontWeight: "700" },
});
