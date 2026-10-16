// Fields and cards (decision 2026-10-15 "Chat makes, screens can fix"): the plain setup screen
// of one list, for when the chat won't build what's wanted. Hidden under the list's ⋯ menu,
// never a tab or a home button: the chat stays the front door. Fields (rename, retype, choices,
// required, remove, add), rules (read, delete) and the list's cards and views (pin, delete),
// through the same operations the assistant uses.
// online-only: a setup lives on the server; nothing here is queued.
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  FIELD_TYPES,
  type CollectionView,
  type FieldType,
  type FieldView,
  type RuleView,
  type SavedView,
} from "@assistant/shared";
import { Text, TextInput } from "@assistant/cards/native";
import { ApiError, isOffline, request } from "@/api";
import { TYPE_WORDS } from "@/components/SetupEditSheet";
import { radius, useTheme } from "@/theme";

const enc = encodeURIComponent;

type Draft = {
  name: string;
  type: FieldType;
  choices: string;
  target: string;
  required: boolean;
  formula: string;
};
const draftOf = (f?: FieldView): Draft => ({
  name: f?.name ?? "",
  type: f?.type ?? "text",
  choices: (f?.options.choices ?? []).join(", "),
  target: f?.options.target ?? "",
  required: f?.required ?? false,
  formula: f?.options.formula ?? "",
});

export default function Setup() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { collection } = useLocalSearchParams<{ collection?: string }>();
  const [c, setC] = useState<CollectionView | null>(null);
  const [rules, setRules] = useState<RuleView[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // The field being changed (null: none; "new": one being added).
  const [editing, setEditing] = useState<FieldView | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf());
  const [picking, setPicking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ what: string; run: () => Promise<void> } | null>(null);

  const load = useCallback(async () => {
    if (!collection) return;
    try {
      const [col, rs, vs] = await Promise.all([
        request<CollectionView>("GET", `/api/collections/${enc(collection)}`),
        request<RuleView[]>("GET", `/api/collections/${enc(collection)}/rules`).catch(() => [] as RuleView[]),
        request<SavedView[]>("GET", "/api/views"),
      ]);
      setC(col);
      setRules(rs);
      setViews(vs.filter((v) => v.collection_id === col.id));
      setNote("");
    } catch (e) {
      setNote(
        isOffline(e) ? "Fields and cards need a connection." : e instanceof Error ? e.message : String(e),
      );
    }
  }, [collection]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (what: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await what();
      await load();
      setNote(done);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      return true;
    } catch (e) {
      setNote(isOffline(e) ? "That needs a connection." : e instanceof ApiError ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const fieldBody = (d: Draft) => {
    const options: Record<string, unknown> = {};
    if (d.type === "choice" || d.type === "multi_choice")
      options.choices = d.choices
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    if (d.type === "link") options.target = d.target.trim() || null;
    if (d.formula.trim()) options.formula = d.formula.trim();
    return { name: d.name.trim(), type: d.type, options, required: d.required };
  };
  const saveField = async () => {
    if (!c) return;
    const body = fieldBody(draft);
    const ok =
      editing === "new"
        ? await run(
            () => request("POST", `/api/collections/${enc(c.id)}/fields`, { field: body }),
            `${body.name} added.`,
          )
        : editing
          ? await run(
              () =>
                request("PATCH", `/api/collections/${enc(c.id)}/fields/${enc(editing.id)}`, {
                  name: body.name,
                  options: body.options,
                  required: body.required,
                }),
              `${body.name} changed.`,
            )
          : false;
    if (ok) setEditing(null);
  };
  const open = (f: FieldView | "new") => {
    setDraft(draftOf(f === "new" ? undefined : f));
    setEditing(f);
  };
  const isTitle = (f: FieldView) => f.id === c?.title_field_id;

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 6 }]}>
      <View style={s.column}>
        <View style={s.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={[s.back, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
          </Pressable>
        </View>
        <View style={s.head}>
          <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
            Fields and cards
          </Text>
          <Text style={[s.meta, { color: t.fg2 }]} numberOfLines={1}>
            {c?.name ?? collection ?? ""} · the chat does all this too
          </Text>
        </View>
        {note ? <Text style={[s.note, { color: t.fg2 }]}>{note}</Text> : null}
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 40 }}>
          <View style={[s.card, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
            <Text style={[s.section, { color: t.fg2 }]}>FIELDS</Text>
            {(c?.fields ?? []).map((f) => (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                accessibilityLabel={`${f.name}, ${TYPE_WORDS[f.type]}`}
                onPress={() => open(f)}
                style={[s.row, { borderTopColor: t.sep }]}
              >
                <View style={s.grow}>
                  <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
                    {f.name}
                    {isTitle(f) ? (
                      <Text style={{ color: t.fg2, fontWeight: "500" }}> · the title</Text>
                    ) : null}
                  </Text>
                  <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
                    {f.options.formula
                      ? `= ${f.options.formula}`
                      : f.options.rollup
                        ? "worked out from linked records"
                        : TYPE_WORDS[f.type] +
                          (f.options.choices?.length ? `: ${f.options.choices.join(", ")}` : "") +
                          (f.required ? " · required" : "")}
                  </Text>
                </View>
                <Text style={{ color: t.fg3, fontSize: 18 }}>›</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => open("new")}
              style={[s.row, { borderTopColor: t.sep }]}
            >
              <Text style={{ color: t.accent, fontWeight: "700", fontSize: 15 }}>+ Add a field</Text>
            </Pressable>
          </View>

          <View style={[s.card, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
            <Text style={[s.section, { color: t.fg2 }]}>RULES</Text>
            {rules.length ? (
              rules.map((r) => (
                <View key={r.id} style={[s.row, { borderTopColor: t.sep }]}>
                  <Text style={[s.rowSub, s.grow, { color: t.fg }]}>{r.words}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove rule: ${r.words}`}
                    onPress={() =>
                      setConfirmRemove({
                        what: `the rule “${r.words}”`,
                        run: async () => {
                          await run(() => request("DELETE", `/api/rules/${enc(r.id)}`), "Rule removed.");
                        },
                      })
                    }
                    hitSlop={8}
                  >
                    <Text style={{ color: t.danger, fontWeight: "700" }}>Remove</Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <Text style={[s.rowSub, { color: t.fg2, paddingVertical: 8 }]}>
                No rules. Ask the chat for one.
              </Text>
            )}
          </View>

          <View style={[s.card, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
            <Text style={[s.section, { color: t.fg2 }]}>CARDS AND VIEWS</Text>
            {views.length ? (
              views.map((v) => (
                <View key={v.id} style={[s.row, { borderTopColor: t.sep }]}>
                  <View style={s.grow}>
                    <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
                      {v.name}
                    </Text>
                    <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
                      {v.card?.arrangement ?? "list"}
                      {v.filters.length
                        ? ` · ${v.filters.length} filter${v.filters.length === 1 ? "" : "s"}`
                        : ""}
                    </Text>
                  </View>
                  <Text style={[s.rowSub, { color: t.fg2 }]}>On home</Text>
                  <Switch
                    accessibilityLabel={`${v.name} on the home`}
                    value={v.pinned}
                    disabled={busy}
                    onValueChange={(pinned) =>
                      void run(
                        () => request("PATCH", `/api/views/${enc(v.id)}`, { pinned }),
                        pinned ? `${v.name} is on the home.` : `${v.name} is off the home.`,
                      )
                    }
                    trackColor={{ true: t.accent, false: t.fill2 }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${v.name}`}
                    onPress={() =>
                      setConfirmRemove({
                        what: `the card “${v.name}”`,
                        run: async () => {
                          await run(() => request("DELETE", `/api/views/${enc(v.id)}`), `${v.name} deleted.`);
                        },
                      })
                    }
                    hitSlop={8}
                  >
                    <Text style={{ color: t.danger, fontWeight: "700" }}>Delete</Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <Text style={[s.rowSub, { color: t.fg2, paddingVertical: 8 }]}>
                No cards yet. Ask the chat to pin one.
              </Text>
            )}
          </View>
        </ScrollView>
      </View>

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        tone="cell"
        keyboard
        gap={10}
        accessibilityLabel="Field"
      >
        <Text style={[s.label, { color: t.fg2 }]}>
          {editing === "new" ? "New field" : "Change the field"}
        </Text>
        <TextInput
          accessibilityLabel="Field name"
          placeholder="Field name"
          placeholderTextColor={t.fg2}
          value={draft.name}
          onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
          style={[s.input, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
        />
        {editing === "new" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Type: ${TYPE_WORDS[draft.type]}`}
            onPress={() => setPicking(true)}
            style={[s.input, s.typeRow, { backgroundColor: t.fill, borderColor: t.sep }]}
          >
            <Text style={{ color: t.fg, fontSize: 16 }}>{TYPE_WORDS[draft.type]}</Text>
            <Text style={{ color: t.accent, fontWeight: "700" }}>Change ▾</Text>
          </Pressable>
        ) : (
          <Text style={[s.rowSub, { color: t.fg2 }]}>
            {TYPE_WORDS[draft.type]} · a field keeps its kind; ask the chat to change it
          </Text>
        )}
        {draft.type === "choice" || draft.type === "multi_choice" ? (
          <TextInput
            accessibilityLabel="Choices, separated by commas"
            placeholder="Choices, separated by commas"
            placeholderTextColor={t.fg2}
            value={draft.choices}
            onChangeText={(choices) => setDraft((d) => ({ ...d, choices }))}
            style={[s.input, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
          />
        ) : null}
        {draft.type === "link" && editing === "new" ? (
          <TextInput
            accessibilityLabel="Links to which list"
            placeholder="Links to which list (name)"
            placeholderTextColor={t.fg2}
            value={draft.target}
            onChangeText={(target) => setDraft((d) => ({ ...d, target }))}
            style={[s.input, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
          />
        ) : null}
        {["number", "money", "date", "text", "boolean"].includes(draft.type) ? (
          <TextInput
            accessibilityLabel="Formula (optional)"
            placeholder="Formula, e.g. {Fee} - {Paid} (optional)"
            placeholderTextColor={t.fg2}
            value={draft.formula}
            onChangeText={(formula) => setDraft((d) => ({ ...d, formula }))}
            autoCapitalize="none"
            autoCorrect={false}
            style={[s.input, { backgroundColor: t.fill, color: t.fg, borderColor: t.sep }]}
          />
        ) : null}
        <View style={s.typeRow}>
          <Text style={[s.rowSub, { color: t.fg }]}>Required</Text>
          <Switch
            accessibilityLabel="Required"
            value={draft.required}
            onValueChange={(required) => setDraft((d) => ({ ...d, required }))}
            trackColor={{ true: t.accent, false: t.fill2 }}
          />
        </View>
        <View style={s.actions}>
          {editing && editing !== "new" && c && !isTitle(editing) ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const f = editing;
                setEditing(null);
                setConfirmRemove({
                  what: `the field “${f.name}” (its values go with it; undoable from Recently deleted is not; the chat can undo)`,
                  run: async () => {
                    await run(
                      () => request("DELETE", `/api/collections/${enc(c.id)}/fields/${enc(f.id)}`),
                      `${f.name} removed.`,
                    );
                  },
                });
              }}
              style={[s.secondary, { borderColor: t.sep }]}
            >
              <Text style={[s.btnText, { color: t.danger }]}>Remove</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !draft.name.trim()}
            onPress={() => void saveField()}
            style={[
              s.primary,
              s.grow,
              { backgroundColor: t.accent, opacity: busy || !draft.name.trim() ? 0.5 : 1 },
            ]}
          >
            <Text style={[s.btnText, { color: t.onAccent }]}>{editing === "new" ? "Add" : "Save"}</Text>
          </Pressable>
        </View>
      </Sheet>
      <Sheet
        open={picking}
        onClose={() => setPicking(false)}
        tone="cell"
        gap={4}
        accessibilityLabel="Kind of field"
      >
        {FIELD_TYPES.map((type) => (
          <Pressable
            key={type}
            accessibilityRole="button"
            accessibilityState={{ selected: draft.type === type }}
            onPress={() => {
              setDraft((d) => ({ ...d, type }));
              setPicking(false);
            }}
            style={[s.choice, draft.type === type ? { backgroundColor: t.fill } : null]}
          >
            <Text style={{ color: t.fg, fontSize: 16, fontWeight: draft.type === type ? "800" : "500" }}>
              {TYPE_WORDS[type]}
            </Text>
          </Pressable>
        ))}
      </Sheet>

      <Sheet
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        tone="cell"
        gap={10}
        accessibilityLabel="Remove?"
      >
        <Text style={[s.rowTitle, { color: t.fg }]}>Remove {confirmRemove?.what}?</Text>
        <View style={s.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmRemove(null)}
            style={[s.secondary, { borderColor: t.sep }]}
          >
            <Text style={[s.btnText, { color: t.fg }]}>Keep</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              const r = confirmRemove;
              setConfirmRemove(null);
              void r?.run();
            }}
            style={[s.primary, s.grow, { backgroundColor: t.danger }]}
          >
            <Text style={[s.btnText, { color: t.onAccent }]}>Remove</Text>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  top: { paddingHorizontal: 16, paddingBottom: 4 },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  head: { paddingHorizontal: 20, paddingTop: 6, gap: 2 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  meta: { fontSize: 14 },
  note: { paddingHorizontal: 20, paddingTop: 10, fontSize: 14 },
  card: {
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  section: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, paddingVertical: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  grow: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: "700" },
  rowSub: { fontSize: 13.5, lineHeight: 19 },
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  typeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
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
  btnText: { fontSize: 15, fontWeight: "800" },
  picker: { position: "absolute", left: 16, right: 16, bottom: 32, borderRadius: 20, padding: 12, gap: 2 },
  choice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12 },
});
