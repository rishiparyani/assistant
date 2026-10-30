// Help (decision 2026-10-13 "Guide people, no presets"), in You (the face at the top of Chats):
// take the tour again, ideas for cards (the gallery), and "How do I…?" asked in the chat.
// Nothing is set up from here; the person or the assistant makes everything.
import { StyleSheet, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import { Text } from "@assistant/cards/native";
import { Tap } from "@assistant/cards/native";
import { useTheme } from "@/theme";

export interface HelpAction {
  title: string;
  text: string;
  go: () => void;
}

export function HelpSheet({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: HelpAction[];
}) {
  const { t } = useTheme();
  return (
    <Sheet open={open} onClose={onClose} gap={10} accessibilityLabel="Help">
      <Text style={[s.title, { color: t.fg }]}>Help</Text>
      {actions.map((a) => (
        <Tap
          key={a.title}
          accessibilityRole="button"
          accessibilityLabel={a.title}
          onPress={() => {
            onClose();
            a.go();
          }}
          scale={0.985}
          style={[s.row, { backgroundColor: t.cell, borderColor: t.hair }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.rowTitle, { color: t.fg }]}>{a.title}</Text>
            <Text style={[s.rowText, { color: t.fg2 }]}>{a.text}</Text>
          </View>
          <Text style={{ color: t.accent, fontSize: 22 }}>›</Text>
        </Tap>
      ))}
    </Sheet>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5, paddingHorizontal: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 64,
    padding: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 16, fontWeight: "700" },
  rowText: { fontSize: 13 },
});
