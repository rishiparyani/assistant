// Help (decision 2026-10-13 "Guide people, no presets"), one tap from the home's "?" button:
// take the tour again, ideas for cards (the gallery), and "How do I…?" asked in the chat.
// Nothing is set up from here; the person or the assistant makes everything.
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close help" style={s.back} onPress={onClose} />
      <View
        style={[s.sheet, { backgroundColor: t.page, borderColor: t.hair, paddingBottom: insets.bottom + 16 }]}
        accessibilityViewIsModal
      >
        <View style={[s.grab, { backgroundColor: t.fill2 }]} />
        <Text style={[s.title, { color: t.fg }]}>Help</Text>
        {actions.map((a) => (
          <Pressable
            key={a.title}
            accessibilityRole="button"
            accessibilityLabel={a.title}
            onPress={() => {
              onClose();
              a.go();
            }}
            style={({ pressed }) => [
              s.row,
              { backgroundColor: t.cell, borderColor: t.hair, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.rowTitle, { color: t.fg }]}>{a.title}</Text>
              <Text style={[s.rowText, { color: t.fg2 }]}>{a.text}</Text>
            </View>
            <Text style={{ color: t.accent, fontSize: 22 }}>›</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(8,9,14,0.4)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignSelf: "center",
    width: "100%",
    maxWidth: 640,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, marginBottom: 4 },
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
