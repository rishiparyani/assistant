// What changed (home-first.md §2 decision 14): records added, changed or deleted, in plain
// words from the audit log, each with Undo while it can be undone. Shown under a reply
// (inline: just what that reply did) or as a sheet with the recent list.
// online-only: the log and Undo live on the server.
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@assistant/cards/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HistoryItem } from "@assistant/shared";
import { ApiError, isOffline, request } from "../api.ts";
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

  // Undo asks first when it would overwrite a later change, or when a workflow did things
  // because of the change (they can be undone with it, or kept).
  // `through`: the newest later change the person is shown (Undo anyway covers up to it).
  const [asking, setAsking] = useState<{ id: string; through: string | null; message: string } | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());

  const tap = (item: HistoryItem) => {
    const later = item.changed_since;
    const led = item.followups.some((f) => f.undoable) || item.told.some((x) => x !== "you");
    if (!later && !led) return void undo(item, null);
    setKeep(new Set());
    setAsking({
      id: item.id,
      through: later?.through ?? null,
      message: later ? `${capital(sentence(later.by))} changed ${sentence(later.fields)} after this.` : "",
    });
  };

  const undo = async (item: HistoryItem, through: string | null) => {
    if (busy) return;
    setBusy(item.id);
    const also = item.followups.filter((f) => f.undoable && !keep.has(f.id)).map((f) => f.id);
    try {
      await request("POST", `/api/history/${encodeURIComponent(item.id)}/undo`, {
        force_through: through ?? undefined,
        with: also,
      });
      setAsking(null);
      setNote("");
      if (!given) {
        // The list moves on: the undo is a change of its own.
        const list = await fetchChanges(20);
        setItems(list);
        onChange?.(list);
        return;
      }
      const next = items.map((i) =>
        i.id === item.id || also.includes(i.id) ? { ...i, undoable: false, undone_by: "now" } : i,
      );
      setItems(next);
      onChange?.(next);
    } catch (e) {
      // Someone changed it in the meantime: say who, and let the person decide.
      const d =
        e instanceof ApiError ? (e.details as { reason?: string; through?: string } | undefined) : undefined;
      if (d?.reason === "changed_since" && d.through)
        setAsking({
          id: item.id,
          through: d.through,
          message: (e as Error).message.replace(/ Undo anyway.*$/, ""),
        });
      else setNote(isOffline(e) ? "Undo needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const rows = items.map((item) => (
    <View key={item.id} style={[s.item, { borderTopColor: t.sep }]}>
      <View style={s.row}>
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
          {item.also_restores ? (
            <Text style={[s.line, { color: t.fg2 }]}>
              Took {item.also_restores} linked {item.also_restores === 1 ? "record" : "records"} with it
            </Text>
          ) : null}
          {!inline ? (
            <Text style={[s.meta, { color: t.fg3 }]}>
              {item.by} · {when(item.at)}
              {item.undone_by ? " · undone" : ""}
            </Text>
          ) : null}
        </View>
        {item.undoable && asking?.id !== item.id ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Undo ${item.title}`}
            disabled={busy !== null}
            onPress={() => tap(item)}
            style={[s.undo, { backgroundColor: t.fill, opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={{ color: t.accent, fontWeight: "700", fontSize: 14 }}>Undo</Text>
          </Pressable>
        ) : item.undone_by ? (
          <Text style={[s.meta, { color: t.fg3 }]}>Undone</Text>
        ) : null}
      </View>
      {asking?.id === item.id ? (
        <View style={[s.ask, { backgroundColor: t.fill }]}>
          {asking.message ? (
            <Text style={[s.line, { color: t.fg, fontWeight: "600" }]}>
              {asking.message} Undo puts the earlier value back over the newer one.
            </Text>
          ) : null}
          {item.followups.some((f) => f.undoable) ? (
            <Text style={[s.meta, { color: t.fg2, fontWeight: "700" }]}>
              IT ALSO LED TO · TAP TO KEEP ONE
            </Text>
          ) : null}
          {item.followups
            .filter((f) => f.undoable)
            .map((f) => {
              const kept = keep.has(f.id);
              return (
                <Pressable
                  key={f.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !kept }}
                  onPress={() =>
                    setKeep((k) => {
                      const n = new Set(k);
                      if (n.has(f.id)) n.delete(f.id);
                      else n.add(f.id);
                      return n;
                    })
                  }
                  style={s.pick}
                >
                  <View
                    style={[
                      s.box,
                      { borderColor: t.accent, backgroundColor: kept ? "transparent" : t.accent },
                    ]}
                  >
                    {!kept ? (
                      <Text style={{ color: t.onAccent, fontSize: 12, fontWeight: "800" }}>✓</Text>
                    ) : null}
                  </View>
                  <Text style={[s.line, { color: t.fg, flex: 1 }]} numberOfLines={2}>
                    {kept ? "Keep: " : "Undo too: "}
                    {f.line}
                  </Text>
                </Pressable>
              );
            })}
          {item.told.some((x) => x !== "you") ? (
            <Text style={[s.line, { color: t.fg2 }]}>{told(item.told.filter((x) => x !== "you"))}</Text>
          ) : null}
          <View style={s.askRow}>
            <Pressable
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={() => void undo(item, asking.through)}
              style={[s.undo, s.grow, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
            >
              <Text style={{ color: t.onAccent, fontWeight: "800", fontSize: 14 }}>
                {asking.through ? "Undo anyway" : "Undo"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAsking(null)}
              style={[s.undo, { backgroundColor: t.cell }]}
            >
              <Text style={{ color: t.fg, fontWeight: "700", fontSize: 14 }}>Keep as is</Text>
            </Pressable>
          </View>
        </View>
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

const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** "Asha", "Asha and Kabir", "Asha, Kabir and Meera". */
const sentence = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const told = (people: string[]) =>
  `${sentence(people)} ${people.length === 1 ? "was" : "were"} told about it; they’ll hear it was undone.`;

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
  item: { paddingVertical: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  ask: { borderRadius: 16, padding: 12, gap: 8 },
  askRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  grow: { flex: 1 },
  pick: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
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
