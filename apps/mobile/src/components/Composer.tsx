// The one composer (docs/design/from-scratch.md §2 "one composer", §3 "Chat sheet"): the same
// bar on every screen, at the bottom, saying what the screen is about. Type and send, and the
// chat opens as a sheet over the screen with that sent; tap the arrow, and it opens as it is.
// It matches the page (decision 2026-11-09 "A calmer look, and a home that shows your day": the
// dark slab was the heaviest thing on every screen), and people without the assistant don't see
// it at all: a bar that can only say "not on your plan" is a dead end.
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetworkState } from "expo-network";
import { Tap, TextInput, type } from "@assistant/cards/native";
import { aboutLabel, openChat, useChatPanel, type ChatAbout, type ChatParams } from "../chat-open.ts";
import { useKeyboardRoom } from "../keyboard.ts";
import { useSession } from "../session.tsx";
import { useTheme } from "../theme.ts";
import { SendIcon } from "./HeaderIcons.tsx";

/** How much a screen's content leaves free at the bottom so its last row clears the bar. */
export const COMPOSER_ROOM = 84;

/** `lift`: how far above the bottom edge a screen's own bar (a message box) pushes the composer. */
export function Composer({
  about,
  params,
  lift = 0,
  placeholder,
}: {
  /** What the screen is about (none: the home, where anything can be asked). */
  about?: ChatAbout;
  /** Said in the empty box instead of "Ask about …". */
  placeholder?: string;
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
  // Nothing to ask with: no bar (someone played in a rehearsal has no assistant either).
  if (!assistant || me?.practice) return null;
  const q = text.trim();
  const label = about ? aboutLabel(about) : "anything";
  const hint = placeholder ?? `Ask about ${label}`;
  const go = () => {
    if (!assistant || !online) return;
    openChat(q ? { ...params, ask: q, send: "1" } : (params ?? {}), about);
    setText("");
  };
  const bottom = (room ? 12 : insets.bottom + 12) + lift + room;
  return (
    <>
      {/* The page's own colour from the middle of the bar down, so rows scroll away behind the
          bar instead of peeking out under it (not where a screen's own bar sits below). */}
      {lift ? null : (
        <View pointerEvents="none" style={[s.under, { height: bottom + 27, backgroundColor: t.page }]} />
      )}
      <View style={[s.wrap, { bottom }]} pointerEvents="box-none">
        <View style={[s.bar, { backgroundColor: t.cell, borderColor: t.hair, shadowColor: t.shadow }]}>
          <TextInput
            accessibilityLabel={hint}
            placeholder={online ? hint : "Asking needs a connection"}
            placeholderTextColor={t.fg2}
            value={text}
            onChangeText={setText}
            onSubmitEditing={go}
            returnKeyType="send"
            submitBehavior="submit"
            editable={online}
            autoCorrect={false}
            style={[
              s.input,
              type.body,
              { color: t.fg },
              Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : null,
            ]}
          />
          <Tap
            accessibilityRole="button"
            accessibilityLabel={q ? "Send" : "Open the chat"}
            onPress={go}
            disabled={!online}
            scale={0.88}
            haptic="light"
            hitSlop={6}
            style={[s.send, { backgroundColor: online ? t.accent : t.fill }]}
          >
            <SendIcon color={online ? t.onAccent : t.fg3} />
          </Tap>
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  under: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: {
    width: "100%",
    maxWidth: 640,
    minHeight: 54,
    borderRadius: 27,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 18,
    paddingRight: 7,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  input: { flex: 1, minWidth: 0, minHeight: 44, paddingVertical: 2 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
