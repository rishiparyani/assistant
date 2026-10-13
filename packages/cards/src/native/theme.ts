// Design tokens (docs/design/home-first.md §3). Light and dark are both first class; every
// colour in the app comes from here. Collection colours are picked when a collection is made.
import { useColorScheme } from "react-native";

export const light = {
  // A warm off-white ground (decision 2026-10-13 "A warmer home"), white cards on it.
  canvas: "#eae7e1",
  page: "#f4f2ee",
  cell: "#ffffff",
  fg: "#17161c",
  fg2: "rgba(23,22,28,0.62)",
  fg3: "rgba(23,22,28,0.34)",
  hair: "rgba(23,22,28,0.07)",
  sep: "rgba(23,22,28,0.09)",
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
  sep: "rgba(244,242,238,0.1)",
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

export const radius = { card: 22, sheet: 16, control: 12, pill: 999 };
export const space = (n: number) => n * 4;
