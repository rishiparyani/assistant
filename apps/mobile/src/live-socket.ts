// Live updates on the phone (decision 2026-09-28, as on the website): while a screen that
// wants them is open, one WebSocket to the person's live object says when something they can
// see changed ("group_changed" for a chat). Messages carry no data: the screen fetches again,
// so it only ever sees what the person may see. Reconnects with back-off; every screen also
// works without it (it loads on open and on pull).
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { API_URL } from "./config.ts";
import { cookieHeader } from "./auth.ts";

export type LiveMessage = { type: string } & Record<string, string | number>;
type Listener = (m: LiveMessage) => void;

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let retry = 0;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let keepAlive: ReturnType<typeof setInterval> | undefined;

async function connect() {
  if (ws || !listeners.size || AppState.currentState !== "active") return;
  const url = API_URL.replace(/^http/, "ws") + "/api/live";
  const cookie = await cookieHeader();
  if (ws || !listeners.size) return;
  // React Native takes headers as a third argument (the session cookie, and the app as the
  // origin, which the Worker checks); a browser sends both itself.
  const Socket = WebSocket as unknown as new (
    url: string,
    protocols?: string[] | null,
    options?: { headers: Record<string, string> },
  ) => WebSocket;
  const socket =
    Platform.OS === "web"
      ? new WebSocket(url)
      : new Socket(url, null, { headers: { origin: API_URL, ...(cookie ? { cookie } : {}) } });
  ws = socket;
  socket.onopen = () => {
    // After a drop, catch up on anything missed meanwhile.
    if (retry > 0) listeners.forEach((l) => l({ type: "reconnected" }));
    retry = 0;
    keepAlive = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), 30_000);
  };
  socket.onmessage = (e) => {
    if (e.data === "pong" || typeof e.data !== "string") return;
    try {
      const m = JSON.parse(e.data) as LiveMessage;
      listeners.forEach((l) => l(m));
    } catch {
      // not ours
    }
  };
  socket.onclose = () => {
    clearInterval(keepAlive);
    if (ws === socket) ws = null;
    if (!listeners.size || AppState.currentState !== "active") return;
    clearTimeout(reconnect);
    reconnect = setTimeout(() => void connect(), Math.min(30_000, 1000 * 2 ** retry++));
  };
}

function disconnect() {
  clearTimeout(reconnect);
  clearInterval(keepAlive);
  const socket = ws;
  ws = null;
  socket?.close(1000);
}

// Closed in the background (saves battery), opened again on return with a catch-up.
AppState.addEventListener("change", (s) => {
  if (s === "active") {
    retry = Math.max(retry, 1);
    void connect();
  } else disconnect();
});

/** Calls `on` for each live message while the calling screen is mounted. */
export function useLive(on: Listener) {
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => {
    const l: Listener = (m) => ref.current(m);
    listeners.add(l);
    void connect();
    return () => {
      listeners.delete(l);
      if (!listeners.size) disconnect();
    };
  }, []);
}

/** Connects again as whoever is signed in now (after switching accounts). */
export function reconnectLive() {
  const old = ws;
  ws = null;
  retry = 0;
  clearTimeout(reconnect);
  old?.close();
  void connect();
}
