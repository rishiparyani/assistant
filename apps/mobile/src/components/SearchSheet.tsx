// Search (home-first.md §4 and §2 point 8): what the home holds, matched on the device at
// once (titles, rows, fields; works offline), and the person's own index on the server
// (every record they can see, by part of a word) a moment later when there's a connection.
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";
import { Sheet } from "@/components/Sheet";
import { Text, TextInput } from "@assistant/cards/native";
import { request } from "../api.ts";
import type { HomeCard } from "../home.ts";
import { radius, useTheme } from "../theme.ts";

export type SearchResult = RecordHit | MessageHit;

/** A piece of a chat I'm in. */
export interface MessageHit {
  kind: "message";
  group_id: string;
  chat: string;
  message_id: string;
  snippet: string;
  updated_at: string;
}

export interface RecordHit {
  kind: "record";
  space_id: string;
  space: string;
  collection_id: string;
  collection: string;
  record_id: string;
  title: string;
  snippet: string;
  updated_at: string;
}

export function SearchSheet({
  cards,
  onClose,
  onOpen,
  onOpenResult,
  lists = [],
  onOpenList,
}: {
  cards: HomeCard[];
  /** Every list the person has: a name that matches opens the whole list. */
  lists?: { id: string; name: string }[];
  onOpenList?: (id: string) => void;
  onClose: () => void;
  onOpen: (card: HomeCard) => void;
  /** A hit from the server's index (a record somewhere the person can see). */
  onOpenResult?: (hit: SearchResult, q: string) => void;
}) {
  const { t } = useTheme();
  const [text, setText] = useState("");
  // The server's index, a moment after typing stops; silent when offline.
  const [remote, setRemote] = useState<SearchResult[]>([]);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setRemote([]);
      return;
    }
    let gone = false;
    const timer = setTimeout(() => {
      request<SearchResult[]>("GET", `/api/search?q=${encodeURIComponent(q)}&limit=12`)
        .then((hits) => !gone && setRemote(hits))
        .catch(() => !gone && setRemote([]));
    }, 250);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [text]);
  const hits = useMemo(() => {
    const q = text.trim().toLowerCase();
    const seen = new Set<string>();
    return cards
      .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
      .map((c) => {
        const lines = [
          ...c.records.map((r) => r.title),
          ...(c.shared?.fields ?? []).map((f) => `${f.name}: ${f.display}`),
          ...(c.waiting ? [c.waiting.text] : []),
        ];
        const match = (x: string) => x.toLowerCase().includes(q);
        const rows = q ? lines.filter(match) : lines.slice(0, 3);
        return { card: c, rows, hit: !q || match(c.spec.title) || rows.length > 0 };
      })
      .filter((x) => x.hit);
  }, [cards, text]);
  return (
    <Sheet open onClose={onClose} keyboard grab={false} gap={10} accessibilityLabel="Search">
      <TextInput
        autoFocus
        accessibilityLabel="Search your cards"
        placeholder="Search your cards"
        placeholderTextColor={t.fg2}
        value={text}
        onChangeText={setText}
        style={[s.input, { backgroundColor: t.cell, color: t.fg, borderColor: t.sep }]}
      />
      <ScrollView style={s.results} keyboardShouldPersistTaps="handled">
        {onOpenList && text.trim().length >= 2
          ? lists
              .filter((l) => l.name.toLowerCase().includes(text.trim().toLowerCase()))
              .slice(0, 3)
              .map((l) => (
                <Pressable
                  key={`list:${l.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Open the list ${l.name}`}
                  onPress={() => onOpenList(l.id)}
                  style={[s.hit, { backgroundColor: t.cell, borderColor: t.hair }]}
                >
                  <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
                    {l.name} <Text style={{ color: t.fg2, fontWeight: "600" }}>· list ›</Text>
                  </Text>
                </Pressable>
              ))
          : null}
        {hits.map(({ card, rows }) => (
          <Pressable
            key={card.id}
            accessibilityRole="button"
            onPress={() => onOpen(card)}
            style={[s.hit, { backgroundColor: t.cell, borderColor: t.hair }]}
          >
            <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
              {card.spec.title}
            </Text>
            {rows.slice(0, 3).map((r) => (
              <Text key={r} style={[s.row, { color: t.fg2 }]} numberOfLines={1}>
                {r}
              </Text>
            ))}
          </Pressable>
        ))}
        {remote.length ? <Text style={[s.kicker, { color: t.fg2 }]}>Everything you can see</Text> : null}
        {remote.map((h) =>
          h.kind === "message" ? (
            // A piece of a chat: who said what, opening the chat.
            <Pressable
              key={`${h.group_id}:${h.message_id}`}
              accessibilityRole="button"
              onPress={() => onOpenResult?.(h, text.trim())}
              style={[s.hit, { backgroundColor: t.cell, borderColor: t.hair }]}
            >
              <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
                {h.chat} · chat
              </Text>
              <Text style={[s.row, { color: t.fg2 }]} numberOfLines={3}>
                {h.snippet.replace(/[[\]]/g, "")}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              key={`${h.space_id}:${h.record_id}`}
              accessibilityRole="button"
              onPress={() => onOpenResult?.(h, text.trim())}
              style={[s.hit, { backgroundColor: t.cell, borderColor: t.hair }]}
            >
              <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
                {h.title}
              </Text>
              <Text style={[s.row, { color: t.fg2 }]} numberOfLines={2}>
                {h.collection}
                {h.snippet && h.snippet !== h.title ? ` · ${h.snippet.replace(/[[\]]/g, "")}` : ""}
              </Text>
            </Pressable>
          ),
        )}
        {!hits.length && !remote.length ? (
          <Text style={[s.row, { color: t.fg2, padding: 12 }]}>Nothing matches.</Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  results: { maxHeight: 420, flexShrink: 1 },
  input: {
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  hit: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 2,
    marginBottom: 8,
  },
  title: { fontSize: 14, fontWeight: "700" },
  row: { fontSize: 13 },
  kicker: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    paddingVertical: 6,
  },
});
