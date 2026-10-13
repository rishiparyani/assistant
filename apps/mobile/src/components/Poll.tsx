// Asking everyone in a chat (decision 2026-10-14 "Ask everyone", as in the mock-up): a question
// card with an answer button each (with how many picked it and who), and the sheet that asks.
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PollView } from "@assistant/shared";
import { Text, TextInput } from "@assistant/cards/native";
import { askEveryone, votePoll } from "../chats.ts";
import { radius, tint, useTheme } from "../theme.ts";

/** A question in the chat: tap an answer (tap it again to take it back). */
export function PollCard({
  groupId,
  messageId,
  poll,
  asker,
  mine,
}: {
  groupId: string;
  messageId: string;
  poll: PollView;
  /** "You" or the person who asked. */
  asker: string;
  /** Whether I asked it (it sits on my side). */
  mine: boolean;
}) {
  const { t, dark } = useTheme();
  const total = poll.votes.reduce((n, v) => n + v.people.length, 0);
  const pick = (option: string) => {
    votePoll(groupId, messageId, poll.mine === option ? null : option);
    void Haptics.selectionAsync().catch(() => undefined);
  };
  return (
    <View
      style={[
        s.card,
        mine ? s.right : s.left,
        { backgroundColor: t.cell, borderColor: tint(t.accent, 0.35) },
      ]}
    >
      <Text style={[s.kicker, { color: t.warn }]}>
        {mine ? "You asked everyone" : `${asker} asked everyone`}
      </Text>
      <Text style={[s.question, { color: t.fg }]}>{poll.question}</Text>
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
    </View>
  );
}

/** The sheet that asks: a question and its answers (Yes / No / Maybe to start with). */
export function AskEveryoneSheet({
  groupId,
  open,
  onClose,
}: {
  groupId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["Yes", "No", "Maybe"]);
  const [adding, setAdding] = useState("");
  const clean = options.map((o) => o.trim()).filter(Boolean);
  const distinct = new Set(clean.map((o) => o.toLowerCase())).size === clean.length;
  const ready = question.trim().length > 0 && clean.length >= 2 && distinct;
  const go = () => {
    if (!ready) return;
    askEveryone(groupId, question.trim(), clean);
    setQuestion("");
    setOptions(["Yes", "No", "Maybe"]);
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
        <Text style={[s.label, { color: t.fg2 }]}>Answers</Text>
        <View style={s.chips}>
          {options.map((o, i) => (
            <Pressable
              key={`${o}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${o}`}
              disabled={options.length <= 2}
              onPress={() => setOptions((xs) => xs.filter((_, j) => j !== i))}
              style={[s.chip, { backgroundColor: t.cell }]}
            >
              <Text style={[s.chipText, { color: t.fg }]}>{o}</Text>
              {options.length > 2 ? <Text style={[s.chipX, { color: t.fg3 }]}>×</Text> : null}
            </Pressable>
          ))}
        </View>
        {options.length < 6 ? (
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
