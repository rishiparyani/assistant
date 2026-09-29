// Live updates (decision 2026-09-28): while the app is open and visible it keeps one
// WebSocket to the server, which says when a gig I'm on changes; the screens on show
// then refresh. Closed while the app is in the background (saves battery), reopened with
// back-off when it drops, and every change also still works without it (pull to refresh).
import { refreshAll } from "./query.svelte.ts";
import { saveSoon } from "./offline.svelte.ts";

let ws: WebSocket | null = null;
let wanted = false;
let retry = 0;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let ping: ReturnType<typeof setInterval> | undefined;
let bunch: ReturnType<typeof setTimeout> | undefined;

function connect() {
  if (!wanted || ws || document.visibilityState !== "visible" || !navigator.onLine) return;
  const socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`,
  );
  ws = socket;
  socket.onopen = () => {
    // After a drop (not a first connect), catch up on anything missed meanwhile.
    if (retry > 0) refreshAll();
    retry = 0;
    ping = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), 30_000);
  };
  socket.onmessage = (e) => {
    if (e.data === "pong") return;
    // Several changes often arrive together (one per recipient row); refresh once.
    clearTimeout(bunch);
    bunch = setTimeout(refreshAll, 300);
    // A gig changed (maybe a new one): keep the offline copy up to date.
    saveSoon();
  };
  socket.onclose = () => {
    clearInterval(ping);
    if (ws === socket) ws = null;
    if (!wanted || document.visibilityState !== "visible") return;
    clearTimeout(reconnect);
    reconnect = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
  };
}

function disconnect() {
  clearTimeout(reconnect);
  clearInterval(ping);
  const socket = ws;
  ws = null;
  socket?.close(1000);
}

// Offline: don't keep retrying; reconnect as soon as the connection is back.
addEventListener("online", () => connect());

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") connect();
  else disconnect();
});

/** Turns live updates on (signed in) or off (signed out). */
export function setLive(on: boolean) {
  if (on === wanted) return;
  wanted = on;
  if (on) connect();
  else disconnect();
}
