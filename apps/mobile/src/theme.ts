// Design tokens (docs/design/home-first.md §3). Light and dark are both first class; every
// colour in the app comes from here. Collection colours are picked when a collection is made.
import { useColorScheme } from "react-native";

export const light = {
  canvas: "#e9eaee",
  page: "#f3f4f7",
  cell: "#ffffff",
  fg: "#15161a",
  fg2: "rgba(30,32,40,0.62)",
  fg3: "rgba(30,32,40,0.32)",
  hair: "rgba(30,32,40,0.08)",
  sep: "rgba(30,32,40,0.12)",
  fill: "rgba(60,65,80,0.08)",
  fill2: "rgba(60,65,80,0.15)",
  glass: "rgba(255,255,255,0.72)",
  accent: "#5b5bf6",
  accentSoft: "rgba(91,91,246,0.14)",
  onAccent: "#ffffff",
  danger: "#e5484d",
  shadow: "rgba(10,12,20,0.08)",
  bubbleThem: "#ffffff",
};
export const dark: typeof light = {
  canvas: "#0b0c0f",
  page: "#0f1014",
  cell: "#191a20",
  fg: "#f2f3f6",
  fg2: "rgba(235,237,243,0.62)",
  fg3: "rgba(235,237,243,0.32)",
  hair: "rgba(235,237,243,0.08)",
  sep: "rgba(235,237,243,0.1)",
  fill: "rgba(235,237,243,0.07)",
  fill2: "rgba(235,237,243,0.13)",
  glass: "rgba(34,36,44,0.78)",
  accent: "#7c7cff",
  accentSoft: "rgba(124,124,255,0.18)",
  onAccent: "#ffffff",
  danger: "#ff6b6b",
  shadow: "rgba(0,0,0,0.35)",
  bubbleThem: "#191a20",
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
