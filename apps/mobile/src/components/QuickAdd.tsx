// A quick add the person asked the chat for (decision "Chat makes, screens use"): an add box
// with just the fields they chose, on their saved view's card. The website had it; the phone
// drew the card as a plain list (owner, 2026-10-19: "I told it that I need a form to make
// entries for my budgets … look at what it gave me"). Works offline: the new record gets its
// id here and waits in the outbox.
import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { Tap, Text, TextInput, type } from "@assistant/cards/native";
import {
  ValueError,
  normalizeValue,
  ulid,
  type CollectionView,
  type FieldView,
  type RecordView,
  type StoredValue,
} from "@assistant/shared";
import { send } from "../outbox.ts";
import { cardFor, homeChanged } from "../home.ts";
import { useTheme } from "../theme.ts";
import type { HomeCard } from "@assistant/cards/native";

const enc = encodeURIComponent;
/** Today on this device, as a date field stores it. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A field to fill in: one of a list's, or one a share offers (with what may be picked). */
export interface AddField {
  id: string;
  name: string;
  type: FieldView["type"];
  options: FieldView["options"];
  required: boolean;
  /** What may be picked (a shared form's links and people), as id and title. */
  pick?: { id: string; title: string }[];
}

/**
 * The fields to fill in and an Add button. `onAdd` gets the values to send (money as rupees in
 * text) and the values as they will be stored; it says what to show after (or throws).
 */
export function AddForm({
  fields,
  name,
  button = "Add",
  initial,
  onAdd,
}: {
  fields: AddField[];
  /** What it adds to (for the button's spoken label). */
  name: string;
  button?: string;
  /** Filled in already (a pill that acts), by field id; the person changes what they like. */
  initial?: Record<string, unknown>;
  onAdd: (
    send: Record<string, unknown>,
    values: Record<string, StoredValue>,
  ) => string | void | Promise<string | void>;
}) {
  const { t } = useTheme();
  const [form, setForm] = useState<Record<string, unknown>>(initial ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (id: string, v: unknown) => {
    setForm((f) => ({ ...f, [id]: v }));
    setErrors((e) => ({ ...e, [id]: "" }));
    setNote("");
  };

  const add = async () => {
    const e: Record<string, string> = {};
    const values: Record<string, StoredValue> = {};
    for (const f of fields) {
      try {
        // A pick is already what's stored (an id, or "me"); a switch left alone is a "no".
        values[f.id] = f.pick
          ? ((form[f.id] as StoredValue | undefined) ?? null)
          : normalizeValue(f, f.type === "boolean" ? (form[f.id] ?? false) : form[f.id]);
        if (f.pick && values[f.id] === "") values[f.id] = null;
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
    setBusy(true);
    try {
      const said = await onAdd(kept, values);
      setNote(said ?? "Added.");
      setForm({});
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.form}>
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
        const choices = f.pick
          ? f.pick
          : (f.type === "choice" || f.type === "multi_choice" ? (f.options.choices ?? []) : []).map((c) => ({
              id: c,
              title: c,
            }));
        if (choices.length || f.pick) {
          const many = f.type === "multi_choice";
          const picked = Array.isArray(value)
            ? (value as string[])
            : typeof value === "string"
              ? [value]
              : [];
          return (
            <View key={f.id} style={{ gap: 6 }}>
              {label}
              <View style={s.chips}>
                {choices.length ? (
                  choices.map((c) => {
                    const on = picked.includes(c.id);
                    return (
                      <Tap
                        key={c.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() =>
                          set(
                            f.id,
                            many
                              ? on
                                ? picked.filter((x) => x !== c.id)
                                : [...picked, c.id]
                              : on
                                ? ""
                                : c.id,
                          )
                        }
                        haptic="selection"
                        style={[s.chip, { backgroundColor: on ? t.accent : t.fill }]}
                      >
                        <Text style={[type.small, { color: on ? t.onAccent : t.fg, fontWeight: "600" }]}>
                          {c.title}
                        </Text>
                      </Tap>
                    );
                  })
                ) : (
                  <Text style={[type.caption, { color: t.fg3 }]}>Nothing to pick from yet.</Text>
                )}
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
                doneBar
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
          accessibilityLabel={`${button} to ${name}`}
          disabled={busy}
          onPress={() => void add()}
          haptic="light"
          style={[s.add, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[type.label, { color: t.onAccent, fontSize: 15 }]}>{button}</Text>
        </Tap>
      </View>
    </View>
  );
}

export function QuickAdd({
  collection,
  fieldIds,
  space = null,
  onAdded,
}: {
  collection: CollectionView;
  fieldIds: string[];
  /** The space the list is in (null: the person's own). */
  space?: string | null;
  /** The new record as it will be, to show at once (offline it waits in the outbox). */
  onAdded?: (record: RecordView) => void;
}) {
  const { t } = useTheme();
  const fields = fieldIds
    .map((id) => collection.fields.find((f) => f.id === id))
    .filter((f) => f !== undefined);
  return (
    <View style={[s.box, { borderTopColor: t.sep }]} accessibilityLabel={`Quick add to ${collection.name}`}>
      <AddForm
        fields={fields}
        name={collection.name}
        onAdd={(kept, values) => {
          const id = ulid();
          send({
            kind: "spaces.add_record",
            method: "POST",
            path: `/api/collections/${enc(collection.id)}/records`,
            body: { id, values: kept, ...(space ? { space } : {}) },
            label: `New in ${collection.name}`,
          });
          const title = values[collection.title_field_id];
          const now = new Date().toISOString();
          // Shown on the card at once (Codex on PR 170): offline the home reloads from its saved
          // copy, which wouldn't have it until the outbox is sent.
          onAdded?.({
            id,
            collection_id: collection.id,
            title: typeof title === "string" && title ? title : "New record",
            values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)),
            named: {},
            links: {},
            created_at: now,
            updated_at: now,
            version: 0,
          });
          homeChanged();
          return `Added${typeof title === "string" && title ? ` “${title}”` : ""}.`;
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { paddingTop: 12, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  form: { gap: 12 },
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

/**
 * A card's add box, when its view is a quick add (and it's the person's own list). `onChange`
 * gets the card with the new record in it, to draw at once.
 */
export function quickAddFor(card: HomeCard | null, onChange?: (card: HomeCard) => void) {
  const fields = card?.view?.add_fields ?? [];
  const collection = card?.collection;
  return card && collection && fields.length && !card.shared ? (
    <QuickAdd
      collection={collection}
      fieldIds={fields}
      space={card.space ?? null}
      onAdded={(r) =>
        onChange?.({
          ...cardFor(collection, [r, ...card.records], card.view ?? null, card.spec.title),
          id: card.id,
          space: card.space,
          colour: card.colour,
        })
      }
    />
  ) : undefined;
}
