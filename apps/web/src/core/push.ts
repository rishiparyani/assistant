// Push notifications on this device (T11): the service worker, permission and the
// subscription the server sends to. iPhone: only in the app added to the Home Screen.
import type { PushStatusView } from "@assistant/shared";
import { request } from "./api.ts";

export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** iPhone/iPad Safari outside the Home Screen app can't get pushes. */
export const needsHomeScreen = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  !(navigator as { standalone?: boolean }).standalone &&
  !window.matchMedia("(display-mode: standalone)").matches;

/** The service worker: keeps the app on the device for offline use, and shows pushes. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // Not available (e.g. private mode): the app works online as before.
  });
}

const key = (b64: string) =>
  Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function pushStatus(): Promise<
  PushStatusView & { permission: NotificationPermission | "unsupported" }
> {
  const sub = await currentSubscription().catch(() => null);
  const status = await request<PushStatusView>(
    "GET",
    `/api/me/push${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""}`,
  );
  return { ...status, permission: pushSupported() ? Notification.permission : "unsupported" };
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Browser";
}

/** Asks permission and turns notifications on for this device. */
// online-only: registers this device with the push service.
export async function enablePush(): Promise<PushStatusView> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this app in your settings");
  const reg = await navigator.serviceWorker.ready;
  const { public_key } = await request<PushStatusView>("GET", "/api/me/push");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(public_key) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return request<PushStatusView>("POST", "/api/me/push", {
    endpoint: json.endpoint,
    keys: json.keys,
    label: deviceLabel(),
  });
}

// online-only: unregisters this device on the server.
export async function disablePush(): Promise<PushStatusView> {
  const sub = await currentSubscription();
  const endpoint = sub?.endpoint;
  await sub?.unsubscribe().catch(() => {});
  return request<PushStatusView>("POST", "/api/me/push/remove", endpoint ? { endpoint } : {});
}

// online-only: asks the server to send a test notification now.
export const testPush = () => request<{ sent: number }>("POST", "/api/me/push/test", {});
