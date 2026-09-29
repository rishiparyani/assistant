// The iPhone app (docs/design/ios-app.md) shows this same web app in a native shell
// (Capacitor), which adds `window.Capacitor` to the page.
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

/** True inside the iPhone app, false in a browser or the Home Screen web app. */
export const inApp = (): boolean =>
  typeof window !== "undefined" &&
  !!(window as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.();
