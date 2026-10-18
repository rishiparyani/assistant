// The editable grid (decision 2026-10-15 "Toward Excel", 5): one list as a sheet, a column
// per field, cells changed in place. Tap a cell to type (number, money, date, text), to
// flip a yes/no, or to pick a choice; Next on the keyboard moves along the row. Each change
// shows at once and goes through the outbox like a card's control (works offline). Links,
// people and calculated fields show but can't be typed over here.
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View, type TextInput as RNTextInput } from "react-native";
import * as Haptics from "expo-haptics";
import {
  normalizeValue,
  readDate,
  type FieldView,
  type RecordView,
  type StoredValue,
} from "@assistant/shared";
import { Text, TextInput } from "./text.tsx";
import { shown, tint } from "./rows.tsx";
import { useTheme } from "./theme.ts";
import { UNFLEX, useFit } from "./fit.ts";

const TYPED = new Set(["text", "long_text", "number", "money", "date", "datetime"]);
const WIDTH: Record<string, number> = {
  text: 150,
  long_text: 180,
  number: 84,
  money: 104,
  date: 112,
  datetime: 150,
  boolean: 70,
  choice: 120,
  multi_choice: 150,
  person: 120,
  link: 140,
};

/** A column's width; the first (the title) stays narrower, so three columns fit a phone. */
const widthOf = (f: FieldView, i: number) => (i === 0 && f.type === "text" ? 128 : (WIDTH[f.type] ?? 120));

/** Whether a cell of this field can be edited in the grid. */
export function gridEditable(f: FieldView): boolean {
  return (
    !f.options.formula &&
    !f.options.rollup &&
    !f.options.personal &&
    (TYPED.has(f.type) || f.type === "boolean" || f.type === "choice")
  );
}

/** What a cell shows while being typed in (money as plain rupees, dates as yyyy-mm-dd). */
function typedText(f: FieldView, v: StoredValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (f.type === "money" && typeof v === "number") return String(v / 100);
  return String(v);
}

/** Reads what was typed the way a write would, or throws with a plain message. */
function readTyped(f: FieldView, text: string): StoredValue {
  const s = text.trim();
  if (!s) return null;
  if (f.type === "date") return normalizeValue(f, readDate(s) ?? s);
  if (f.type === "number") return normalizeValue(f, Number(s.replace(/,/g, "")));
  return normalizeValue(f, s);
}

export function EditableGrid({
  fields,
  records,
  colour,
  rows,
  onSet,
  onOpen,
}: {
  /** The columns, in order (the title first is usual). */
  fields: FieldView[];
  records: RecordView[];
  colour: string;
  /** At most this many rows (a card); undefined: all. */
  rows?: number;
  onSet?: (record: RecordView, fieldId: string, value: StoredValue) => void;
  /** Tapping a row's title opens it (the list screen); none on a card. */
  onOpen?: (record: RecordView) => void;
}) {
  const { t, dark } = useTheme();
  const fit = useFit();
  const [editing, setEditing] = useState<{ record: string; field: string } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ record: RecordView; field: FieldView } | null>(null);
  const input = useRef<RNTextInput>(null);
  const shownRecords = rows ? records.slice(0, rows) : records;
  const editable = fields.filter(gridEditable);

  useEffect(() => {
    if (editing) setTimeout(() => input.current?.focus(), 30);
  }, [editing]);

  const start = (r: RecordView, f: FieldView) => {
    if (!onSet || !gridEditable(f)) return;
    void Haptics.selectionAsync().catch(() => undefined);
    if (f.type === "boolean") {
      onSet(r, f.id, r.values[f.id] !== true);
      return;
    }
    if (f.type === "choice") {
      setPicking({ record: r, field: f });
      return;
    }
    setError(null);
    setText(typedText(f, r.values[f.id]));
    setEditing({ record: r.id, field: f.id });
  };
  /** Saves the cell being typed; true when it was fine (or nothing changed). */
  const commit = (): boolean => {
    if (!editing || !onSet) return true;
    const r = records.find((x) => x.id === editing.record);
    const f = fields.find((x) => x.id === editing.field);
    if (!r || !f) return true;
    let v: StoredValue;
    try {
      v = readTyped(f, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
    if (JSON.stringify(v ?? null) !== JSON.stringify(r.values[f.id] ?? null)) onSet(r, f.id, v);
    return true;
  };
  const stop = () => {
    if (commit()) {
      setEditing(null);
      setError(null);
    }
  };
  /** Next on the keyboard: the next typed cell along the row, then the next row's first. */
  const next = () => {
    if (!editing || !commit()) return;
    const typed = editable.filter((f) => TYPED.has(f.type));
    const row = shownRecords.findIndex((r) => r.id === editing.record);
    const col = typed.findIndex((f) => f.id === editing.field);
    const [nr, nc] = col + 1 < typed.length ? [row, col + 1] : [row + 1, 0];
    const r = shownRecords[nr];
    const f = typed[nc];
    if (!r || !f) {
      setEditing(null);
      return;
    }
    setError(null);
    setText(typedText(f, r.values[f.id]));
    setEditing({ record: r.id, field: f.id });
  };

  return (
    <View style={[s.wrap, fit && UNFLEX]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
        <View>
          <View style={[s.row, s.headRow, { borderBottomColor: t.sep }]}>
            {fields.map((f, i) => (
              <Text key={f.id} style={[s.head, { color: t.fg2, width: widthOf(f, i) }]} numberOfLines={1}>
                {f.name.toUpperCase()}
              </Text>
            ))}
          </View>
          {shownRecords.map((r) => (
            <View key={r.id} style={[s.row, { borderBottomColor: t.sep }]}>
              {fields.map((f, i) => {
                const active = editing?.record === r.id && editing.field === f.id;
                const can = !!onSet && gridEditable(f);
                const width = widthOf(f, i);
                if (active)
                  return (
                    <View key={f.id} style={[s.cell, { width }]}>
                      <TextInput
                        ref={input}
                        accessibilityLabel={`${r.title} · ${f.name}`}
                        value={text}
                        onChangeText={(x) => {
                          setText(x);
                          setError(null);
                        }}
                        onBlur={stop}
                        onSubmitEditing={next}
                        blurOnSubmit={false}
                        returnKeyType="next"
                        keyboardType={f.type === "number" || f.type === "money" ? "decimal-pad" : "default"}
                        autoCapitalize={f.type === "text" ? "sentences" : "none"}
                        autoCorrect={f.type === "text"}
                        style={[
                          s.input,
                          { color: t.fg, borderColor: error ? t.danger : colour, backgroundColor: t.cell },
                        ]}
                      />
                      {error ? (
                        <Text style={[s.error, { color: t.danger }]} numberOfLines={1}>
                          {error}
                        </Text>
                      ) : null}
                    </View>
                  );
                const value =
                  f.type === "boolean"
                    ? r.values[f.id] === true
                      ? "Yes"
                      : r.values[f.id] === false
                        ? "No"
                        : ""
                    : shown(f, r, null);
                return (
                  <Pressable
                    key={f.id}
                    accessibilityRole={can ? "button" : "text"}
                    accessibilityLabel={`${f.name}: ${value || "empty"}`}
                    accessibilityHint={can ? "Tap to change" : undefined}
                    onPress={() => (i === 0 && onOpen && !can ? onOpen(r) : start(r, f))}
                    onLongPress={() => i === 0 && onOpen?.(r)}
                    style={({ pressed }) => [
                      s.cell,
                      { width },
                      pressed && can ? { backgroundColor: tint(colour, 0.12) } : null,
                    ]}
                  >
                    <Text
                      style={[
                        s.cellText,
                        { color: can ? t.fg : t.fg2, fontWeight: i === 0 ? "700" : "500" },
                        f.type === "number" || f.type === "money" ? s.num : null,
                      ]}
                      numberOfLines={1}
                    >
                      {value || (can ? "·" : "—")}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {!shownRecords.length ? <Text style={[s.empty, { color: t.fg2 }]}>Nothing yet.</Text> : null}
        </View>
      </ScrollView>
      <Modal visible={!!picking} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable style={[s.scrim, { backgroundColor: t.shadow }]} onPress={() => setPicking(null)} />
        {picking ? (
          <View style={[s.picker, { backgroundColor: t.cell }]}>
            <Text style={[s.pickTitle, { color: t.fg2 }]} numberOfLines={1}>
              {picking.record.title} · {picking.field.name}
            </Text>
            {[...(picking.field.options.choices ?? []), null].map((choice) => {
              const on = (picking.record.values[picking.field.id] ?? null) === choice;
              return (
                <Pressable
                  key={choice ?? "__none"}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    onSet?.(picking.record, picking.field.id, choice);
                    setPicking(null);
                  }}
                  style={[s.choice, on ? { backgroundColor: tint(colour, dark ? 0.24 : 0.14) } : null]}
                >
                  <Text
                    style={[s.choiceText, { color: choice ? t.fg : t.fg2, fontWeight: on ? "800" : "500" }]}
                  >
                    {choice ?? "Clear"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: StyleSheet.hairlineWidth },
  headRow: { paddingBottom: 2 },
  head: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 6 },
  cell: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  cellText: { fontSize: 14 },
  num: { textAlign: "right", fontVariant: ["tabular-nums"] },
  input: {
    minHeight: 36,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 8,
    fontSize: 16,
  },
  error: { fontSize: 10.5, marginTop: 2 },
  empty: { fontSize: 12, fontWeight: "500", padding: 8 },
  scrim: { flex: 1, opacity: 0.5 },
  picker: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 32,
    borderRadius: 20,
    padding: 12,
    gap: 4,
  },
  pickTitle: { fontSize: 12, fontWeight: "800", paddingHorizontal: 8, paddingBottom: 6 },
  choice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12 },
  choiceText: { fontSize: 16 },
});
