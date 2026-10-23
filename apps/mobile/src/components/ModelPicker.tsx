// Which model answers in the chat (decision 2026-10-18 "Pick the model"; owner: "there should
// be 3 models in the model selector: auto, quick, and careful"). Kept on the device, for every
// chat; sent with each message.
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Tap, Text, type } from "@assistant/cards/native";
import type { ChatModelPick } from "@assistant/shared";
import { Sheet } from "./Sheet";
import { readJson, writeJson } from "@/storage";
import { useTheme } from "@/theme";

const KEY = "gigspree:model-pick";

export const PICKS: { id: ChatModelPick; label: string; words: string }[] = [
  {
    id: "auto",
    label: "Auto",
    words: "Quick for everyday things, Careful for setups and when Quick gets stuck",
  },
  { id: "quick", label: "Quick", words: "Fast answers; stays on Quick unless a setup needs Careful" },
  { id: "careful", label: "Careful", words: "Thinks longer before answering; uses more AI credit" },
];

export const pickLabel = (p: ChatModelPick) => PICKS.find((x) => x.id === p)!.label;

/** The pick on this device, and a setter that keeps it. */
export function useModelPick(): [ChatModelPick, (p: ChatModelPick) => void] {
  const [pick, setPick] = useState<ChatModelPick>(() => {
    const saved = readJson<string>(KEY);
    return PICKS.some((p) => p.id === saved) ? (saved as ChatModelPick) : "auto";
  });
  return [
    pick,
    (p) => {
      setPick(p);
      writeJson(KEY, p);
    },
  ];
}

export function ModelSheet({
  open,
  pick,
  carefulOn,
  onPick,
  onClose,
  onChanges,
}: {
  open: boolean;
  pick: ChatModelPick;
  /** Careful can answer now (AI credit set up, budget left). */
  carefulOn: boolean;
  onPick: (p: ChatModelPick) => void;
  onClose: () => void;
  /** "What this chat changed" (the undo list) lives under the title too. */
  onChanges?: () => void;
}) {
  const { t } = useTheme();
  return (
    <Sheet open={open} onClose={onClose} gap={0} accessibilityLabel="Model">
      <Text style={[type.heading, { color: t.fg, marginBottom: 8 }]}>Model</Text>
      {PICKS.map((p, i) => {
        const off = p.id === "careful" && !carefulOn;
        const on = p.id === pick;
        return (
          <Tap
            key={p.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: off }}
            disabled={off}
            haptic="selection"
            onPress={() => {
              onPick(p.id);
              onClose();
            }}
            style={[
              s.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
              off && { opacity: 0.45 },
            ]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.label, { color: on ? t.accent : t.fg }]}>{p.label}</Text>
              <Text style={[type.caption, { color: t.fg2 }]}>
                {off ? "Not available now: needs AI credit" : p.words}
              </Text>
            </View>
            {on ? <Text style={{ color: t.accent, fontWeight: "800", fontSize: 16 }}>✓</Text> : null}
          </Tap>
        );
      })}
      {onChanges ? (
        <Tap
          accessibilityRole="button"
          onPress={() => {
            onClose();
            onChanges();
          }}
          style={[s.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep, marginTop: 4 }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.label, { color: t.fg }]}>What this chat changed</Text>
            <Text style={[type.caption, { color: t.fg2 }]}>Every change, with Undo</Text>
          </View>
          <Text style={{ color: t.fg3, fontWeight: "700", fontSize: 16 }}>›</Text>
        </Tap>
      ) : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingVertical: 10 },
  label: { fontSize: 16, fontWeight: "700" },
});
