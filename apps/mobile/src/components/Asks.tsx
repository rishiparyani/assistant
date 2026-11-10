// Things to ask, one tap each, in a row above the composer (decision 2026-11-09 "A calmer look,
// and a home that shows your day"): since things are made and changed in the chat, a screen says
// what could be asked of it, in words that fit what's on it. Drawn only for people who have the
// assistant, on the page's colour so what scrolls under it doesn't show through.
import { ScrollView, StyleSheet, View } from "react-native";
import { forwardRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tap, Text, type } from "@assistant/cards/native";
import { useSession } from "../session.tsx";
import { useTheme } from "../theme.ts";

/** How much more room a screen leaves at the bottom when it has this row above its composer. */
export const ASKS_ROOM = 50;

export const Asks = forwardRef<View, { asks: string[]; onAsk: (text: string) => void }>(function Asks(
  { asks, onAsk },
  ref,
) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useSession();
  if (me?.assistant === false || me?.practice || !asks.length) return null;
  return (
    <View ref={ref} style={[s.wrap, { backgroundColor: t.page, paddingBottom: insets.bottom + 12 + 54 + 8 }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.row}
      >
        {asks.map((a) => (
          <Tap
            key={a}
            accessibilityRole="button"
            accessibilityLabel={`Ask: ${a}`}
            onPress={() => onAsk(a)}
            style={[s.ask, { backgroundColor: t.cell, borderColor: t.hair }]}
          >
            <Text style={[type.caption, { color: t.accent, fontSize: 13.5 }]}>{a}</Text>
          </Tap>
        ))}
      </ScrollView>
    </View>
  );
});

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 8 },
  row: { gap: 8, paddingHorizontal: 16 },
  ask: {
    minHeight: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
