// Which model answers in the chat, by name (decision 2026-11-04 "Pick a model, it does the
// whole job", owner: "we'll have the actual model names, like not quick and careful"). The
// picked one answers the whole request alone. Kept on the device, for every chat; sent with
// each message.
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Tap, Text, type } from "@assistant/cards/native";
import { DEFAULT_PICK, PICKER_MODELS, type ChatModelPick } from "@assistant/shared";
import { Sheet } from "./Sheet";
import { readJson, writeJson } from "@/storage";
import { useTheme } from "@/theme";

const KEY = "gigspree:model-pick";

export const pickLabel = (p: ChatModelPick) => PICKER_MODELS.find((x) => x.id === p)?.label ?? p;

/** The pick on this device (an older Auto, Quick or Careful becomes the default), and a setter. */
export function useModelPick(): [ChatModelPick, (p: ChatModelPick) => void] {
  const [pick, setPick] = useState<ChatModelPick>(() => {
    const saved = readJson<string>(KEY);
    const known = PICKER_MODELS.find((p) => p.id === saved);
    return known ? known.id : DEFAULT_PICK;
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
  available,
  onPick,
  onClose,
  onChanges,
}: {
  open: boolean;
  pick: ChatModelPick;
  /** The models that can answer now (their key and credit set up); unknown: all of them. */
  available?: string[];
  onPick: (p: ChatModelPick) => void;
  onClose: () => void;
  /** "What this chat changed" (the undo list) lives under the title too. */
  onChanges?: () => void;
}) {
  const { t } = useTheme();
  return (
    <Sheet open={open} onClose={onClose} gap={0} accessibilityLabel="Model">
      <Text style={[type.heading, { color: t.fg, marginBottom: 8 }]}>Model</Text>
      {PICKER_MODELS.map((p, i) => {
        const off = !!available && !available.includes(p.id);
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
                {off ? "Not available now: its AI credit isn't set up" : p.words}
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
