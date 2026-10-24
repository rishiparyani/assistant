// Better Auth's client for the app. On the phone the session cookie is kept in the Keychain /
// Keystore by the Expo plugin and sent as a header; on the website the browser's cookie does it.
// online-only: sign-in is handled by the server.
import { Platform } from "react-native";
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { API_URL, APP_SCHEME, LOCAL } from "./config.ts";
import { kv } from "./storage.ts";

// Against the local test server only (the simulator job): a build without entitlements has no
// Keychain ("A required entitlement isn't present"), so the cookie goes to the app's own store
// instead. Against any other server the Keychain is the only place.
const storage: typeof SecureStore = LOCAL.test(API_URL)
  ? {
      ...SecureStore,
      getItem: (k) =>
        tryKeychain(
          () => SecureStore.getItem(k),
          () => kv.get(k),
        ),
      getItemAsync: (k) =>
        tryKeychainAsync(
          () => SecureStore.getItemAsync(k),
          () => kv.get(k),
        ),
      setItem: (k, v) =>
        tryKeychain(
          () => SecureStore.setItem(k, v),
          () => kv.set(k, v),
        ),
      setItemAsync: (k, v) =>
        tryKeychainAsync(
          () => SecureStore.setItemAsync(k, v),
          () => kv.set(k, v),
        ),
    }
  : SecureStore;

function tryKeychain<T>(keychain: () => T, fallback: () => T): T {
  try {
    return keychain();
  } catch {
    return fallback();
  }
}
async function tryKeychainAsync<T>(keychain: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await keychain();
  } catch {
    return fallback();
  }
}

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: "/auth",
  plugins:
    Platform.OS === "web" ? [] : [expoClient({ scheme: APP_SCHEME, storagePrefix: APP_SCHEME, storage })],
});

/** The Cookie header for API calls from the phone ("" on the web, where the browser sends it). */
export async function cookieHeader(): Promise<string> {
  if (Platform.OS === "web") return "";
  try {
    return (await authClient.getCookie()) ?? "";
  } catch {
    return "";
  }
}

/** Google through the system sign-in sheet. */
export async function signInWithGoogle() {
  const res = await authClient.signIn.social({
    provider: "google",
    callbackURL: Platform.OS === "web" ? "/" : `${APP_SCHEME}://`,
  });
  // The client returns errors instead of throwing them; the screen shows them.
  if (res.error) throw new Error(res.error.message ?? `Couldn't reach the sign-in (${res.error.status})`);
  // On the phone the sheet closes without a word when the person cancels, Google refuses, or
  // the app isn't handed the session; say so, instead of a screen that does nothing.
  if (Platform.OS !== "web" && !(await cookieHeader()))
    throw new Error("Sign-in didn't finish. Try again; if it keeps happening, tell the app team.");
}

/** Local test server only (email/password exists only on localhost). */
export async function signInWithEmail(email: string, password: string) {
  const res = await authClient.signIn.email({ email, password });
  if (res.error) throw new Error(res.error.message ?? "Couldn't sign in");
}

export async function signOut() {
  await authClient.signOut();
}
