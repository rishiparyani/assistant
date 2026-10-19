// What the A2UI parts share (decision 2026-10-18 "Try A2UI"): colours by name in the app's light
// and dark forms, a value in the card's words, and the small pieces several parts draw (a pill,
// an emoji in a soft square, initials). Only the app's theme; no data, no network.
import { StyleSheet, View } from "react-native";
import { formatINR } from "@assistant/shared";
import { dayOf } from "../../a2ui/catalog.ts";
import { Text } from "../text.tsx";
import { COLLECTION_COLOURS, type CollectionColour, type Theme, useTheme } from "../theme.ts";
import type { ChildRef } from "./player.tsx";

export type Tone = "plain" | "muted" | "accent" | "good" | "warn" | "danger";

export const toneOf = (t: Theme, tone: unknown, plain = t.fg): string =>
  tone === "muted"
    ? t.fg2
    : tone === "accent"
      ? t.accent
      : tone === "good"
        ? t.good
        : tone === "warn"
          ? t.warn
          : tone === "danger"
            ? t.danger
            : plain;

/** A colour at a little opacity, for pills, bands and washes (hex or rgb()). */
export const soft = (c: string, a: number) => {
  if (c.startsWith("#") && c.length === 7) {
    const v = parseInt(c.slice(1), 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }
  return c.replace(/rgba?\(([^,]+),([^,]+),([^,)]+).*\)/, `rgba($1,$2,$3,${a})`);
};

const NAMED: Record<string, CollectionColour> = {
  blue: "people",
  green: "home",
  teal: "money",
  orange: "time",
  purple: "flow",
  pink: "music",
  grey: "neutral",
};
/** A part's colour by name (see COLOURS in the catalogue), in this theme. */
export function colourOf(t: Theme, dark: boolean, name: unknown, fallback = t.accent): string {
  if (typeof name !== "string") return fallback;
  const c = NAMED[name];
  if (c) return COLLECTION_COLOURS[dark ? "dark" : "light"][c];
  if (name === "red" || name === "danger") return t.danger;
  if (name === "good" || name === "warn" || name === "accent") return toneOf(t, name);
  return fallback;
}
/** Colours in turn, for slices and bars that each need one. */
export const SERIES = ["accent", "teal", "orange", "purple", "pink", "blue", "green", "grey"] as const;

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
export const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
export const kids = (p: Record<string, unknown>) =>
  Array.isArray(p.children) ? (p.children as ChildRef[]) : [];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon 19 Oct" for a day. */
export function dayWords(v: unknown): string {
  const d = dayOf(v);
  if (!d) return str(v);
  const at = new Date(`${d}T00:00:00`);
  return `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}
export const monthName = (m: number) => MONTHS[m] ?? "";

/** A value in the card's words: money in paise as ₹, a percentage, a date, a number in Indian style. */
export function shownValue(v: unknown, format: unknown): string {
  if (v === undefined || v === null) return "–";
  // Whole rupees on a card (calculations leave paise behind: ₹21,695.58).
  if (format === "money") return formatINR(Math.round(num(v) / 100) * 100);
  if (format === "percent") return `${Math.round(num(v) * 10) / 10}%`;
  if (format === "date") return dayWords(v);
  if (format === "number" || typeof v === "number") return num(v).toLocaleString("en-IN");
  return String(v);
}
/** A short money or number for an axis or a small tile: ₹1.2L, ₹12k, 3.4k. */
export function shortValue(v: number, format: unknown): string {
  const x = format === "money" ? v / 100 : v;
  const a = Math.abs(x);
  const unit =
    a >= 1e7
      ? `${+(x / 1e7).toFixed(1)}Cr`
      : a >= 1e5
        ? `${+(x / 1e5).toFixed(1)}L`
        : a >= 1e3
          ? `${+(x / 1e3).toFixed(1)}k`
          : `${Math.round(x)}`;
  return format === "money" ? `₹${unit}` : format === "percent" ? `${Math.round(v)}%` : unit;
}

/** A list of numbers from a list of numbers or items (one field of each). */
export function numbers(v: unknown, field?: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) =>
    x && typeof x === "object" && typeof field === "string"
      ? num((x as Record<string, unknown>)[field])
      : num(x),
  );
}

export function Pill({ text, tone, icon }: { text: string; tone?: Tone; icon?: string }) {
  const { t } = useTheme();
  const c = toneOf(t, tone ?? "muted", t.fg2);
  return (
    <Text style={[k.pill, { color: c, backgroundColor: soft(c, 0.14) }]} numberOfLines={1}>
      {icon ? `${icon} ` : ""}
      {text}
    </Text>
  );
}

const SIZES = { small: 28, medium: 40, large: 56 } as const;
type Size = keyof typeof SIZES;
const sizeOf = (s: unknown): Size => (s === "small" || s === "large" ? s : "medium");

/** An emoji in a soft rounded square of a colour. */
export function IconBox({ icon, colour, size }: { icon: string; colour?: unknown; size?: unknown }) {
  const { t, dark } = useTheme();
  const px = SIZES[sizeOf(size)];
  const c = colourOf(t, dark, colour ?? "accent");
  return (
    <View
      style={[
        k.iconBox,
        { width: px, height: px, borderRadius: px * 0.3, backgroundColor: soft(c, dark ? 0.24 : 0.14) },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text style={{ fontSize: px * 0.52, lineHeight: px * 0.68 }}>{icon}</Text>
    </View>
  );
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
/** The same colour for a name every time. */
function nameColour(t: Theme, dark: boolean, name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return colourOf(t, dark, SERIES[Math.abs(h) % (SERIES.length - 1)]);
}
/** A person's initials in a circle of their own colour. */
export function Initials({ name, size, ring }: { name: string; size?: unknown; ring?: string }) {
  const { t, dark } = useTheme();
  const px = typeof size === "number" ? size : SIZES[sizeOf(size)];
  const c = nameColour(t, dark, name);
  return (
    <View
      style={[
        k.avatar,
        { width: px, height: px, borderRadius: px / 2, backgroundColor: soft(c, dark ? 0.3 : 0.18) },
        ring ? { borderWidth: 2, borderColor: ring } : null,
      ]}
      accessibilityLabel={name}
    >
      <Text style={{ color: c, fontWeight: "800", fontSize: px * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

/** A day as a small tile: the month over the date. */
export function DateTile({ day }: { day: string }) {
  const { t } = useTheme();
  const at = new Date(`${day}T00:00:00`);
  return (
    <View style={[k.dateTile, { backgroundColor: t.fill }]}>
      <Text style={[k.dateMonth, { color: t.danger }]}>{monthName(at.getMonth()).toUpperCase()}</Text>
      <Text style={[k.dateDay, { color: t.fg }]}>{at.getDate()}</Text>
    </View>
  );
}

const k = StyleSheet.create({
  pill: {
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  iconBox: { alignItems: "center", justifyContent: "center" },
  avatar: { alignItems: "center", justifyContent: "center" },
  dateTile: { width: 44, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dateMonth: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  dateDay: { fontSize: 18, fontWeight: "800", marginTop: -1 },
});
