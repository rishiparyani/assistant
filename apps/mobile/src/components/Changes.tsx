// What changed (home-first.md §2 decision 14): records added, changed or deleted, in plain
// words from the audit log, each with Undo while it can be undone. Shown under a reply
// (inline: just what that reply did) or as a sheet with the recent list.
// online-only: the log and Undo live on the server.
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@assistant/cards/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HistoryItem } from "@assistant/shared";
import { isOffline, request } from "../api.ts";
import { radius, useTheme } from "../theme.ts";

export const fetchChanges = (limit = 20) => request<HistoryItem[]>("GET", `/api/history?limit=${limit}`);

const WORDS: Record<HistoryItem["action"], string> = {
  add_record: "Added",
  update_record: "Changed",
  delete_record: "Deleted",
};

export function Changes({
  items: given,
  inline,
  onChange,
  onClose,
}: {
  /** The entries to show; when left out, the recent list is fetched. */
  items?: HistoryItem[];
  inline?: boolean;
  onChange?: (items: HistoryItem[]) => void;
  onClose?: () => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<HistoryItem[]>(given ?? []);
  const [note, setNote] = useState(given ? "" : "Loading…");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (given) setItems(given);
  }, [given]);
  useEffect(() => {
    if (given) return;
    fetchChanges(20)
      .then((list) => {
        setItems(list);
        setNote(list.length ? "" : "Nothing changed lately.");
      })
      .catch((e: unknown) =>
        setNote(isOffline(e) ? "Needs a connection." : e instanceof Error ? e.message : String(e)),
      );
  }, [given]);

  const undo = async (item: HistoryItem) => {
    if (busy) return;
    setBusy(item.id);
    try {
      await request("POST", `/api/history/${encodeURIComponent(item.id)}/undo`, {});
      const next = items.map((i) => (i.id === item.id ? { ...i, undoable: false, undone_by: "now" } : i));
      setItems(next);
      onChange?.(next);
      setNote("");
    } catch (e) {
      setNote(isOffline(e) ? "Undo needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const rows = items.map((item) => (
    <View key={item.id} style={[s.row, { borderTopColor: t.sep }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.head, { color: t.fg }]} numberOfLines={1}>
          {WORDS[item.action]} “{item.title}”
          <Text style={{ color: t.fg2, fontWeight: "500" }}> · {item.collection}</Text>
        </Text>
        {item.lines.slice(0, 3).map((l) => (
          <Text key={l} style={[s.line, { color: t.fg2 }]} numberOfLines={1}>
            {l}
          </Text>
        ))}
        {!inline ? (
          <Text style={[s.meta, { color: t.fg3 }]}>
            {item.by} · {when(item.at)}
            {item.undone_by ? " · undone" : ""}
          </Text>
        ) : null}
      </View>
      {item.undoable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Undo ${item.title}`}
          disabled={busy !== null}
          onPress={() => undo(item)}
          style={[s.undo, { backgroundColor: t.fill, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 14 }}>Undo</Text>
        </Pressable>
      ) : item.undone_by ? (
        <Text style={[s.meta, { color: t.fg3 }]}>Undone</Text>
      ) : null}
    </View>
  ));

  if (inline)
    return (
      <View style={[s.inline, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.title, { color: t.accent }]}>What changed</Text>
        {rows}
        {note ? <Text style={[s.line, { color: t.danger }]}>{note}</Text> : null}
      </View>
    );
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.backdrop} />
      <View style={[s.sheet, { backgroundColor: t.page, paddingBottom: insets.bottom + 12 }]}>
        <View style={s.sheetHead}>
          <Text style={[s.sheetTitle, { color: t.fg }]}>What changed</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 8 }}>
          <View style={[s.list, { backgroundColor: t.cell, borderColor: t.hair }]}>{rows}</View>
          {note ? (
            <Text style={[s.line, { color: t.fg2, textAlign: "center", padding: 12 }]}>{note}</Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const s = StyleSheet.create({
  inline: {
    alignSelf: "stretch",
    marginHorizontal: 14,
    marginBottom: 6,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  head: { fontSize: 14, fontWeight: "600" },
  line: { fontSize: 13 },
  meta: { fontSize: 12 },
  undo: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 16,
    gap: 10,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  sheetTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.4 },
  list: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 },
});
