// A quick add the person asked the chat for (decision "Chat makes, screens use"): an add box
// with just the fields they chose, on their saved view's card. The website had it; the phone
// drew the card as a plain list (owner, 2026-10-19: "I told it that I need a form to make
// entries for my budgets … look at what it gave me"). Works offline: the new record gets its
// id here and waits in the outbox.
import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { Tap, Text, TextInput, type } from "@assistant/cards/native";
import { ValueError, normalizeValue, ulid, type CollectionView, type StoredValue } from "@assistant/shared";
import { send } from "../outbox.ts";
import { homeChanged } from "../home.ts";
import { useTheme } from "../theme.ts";
import type { HomeCard } from "@assistant/cards/native";

const enc = encodeURIComponent;
/** Today on this device, as a date field stores it. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function QuickAdd({
  collection,
  fieldIds,
  space = null,
}: {
  collection: CollectionView;
  fieldIds: string[];
  /** The space the list is in (null: the person's own). */
  space?: string | null;
}) {
  const { t } = useTheme();
  const fields = fieldIds
    .map((id) => collection.fields.find((f) => f.id === id))
    .filter((f) => f !== undefined);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const set = (id: string, v: unknown) => {
    setForm((f) => ({ ...f, [id]: v }));
    setErrors((e) => ({ ...e, [id]: "" }));
    setNote("");
  };

  const add = () => {
    const e: Record<string, string> = {};
    const values: Record<string, StoredValue> = {};
    for (const f of fields) {
      try {
        values[f.id] = normalizeValue(f, form[f.id]);
      } catch (err) {
        e[f.id] = err instanceof ValueError ? err.message.replace(`${f.name}: `, "") : String(err);
      }
      if (!e[f.id] && f.required && (values[f.id] === null || values[f.id] === undefined)) e[f.id] = "Needed";
    }
    setErrors(e);
    if (Object.values(e).some(Boolean)) return;
    const kept = Object.fromEntries(
      Object.entries(values)
        .filter(([, v]) => v !== null)
        // Money goes as rupees in text, so the server doesn't read it as paise.
        .map(([k, v]) => [
          k,
          typeof v === "number" && fields.find((f) => f.id === k)?.type === "money" ? String(v / 100) : v,
        ]),
    );
    if (!Object.keys(kept).length) return setNote("Fill in something first.");
    const id = ulid();
    send({
      kind: "spaces.add_record",
      method: "POST",
      path: `/api/collections/${enc(collection.id)}/records`,
      body: { id, values: kept, ...(space ? { space } : {}) },
      label: `New in ${collection.name}`,
    });
    const title = values[collection.title_field_id];
    setNote(`Added${typeof title === "string" && title ? ` “${title}”` : ""}.`);
    setForm({});
    homeChanged();
  };

  return (
    <View style={[s.box, { borderTopColor: t.sep }]} accessibilityLabel={`Quick add to ${collection.name}`}>
      {fields.map((f) => {
        const value = form[f.id];
        const error = errors[f.id];
        const label = (
          <Text style={[type.small, { color: t.fg2 }]}>
            {f.name}
            {f.required ? " *" : ""}
          </Text>
        );
        if (f.type === "boolean")
          return (
            <View key={f.id} style={s.switchRow}>
              {label}
              <Switch
                accessibilityLabel={f.name}
                value={value === true}
                onValueChange={(v) => set(f.id, v)}
                trackColor={{ true: t.accent, false: t.fill }}
              />
            </View>
          );
        const choices = f.type === "choice" || f.type === "multi_choice" ? (f.options.choices ?? []) : [];
        if (choices.length) {
          const picked = Array.isArray(value)
            ? (value as string[])
            : typeof value === "string"
              ? [value]
              : [];
          return (
            <View key={f.id} style={{ gap: 6 }}>
              {label}
              <View style={s.chips}>
                {choices.map((c) => {
                  const on = picked.includes(c);
                  return (
                    <Tap
                      key={c}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() =>
                        set(
                          f.id,
                          f.type === "multi_choice"
                            ? on
                              ? picked.filter((x) => x !== c)
                              : [...picked, c]
                            : on
                              ? ""
                              : c,
                        )
                      }
                      haptic="selection"
                      style={[s.chip, { backgroundColor: on ? t.accent : t.fill }]}
                    >
                      <Text style={[type.small, { color: on ? t.onAccent : t.fg, fontWeight: "600" }]}>
                        {c}
                      </Text>
                    </Tap>
                  );
                })}
              </View>
              {error ? <Text style={[type.caption, { color: t.danger }]}>{error}</Text> : null}
            </View>
          );
        }
        const numeric = f.type === "number" || f.type === "money";
        return (
          <View key={f.id} style={{ gap: 6 }}>
            {label}
            <View style={s.inputRow}>
              <TextInput
                accessibilityLabel={f.name}
                value={typeof value === "string" ? value : ""}
                onChangeText={(v) => set(f.id, v)}
                placeholder={
                  f.type === "money"
                    ? "₹"
                    : f.type === "date"
                      ? "2026-12-31"
                      : f.type === "datetime"
                        ? "2026-12-31T18:00"
                        : undefined
                }
                placeholderTextColor={t.fg3}
                keyboardType={numeric ? "decimal-pad" : "default"}
                multiline={f.type === "long_text"}
                style={[
                  s.input,
                  type.body,
                  { flex: 1, color: t.fg, backgroundColor: t.cell, borderColor: error ? t.danger : t.hair },
                ]}
              />
              {f.type === "date" ? (
                <Tap
                  accessibilityRole="button"
                  onPress={() => set(f.id, today())}
                  style={[s.today, { backgroundColor: t.fill }]}
                >
                  <Text style={[type.small, { color: t.accent, fontWeight: "700" }]}>Today</Text>
                </Tap>
              ) : null}
            </View>
            {error ? <Text style={[type.caption, { color: t.danger }]}>{error}</Text> : null}
          </View>
        );
      })}
      <View style={s.footer}>
        {note ? (
          <Text style={[type.caption, { color: t.fg2, flex: 1 }]}>{note}</Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Tap
          accessibilityRole="button"
          accessibilityLabel={`Add to ${collection.name}`}
          onPress={add}
          haptic="light"
          style={[s.add, { backgroundColor: t.accent }]}
        >
          <Text style={[type.label, { color: t.onAccent, fontSize: 15 }]}>Add</Text>
        </Tap>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 12, paddingTop: 12, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: "center" },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  today: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, justifyContent: "center" },
  footer: { flexDirection: "row", alignItems: "center", gap: 12 },
  add: { minHeight: 44, paddingHorizontal: 22, borderRadius: 22, justifyContent: "center" },
});

/** A card's add box, when its view is a quick add (and it's the person's own list). */
export function quickAddFor(card: HomeCard | null) {
  const fields = card?.view?.add_fields ?? [];
  return card && fields.length && card.collection && !card.shared ? (
    <QuickAdd collection={card.collection} fieldIds={fields} space={card.space ?? null} />
  ) : undefined;
}
