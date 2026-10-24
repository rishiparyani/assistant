import { useEffect, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import { setAppFont } from "@assistant/cards/native";
import { WIDE, closeChatPanel, useChatPanel } from "@/chat-open";
import { ChatScreen } from "./chat";
import { Stack, useGlobalSearchParams, usePathname, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { API_URL, LOCAL } from "@/config";
import { SessionProvider, useSession } from "@/session";
import { useTheme } from "@/theme";

/**
 * Every screen needs a signed-in person (sign-in and the test route aside): a deep link like
 * /chat opened while signed out goes to sign-in, which comes back to it.
 */
function SessionGate() {
  const { me, loaded } = useSession();
  const path = usePathname();
  const params = useGlobalSearchParams();
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (!loaded || me || path === "/login" || path === "/test" || path === "/gallery" || path === "/a2ui")
      return;
    // Keep the query (e.g. /capture?text=… from Siri) so nothing asked for is lost at sign-in;
    // route segments like [id] are already in the path.
    const inPath = new Set(segments.map((s) => /^\[(?:\.\.\.)?(.+)\]$/.exec(s)?.[1]).filter(Boolean));
    // (Built by hand: React Native's URLSearchParams lacks parts of the web one.)
    const query: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (inPath.has(k)) continue;
      for (const one of Array.isArray(v) ? v : [v])
        if (typeof one === "string") query.push(`${encodeURIComponent(k)}=${encodeURIComponent(one)}`);
    }
    const next = query.length ? `${path}?${query.join("&")}` : path;
    // On the website the sign-in page is the site's own (Google, passkeys), which comes back
    // here; the app's sign-in screen would only forward to it.
    if (Platform.OS === "web" && window.location.origin === API_URL && !LOCAL.test(API_URL)) {
      window.location.replace(next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login");
      return;
    }
    router.replace({ pathname: "/login", params: next && next !== "/" ? { next } : {} });
  }, [loaded, me, path, params, segments, router]);
  return null;
}

export default function Layout() {
  const { t, dark } = useTheme();
  // The app's typeface (decision 2026-10-13 "A warmer home"). The first screen waits for it a
  // moment so text doesn't jump; past a second and a half it goes on in the system font.
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(id);
  }, []);
  // On the website the site's service worker keeps the app's files on the device, so it opens
  // offline (docs/design/offline.md); not on a local or preview server, which has none.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (window.location.origin !== API_URL || LOCAL.test(API_URL)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  setAppFont(fontsLoaded && !fontError);
  // On a wide website window the chat sits beside the screen, like Claude's own panel (owner,
  // 2026-10-24; decision "The chat from any screen"); it opens from any screen's bar.
  const { width } = useWindowDimensions();
  const panel = useChatPanel();
  const sideChat = Platform.OS === "web" && width >= WIDE && panel.open;
  if (!fontsLoaded && !fontError && !waited) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.canvas }}>
      <SessionProvider>
        <StatusBar style={dark ? "light" : "dark"} />
        <SessionGate />
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.canvas } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="login" options={{ presentation: "fullScreenModal", animation: "fade" }} />
              {/* A page sheet (UIKit's own), not a form sheet with custom detents: the form sheet
              laid its content out wrong once the keyboard had been up (bubbles under the
              header, under the message box). */}
              <Stack.Screen name="chat" options={{ presentation: "modal" }} />
              <Stack.Screen name="memory" options={{ presentation: "modal" }} />
              <Stack.Screen name="library" options={{ presentation: "modal" }} />
              <Stack.Screen name="capture" options={{ presentation: "modal" }} />
              <Stack.Screen name="process" options={{ presentation: "modal" }} />
              <Stack.Screen name="connections" options={{ presentation: "modal" }} />
              {/* A whole list: slides in from the right, back is a swipe. */}
              <Stack.Screen name="list" />
              <Stack.Screen name="trash" />
              {/* Chats with people, and one chat: pushed like the list. */}
              <Stack.Screen name="chats" />
              <Stack.Screen name="talk" />
            </Stack>
          </View>
          {sideChat ? (
            <View style={{ width: 440, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.sep }}>
              <ChatScreen key={panel.nonce} params={panel.params} embedded onClose={closeChatPanel} />
            </View>
          ) : null}
        </View>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
