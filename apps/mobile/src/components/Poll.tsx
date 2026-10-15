// Asking everyone in a chat (decision 2026-10-14 "Ask everyone", as in the mock-up): a question
// card with an answer button each (with how many picked it and who), and the sheet that asks.
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatCard, PollView, SharedOpened } from "@assistant/shared";
import { Text, TextInput } from "@assistant/cards/native";
import { request } from "../api.ts";
import { askEveryone, votePoll } from "../chats.ts";
import { radius, tint, useTheme } from "../theme.ts";

/** A question in the chat: tap an answer (tap it again to take it back). */
export function PollCard({
  groupId,
  messageId,
  poll: given,
  asker,
  mine,
  me,
  highlight,
  onLongPress,
  saved,
}: {
  groupId: string;
  messageId: string;
  /** `was`: my answer as the server has it, while a change is on its way. */
  poll: PollView & { was?: string | null };
  /** "You" or the person who asked. */
  asker: string;
  /** Whether I asked it (it sits on my side). */
  mine: boolean;
  /** My name as the chat shows it (to move it when my answer changes before it's sent). */
  me: string;
  /** Opened from a search hit: a ring around it. */
  highlight?: boolean;
  /** Hold to save it, like any message. */
  onLongPress?: () => void;
  /** "Saved to …" for me. */
  saved?: string;
}) {
  const { t, dark } = useTheme();
  // A change of mine still on its way: my name moves to the new answer at once.
  const poll =
    given.was !== undefined && given.was !== given.mine
      ? {
          ...given,
          votes: given.votes.map((v) => {
            let people = v.option === given.was ? removeOnce(v.people, me) : v.people;
            if (v.option === given.mine) people = [...people, me];
            return { ...v, people };
          }),
        }
      : given;
  const total = poll.votes.reduce((n, v) => n + v.people.length, 0);
  const pick = (option: string) => {
    votePoll(groupId, messageId, poll.mine === option ? null : option);
    void Haptics.selectionAsync().catch(() => undefined);
  };
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityHint="Hold to save it to your lists"
      style={[
        s.card,
        mine ? s.right : s.left,
        { backgroundColor: t.cell, borderColor: highlight ? t.accent : tint(t.accent, 0.35) },
        highlight && { borderWidth: 2 },
      ]}
    >
      <Text style={[s.kicker, { color: t.warn }]}>
        {mine ? "You asked everyone" : `${asker} asked everyone`}
      </Text>
      <Text style={[s.question, { color: t.fg }]}>{poll.question}</Text>
      {poll.about ? (
        <Text style={[s.who, { color: t.fg2 }]} numberOfLines={1}>
          Your answer fills in {poll.about.field} on “{poll.about.record}”
        </Text>
      ) : null}
      <View style={s.options}>
        {poll.votes.map((v) => {
          const on = poll.mine === v.option;
          return (
            <Pressable
              key={v.option}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${v.option}, ${v.people.length}`}
              onPress={() => pick(v.option)}
              style={[s.option, { backgroundColor: on ? t.accent : tint(t.accent, dark ? 0.16 : 0.08) }]}
            >
              <Text style={[s.optionText, { color: on ? t.onAccent : t.fg }]} numberOfLines={1}>
                {v.option}
              </Text>
              <Text style={[s.count, { color: on ? t.onAccent : t.fg2 }]}>{v.people.length}</Text>
            </Pressable>
          );
        })}
      </View>
      {total ? (
        <Text style={[s.who, { color: t.fg2 }]} numberOfLines={3}>
          {poll.votes
            .filter((v) => v.people.length)
            .map((v) => `${v.option}: ${v.people.join(", ")}`)
            .join(" · ")}
        </Text>
      ) : (
        <Text style={[s.who, { color: t.fg3 }]}>No answers yet</Text>
      )}
      {saved ? <Text style={[s.who, { color: t.good, fontWeight: "700" }]}>Saved to {saved} ✓</Text> : null}
    </Pressable>
  );
}

/** The list without one copy of a name (two people can share one). */
function removeOnce(people: string[], name: string): string[] {
  const i = people.indexOf(name);
  return i < 0 ? people : [...people.slice(0, i), ...people.slice(i + 1)];
}

/** A personal field of a pinned record that a question could fill in. */
type Fillable = {
  share_id: string;
  record: string;
  field_id: string;
  field: string;
  choices: string[] | null;
};

/**
 * The sheet that asks: a question and its answers (Yes / No / Maybe to start with). With
 * records pinned to the chat, it can be a question that acts (decision 2026-10-15): pick one of
 * their personal yes/no or choice fields, and each person's answer fills in their own.
 */
export function AskEveryoneSheet({
  groupId,
  cards = [],
  canAct = false,
  open,
  onClose,
}: {
  groupId: string;
  /** Records pinned to the chat. */
  cards?: ChatCard[];
  /** Whether I may ask a question that fills one in (an admin, or I pinned it). */
  canAct?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["Yes", "No", "Maybe"]);
  const [adding, setAdding] = useState("");
  const [fillable, setFillable] = useState<Fillable[]>([]);
  const [fills, setFills] = useState<Fillable | null>(null);
  // online-only: which pinned records have personal fields is read when the sheet opens.
  useEffect(() => {
    if (!open || !canAct || !cards.length) return;
    let current = true;
    Promise.all(
      cards.map((c) =>
        request<SharedOpened>(
          "GET",
          `/api/groups/${encodeURIComponent(groupId)}/cards/${encodeURIComponent(c.share_id)}`,
        )
          .then((o) =>
            o.share.kind === "card" && "record" in o
              ? o.record.fields
                  .filter((f) => f.personal && (f.type === "boolean" || f.type === "choice"))
                  .map((f): Fillable => ({
                    share_id: c.share_id,
                    record: o.record.title,
                    field_id: f.id,
                    field: f.name,
                    choices: f.type === "choice" ? (f.options.choices ?? []) : null,
                  }))
              : [],
          )
          .catch(() => [] as Fillable[]),
      ),
    ).then((all) => {
      if (current) setFillable(all.flat());
    });
    return () => {
      current = false;
    };
  }, [open, canAct, cards, groupId]);
  // The answers follow the field: Yes / No / Maybe for a yes/no, its choices for a choice.
  const pickFill = (f: Fillable | null) => {
    setFills(f);
    setOptions(f ? (f.choices ? f.choices.slice(0, 6) : ["Yes", "No", "Maybe"]) : ["Yes", "No", "Maybe"]);
  };
  const clean = options.map((o) => o.trim()).filter(Boolean);
  const distinct = new Set(clean.map((o) => o.toLowerCase())).size === clean.length;
  const ready = question.trim().length > 0 && clean.length >= 2 && distinct;
  const go = () => {
    if (!ready) return;
    askEveryone(
      groupId,
      question.trim(),
      clean,
      fills ? { share_id: fills.share_id, field: fills.field_id } : undefined,
    );
    setQuestion("");
    setOptions(["Yes", "No", "Maybe"]);
    setFills(null);
    onClose();
  };
  const add = () => {
    const o = adding.trim();
    if (!o || options.length >= 6) return;
    setOptions((xs) => [...xs, o]);
    setAdding("");
  };
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[s.scrim, { backgroundColor: t.shadow }]}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View style={[s.sheet, { backgroundColor: t.page, paddingBottom: insets.bottom + 16 }]}>
        <View style={[s.grab, { backgroundColor: t.fill2 }]} />
        <Text style={[s.title, { color: t.fg }]}>Ask everyone</Text>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="e.g. Free on Sat 12 Dec for Taj?"
          placeholderTextColor={t.fg3}
          maxLength={300}
          accessibilityLabel="Question"
          style={[s.input, { backgroundColor: t.cell, color: t.fg }]}
        />
        {fillable.length ? (
          <>
            <Text style={[s.label, { color: t.fg2 }]}>Answers fill in</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {[null, ...fillable].map((f) => {
                const on =
                  (fills?.share_id ?? null) === (f?.share_id ?? null) && fills?.field_id === f?.field_id;
                return (
                  <Pressable
                    key={f ? `${f.share_id}:${f.field_id}` : "none"}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => pickFill(f)}
                    style={[s.chip, { backgroundColor: on ? t.accent : t.cell }]}
                  >
                    <Text style={[s.chipText, { color: on ? t.onAccent : t.fg }]} numberOfLines={1}>
                      {f ? `${f.field} · ${f.record}` : "Nothing"}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}
        <Text style={[s.label, { color: t.fg2 }]}>Answers</Text>
        <View style={s.chips}>
          {options.map((o, i) => (
            <Pressable
              key={`${o}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${o}`}
              disabled={options.length <= 2 || !!fills}
              onPress={() => setOptions((xs) => xs.filter((_, j) => j !== i))}
              style={[s.chip, { backgroundColor: t.cell }]}
            >
              <Text style={[s.chipText, { color: t.fg }]}>{o}</Text>
              {options.length > 2 && !fills ? <Text style={[s.chipX, { color: t.fg3 }]}>×</Text> : null}
            </Pressable>
          ))}
        </View>
        {fills ? (
          <Text style={[s.label, { color: t.fg3 }]}>
            Each person’s answer becomes their own answer to {fills.field} on “{fills.record}”.
          </Text>
        ) : null}
        {options.length < 6 && !fills ? (
          <View style={s.addRow}>
            <TextInput
              value={adding}
              onChangeText={setAdding}
              onSubmitEditing={add}
              placeholder="Another answer"
              placeholderTextColor={t.fg3}
              maxLength={40}
              accessibilityLabel="Another answer"
              style={[s.input, s.grow, { backgroundColor: t.cell, color: t.fg }]}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!adding.trim()}
              onPress={add}
              style={[s.addBtn, { backgroundColor: t.fill, opacity: adding.trim() ? 1 : 0.5 }]}
            >
              <Text style={[s.chipText, { color: t.fg }]}>Add</Text>
            </Pressable>
          </View>
        ) : null}
        {!distinct ? <Text style={[s.label, { color: t.danger }]}>Answers must differ.</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={!ready}
          onPress={go}
          style={[s.go, { backgroundColor: t.accent, opacity: ready ? 1 : 0.5 }]}
        >
          <Text style={[s.goText, { color: t.onAccent }]}>Ask everyone</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: radius.card, borderWidth: 1, padding: 12, gap: 8, width: "86%", maxWidth: 360 },
  right: { alignSelf: "flex-end" },
  left: { alignSelf: "flex-start" },
  kicker: { fontSize: 12, fontWeight: "800" },
  question: { fontSize: 16, fontWeight: "800", lineHeight: 22 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  option: {
    flexGrow: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  optionText: { fontSize: 14, fontWeight: "800", flexShrink: 1 },
  count: { fontSize: 13, fontWeight: "800" },
  who: { fontSize: 12, lineHeight: 17 },
  scrim: { flex: 1, opacity: 0.6 },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, gap: 12 },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  input: { minHeight: 48, borderRadius: 16, paddingHorizontal: 16, fontSize: 16 },
  label: { fontSize: 13, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipText: { fontSize: 14, fontWeight: "700" },
  chipX: { fontSize: 16, fontWeight: "700" },
  addRow: { flexDirection: "row", gap: 8 },
  grow: { flex: 1 },
  addBtn: { minHeight: 48, paddingHorizontal: 16, borderRadius: 24, justifyContent: "center" },
  go: { minHeight: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  goText: { fontSize: 16, fontWeight: "800" },
});
