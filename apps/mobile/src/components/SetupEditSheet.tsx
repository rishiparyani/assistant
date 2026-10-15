// A setup card changed by hand before Confirm (decision 2026-10-15 "Chat makes, screens can
// fix"): the assistant got it most of the way; here a list is renamed, a field renamed or
// retyped, choices fixed, a field added or dropped, then Confirm runs the changed version.
// The form lives inside the chat's flow, so there's no builder in the main screens.
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FIELD_TYPES, type FieldType } from "@assistant/shared";
import { Text, TextInput } from "@assistant/cards/native";
import { useTheme } from "../theme.ts";

export const TYPE_WORDS: Record<FieldType, string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  money: "Money",
  date: "Date",
  datetime: "Date and time",
  boolean: "Yes/no",
  choice: "Choice",
  multi_choice: "Several choices",
  person: "Person",
  link: "Link",
};

/** A field as the setup card carries it (names, never ids). */
export interface DraftField {
  name: string;
  type: FieldType;
  options?: {
    choices?: string[];
    target?: string | null;
    many?: boolean;
    formula?: string;
    [k: string]: unknown;
  };
  required?: boolean;
  [k: string]: unknown;
}
interface DraftList {
  name: string;
  description?: string | null;
  fields: DraftField[];
  [k: string]: unknown;
}

/** The lists a setup card would make, read from its arguments; null when it isn't that kind of card. */
export function draftOf(tool: string, args: Record<string, unknown>): DraftList[] | null {
  if (tool === "make_setup" && Array.isArray(args.collections))
    return (args.collections as DraftList[]).map((c) => ({ ...c, fields: c.fields ?? [] }));
  if (tool === "create_collection")
    return [
      { ...(args as DraftList), name: String(args.name ?? ""), fields: (args.fields as DraftField[]) ?? [] },
    ];
  if (tool === "add_field" && args.field && typeof args.field === "object")
    return [{ name: String(args.collection ?? ""), fields: [args.field as DraftField], one: true }];
  return null;
}

/** The card's arguments with the changed lists put back. */
export function argsWith(
  tool: string,
  args: Record<string, unknown>,
  lists: DraftList[],
): Record<string, unknown> {
  if (tool === "make_setup") return { ...args, collections: lists.map(({ one: _one, ...c }) => c) };
  if (tool === "create_collection") {
    const { one: _one, ...c } = lists[0]!;
    return { ...args, ...c };
  }
  if (tool === "add_field") return { ...args, field: lists[0]!.fields[0] };
  return args;
}

export function SetupEditSheet({
  tool,
  args,
  onClose,
  onConfirm,
  busy,
}: {
  tool: string;
  args: Record<string, unknown> | null;
  onClose: () => void;
  onConfirm: (args: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [lists, setLists] = useState<DraftList[]>(() => (args ? (draftOf(tool, args) ?? []) : []));
  const [picking, setPicking] = useState<{ list: number; field: number } | null>(null);
  if (!args) return null;
  const setList = (i: number, patch: Partial<DraftList>) =>
    setLists((xs) => xs.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  const setField = (i: number, j: number, patch: Partial<DraftField>) =>
    setList(i, { fields: lists[i]!.fields.map((f, n) => (n === j ? { ...f, ...patch } : f)) });
  const addField = (i: number) => setList(i, { fields: [...lists[i]!.fields, { name: "", type: "text" }] });
  const dropField = (i: number, j: number) =>
    setList(i, { fields: lists[i]!.fields.filter((_, n) => n !== j) });
  const ok = lists.every((c) => c.name.trim() && c.fields.every((f) => f.name.trim()));
  const oneField = tool === "add_field";

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[s.scrim, { backgroundColor: t.shadow }]}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View style={[s.sheet, { backgroundColor: t.cell, paddingBottom: insets.bottom + 12 }]}>
        <View style={[s.grab, { backgroundColor: t.fill2 }]} />
        <Text style={[s.label, { color: t.fg2 }]}>Change it, then confirm</Text>
        <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
          {lists.map((c, i) => (
            <View key={i} style={[s.list, { borderColor: t.sep }]}>
              {oneField ? (
                <Text style={[s.small, { color: t.fg2 }]}>A field for {c.name}</Text>
              ) : (
                <TextInput
                  accessibilityLabel="List name"
                  placeholder="List name"
                  placeholderTextColor={t.fg2}
                  value={c.name}
                  onChangeText={(name) => setList(i, { name })}
                  style={[s.input, s.listName, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
                />
              )}
              {c.fields.map((f, j) => (
                <View key={j} style={[s.field, { borderTopColor: t.sep }]}>
                  <View style={s.fieldRow}>
                    <TextInput
                      accessibilityLabel="Field name"
                      placeholder="Field name"
                      placeholderTextColor={t.fg2}
                      value={f.name}
                      onChangeText={(name) => setField(i, j, { name })}
                      style={[s.input, s.grow, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Type: ${TYPE_WORDS[f.type] ?? f.type}`}
                      onPress={() => setPicking({ list: i, field: j })}
                      style={[s.type, { backgroundColor: t.fill, borderColor: t.sep }]}
                    >
                      <Text style={{ color: t.accent, fontWeight: "700", fontSize: 14 }}>
                        {TYPE_WORDS[f.type] ?? f.type} ▾
                      </Text>
                    </Pressable>
                    {!oneField ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${f.name || "this field"}`}
                        onPress={() => dropField(i, j)}
                        hitSlop={8}
                        style={s.x}
                      >
                        <Text style={{ color: t.fg2, fontSize: 18, fontWeight: "700" }}>×</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {f.type === "choice" || f.type === "multi_choice" ? (
                    <TextInput
                      accessibilityLabel="Choices, separated by commas"
                      placeholder="Choices, separated by commas"
                      placeholderTextColor={t.fg2}
                      value={(f.options?.choices ?? []).join(", ")}
                      onChangeText={(x) =>
                        setField(i, j, {
                          options: {
                            ...f.options,
                            choices: x
                              .split(",")
                              .map((c) => c.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                      style={[s.input, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
                    />
                  ) : null}
                  {f.type === "link" ? (
                    <TextInput
                      accessibilityLabel="Links to which list"
                      placeholder="Links to which list (name)"
                      placeholderTextColor={t.fg2}
                      value={f.options?.target ?? ""}
                      onChangeText={(x) => setField(i, j, { options: { ...f.options, target: x || null } })}
                      style={[s.input, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
                    />
                  ) : null}
                  {f.options?.formula ? (
                    <TextInput
                      accessibilityLabel="Formula"
                      placeholder="Formula"
                      placeholderTextColor={t.fg2}
                      value={f.options.formula}
                      onChangeText={(x) => setField(i, j, { options: { ...f.options, formula: x } })}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[s.input, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
                    />
                  ) : null}
                  <View style={s.fieldRow}>
                    <Text style={[s.small, { color: t.fg2 }]}>Required</Text>
                    <Switch
                      accessibilityLabel={`${f.name || "This field"} required`}
                      value={!!f.required}
                      onValueChange={(required) => setField(i, j, { required })}
                      trackColor={{ true: t.accent, false: t.fill2 }}
                    />
                  </View>
                </View>
              ))}
              {!oneField ? (
                <Pressable accessibilityRole="button" onPress={() => addField(i)} style={s.add}>
                  <Text style={{ color: t.accent, fontWeight: "700", fontSize: 15 }}>+ Add a field</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {!lists.length ? (
            <Text style={[s.small, { color: t.fg2 }]}>This card has nothing to change by hand.</Text>
          ) : null}
        </ScrollView>
        <View style={s.row}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[s.secondary, { borderColor: t.sep }]}
          >
            <Text style={[s.primaryText, { color: t.fg }]}>Back</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy || !ok || !lists.length}
            onPress={() => onConfirm(argsWith(tool, args, lists))}
            style={[
              s.primary,
              s.grow,
              { backgroundColor: t.accent, opacity: busy || !ok || !lists.length ? 0.5 : 1 },
            ]}
          >
            <Text style={[s.primaryText, { color: t.onAccent }]}>Confirm with changes</Text>
          </Pressable>
        </View>
      </View>
      <Modal visible={!!picking} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable style={[s.scrim, { backgroundColor: t.shadow }]} onPress={() => setPicking(null)} />
        <View style={[s.picker, { backgroundColor: t.cell }]}>
          {FIELD_TYPES.map((type) => {
            const on = picking ? lists[picking.list]?.fields[picking.field]?.type === type : false;
            return (
              <Pressable
                key={type}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  if (picking) setField(picking.list, picking.field, { type });
                  setPicking(null);
                }}
                style={[s.choice, on ? { backgroundColor: t.fill } : null]}
              >
                <Text style={{ color: t.fg, fontSize: 16, fontWeight: on ? "800" : "500" }}>
                  {TYPE_WORDS[type]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, opacity: 0.6 },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, gap: 10, maxHeight: "88%" },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3 },
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  scroll: { flexGrow: 0 },
  body: { gap: 12, paddingBottom: 8 },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 10, gap: 8 },
  listName: { fontWeight: "700" },
  field: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 6 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  type: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  x: { width: 32, height: 44, alignItems: "center", justifyContent: "center" },
  add: { minHeight: 44, justifyContent: "center" },
  small: { fontSize: 14, lineHeight: 20, flex: 1 },
  row: { flexDirection: "row", gap: 8 },
  grow: { flex: 1 },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondary: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryText: { fontSize: 15, fontWeight: "800" },
  picker: { position: "absolute", left: 16, right: 16, bottom: 32, borderRadius: 20, padding: 8, gap: 2 },
  choice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12 },
});
