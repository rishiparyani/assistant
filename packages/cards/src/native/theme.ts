// Design tokens (docs/design/home-first.md §3). Light and dark are both first class; every
// colour in the app comes from here. Collection colours are picked when a collection is made.
import { useColorScheme, type TextStyle } from "react-native";

export const light = {
  // Jamun (decision 2026-10-28 "Chats as home, Jamun, a polished look"): a pale plum ground,
  // white cards on it, deep plum for what you tap.
  canvas: "#ede6f2",
  page: "#f7f2fa",
  cell: "#ffffff",
  fg: "#1e1424",
  fg2: "rgba(30,20,36,0.62)",
  fg3: "rgba(30,20,36,0.34)",
  hair: "rgba(30,20,36,0.07)",
  sep: "rgba(30,20,36,0.06)",
  fill: "rgba(78,40,100,0.07)",
  fill2: "rgba(78,40,100,0.14)",
  glass: "rgba(255,255,255,0.8)",
  accent: "#6e2e91",
  accentSoft: "#f3e9f9",
  onAccent: "#ffffff",
  danger: "#dc2626",
  shadow: "rgba(30,20,36,0.08)",
  bubbleThem: "#ffffff",
  /** The chat bar: dark on the light home, so asking is the obvious thing to do. */
  ink: "#1e1424",
  onInk: "#ffffff",
  /** The "Next up" card. */
  hero: "#4d2166",
  onHero: "#ffffff",
  /** The date tile on the hero: dark figures on a white tile, in both themes. */
  tileInk: "#1e1424",
  /** Money in, money out and deadlines. */
  good: "#0e8a6a",
  warn: "#c2410c",
};
export const dark: typeof light = {
  canvas: "#0c070f",
  page: "#110a15",
  cell: "#21162b",
  fg: "#f2eaf6",
  fg2: "rgba(242,234,246,0.64)",
  fg3: "rgba(242,234,246,0.34)",
  hair: "rgba(242,234,246,0.08)",
  sep: "rgba(242,234,246,0.08)",
  fill: "rgba(242,234,246,0.07)",
  fill2: "rgba(242,234,246,0.13)",
  glass: "rgba(33,22,43,0.82)",
  // Light enough to read on the dark cards, dark enough for white text on it.
  accent: "#b47ee0",
  accentSoft: "rgba(180,126,224,0.2)",
  onAccent: "#ffffff",
  danger: "#f87171",
  shadow: "rgba(0,0,0,0.45)",
  bubbleThem: "#21162b",
  ink: "#2e2038",
  onInk: "#ffffff",
  hero: "#3b1f4f",
  onHero: "#ffffff",
  tileInk: "#1e1424",
  good: "#34d399",
  warn: "#fb923c",
};
export type Theme = typeof light;

/** Colours a collection can have; the first that isn't taken is picked when one is made. */
export const COLLECTION_COLOURS = {
  light: {
    money: "#0ea5a0",
    time: "#f59e0b",
    people: "#3b82f6",
    flow: "#8b5cf6",
    music: "#ec4899",
    home: "#10b981",
    neutral: "#64748b",
  },
  dark: {
    money: "#2dd4bf",
    time: "#fbbf24",
    people: "#60a5fa",
    flow: "#a78bfa",
    music: "#f472b6",
    home: "#34d399",
    neutral: "#94a3b8",
  },
} as const;
export type CollectionColour = keyof typeof COLLECTION_COLOURS.light;

/** `hex` laid over `base` at `amount` (0–1), as a solid colour. */
function mix(hex: string, base: string, amount: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(base, i) + (ch(hex, i) - ch(base, i)) * amount));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A card's soft colour (decision 2026-10-16 "Soft coloured cards"): a pale wash of the list's
 * colour on white in light mode, a deep muted one on the card grey in dark mode, so a whole
 * card says which list it is without shouting. Text, ticks and money keep their own colours.
 */
export const CARD_TINTS = {
  light: Object.fromEntries(
    Object.entries(COLLECTION_COLOURS.light).map(([k, v]) => [k, mix(v, light.cell, 0.1)]),
  ) as Record<CollectionColour, string>,
  dark: Object.fromEntries(
    Object.entries(COLLECTION_COLOURS.dark).map(([k, v]) => [k, mix(v, dark.cell, 0.14)]),
  ) as Record<CollectionColour, string>,
};

export function useTheme(): {
  t: Theme;
  dark: boolean;
  colour: (c: CollectionColour) => string;
  /** The card's soft background in this list's colour. */
  cardTint: (c: CollectionColour) => string;
} {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  return {
    t: isDark ? dark : light,
    dark: isDark,
    colour: (c) => COLLECTION_COLOURS[isDark ? "dark" : "light"][c],
    cardTint: (c) => CARD_TINTS[isDark ? "dark" : "light"][c],
  };
}

/** The colours a list can get from its name (grey is kept for things that aren't lists). */
const PICKS: CollectionColour[] = ["money", "time", "people", "flow", "music", "home"];

/**
 * Until collections carry a colour of their own: a steady pick from the name. A few everyday
 * words choose a fitting colour; any other name gets one of the six by its letters, the same
 * every time, so every list has a colour of its own rather than grey.
 */
export function colourFor(name: string): CollectionColour {
  const n = name.toLowerCase();
  if (/expense|money|pay|fee|budget|cost|spent|bill/.test(n)) return "money";
  if (/remind|today|task|todo|event|due/.test(n)) return "time";
  if (/guest|people|contact|member|patient|client|visitor/.test(n)) return "people";
  if (/flow|process|rule/.test(n)) return "flow";
  if (/home|grocer|shop|house/.test(n)) return "home";
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PICKS[h % PICKS.length]!;
}

/** card: a card on the home; row: a row inside a list or a sheet; control: inputs and small buttons. */
export const radius = { card: 22, row: 16, sheet: 26, control: 12, pill: 999 };
export const space = (n: number) => n * 4;

/**
 * Type scale (decision 2026-10-15 "Feel: the ChatGPT bar"): one set of sizes, weights and line
 * heights for the whole app and every card. Screens and cards name a step, never a size.
 */
export const type = {
  /** The one big title of a screen ("My cards"). */
  display: { fontSize: 30, lineHeight: 34, fontWeight: "800", letterSpacing: -0.8 },
  /** A sheet's or page's title. */
  title: { fontSize: 22, lineHeight: 26, fontWeight: "800", letterSpacing: -0.5 },
  /** A card's or section's heading. */
  heading: { fontSize: 17, lineHeight: 22, fontWeight: "700", letterSpacing: -0.2 },
  /** Messages, rows, inputs: the reading size (never under 16 in an input). */
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" },
  /** Dense rows and secondary lines. */
  small: { fontSize: 15, lineHeight: 20, fontWeight: "400" },
  /** Buttons, chips, tabs. */
  label: { fontSize: 15, lineHeight: 18, fontWeight: "700" },
  /** Captions, times, counts. */
  caption: { fontSize: 12.5, lineHeight: 16, fontWeight: "600" },
  /** A tiny uppercase label over a section. */
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  /** Figures: tight, tabular, so columns line up. */
  num: { fontWeight: "800", letterSpacing: -0.6, fontVariant: ["tabular-nums"] },
} as const satisfies Record<string, TextStyle>;

/**
 * Motion tokens: springs, not durations, for anything a finger moves (home-first.md §3); short
 * timings for fades. Reanimated turns all of them off under Reduce Motion by itself.
 */
export const motion = {
  spring: {
    /** Press feedback, toggles: fast, no overshoot. */
    press: { damping: 24, stiffness: 420, mass: 0.6 },
    /** Sheets and menus coming up. */
    sheet: { damping: 26, stiffness: 260, mass: 0.9 },
    /** Something settling into place (a reorder, a count). */
    settle: { damping: 18, stiffness: 220 },
  },
  /** A fade or a colour change. */
  fade: 160,
  /** Content appearing (a message, a row). */
  enter: 220,
  /** Press feedback: how far a tapped thing shrinks. */
  pressScale: 0.97,
} as const;
