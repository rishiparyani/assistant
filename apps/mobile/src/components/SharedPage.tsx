// Something shared with one person, opened: a card with its parts, a list, a form to fill in,
// or a question. Only what the share shows, and only the fields it lets them change are
// controls. Drawn from what the owner's object sent for that person, so in a rehearsal
// (decision 2026-10-16 "Rehearse as each person") it is exactly their page.
import { useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { Tap, Text, TextInput, type } from "@assistant/cards/native";
import {
  ValueError,
  normalizeValue,
  type SharedField,
  type SharedOpened,
  type SharedRecord,
  type StoredValue,
} from "@assistant/shared";
import { AddForm } from "./QuickAdd.tsx";
import { radius, useTheme } from "../theme.ts";

type Run = (key: string, go: () => Promise<unknown>) => void;

export function SharedPage({
  opened,
  busy,
  run,
  onSet,
  onAdd,
  onAnswer,
}: {
  opened: SharedOpened;
  /** What is being sent now (a record id, a section, "answer"). */
  busy?: string | null;
  /** Runs one action (the caller shows what went wrong). */
  run: Run;
  onSet: (recordId: string, fieldId: string, value: StoredValue) => Promise<unknown>;
  onAdd: (section: string, values: Record<string, unknown>) => Promise<unknown>;
  onAnswer: (answer: string) => Promise<unknown>;
}) {
  const { t } = useTheme();
  const share = opened.share;
  const from = (
    <Text style={[type.caption, { color: t.fg2 }]}>
      From {share.owner} ·{" "}
      {share.kind === "question"
        ? "a question"
        : share.kind === "form"
          ? "a form to fill in"
          : share.access === "edit"
            ? "you can change it"
            : "to view"}
    </Text>
  );

  if ("choices" in opened)
    return (
      <View style={s.page}>
        <Text style={[s.title, { color: t.fg }]}>{opened.text}</Text>
        {from}
        <View style={s.row}>
          {(opened.choices ?? ["Done"]).map((c) => {
            const on = opened.mine === c;
            return (
              <Tap
                key={c}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Answer ${c}`}
                disabled={opened.closed || !!busy}
                onPress={() => run("answer", () => onAnswer(c))}
                haptic="light"
                style={[s.btn, { backgroundColor: on ? t.accent : t.fill, opacity: busy ? 0.6 : 1 }]}
              >
                <Text style={[s.btnText, { color: on ? t.onAccent : t.fg }]}>{c}</Text>
              </Tap>
            );
          })}
        </View>
        <Text style={[type.caption, { color: t.fg2 }]}>
          {opened.closed
            ? "No longer taking answers."
            : opened.mine
              ? `You said “${opened.mine}”. You can change it.`
              : "Tap an answer."}
        </Text>
      </View>
    );

  if ("record" in opened)
    return (
      <View style={s.page}>
        <Text style={[s.title, { color: t.fg }]}>{opened.record.title}</Text>
        {from}
        <Fields record={opened.record} busy={busy} run={run} onSet={onSet} />
        {opened.sections.map((sec) => (
          <View key={sec.key} style={{ gap: 8 }}>
            <Text style={[s.h2, { color: t.fg }]}>{sec.title}</Text>
            {sec.records.length ? (
              sec.records.map((r) => <Row key={r.id} record={r} busy={busy} run={run} onSet={onSet} />)
            ) : (
              <Text style={[type.caption, { color: t.fg2 }]}>None yet.</Text>
            )}
            {sec.can_add ? (
              <Box>
                <AddForm
                  fields={sec.fields.filter((f) => f.editable)}
                  name={sec.title}
                  onAdd={async (values) => {
                    await onAdd(sec.key, values);
                    return "Added.";
                  }}
                />
              </Box>
            ) : null}
          </View>
        ))}
      </View>
    );

  if ("records" in opened)
    return (
      <View style={s.page}>
        <Text style={[s.title, { color: t.fg }]}>{share.title}</Text>
        {from}
        {opened.records.length ? (
          opened.records.map((r) => <Row key={r.id} record={r} busy={busy} run={run} onSet={onSet} />)
        ) : (
          <Text style={[type.caption, { color: t.fg2 }]}>Nothing here now.</Text>
        )}
        {opened.can_add ? (
          <Box>
            <Text style={[s.h2, { color: t.fg }]}>Add to {opened.collection}</Text>
            <AddForm
              fields={opened.fields.filter((f) => f.editable)}
              name={opened.collection}
              onAdd={async (values) => {
                await onAdd("view", values);
                return "Added.";
              }}
            />
          </Box>
        ) : null}
      </View>
    );

  return (
    <View style={s.page}>
      <Text style={[s.title, { color: t.fg }]}>{share.title}</Text>
      {from}
      {opened.description ? <Text style={[type.body, { color: t.fg }]}>{opened.description}</Text> : null}
      <Box>
        <AddForm
          fields={opened.fields}
          name={opened.collection}
          button="Send"
          onAdd={async (values) => {
            await onAdd("form", values);
            return "Sent.";
          }}
        />
      </Box>
      <Text style={[s.h2, { color: t.fg }]}>What you've sent</Text>
      {opened.mine.length ? (
        opened.mine.map((r) => <Row key={r.id} record={r} busy={busy} run={run} onSet={onSet} />)
      ) : (
        <Text style={[type.caption, { color: t.fg2 }]}>Nothing yet.</Text>
      )}
    </View>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  const { t } = useTheme();
  return <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair }]}>{children}</View>;
}

const shownOf = (f: SharedField) => (Array.isArray(f.display) ? f.display.join(", ") : (f.display ?? ""));

/** A record's shared fields, one per line; the ones they may change are controls. */
function Fields({
  record,
  busy,
  run,
  onSet,
}: {
  record: SharedRecord;
  busy?: string | null;
  run: Run;
  onSet: (recordId: string, fieldId: string, value: StoredValue) => Promise<unknown>;
}) {
  const { t } = useTheme();
  const fields = record.fields.filter((f) => !f.title && (f.editable || shownOf(f)));
  if (!fields.length) return null;
  return (
    <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair }]}>
      {fields.map((f) => (
        <View key={f.id} style={s.field}>
          <Text style={[type.small, { color: t.fg2, flexShrink: 0, maxWidth: "40%" }]}>{f.name}</Text>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            {f.editable ? (
              <Edit
                field={f}
                busy={busy === record.id}
                set={(v) => run(record.id, () => onSet(record.id, f.id, v))}
              />
            ) : (
              <Text style={[type.body, { color: t.fg, textAlign: "right" }]}>{shownOf(f)}</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/** A record in a list: its title, what's shown of it, and its controls. */
function Row(props: {
  record: SharedRecord;
  busy?: string | null;
  run: Run;
  onSet: (recordId: string, fieldId: string, value: StoredValue) => Promise<unknown>;
}) {
  const { t } = useTheme();
  const { record } = props;
  const editable = record.fields.some((f) => f.editable && !f.title);
  const line = record.fields
    .filter((f) => !f.title && !f.editable)
    .map(shownOf)
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={{ gap: 6 }}>
      <View style={[s.rowCard, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[type.body, { color: t.fg, fontWeight: "600" }]}>{record.title}</Text>
        {line ? <Text style={[type.caption, { color: t.fg2 }]}>{line}</Text> : null}
      </View>
      {editable ? (
        <Fields {...props} record={{ ...record, fields: record.fields.filter((f) => f.editable) }} />
      ) : null}
    </View>
  );
}

/** One field they may change: a switch, chips, or a box that saves when they're done. */
function Edit({ field, busy, set }: { field: SharedField; busy: boolean; set: (v: StoredValue) => void }) {
  const { t } = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (field.type === "boolean")
    return (
      <Switch
        accessibilityLabel={field.name}
        value={field.value === true}
        disabled={busy}
        onValueChange={(v) => set(v)}
        trackColor={{ true: t.accent, false: t.fill }}
      />
    );
  const choices = field.type === "choice" ? (field.options.choices ?? []) : [];
  if (choices.length)
    return (
      <View style={[s.row, { justifyContent: "flex-end" }]}>
        {choices.map((c) => {
          const on = field.value === c;
          return (
            <Tap
              key={c}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              disabled={busy}
              onPress={() => set(on ? null : c)}
              haptic="selection"
              style={[s.chip, { backgroundColor: on ? t.accent : t.fill }]}
            >
              <Text style={[type.small, { color: on ? t.onAccent : t.fg, fontWeight: "600" }]}>{c}</Text>
            </Tap>
          );
        })}
      </View>
    );
  const save = () => {
    if (text === null) return;
    try {
      const v = normalizeValue(field, text);
      setError("");
      setText(null);
      set(v);
    } catch (e) {
      setError(e instanceof ValueError ? e.message.replace(`${field.name}: `, "") : String(e));
    }
  };
  return (
    <View style={{ alignSelf: "stretch", gap: 4 }}>
      <TextInput
        accessibilityLabel={field.name}
        value={text ?? shownOf(field)}
        onChangeText={setText}
        onEndEditing={save}
        onSubmitEditing={save}
        editable={!busy}
        doneBar
        style={[
          s.input,
          type.body,
          { color: t.fg, backgroundColor: t.page, borderColor: error ? t.danger : t.hair },
        ]}
      />
      {error ? <Text style={[type.caption, { color: t.danger }]}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  page: { gap: 12 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  h2: { fontSize: 15, fontWeight: "700", marginTop: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  box: { padding: 14, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  rowCard: { padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  field: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: "center" },
  btn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 15, fontWeight: "700" },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 16,
  },
});
