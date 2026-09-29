// The iPhone app (docs/design/ios-app.md): a native shell that shows the live web app, so
// sign-in cookies, passkeys, live updates and the offline service worker work exactly as
// on the web. APP_ENV picks which server it shows (read at `cap sync` time).
import type { CapacitorConfig } from "@capacitor/cli";

const SERVERS = {
  production: "https://assistant.rishiparyani.workers.dev",
  dev: "https://assistant-dev.rishiparyani.workers.dev",
  // The simulator tests on the Mac runner (a local Worker with fake data).
  local: "http://localhost:8787",
} as const;

const env = (process.env.APP_ENV ?? "production") as keyof typeof SERVERS;
const url = SERVERS[env];
if (!url) throw new Error(`Unknown APP_ENV "${env}"`);

const config: CapacitorConfig = {
  appId: "in.gigspree.assistant",
  appName: "Assistant",
  // Shown only if the server can't be reached before the web app was ever saved.
  webDir: "www",
  server: { url, cleartext: env === "local" },
  ios: {
    // Service workers (offline use) run in the app only for "app-bound" domains
    // (WKAppBoundDomains in Info.plist).
    limitsNavigationsToAppBoundDomains: env !== "local",
    contentInset: "never",
    backgroundColor: "#ffffff",
  },
};

export default config;
