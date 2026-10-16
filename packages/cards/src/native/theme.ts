// Design tokens (docs/design/home-first.md §3). Light and dark are both first class; every
// colour in the app comes from here. Collection colours are picked when a collection is made.
import { useColorScheme, type TextStyle } from "react-native";

export const light = {
  // A warm off-white ground (decision 2026-10-13 "A warmer home"), white cards on it.
  canvas: "#eae7e1",
  page: "#f4f2ee",
  cell: "#ffffff",
  fg: "#17161c",
  fg2: "rgba(23,22,28,0.62)",
  fg3: "rgba(23,22,28,0.34)",
  hair: "rgba(23,22,28,0.07)",
  sep: "rgba(23,22,28,0.06)",
  fill: "rgba(60,55,70,0.07)",
  fill2: "rgba(60,55,70,0.14)",
  glass: "rgba(255,255,255,0.8)",
  accent: "#4f46e5",
  accentSoft: "#ecebff",
  onAccent: "#ffffff",
  danger: "#dc2626",
  shadow: "rgba(23,22,28,0.07)",
  bubbleThem: "#ffffff",
  /** The chat bar: dark on the light home, so asking is the obvious thing to do. */
  ink: "#17161c",
  onInk: "#ffffff",
  /** The "Next up" card. */
  hero: "#2c2878",
  onHero: "#ffffff",
  /** The date tile on the hero: dark figures on a white tile, in both themes. */
  tileInk: "#17161c",
  /** Money in, money out and deadlines. */
  good: "#0e8a6a",
  warn: "#c2410c",
};
export const dark: typeof light = {
  canvas: "#0c0b0f",
  page: "#121116",
  cell: "#1c1b22",
  fg: "#f4f2ee",
  fg2: "rgba(244,242,238,0.64)",
  fg3: "rgba(244,242,238,0.34)",
  hair: "rgba(244,242,238,0.08)",
  sep: "rgba(244,242,238,0.08)",
  fill: "rgba(244,242,238,0.07)",
  fill2: "rgba(244,242,238,0.13)",
  glass: "rgba(36,35,44,0.82)",
  accent: "#8b85ff",
  accentSoft: "rgba(139,133,255,0.18)",
  onAccent: "#ffffff",
  danger: "#f87171",
  shadow: "rgba(0,0,0,0.4)",
  bubbleThem: "#1c1b22",
  ink: "#2a2933",
  onInk: "#ffffff",
  hero: "#2e2a7a",
  onHero: "#ffffff",
  tileInk: "#17161c",
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

export function useTheme(): { t: Theme; dark: boolean; colour: (c: CollectionColour) => string } {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  return {
    t: isDark ? dark : light,
    dark: isDark,
    colour: (c) => COLLECTION_COLOURS[isDark ? "dark" : "light"][c],
  };
}

/** Until collections carry a colour of their own: a steady pick from the name. */
export function colourFor(name: string): CollectionColour {
  const n = name.toLowerCase();
  if (/expense|money|pay|fee|budget|cost/.test(n)) return "money";
  if (/remind|today|task|todo|event|rehears/.test(n)) return "time";
  if (/guest|people|band|contact|member|patient|client/.test(n)) return "people";
  if (/song|set ?list|music|chart/.test(n)) return "music";
  if (/flow|process|rule/.test(n)) return "flow";
  if (/home|grocer|shop|house/.test(n)) return "home";
  return "neutral";
}

export const radius = { card: 22, sheet: 26, control: 12, pill: 999 };
export const space = (n: number) => n * 4;

/**
 * Type scale (decision 2026-10-15 "Feel: the ChatGPT bar"): one set of sizes, weights and line
 * heights for the whole app and every card. Screens and cards name a step, never a size.
 */
export const type = {
  /** The one big title of a screen ("My day"). */
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
