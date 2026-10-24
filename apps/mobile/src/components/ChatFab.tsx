// The chat, one tap away on every screen (owner, 2026-10-24: "I wanted it to be floating… to be
// everywhere possible in the app so that we can get the context from literally anywhere"): a
// round button that floats at the bottom right of any screen and opens the chat about what that
// screen shows. The screen says what it is about (a kind and a name, never the pixels); the chat
// shows it as a chip the person can tap away (decision 2026-10-24 "The chat from any screen",
// revised the same day: floating after all).
import { Platform, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Tap } from "@assistant/cards/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { aboutLabel, openChat, useChatPanel, type ChatAbout, type ChatParams } from "../chat-open.ts";
import { useTheme } from "../theme.ts";

/** How much a screen's content leaves free at the bottom so its last row clears the button. */
export const CHAT_FAB_ROOM = 84;

/** `lift`: how far above the bottom edge a screen's own bar (a message box) pushes the button. */
export function ChatFab({
  about,
  params,
  lift = 0,
}: {
  about: ChatAbout;
  params?: ChatParams;
  lift?: number;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const panel = useChatPanel();
  // On a wide website window the chat is already open beside the screen.
  if (Platform.OS === "web" && panel.open) return null;
  return (
    <View style={[s.corner, { bottom: insets.bottom + 16 + lift }]} pointerEvents="box-none">
      <Tap
        accessibilityRole="button"
        accessibilityLabel={`Ask about ${aboutLabel(about)}`}
        onPress={() => openChat(router, params ?? {}, about)}
        scale={0.9}
        haptic="light"
        style={[s.fab, { backgroundColor: t.accent, shadowColor: t.shadow }]}
      >
        {/* A speech bubble with dots: the assistant's chat, the same glyph as the home's bar. */}
        <View style={[s.bubble, { borderColor: t.onAccent }]}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[s.dot, { backgroundColor: t.onAccent }]} />
          ))}
        </View>
      </Tap>
    </View>
  );
}

const s = StyleSheet.create({
  corner: { position: "absolute", right: 16 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  bubble: {
    width: 24,
    height: 18,
    borderRadius: 6,
    borderWidth: 2.2,
    borderBottomLeftRadius: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2.5,
  },
  dot: { width: 3, height: 3, borderRadius: 2 },
});
