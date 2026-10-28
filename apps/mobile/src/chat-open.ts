// Opening the chat from any screen (docs/design/from-scratch.md §2 "one composer", §3 "Chat
// sheet"): every screen has the composer at the bottom; a tap raises the chat as a sheet over
// that screen (a panel beside it on a wide website window). The screen says what it is about
// (a kind and a name, never the pixels); the chat shows it as a chip the person can tap away,
// and puts it in words at the front of their first message, so the model knows without being
// told.
import { useSyncExternalStore } from "react";
import { Dimensions, Platform, useWindowDimensions } from "react-native";
import { afterModals, modalLeaving } from "./modals.ts";

export interface ChatAbout {
  kind: "list" | "record" | "workflow" | "space" | "group" | "card" | "screen";
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
    case "screen":
      return `On the ${a.title} screen: `;
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

// The chat: open or not, and what it opened with (a new open remounts it). One for the whole
// app, hosted by the layout: a sheet over the screen, or the panel beside it on a wide window.
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
/** The phone's chat going away (iOS): the layout's modal calls it once it's gone. */
let chatLeaving: (() => void) | null = null;
export const chatGone = () => {
  chatLeaving?.();
  chatLeaving = null;
};
export const closeChatPanel = () => {
  if (panel.open && Platform.OS === "ios" && !chatLeaving) chatLeaving = modalLeaving();
  setPanel({ ...panel, open: false });
};
/**
 * Before the chat opens a screen (a list, a workflow): the sheet goes away so the screen is
 * seen; the panel beside the screen on a wide window stays.
 */
export const leaveChat = () => {
  if (!wideNow()) closeChatPanel();
};

/** The panel's width beside the screen. */
export const PANEL_WIDTH = 440;

/** Two panes (chats-home.md, the polished look): on a laptop's website the chats stay on the
 *  left and what's opened shows on the right. */
export const SIDEBAR_WIDTH = 360;
export function useTwoPanes(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= WIDE;
}

/**
 * The width a screen has for itself: the window's, less the chats beside it and the chat panel
 * when it is open beside it (the home lays its dashboard out from this, Codex on PR 193).
 */
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  const open = useChatPanel().open;
  const wide = Platform.OS === "web" && width >= WIDE;
  return width - (wide ? SIDEBAR_WIDTH : 0) - (wide && open ? PANEL_WIDTH : 0);
}

/** Opens the chat with these parameters, over the screen it was opened from. */
export function openChat(params: ChatParams = {}, about?: ChatAbout | null) {
  const all: ChatParams = { ...params, ...(about ? { about: JSON.stringify(about) } : {}) };
  const clean = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
  // The phone's chat is a modal: it waits for any sheet that's still going away (`@/modals`).
  afterModals(() => setPanel({ open: true, params: clean, nonce: panel.nonce + 1 }));
}
