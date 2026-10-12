// "Search your cards" (home-first.md §2 point 8): the chat bar of a person without the
// assistant. A plain search over what the home already holds (titles, rows, fields), on the
// device; the real search (one index per person) is HF5.
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeCard } from "../home.ts";
import { radius, useTheme } from "../theme.ts";

export function SearchSheet({
  cards,
  onClose,
  onOpen,
}: {
  cards: HomeCard[];
  onClose: () => void;
  onOpen: (card: HomeCard) => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
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
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.backdrop} />
      <View style={[s.sheet, { backgroundColor: t.page, paddingBottom: insets.bottom + 12 }]}>
        <TextInput
          autoFocus
          accessibilityLabel="Search your cards"
          placeholder="Search your cards"
          placeholderTextColor={t.fg2}
          value={text}
          onChangeText={setText}
          style={[s.input, { backgroundColor: t.cell, color: t.fg, borderColor: t.sep }]}
        />
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
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
          {!hits.length ? <Text style={[s.row, { color: t.fg2, padding: 12 }]}>Nothing matches.</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: 16,
    gap: 10,
  },
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
});
