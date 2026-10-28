// What a search finds (decision 2026-10-16 "One bar"; chats-home.md: search on pull-down): the
// device's lists and cards at once, the server's index a moment later, and "Ask" first when the
// assistant can take it. Offline it searches what the phone has and says asking needs a connection.
import { StyleSheet, View } from "react-native";
import { useNetworkState } from "expo-network";
import { Tap, Text, type } from "@assistant/cards/native";
import type { HomeCard } from "@/home";
import { cardHits, listHits, useRemoteHits, type SearchResult } from "@/search";
import { useTheme } from "@/theme";

export interface SearchResultsProps {
  q: string;
  /** This person has the assistant (else nothing is offered to ask). */
  assistant: boolean;
  cards: HomeCard[];
  lists: { id: string; name: string; space?: string; space_name?: string }[];
  /** Whether anything else on the screen matched (rows above), so "Nothing matches" stays quiet. */
  others?: boolean;
  onAsk: (text: string) => void;
  onOpenCard: (card: HomeCard) => void;
  onOpenList: (id: string, space?: string) => void;
  onOpenHit: (hit: SearchResult, q: string) => void;
}

export function SearchResults({
  q,
  assistant,
  cards,
  lists,
  others,
  onAsk,
  onOpenCard,
  onOpenList,
  onOpenHit,
}: SearchResultsProps) {
  const { t } = useTheme();
  const net = useNetworkState();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const canAsk = assistant && online;
  const lists_ = listHits(lists, q);
  const cards_ = cardHits(cards, q);
  const remote = useRemoteHits(q, online);
  const nothing = !others && !lists_.length && !cards_.length && !remote.length;
  return (
    <View style={s.results}>
      {canAsk ? (
        <Tap
          accessibilityRole="button"
          accessibilityLabel={`Ask the assistant: ${q}`}
          onPress={() => onAsk(q)}
          scale={0.985}
          style={[s.hit, { backgroundColor: t.ink }]}
        >
          <Text style={[type.body, { color: t.onInk, flex: 1 }]} numberOfLines={1}>
            Ask: “{q}”
          </Text>
          <Text style={{ color: t.onInk, fontWeight: "800" }}>↑</Text>
        </Tap>
      ) : null}
      {lists_.map((l) => (
        <Tap
          key={`list:${l.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Open the list ${l.name}`}
          onPress={() => onOpenList(l.id, l.space)}
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
          onPress={() => onOpenCard(card)}
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
      {remote
        // A list found on the phone already shows above (as "list ›").
        .filter((h) => !(h.kind === "item" && h.what === "list" && lists_.some((l) => l.id === h.id)))
        .map((h) => (
          <Tap
            key={
              h.kind === "message"
                ? `${h.group_id}:${h.message_id}`
                : h.kind === "conversation"
                  ? `${h.chat_id}:${h.message_id}`
                  : h.kind === "item"
                    ? `${h.what}:${h.id}`
                    : `${h.space_id}:${h.record_id}`
            }
            accessibilityRole="button"
            onPress={() => onOpenHit(h, q)}
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
              {h.kind === "item"
                ? h.detail
                : h.kind === "message" || h.kind === "conversation"
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
    </View>
  );
}

const s = StyleSheet.create({
  results: { gap: 6 },
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
