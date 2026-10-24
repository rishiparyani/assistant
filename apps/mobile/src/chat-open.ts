// Opening the chat from any screen, with what that screen shows (owner, 2026-10-24: "whichever
// screen we open from, maybe the chat could get the context from that screen"). The screen says
// what it is about (a kind and a name, never the pixels); the chat shows it as a chip the person
// can tap away, and puts it in words at the front of their first message, so the model knows
// without being told. On a wide website window the chat opens as a panel beside the screen
// instead of over it (the website is the app, 2026-10-22).
import { useSyncExternalStore } from "react";
import { Dimensions, Platform, useWindowDimensions } from "react-native";

export interface ChatAbout {
  kind: "list" | "record" | "workflow" | "space" | "group" | "card";
  title: string;
  /** A record's list (shown as "in Flats"). */
  in?: string;
}

/** The chat route's parameters (also what the wide-screen panel opens with). */
export interface ChatParams {
  card?: string;
  ask?: string;
  id?: string;
  send?: string;
  space?: string;
  /** A ChatAbout as JSON. */
  about?: string;
}

/** How the person's first message starts, so the model knows what it is about. */
export function aboutWords(a: ChatAbout): string {
  switch (a.kind) {
    case "record":
      return a.in ? `About “${a.title}” in ${a.in}: ` : `About “${a.title}”: `;
    case "list":
      return `About the list “${a.title}”: `;
    case "workflow":
      return `About the workflow “${a.title}”: `;
    case "space":
      return `About the space “${a.title}”: `;
    case "group":
      return `About the chat “${a.title}”: `;
    default:
      return `About the card “${a.title}”: `;
  }
}

/** What the chip says. */
export function aboutLabel(a: ChatAbout): string {
  return a.kind === "record" && a.in ? `${a.title} · ${a.in}` : a.title;
}

export function parseAbout(raw: string | undefined): ChatAbout | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<ChatAbout>;
    return o && typeof o.title === "string" && typeof o.kind === "string" ? (o as ChatAbout) : null;
  } catch {
    return null;
  }
}

/** A window wide enough for the chat beside the screen (a laptop, an iPad in landscape). */
export const WIDE = 1024;
export const wideNow = () => Platform.OS === "web" && Dimensions.get("window").width >= WIDE;

// The panel on a wide window: open or not, and what it opened with (a new open remounts it).
let panel: { open: boolean; params: ChatParams; nonce: number } = { open: false, params: {}, nonce: 0 };
const listeners = new Set<() => void>();
const setPanel = (next: typeof panel) => {
  panel = next;
  listeners.forEach((l) => l());
};
export function useChatPanel() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => panel,
    () => panel,
  );
}
export const closeChatPanel = () => setPanel({ ...panel, open: false });

/** The panel's width beside the screen. */
export const PANEL_WIDTH = 440;

/**
 * The width a screen has for itself: the window's, less the chat panel when it is open beside
 * it (the home lays its dashboard out from this, Codex on PR 193).
 */
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  const open = useChatPanel().open;
  return Platform.OS === "web" && open && width >= WIDE ? width - PANEL_WIDTH : width;
}

/** Opens the chat with these parameters: the panel on a wide window, the chat screen otherwise. */
export function openChat(
  router: { push: (to: { pathname: "/chat"; params: Record<string, string> }) => void },
  params: ChatParams = {},
  about?: ChatAbout | null,
) {
  const all: ChatParams = { ...params, ...(about ? { about: JSON.stringify(about) } : {}) };
  const clean = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
  if (wideNow()) {
    setPanel({ open: true, params: clean, nonce: panel.nonce + 1 });
    return;
  }
  router.push({ pathname: "/chat", params: clean });
}
