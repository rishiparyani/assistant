// The chat, one tap away on any screen (owner, 2026-10-24: the chat "will permanently be there
// on any screen, and we can open that chat from anywhere"): a thin dark bar at the bottom, the
// same place as the home's, that opens the chat about what the screen shows. The screen leaves
// room for it, so it never covers a row or a button (not a floating bubble: decision
// 2026-10-24 "The chat from any screen").
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@assistant/cards/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme.ts";

/** How much a screen's content leaves free at the bottom for the bar. */
export const CHAT_BAR_ROOM = 84;

export function ChatBar({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bottom, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hint}
        onPress={onPress}
        style={[s.bar, { backgroundColor: t.ink, shadowColor: t.shadow }]}
      >
        <Text style={[s.barText, { color: t.onInk }]} numberOfLines={1}>
          {label}
        </Text>
        <View style={[s.send, { backgroundColor: t.accent }]}>
          <Text style={{ color: t.onAccent, fontSize: 17, fontWeight: "800", lineHeight: 19 }}>↑</Text>
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 8, paddingHorizontal: 16 },
  bar: {
    height: 52,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 18,
    paddingRight: 9,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  barText: { flex: 1, fontSize: 15, fontWeight: "600", opacity: 0.75 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
