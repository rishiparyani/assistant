// The tick box on list rows (decision 2026-10-13 "A warmer home", as in the mock-up): a soft
// rounded square, filled in the accent with a white check when done.
import { StyleSheet, View } from "react-native";
import { useTheme } from "./theme.ts";
import { Text } from "./text.tsx";

export function Tick({ done }: { done: boolean }) {
  const { t } = useTheme();
  return (
    <View
      style={[
        s.box,
        done
          ? { backgroundColor: t.accent, borderColor: t.accent }
          : { backgroundColor: t.cell, borderColor: t.fill2 },
      ]}
    >
      {done ? <Text style={[s.check, { color: t.onAccent }]}>✓</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  check: { fontSize: 14, fontWeight: "800", lineHeight: 16 },
});
