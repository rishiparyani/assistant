// The one bar (decision 2026-10-16 "One bar"): type, and what you have appears above it at
// once, from the device (lists, cards, rows) and a moment later from the server's index;
// press send to ask the assistant instead. Offline it is a search bar and nothing else:
// the send button becomes a magnifier and nothing is queued as a message.
import { forwardRef } from "react";
import { Image, Platform, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useNetworkState } from "expo-network";
import { Tap, Text, TextInput, motion, type } from "@assistant/cards/native";
import type { HomeCard } from "@/home";
import { cardHits, listHits, useRemoteHits, type SearchResult } from "@/search";
import { radius, useTheme } from "@/theme";

const logoDark = require("../../assets/logo-dark.png");

export interface HomeBarProps {
  /** This person has the assistant (else the bar searches only). */
  assistant: boolean;
  text: string;
  onChangeText: (t: string) => void;
  cards: HomeCard[];
  lists: { id: string; name: string; space?: string; space_name?: string }[];
  /** The space whose page is showing (decision 2026-10-16 "Spaces"): asking goes to its chat. */
  space?: { id: string; name: string };
  /** Send the words to the assistant (online, with the assistant), in the page's space if any. */
  onAsk: (text: string, space?: string) => void;
  onOpenCard: (card: HomeCard) => void;
  onOpenList: (id: string, space?: string) => void;
  onOpenHit: (hit: SearchResult, q: string) => void;
}

export const HomeBar = forwardRef<View, HomeBarProps>(function HomeBar(
  { assistant, text, onChangeText, cards, lists, space, onAsk, onOpenCard, onOpenList, onOpenHit },
  ref,
) {
  const { t } = useTheme();
  const net = useNetworkState();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const canAsk = assistant && online;
  const q = text.trim();
  const searching = q.length > 0;
  const lists_ = listHits(lists, q);
  const cards_ = cardHits(cards, q);
  const remote = useRemoteHits(q, online);
  const ask = () => {
    if (!canAsk || !q) return;
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
          style={[s.panel, { backgroundColor: t.cell, borderColor: t.hair, shadowColor: t.shadow }]}
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
                key={h.kind === "message" ? `${h.group_id}:${h.message_id}` : `${h.space_id}:${h.record_id}`}
                accessibilityRole="button"
                onPress={() => pick(() => onOpenHit(h, q))}
                scale={0.985}
                style={[s.hit, s.hitCol, { backgroundColor: t.fill }]}
              >
                <Text style={[type.body, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
                  {h.kind === "message" ? `${h.chat} · chat` : h.title}
                </Text>
                <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={2}>
                  {h.kind === "message"
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
      <View ref={ref} collapsable={false} style={[s.bar, { backgroundColor: t.ink, shadowColor: t.shadow }]}>
        <Image source={logoDark} style={{ width: 26, height: 26 }} accessibilityIgnoresInvertColors />
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
          blurOnSubmit={!canAsk}
          autoCorrect={false}
          style={[s.input, type.body, { color: t.onInk }]}
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
          accessibilityLabel={canAsk ? "Send" : "Search"}
          accessibilityState={{ disabled: canAsk && !q }}
          onPress={ask}
          disabled={!canAsk}
          scale={0.88}
          haptic="light"
          style={[s.send, { backgroundColor: canAsk ? t.accent : t.fill }]}
        >
          <Text
            style={{ color: canAsk ? t.onAccent : t.onInk, fontSize: 17, fontWeight: "800", lineHeight: 19 }}
          >
            {canAsk ? "↑" : "⌕"}
          </Text>
        </Tap>
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  wrap: { flex: 1 },
  bar: {
    height: 52,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 14,
    paddingRight: 9,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 44,
    paddingVertical: 0,
    fontWeight: "600",
    ...(Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : {}),
  },
  clear: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 60,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 340,
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
