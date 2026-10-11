// Better Auth's client for the app. On the phone the session cookie is kept in the Keychain /
// Keystore by the Expo plugin and sent as a header; on the website the browser's cookie does it.
// online-only: sign-in is handled by the server.
import { Platform } from "react-native";
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { API_URL, APP_SCHEME } from "./config.ts";

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: "/auth",
  plugins:
    Platform.OS === "web"
      ? []
      : [expoClient({ scheme: APP_SCHEME, storagePrefix: APP_SCHEME, storage: SecureStore })],
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

/** Google through the system sign-in sheet (security change: waits for the owner's OK). */
export async function signInWithGoogle() {
  await authClient.signIn.social({
    provider: "google",
    callbackURL: Platform.OS === "web" ? "/" : `${APP_SCHEME}://`,
  });
}

/** Local test server only (email/password exists only on localhost). */
export async function signInWithEmail(email: string, password: string) {
  const res = await authClient.signIn.email({ email, password });
  if (res.error) throw new Error(res.error.message ?? "Couldn't sign in");
}

export async function signOut() {
  await authClient.signOut();
}
