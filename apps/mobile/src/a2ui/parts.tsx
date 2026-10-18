// The app's A2UI parts (the trial): what an agent may put on a card, drawn with the app's own
// look (theme tokens, type scale, ticks, tap feedback). The player knows nothing of these; the
// agent sees only their names and properties.
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { z } from "zod/v3";
import { Tap, Text, Tick, radius, type, useTheme } from "@assistant/cards/native";
import { formatINR } from "@assistant/shared";
import { A2, type ChildRef, type Part } from "./player";

const children = A2.children;

const Column: Part = {
  name: "Column",
  schema: z.object({ children: children(), gap: z.number().optional() }),
  View: ({ props, child }) => (
    <View style={{ gap: typeof props.gap === "number" ? props.gap : 12 }}>
      {(props.children as ChildRef[]).map((c, i) => child(c, i))}
    </View>
  ),
};

const Row: Part = {
  name: "Row",
  schema: z.object({ children: children() }),
  View: ({ props, child }) => (
    <View style={s.row}>
      {(props.children as ChildRef[]).map((c, i) => (
        <View key={i} style={{ flex: 1, minWidth: 0 }}>
          {child(c, i)}
        </View>
      ))}
    </View>
  ),
};

/** The card itself: a soft panel in the theme, with an optional title. */
const Card: Part = {
  name: "Card",
  schema: z.object({ title: A2.string("title").optional(), children: children() }),
  View: ({ props, child }) => {
    const { t } = useTheme();
    return (
      <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair, shadowColor: t.shadow }]}>
        {props.title ? <Text style={[type.heading, { color: t.fg }]}>{props.title as string}</Text> : null}
        {(props.children as ChildRef[]).map((c, i) => child(c, i))}
      </View>
    );
  },
};

/** Tabs: one child per tab; which one is open is the person's, not the data's. */
const Tabs: Part = {
  name: "Tabs",
  schema: z.object({
    tabs: z
      .array(z.object({ title: z.string(), child: z.string() }))
      .min(1)
      .max(5),
  }),
  View: ({ props, child }) => {
    const { t } = useTheme();
    const tabs = props.tabs as { title: string; child: string }[];
    const [open, setOpen] = useState(0);
    const at = Math.min(open, tabs.length - 1);
    return (
      <View style={{ gap: 12 }}>
        <View style={[s.tabs, { backgroundColor: t.fill }]} accessibilityRole="tablist">
          {tabs.map((tab, i) => (
            <Tap
              key={tab.title}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === at }}
              onPress={() => setOpen(i)}
              haptic="selection"
              scale={0.97}
              style={[s.tab, i === at && [s.tabOn, { backgroundColor: t.cell, shadowColor: t.shadow }]]}
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
};

const TextPart: Part = {
  name: "Text",
  schema: z.object({ text: A2.string(), style: z.enum(["heading", "body", "caption"]).optional() }),
  View: ({ props }) => {
    const { t } = useTheme();
    const style = (props.style as string) ?? "body";
    return (
      <Text style={[type[style as "body"], { color: style === "caption" ? t.fg2 : t.fg }]}>
        {String(props.text ?? "")}
      </Text>
    );
  },
};

/** A figure with a label: "Outstanding ₹49,000". Money is in paise, as everywhere in the app. */
const Stat: Part = {
  name: "Stat",
  schema: z.object({
    label: A2.string("label"),
    value: A2.number("value"),
    format: z.enum(["money", "number"]).optional(),
    tone: z.enum(["plain", "good", "warn"]).optional(),
  }),
  View: ({ props }) => {
    const { t } = useTheme();
    const n = typeof props.value === "number" ? props.value : 0;
    const shown = props.format === "money" ? formatINR(n) : n.toLocaleString("en-IN");
    const tone = props.tone === "good" ? t.good : props.tone === "warn" ? t.warn : t.fg;
    return (
      <View style={[s.stat, { backgroundColor: t.fill }]}>
        <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
          {String(props.label ?? "")}
        </Text>
        <Text
          style={[s.figure, { color: tone }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {shown}
        </Text>
      </View>
    );
  },
};

/** Pick one of a few: writes the choice into the data, so other parts can follow it. */
const Picker: Part = {
  name: "Picker",
  schema: z.object({ value: A2.string("the choice"), options: z.array(z.string()).min(2).max(6) }),
  View: ({ props }) => {
    const { t } = useTheme();
    const set = props.setValue as (v: string) => void;
    return (
      <View style={s.chips} accessibilityRole="radiogroup">
        {(props.options as string[]).map((o) => {
          const on = props.value === o;
          return (
            <Tap
              key={o}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => set(o)}
              haptic="selection"
              scale={0.95}
              style={[s.chip, { backgroundColor: on ? t.accent : t.fill }]}
            >
              <Text style={[type.label, { color: on ? t.onAccent : t.fg, fontSize: 14 }]}>{o}</Text>
            </Tap>
          );
        })}
      </View>
    );
  },
};

const List: Part = {
  name: "List",
  schema: z.object({ children: children() }),
  View: ({ props, child }) => {
    const { t } = useTheme();
    const rows = props.children as ChildRef[];
    return (
      <View>
        {rows.map((c, i) => (
          <View
            key={i}
            style={
              i < rows.length - 1
                ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.sep }
                : null
            }
          >
            {child(c, i)}
          </View>
        ))}
        {rows.length === 0 ? (
          <Text style={[type.small, { color: t.fg2, paddingVertical: 8 }]}>Nothing here.</Text>
        ) : null}
      </View>
    );
  },
};

/** A row with a tick that writes yes/no into its item, and an amount at the end. */
const CheckRow: Part = {
  name: "CheckRow",
  schema: z.object({
    label: A2.string("label"),
    detail: A2.string("second line").optional(),
    checked: A2.boolean("ticked"),
    amount: A2.number("amount in paise").optional(),
  }),
  View: ({ props }) => {
    const { t } = useTheme();
    const done = props.checked === true;
    const set = props.setChecked as (v: boolean) => void;
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={String(props.label ?? "")}
        onPress={() => set(!done)}
        style={s.checkRow}
      >
        <Tick done={done} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.small, { color: done ? t.fg2 : t.fg, fontWeight: "600" }]} numberOfLines={1}>
            {String(props.label ?? "")}
          </Text>
          {props.detail ? (
            <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
              {String(props.detail)}
            </Text>
          ) : null}
        </View>
        {typeof props.amount === "number" ? (
          <Text style={[type.small, { color: done ? t.fg2 : t.fg, fontVariant: ["tabular-nums"] }]}>
            {formatINR(props.amount)}
          </Text>
        ) : null}
      </Pressable>
    );
  },
};

/** Every part the app offers an agent, by name. */
export const PARTS: Part[] = [Column, Row, Card, Tabs, TextPart, Stat, Picker, List, CheckRow];

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  tabs: { flexDirection: "row", borderRadius: 14, padding: 3, gap: 3 },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  // Only the open tab is raised (a shadow with no opacity still shows on the web).
  tabOn: { shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } },
  stat: { borderRadius: 16, padding: 12, gap: 4 },
  figure: { fontSize: 24, fontWeight: "800", letterSpacing: -0.8, fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 6 },
});
