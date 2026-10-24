// The one composer (docs/design/from-scratch.md §2 "one composer", §3 "Chat sheet"): the same
// dark bar on every screen, at the bottom, with a chip saying what the screen is about. Type and
// send, and the chat opens as a sheet over the screen with that sent; tap the bubble, and it
// opens as it is. Today's bar (HomeBar) is this bar with search in it.
import { useState } from "react";
import { Image, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetworkState } from "expo-network";
import { Tap, Text, TextInput, type } from "@assistant/cards/native";
import { aboutLabel, openChat, useChatPanel, type ChatAbout, type ChatParams } from "../chat-open.ts";
import { useKeyboardRoom } from "../keyboard.ts";
import { useSession } from "../session.tsx";
import { useTheme } from "../theme.ts";

const logoDark = require("../../assets/logo-dark.png");

/** How much a screen's content leaves free at the bottom so its last row clears the bar. */
export const COMPOSER_ROOM = 84;

/** `lift`: how far above the bottom edge a screen's own bar (a message box) pushes the composer. */
export function Composer({
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
  const room = useKeyboardRoom();
  const panel = useChatPanel();
  const { me } = useSession();
  const online = useNetworkState().isInternetReachable !== false;
  const [text, setText] = useState("");
  const assistant = me?.assistant !== false;
  // On a wide website window the chat is already open beside the screen.
  if (Platform.OS === "web" && panel.open) return null;
  const q = text.trim();
  const label = aboutLabel(about);
  const go = () => {
    if (!assistant || !online) return;
    openChat(q ? { ...params, ask: q, send: "1" } : (params ?? {}), about);
    setText("");
  };
  return (
    <View
      style={[s.wrap, { bottom: (room ? 12 : insets.bottom + 12) + lift + room }]}
      pointerEvents="box-none"
    >
      <View style={[s.bar, { backgroundColor: t.ink, shadowColor: t.shadow }]}>
        <Image source={logoDark} style={s.logo} accessibilityIgnoresInvertColors />
        <View style={s.middle}>
          <View style={[s.chip, { backgroundColor: t.onInk + "22" }]}>
            <Text style={[type.caption, { color: t.onInk, fontWeight: "700" }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
          <TextInput
            accessibilityLabel={`Ask about ${label}`}
            placeholder={
              me?.practice
                ? `${me.user.name.split(" ")[0]} has no assistant here`
                : !assistant
                  ? "The assistant isn't on your plan"
                  : online
                    ? "Ask or add…"
                    : "Asking needs a connection"
            }
            placeholderTextColor={t.onInk + "99"}
            value={text}
            onChangeText={setText}
            onSubmitEditing={go}
            returnKeyType="send"
            submitBehavior="submit"
            editable={assistant && online}
            autoCorrect={false}
            style={[
              s.input,
              type.body,
              { color: t.onInk },
              Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : null,
            ]}
          />
        </View>
        <Tap
          accessibilityRole="button"
          accessibilityLabel={q ? "Send" : "Open the chat"}
          onPress={go}
          disabled={!assistant || !online}
          scale={0.88}
          haptic="light"
          hitSlop={6}
          style={[s.send, { backgroundColor: assistant && online ? t.accent : t.fill }]}
        >
          {q ? (
            <Text style={{ color: t.onAccent, fontSize: 17, fontWeight: "800", lineHeight: 19 }}>↑</Text>
          ) : (
            // A speech bubble with dots: the assistant's chat, the same glyph as Today's bar.
            <View style={[s.bubble, { borderColor: t.onAccent }]}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[s.dot, { backgroundColor: t.onAccent }]} />
              ))}
            </View>
          )}
        </Tap>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  bar: {
    width: "100%",
    maxWidth: 640,
    minHeight: 56,
    borderRadius: 28,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 10,
    paddingLeft: 14,
    paddingRight: 9,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  logo: { width: 26, height: 26 },
  middle: { flex: 1, minWidth: 0, gap: 1 },
  chip: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  input: { minHeight: 26, paddingVertical: 2, fontWeight: "600" },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  bubble: {
    width: 20,
    height: 15,
    borderRadius: 5,
    borderWidth: 2,
    borderBottomLeftRadius: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dot: { width: 2.5, height: 2.5, borderRadius: 2 },
});
