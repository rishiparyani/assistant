// The one bar (decision 2026-10-16 "One bar"): type, and what you have appears above it at
// once, from the device (lists, cards, rows) and a moment later from the server's index;
// press send to ask the assistant instead. Offline it is a search bar and nothing else:
// the send button becomes a magnifier and nothing is queued as a message.
import { forwardRef, useState } from "react";
import { Image, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useNetworkState } from "expo-network";
import { Tap, Text, TextInput, motion, type } from "@assistant/cards/native";
import type { HomeCard } from "@/home";
import { cardHits, listHits, useRemoteHits, type SearchResult } from "@/search";
import { radius, useTheme } from "@/theme";
import { useKeyboardRoom } from "@/keyboard";

const logoDark = require("../../assets/logo-dark.png");

export interface HomeBarProps {
  /** This person has the assistant (else the bar searches only). */
  assistant: boolean;
  /** Focus the box when the home opens (the keyboard comes up). */
  autoFocus?: boolean;
  text: string;
  onChangeText: (t: string) => void;
  cards: HomeCard[];
  lists: { id: string; name: string; space?: string; space_name?: string }[];
  /** The space whose page is showing (decision 2026-10-16 "Spaces"): asking goes to its chat. */
  space?: { id: string; name: string };
  /** Send the words to the assistant (online, with the assistant), in the page's space if any. */
  onAsk: (text: string, space?: string) => void;
  /** Open the chat as it is (the empty bar's button: back to the conversation, its answers). */
  onOpenChat: (space?: string) => void;
  onOpenCard: (card: HomeCard) => void;
  onOpenList: (id: string, space?: string) => void;
  onOpenHit: (hit: SearchResult, q: string) => void;
}

export const HomeBar = forwardRef<View, HomeBarProps>(function HomeBar(
  {
    assistant,
    autoFocus,
    text,
    onChangeText,
    cards,
    lists,
    space,
    onAsk,
    onOpenChat,
    onOpenCard,
    onOpenList,
    onOpenHit,
  },
  ref,
) {
  const { t } = useTheme();
  // The matches fit between the top of the screen and the bar, wherever the keyboard put it.
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardRoom();
  // The bar grows with what's typed or dictated (about four lines, then it scrolls inside), so
  // the matches sit above wherever its top is (owner, 2026-10-17: "I can see only a single line").
  const [barHeight, setBarHeight] = useState(52);
  const [typed, setTyped] = useState(34);
  const panelMax = Math.max(160, Math.min(340, height - (keyboard || insets.bottom) - insets.top - 110));
  const net = useNetworkState();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const canAsk = assistant && online;
  const q = text.trim();
  const searching = q.length > 0;
  const lists_ = listHits(lists, q);
  const cards_ = cardHits(cards, q);
  const remote = useRemoteHits(q, online);
  const ask = () => {
    if (!canAsk) return;
    // Nothing typed: the button opens the chat (the owner, 2026-10-16: "I closed the chat
    // window and I can't seem to go back and find that chat").
    if (!q) return onOpenChat(space?.id);
    onChangeText("");
    onAsk(q, space?.id);
  };
  const pick = (go: () => void) => {
    onChangeText("");
    go();
  };
  const nothing = searching && !lists_.length && !cards_.length && !remote.length;
  return (
    <View style={s.wrap}>
      {searching ? (
        <Animated.View
          entering={FadeInDown.duration(motion.enter)}
          exiting={FadeOut.duration(motion.fade)}
          style={[
            s.panel,
            {
              bottom: barHeight + 8,
              maxHeight: panelMax,
              backgroundColor: t.cell,
              borderColor: t.hair,
              shadowColor: t.shadow,
            },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled" style={s.scroll} contentContainerStyle={s.results}>
            {canAsk ? (
              <Tap
                accessibilityRole="button"
                accessibilityLabel={space ? `Ask in ${space.name}: ${q}` : `Ask Gigspree: ${q}`}
                onPress={ask}
                scale={0.985}
                style={[s.hit, { backgroundColor: t.ink }]}
              >
                <Text style={[type.body, { color: t.onInk, flex: 1 }]} numberOfLines={1}>
                  {space ? `Ask in ${space.name}: ` : "Ask: "}“{q}”
                </Text>
                <Text style={{ color: t.onInk, fontWeight: "800" }}>↑</Text>
              </Tap>
            ) : null}
            {lists_.map((l) => (
              <Tap
                key={`list:${l.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Open the list ${l.name}`}
                onPress={() => pick(() => onOpenList(l.id, l.space))}
                scale={0.985}
                style={[s.hit, { backgroundColor: t.fill }]}
              >
                <Text style={[type.body, { color: t.fg, fontWeight: "700", flex: 1 }]} numberOfLines={1}>
                  {l.name}
                </Text>
                <Text style={[type.caption, { color: t.fg2 }]}>
                  {l.space_name ? `in ${l.space_name} · list ›` : "list ›"}
                </Text>
              </Tap>
            ))}
            {cards_.map(({ card, rows }) => (
              <Tap
                key={card.id}
                accessibilityRole="button"
                accessibilityLabel={card.spec.title}
                onPress={() => pick(() => onOpenCard(card))}
                scale={0.985}
                style={[s.hit, s.hitCol, { backgroundColor: t.fill }]}
              >
                <Text style={[type.body, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
                  {card.spec.title}
                </Text>
                {rows.map((r) => (
                  <Text key={r} style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
                    {r}
                  </Text>
                ))}
              </Tap>
            ))}
            {remote.map((h) => (
              <Tap
                key={
                  h.kind === "message"
                    ? `${h.group_id}:${h.message_id}`
                    : h.kind === "conversation"
                      ? `${h.chat_id}:${h.message_id}`
                      : `${h.space_id}:${h.record_id}`
                }
                accessibilityRole="button"
                onPress={() => pick(() => onOpenHit(h, q))}
                scale={0.985}
                style={[s.hit, s.hitCol, { backgroundColor: t.fill }]}
              >
                <Text style={[type.body, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
                  {h.kind === "message"
                    ? `${h.chat} · chat`
                    : h.kind === "conversation"
                      ? `${h.chat} · with the assistant`
                      : h.title}
                </Text>
                <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={2}>
                  {h.kind === "message" || h.kind === "conversation"
                    ? h.snippet.replace(/[[\]]/g, "")
                    : h.collection +
                      (h.snippet && h.snippet !== h.title ? ` · ${h.snippet.replace(/[[\]]/g, "")}` : "")}
                </Text>
              </Tap>
            ))}
            {nothing ? (
              <Text style={[type.caption, { color: t.fg2, padding: 10 }]}>
                {online ? "Nothing matches yet." : "Nothing on this phone matches."}
              </Text>
            ) : null}
            {!online ? (
              <Text style={[type.caption, { color: t.fg2, paddingHorizontal: 10, paddingBottom: 4 }]}>
                Offline · searching what's on this phone. Asking needs a connection.
              </Text>
            ) : null}
          </ScrollView>
        </Animated.View>
      ) : null}
      <View
        ref={ref}
        collapsable={false}
        onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
        style={[s.bar, { backgroundColor: t.ink, shadowColor: t.shadow }]}
      >
        <Image source={logoDark} style={s.logo} accessibilityIgnoresInvertColors />
        <TextInput
          accessibilityLabel={assistant ? "Ask or search" : "Search your cards"}
          placeholder={
            assistant
              ? online
                ? space
                  ? `Ask in ${space.name}, or search…`
                  : "Ask, add or search…"
                : "Search (offline)"
              : "Search your cards"
          }
          placeholderTextColor={t.onInk + "99"}
          value={text}
          onChangeText={onChangeText}
          onSubmitEditing={ask}
          returnKeyType={canAsk ? "send" : "search"}
          submitBehavior={canAsk ? "submit" : "blurAndSubmit"}
          multiline
          autoFocus={autoFocus}
          autoCorrect={false}
          // The phone sizes a growing box itself (up to maxHeight); the web needs its height.
          onContentSizeChange={
            Platform.OS === "web" ? (e) => setTyped(e.nativeEvent.contentSize.height) : undefined
          }
          style={[
            s.input,
            type.body,
            { color: t.onInk },
            // The measured height includes the 6 + 6 padding.
            Platform.OS === "web" ? { height: Math.min(MAX_TEXT + 12, Math.max(34, typed)) } : null,
          ]}
        />
        {searching ? (
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Clear"
            onPress={() => onChangeText("")}
            hitSlop={8}
            style={s.clear}
          >
            <Text style={{ color: t.onInk, opacity: 0.7, fontSize: 15, fontWeight: "700" }}>×</Text>
          </Tap>
        ) : null}
        <Tap
          accessibilityRole="button"
          accessibilityLabel={canAsk ? (q ? "Send" : "Open the chat") : "Search"}
          onPress={ask}
          disabled={!canAsk}
          scale={0.88}
          haptic="light"
          style={[s.send, { backgroundColor: canAsk ? t.accent : t.fill }]}
        >
          {canAsk && !q ? (
            // A speech bubble with dots (the assistant's chat; the home's plain bubble is people).
            <View style={[s.bubble, { borderColor: t.onAccent }]}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[s.dot, { backgroundColor: t.onAccent }]} />
              ))}
            </View>
          ) : (
            <Text
              style={{
                color: canAsk ? t.onAccent : t.onInk,
                fontSize: 17,
                fontWeight: "800",
                lineHeight: 19,
              }}
            >
              {canAsk ? "↑" : "⌕"}
            </Text>
          )}
        </Tap>
      </View>
    </View>
  );
});

/** One line of the bar's text, and the most it shows before scrolling (four lines). */
const LINE = 22;
const MAX_TEXT = LINE * 4;

const s = StyleSheet.create({
  wrap: { flex: 1 },
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
  // The buttons rest on the bottom edge as the text grows (like a messaging app).
  bar: {
    minHeight: 52,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "flex-end",
    paddingVertical: 9,
    gap: 10,
    paddingLeft: 14,
    paddingRight: 9,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  logo: { width: 26, height: 26, marginBottom: 4 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    maxHeight: MAX_TEXT + 12,
    paddingTop: 6,
    paddingBottom: 6,
    fontWeight: "600",
    ...(Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : {}),
  },
  clear: { width: 28, height: 28, marginBottom: 3, alignItems: "center", justifyContent: "center" },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    overflow: "hidden",
  },
  scroll: { flexGrow: 0 },
  results: { padding: 8, gap: 6 },
  hit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  hitCol: { flexDirection: "column", alignItems: "stretch", gap: 2 },
});
