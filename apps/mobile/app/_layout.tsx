import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Modal, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import { setAppFont } from "@assistant/cards/native";
import {
  PANEL_WIDTH,
  SIDEBAR_WIDTH,
  WIDE,
  chatGone,
  closeChatPanel,
  useChatPanel,
  useTwoPanes,
} from "@/chat-open";
import { ChatsHome } from "./index";
import { ChatScreen } from "@/components/ChatScreen";
import { PracticeBanner } from "@/components/PracticeBanner";
import { usePracticeMode } from "@/practice-mode";
import { Stack, useGlobalSearchParams, usePathname, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
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

/** The chats on the left of two panes (a laptop's website), once someone is signed in. */
function Sidebar() {
  const { t } = useTheme();
  const { me } = useSession();
  const path = usePathname();
  const two = useTwoPanes();
  if (!two || !me || path === "/login" || path === "/test") return null;
  return (
    <View
      style={{ width: SIDEBAR_WIDTH, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: t.sep }}
    >
      <ChatsHome pane />
    </View>
  );
}

/**
 * Everything below is drawn again when the account changes (the account switcher), so no
 * screen keeps showing what it loaded for the account before.
 */
function ForAccount({ children }: { children: ReactNode }) {
  const { account } = useSession();
  return <Fragment key={account ?? "signed-out"}>{children}</Fragment>;
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
  // The chat (docs/design/from-scratch.md §3 "Chat sheet"): one for the whole app, opened from
  // any screen's composer. On the phone it is a sheet over the screen; on the website it sits
  // beside the screen on a wide window (like Claude's own panel) and over it on a narrow one.
  // The website's panel stays the same element whether beside or over, so its draft and state
  // survive a resize and a message sent on open isn't sent again (Codex on PR 193).
  const { width } = useWindowDimensions();
  const panel = useChatPanel();
  const sideChat = Platform.OS === "web" && panel.open;
  const beside = width >= WIDE;
  // Rehearsing as someone (from-scratch.md §2 point 9): a banner across the top of the whole app.
  const practising = !!usePracticeMode();
  // The banner takes the top safe area; the screens under it start right below it.
  const insets = useSafeAreaInsets();
  if (!fontsLoaded && !fontError && !waited) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.canvas }}>
      <SessionProvider>
        <StatusBar style={dark ? "light" : "dark"} />
        <ForAccount>
          <SessionGate />
          {practising ? <PracticeBanner /> : null}
          <SafeAreaInsetsContext.Provider value={practising ? { ...insets, top: 0 } : insets}>
            <View style={{ flex: 1, flexDirection: "row" }}>
              <Sidebar />
              <View style={{ flex: 1 }}>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.canvas } }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen
                    name="login"
                    options={{ presentation: "fullScreenModal", animation: "fade" }}
                  />
                  {/* Every other screen is pushed (slides in from the right, back is a swipe): the
              chat sheet is the one sheet, and nothing opens over a sheet (from-scratch.md §2
              "nothing stacks"). /chat is an address only; it opens the sheet over Today. */}
                  <Stack.Screen name="chat" />
                  <Stack.Screen name="memory" />
                  <Stack.Screen name="library" />
                  <Stack.Screen name="capture" />
                  <Stack.Screen name="process" />
                  <Stack.Screen name="connections" />
                  <Stack.Screen name="list" />
                  <Stack.Screen name="trash" />
                  {/* Chats with people, and one chat: pushed like the list. */}
                  <Stack.Screen name="chats" />
                  <Stack.Screen name="talk" />
                  <Stack.Screen name="you" />
                </Stack>
              </View>
              {sideChat ? (
                <View
                  style={
                    beside
                      ? {
                          width: PANEL_WIDTH,
                          borderLeftWidth: StyleSheet.hairlineWidth,
                          borderLeftColor: t.sep,
                        }
                      : [StyleSheet.absoluteFill, { backgroundColor: t.page }]
                  }
                >
                  <ChatScreen key={panel.nonce} params={panel.params} onClose={closeChatPanel} />
                </View>
              ) : null}
            </View>
          </SafeAreaInsetsContext.Provider>
          {Platform.OS !== "web" ? (
            // The phone's chat sheet: the system's page sheet (a pull down or Back closes it),
            // over whatever screen the composer was on.
            <Modal
              visible={panel.open}
              presentationStyle="pageSheet"
              animationType="slide"
              allowSwipeDismissal
              onRequestClose={closeChatPanel}
              onDismiss={chatGone}
            >
              <View style={{ flex: 1, backgroundColor: t.page }}>
                <ChatScreen key={panel.nonce} params={panel.params} onClose={closeChatPanel} />
              </View>
            </Modal>
          ) : null}
        </ForAccount>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
