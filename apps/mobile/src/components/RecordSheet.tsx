// One record, opened from a row (owner, 2026-10-24, tapping a row on a card: "hoping that it
// would maximize, nothing happens"): every field that has a value, as people read them, with
// the chat about it and the whole list one tap away. Screens use what exists; changes go
// through the chat or a list's grid (decision "Chat makes, screens use").
import { ScrollView, StyleSheet, View } from "react-native";
import { Tap, Text, shown, type } from "@assistant/cards/native";
import type { CollectionView, RecordView } from "@assistant/shared";
import { Sheet } from "./Sheet.tsx";
import { useTheme } from "../theme.ts";

export function RecordSheet({
  record,
  collection,
  onClose,
  onAsk,
  onOpenList,
}: {
  record: RecordView | null;
  collection: CollectionView | null;
  onClose: () => void;
  /** The chat about this record; absent without the assistant. */
  onAsk?: () => void;
  /** The whole list on its own screen; absent when already there. */
  onOpenList?: () => void;
}) {
  const { t } = useTheme();
  const fields = (collection?.fields ?? []).filter(
    (f) => f.id !== collection?.title_field_id && !f.options.personal,
  );
  const lines = record
    ? fields.flatMap((f) => {
        const v =
          f.type === "boolean"
            ? record.values[f.id] === true
              ? "Yes"
              : record.values[f.id] === false
                ? "No"
                : ""
            : shown(f, record, null);
        return v ? [{ id: f.id, name: f.name, value: v, long: f.type === "long_text" || v.length > 40 }] : [];
      })
    : [];
  return (
    <Sheet open={!!record} onClose={onClose} tone="cell" accessibilityLabel={record?.title ?? "Record"}>
      {record ? (
        <>
          <View style={s.head}>
            {collection ? <Text style={[type.caption, { color: t.fg2 }]}>{collection.name}</Text> : null}
            <Text style={[type.title, { color: t.fg }]}>{record.title}</Text>
          </View>
          <ScrollView style={s.scroll} contentContainerStyle={{ gap: 2 }}>
            {lines.length ? (
              lines.map((l, i) => (
                <View
                  key={l.id}
                  style={[
                    l.long ? s.lineStack : s.line,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
                  ]}
                >
                  <Text style={[type.small, s.name, { color: t.fg2 }]}>{l.name}</Text>
                  <Text style={[type.body, s.value, { color: t.fg }]} selectable>
                    {l.value}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={[type.small, { color: t.fg2 }]}>Nothing filled in yet.</Text>
            )}
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
  head: { gap: 2 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10 },
  lineStack: { gap: 4, paddingVertical: 10 },
  name: { width: 112, flexShrink: 0 },
  value: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  action: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
