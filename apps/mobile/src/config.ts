// Where the app talks to. EXPO_PUBLIC_API_URL picks the server at build time (local Worker for
// the simulator tests, dev for branch builds, prod for TestFlight); on the website the page's
// own origin is the server.
import { Platform } from "react-native";

const fromEnv = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
export const API_URL =
  fromEnv ??
  (Platform.OS === "web" &&
  typeof window !== "undefined" &&
  !window.location.origin.includes("localhost:8081")
    ? window.location.origin
    : "https://gigspree.in");
export const APP_SCHEME = "gigspree";

/** The local test server, the only place the test sign-in (and its Keychain fallback) works. */
export const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
