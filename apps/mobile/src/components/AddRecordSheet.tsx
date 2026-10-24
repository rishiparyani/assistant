// A list's add form in a sheet, filled in from a pill that acts (owner, 2026-10-24: a tap
// should "perform an action instead of just pasting that same message"): the person changes
// what they like and saves; the record goes through the outbox like a quick add's (offline it
// waits). No model call.
import { Sheet } from "./Sheet.tsx";
import { AddForm } from "./QuickAdd.tsx";
import { StyleSheet, View } from "react-native";
import { Text, type } from "@assistant/cards/native";
import { ulid, type CollectionView, type FieldView } from "@assistant/shared";
import { send } from "../outbox.ts";
import { homeChanged } from "../home.ts";
import { useTheme } from "../theme.ts";

const enc = encodeURIComponent;

/** The fields a person can fill in by hand here (not worked out, not a link, not personal). */
export function addableFields(c: CollectionView): FieldView[] {
  return c.fields.filter(
    (f) =>
      !f.options.formula &&
      !f.options.rollup &&
      !f.options.personal &&
      f.type !== "link" &&
      f.type !== "person",
  );
}

/** Values the model named by field name, as the form's values by field id (a yes/no reads "yes"). */
export function initialFor(fields: FieldView[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(values)) {
    const f = fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) continue;
    out[f.id] = f.type === "boolean" ? /^(yes|true|1)$/i.test(v) : v;
  }
  return out;
}

export function AddRecordSheet({
  open,
  onClose,
  collection,
  space,
  values,
}: {
  open: boolean;
  onClose: () => void;
  collection: CollectionView | null;
  /** The space the list is in (null: the person's own). */
  space: string | null;
  values: Record<string, string>;
}) {
  const { t } = useTheme();
  const fields = collection ? addableFields(collection) : [];
  return (
    <Sheet open={open} onClose={onClose} tone="cell" keyboard accessibilityLabel="Add a record">
      {collection ? (
        <View style={s.box}>
          <Text style={[type.title, { color: t.fg }]}>Add to {collection.name}</Text>
          <Text style={[type.caption, { color: t.fg2 }]}>Change what you like, then Add.</Text>
          <AddForm
            fields={fields}
            name={collection.name}
            initial={initialFor(fields, values)}
            onAdd={(kept, vals) => {
              const id = ulid();
              send({
                kind: "spaces.add_record",
                method: "POST",
                path: `/api/collections/${enc(collection.id)}/records`,
                body: { id, values: kept, ...(space ? { space } : {}) },
                label: `New in ${collection.name}`,
              });
              homeChanged();
              const title = vals[collection.title_field_id];
              return `Added${typeof title === "string" && title ? ` “${title}”` : ""}.`;
            }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

const s = StyleSheet.create({ box: { gap: 10 } });
