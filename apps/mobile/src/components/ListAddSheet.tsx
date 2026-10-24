// "+ Add" on a list screen (the chat's pills use AddRecordSheet, which fills in what the model
// named), per docs/design/from-scratch.md §3 List: 'a "+ Add" button opens the Form block,
// which works offline' (owner, 2026-10-25: "What do I do if I want to add elements in the
// list from the UI?"). Every field of the list, its title first; a link or a person is
// picked from what there is. The new record gets its id here and goes through the outbox, so
// it shows at once and is sent when there's a connection.
import { useEffect, useMemo, useState } from "react";
import { ulid, type CollectionView, type Person, type RecordView } from "@assistant/shared";
import { Text, type } from "@assistant/cards/native";
import { request } from "../api.ts";
import { findAll, homeChanged } from "../home.ts";
import { send } from "../outbox.ts";
import { useTheme } from "../theme.ts";
import { AddForm, type AddField } from "./QuickAdd.tsx";
import { Sheet } from "./Sheet.tsx";

const enc = encodeURIComponent;

export function ListAddSheet({
  open,
  onClose,
  collection,
  space,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  collection: CollectionView;
  /** The space the list is in (left out: the person's own). */
  space?: string;
  /** The new record as it will be, to show at once. */
  onAdded: (record: RecordView) => void;
}) {
  const { t } = useTheme();
  // What links and people may be picked, read when the sheet opens (offline: nothing to pick).
  const [picks, setPicks] = useState<Record<string, { id: string; title: string }[]>>({});
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const got: Record<string, { id: string; title: string }[]> = {};
      const people = collection.fields.some((f) => f.type === "person" && !f.options.personal)
        ? await request<Person[]>("GET", `/api/people${space ? `?space=${enc(space)}` : ""}`).catch(() => [])
        : [];
      for (const f of collection.fields) {
        if (f.type === "person" && !f.options.personal)
          got[f.id] = [
            { id: "me", title: "Me" },
            ...people.flatMap((p) => (p.user_id ? [{ id: p.user_id, title: p.name }] : [])),
          ];
        if (f.type === "link" && typeof f.options.target === "string") {
          const rows = await findAll(f.options.target, space ? { space } : {}, 100).catch(() => []);
          got[f.id] = rows.map((r) => ({ id: r.id, title: r.title }));
        }
      }
      if (live) setPicks(got);
    })();
    return () => {
      live = false;
    };
  }, [open, collection, space]);

  // The title first, then the rest as the list has them; personal answers are each person's own.
  const fields: AddField[] = useMemo(() => {
    // Not worked out (formulas, roll-ups) and not personal answers (each person's own).
    const own = collection.fields.filter(
      (f) => !f.options.personal && !f.options.formula && !f.options.rollup,
    );
    const title = own.filter((f) => f.id === collection.title_field_id);
    return [...title, ...own.filter((f) => f.id !== collection.title_field_id)].map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      options: f.options,
      required: f.required,
      ...(f.type === "link" || f.type === "person" ? { pick: picks[f.id] ?? [] } : {}),
    }));
  }, [collection, picks]);

  return (
    <Sheet open={open} onClose={onClose} keyboard accessibilityLabel={`Add to ${collection.name}`}>
      <Text style={[type.title, { color: t.fg }]}>Add to {collection.name}</Text>
      <AddForm
        key={collection.id}
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
          onAdded({
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
          return `Added${typeof title === "string" && title ? ` “${title}”` : ""}. Add another, or close.`;
        }}
      />
    </Sheet>
  );
}
