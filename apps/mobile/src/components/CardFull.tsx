// A home card opened up (owner, 2026-10-18: "the widget or the card should be maximized"):
// the same card at its full height with every row, still working (ticks, controls), and under
// it the whole list and the chat about it. Tapping a card used to open the chat.
import { ScrollView, StyleSheet, View } from "react-native";
import { Boundary, Card, Tap, Text, type, type HomeCard } from "@assistant/cards/native";
import type { RecordView, StoredValue } from "@assistant/shared";
import { Sheet } from "./Sheet";
import { useTheme } from "@/theme";

export function CardFull({
  card,
  onClose,
  onTick,
  onSet,
  onOpenList,
  onAsk,
}: {
  /** The card as the home has it now (a tick shows here and there at once); null: closed. */
  card: HomeCard | null;
  onClose: () => void;
  onTick?: (record: RecordView, value: boolean) => void;
  onSet?: (record: RecordView, field: string, value: StoredValue) => void;
  /** The whole list on its own screen; absent when the card isn't one list. */
  onOpenList?: () => void;
  /** The chat about this card; absent without the assistant. */
  onAsk?: () => void;
}) {
  const { t } = useTheme();
  return (
    <Sheet
      open={!!card}
      onClose={onClose}
      maxHeight="92%"
      gap={12}
      // A card can have its own boxes (a field to fill in): they stay above the keyboard.
      keyboard
      accessibilityLabel={card ? card.spec.title : "Card"}
    >
      {card ? (
        <>
          <ScrollView
            style={s.scroll}
            contentContainerStyle={{ paddingBottom: 4 }}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <Boundary where="full card">
              <Card card={card} fit onTick={onTick} onSet={onSet} />
            </Boundary>
          </ScrollView>
          <View style={s.actions}>
            {onOpenList ? (
              <Tap
                accessibilityRole="link"
                onPress={onOpenList}
                style={[s.action, { backgroundColor: t.fill }]}
              >
                <Text style={[type.label, { color: t.accent, fontSize: 14 }]}>Open list ›</Text>
              </Tap>
            ) : null}
            {onAsk ? (
              <Tap
                accessibilityRole="button"
                onPress={onAsk}
                haptic="light"
                style={[s.action, { backgroundColor: t.accent }]}
              >
                <Text style={[type.label, { color: t.onAccent, fontSize: 14 }]}>Ask about it</Text>
              </Tap>
            ) : null}
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  action: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
