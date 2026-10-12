// The cards gallery (decision 2026-10-12 "Cards become their own package"): every part the app
// draws, at every size, with made-up data, in the current theme. For checking the look on a
// phone and in the simulator screenshots; nothing here reads or writes data.
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ARRANGEMENT_INFO } from "@assistant/cards";
import { Card, CardGrid, GALLERY_ARRANGEMENTS, sampleCards, useTheme } from "@assistant/cards/native";

const MAX = 1180;

export default function Gallery() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [cards] = useState(sampleCards);
  const gridWidth = Math.min(width, MAX) - 32;
  return (
    <View style={[s.root, { backgroundColor: t.canvas, paddingTop: insets.top + 8 }]}>
      <View style={[s.head, { width: gridWidth + 32, alignSelf: "center" }]}>
        <Text style={[s.title, { color: t.fg }]}>Cards</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={10}
        >
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, alignItems: "center" }}>
        <Text style={[s.note, { color: t.fg2, width: gridWidth }]}>
          {GALLERY_ARRANGEMENTS.length} kinds of card, each at every size it comes in. Made-up data.
        </Text>
        <View style={{ width: gridWidth }}>
          <CardGrid
            cards={cards}
            width={gridWidth}
            arrangeable={false}
            onHold={() => undefined}
            renderCard={(card) => <Card card={card} />}
          />
        </View>
        <View style={[s.legend, { width: gridWidth }]}>
          {GALLERY_ARRANGEMENTS.map((a) => (
            <Text key={a} style={[s.note, { color: t.fg2 }]}>
              <Text style={{ color: t.fg, fontWeight: "700" }}>{a}</Text>: {ARRANGEMENT_INFO[a].shows}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  note: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  legend: { marginTop: 16, gap: 2 },
});
