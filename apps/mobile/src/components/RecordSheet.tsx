// One record, opened from a row (owner, 2026-10-24, tapping a row on a card: "hoping that it
// would maximize, nothing happens"): every field that has a value, as people read them, with
// the chat about it and the whole list one tap away. A record of my own list can be changed
// and deleted here too (decision 2026-11-12 "A record is changed where it's opened": the owner
// asked for it after the test pass; it used to take the chat or the list's grid).
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Tap, Text, shown, type } from "@assistant/cards/native";
import { TRASH_DAYS, type CollectionView, type RecordView, type StoredValue } from "@assistant/shared";
import { isOffline, request } from "../api.ts";
import { homeChanged, writeValues } from "../home.ts";
import { AddForm, type AddField } from "./QuickAdd.tsx";
import { Sheet } from "./Sheet.tsx";
import { useTheme } from "../theme.ts";

const enc = encodeURIComponent;

export function RecordSheet({
  record,
  collection,
  onClose,
  onAsk,
  onOpenList,
  space = null,
  onChanged,
  onDeleted,
}: {
  record: RecordView | null;
  collection: CollectionView | null;
  onClose: () => void;
  /** The chat about this record; absent without the assistant. */
  onAsk?: () => void;
  /** The whole list on its own screen; absent when already there. */
  onOpenList?: () => void;
  /** The space the record is in (none: the person's own). */
  space?: string | null;
  /** Given when the record is mine to change: what it is now, after a change made here. */
  onChanged?: (next: RecordView) => void;
  /** Given when the record is mine to delete: called once it's gone. */
  onDeleted?: (id: string) => void;
}) {
  const { t } = useTheme();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // Each record opens on its values, never on the form or question left from the last one.
  useEffect(() => {
    setMode("view");
    setNote("");
    setBusy(false);
  }, [record?.id]);
  // What can be changed here: plain values (links and people are picked in the chat or the
  // grid; calculated fields and each person's own answers aren't this record's to set).
  const editable: AddField[] = useMemo(() => {
    const all = (collection?.fields ?? []).filter(
      (f) =>
        !f.options.personal &&
        !f.options.formula &&
        !f.options.rollup &&
        f.type !== "link" &&
        f.type !== "person",
    );
    return [
      ...all.filter((f) => f.id === collection?.title_field_id),
      ...all.filter((f) => f.id !== collection?.title_field_id),
    ].map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options, required: f.required }));
  }, [collection]);
  const initial = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of editable) {
      const v = record?.values[f.id];
      if (v === undefined || v === null) continue;
      // The form's boxes hold words: money as rupees, as people type it, and a number as its
      // digits (Codex on PR 236: a quantity opened blank).
      out[f.id] = typeof v === "number" ? String(f.type === "money" ? v / 100 : v) : v;
    }
    return out;
  }, [editable, record]);
  const save = (sent: Record<string, unknown>, stored: Record<string, StoredValue>) => {
    if (!record || !collection || !onChanged) return;
    const changedSent: Record<string, unknown> = {};
    const changedStored: Record<string, StoredValue> = {};
    for (const f of editable) {
      const now = stored[f.id] ?? null;
      const was = (record.values[f.id] as StoredValue | undefined) ?? null;
      if (JSON.stringify(now) === JSON.stringify(was)) continue;
      changedSent[f.id] = now === null ? null : sent[f.id];
      changedStored[f.id] = now;
    }
    if (Object.keys(changedStored).length) {
      onChanged(writeValues(collection, record, changedSent, changedStored, space));
      homeChanged();
    }
    setMode("view");
  };
  // online-only: a delete is done by the server (it follows each link's rule) and can't wait.
  const remove = async () => {
    if (!record || !onDeleted || busy) return;
    setBusy(true);
    setNote("");
    try {
      await request("DELETE", `/api/records/${enc(record.id)}${space ? `?space=${enc(space)}` : ""}`);
      homeChanged();
      onDeleted(record.id);
    } catch (e) {
      setNote(isOffline(e) ? "Deleting needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
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
    <Sheet
      open={!!record}
      onClose={onClose}
      tone="cell"
      keyboard
      accessibilityLabel={record?.title ?? "Record"}
    >
      {record ? (
        <>
          <View style={s.head}>
            {collection ? <Text style={[type.caption, { color: t.fg2 }]}>{collection.name}</Text> : null}
            <Text style={[type.title, { color: t.fg }]}>{record.title}</Text>
          </View>
          {mode === "edit" && collection ? (
            <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
              <AddForm
                key={record.id}
                fields={editable}
                name={collection.name}
                button="Save"
                initial={initial}
                allowEmpty
                onAdd={save}
              />
              <Tap
                accessibilityRole="button"
                onPress={() => setMode("view")}
                style={[s.action, { alignSelf: "flex-start", backgroundColor: t.fill, marginTop: 8 }]}
              >
                <Text style={[type.label, { color: t.fg, fontSize: 14 }]}>Back</Text>
              </Tap>
            </ScrollView>
          ) : mode === "delete" ? (
            <View style={{ gap: 10 }}>
              <Text style={[type.body, { color: t.fg }]}>
                Delete “{record.title || "this"}”? It stays in Recently deleted for {TRASH_DAYS} days.
              </Text>
              {note ? <Text style={[type.small, { color: t.danger }]}>{note}</Text> : null}
              <View style={s.actions}>
                <Tap
                  accessibilityRole="button"
                  onPress={() => setMode("view")}
                  style={[s.action, { backgroundColor: t.fill }]}
                >
                  <Text style={[type.label, { color: t.fg, fontSize: 14 }]}>Keep it</Text>
                </Tap>
                <Tap
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${record.title}`}
                  disabled={busy}
                  onPress={() => void remove()}
                  style={[s.action, { backgroundColor: t.danger, opacity: busy ? 0.6 : 1 }]}
                >
                  <Text style={[type.label, { color: t.onAccent, fontSize: 14 }]}>
                    {busy ? "Deleting…" : "Delete"}
                  </Text>
                </Tap>
              </View>
            </View>
          ) : (
            <>
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
                {onDeleted ? (
                  <Tap
                    accessibilityRole="button"
                    accessibilityLabel="Delete this"
                    onPress={() => setMode("delete")}
                    style={[s.action, { backgroundColor: t.fill }]}
                  >
                    <Text style={[type.label, { color: t.danger, fontSize: 14 }]}>Delete</Text>
                  </Tap>
                ) : null}
                {onChanged && editable.length ? (
                  <Tap
                    accessibilityRole="button"
                    accessibilityLabel="Change this"
                    onPress={() => setMode("edit")}
                    style={[s.action, { backgroundColor: t.fill }]}
                  >
                    <Text style={[type.label, { color: t.accent, fontSize: 14 }]}>Change</Text>
                  </Tap>
                ) : null}
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
          )}
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
