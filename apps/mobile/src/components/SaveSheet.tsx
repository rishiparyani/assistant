// Saving a chat message (decision 2026-10-13 "Chats with people", step 2, as in the mock-up):
// hold a message, Save, and your own assistant proposes where it goes. Only you see this, and
// nothing is saved until you tap Add. Without the assistant, Save puts it in your Inbox as it is.
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import * as Haptics from "expo-haptics";
import type { ChatItem } from "@assistant/shared";
import { Text } from "@assistant/cards/native";
import { Tap } from "@assistant/cards/native";
import { isOffline } from "../api.ts";
import {
  answerProposal,
  markSaved,
  proposeSave,
  saveToInbox,
  savedLabel,
  type GroupMessage,
} from "../chats.ts";
import { radius, useTheme } from "../theme.ts";

export function SaveSheet({
  groupId,
  message,
  action = null,
  canAsk,
  onAsk,
  onClose,
}: {
  groupId: string;
  message: GroupMessage | null;
  /** A suggestion the person tapped ("Remind me"): the assistant proposes that, not a guess. */
  action?: string | null;
  canAsk: boolean;
  /** Ask my assistant about this message instead (the private panel opens with it quoted). */
  onAsk?: (message: GroupMessage) => void;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [chatId, setChatId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    setItems(null);
    setError("");
    setDone("");
    if (!message || !canAsk) return;
    let gone = false;
    proposeSave(groupId, message.id, action ?? undefined)
      .then((p) => {
        if (gone) return;
        setChatId(p.chat_id);
        setItems(p.items);
      })
      .catch((e: unknown) => {
        if (gone) return;
        setItems([]);
        setError(
          isOffline(e)
            ? "Saving with the assistant needs a connection. You can put it in your Inbox now."
            : e instanceof Error
              ? e.message
              : String(e),
        );
      });
    return () => {
      gone = true;
    };
  }, [groupId, message, action, canAsk]);

  const finish = (label: string) => {
    if (!message) return;
    markSaved(groupId, message.id, label);
    setDone(label);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setTimeout(onClose, 700);
  };
  const answer = async (item: ChatItem, what: "confirm" | "cancel") => {
    if (!item.card) return;
    setBusy(true);
    setError("");
    try {
      const view = await answerProposal(chatId, item.card.action_id, what);
      if (what === "cancel") {
        setItems((xs) => (xs ?? []).filter((x) => x.id !== item.id));
        return;
      }
      // Only a card the server actually carried out counts as saved.
      const card = view.items.find((x) => x.card?.action_id === item.card!.action_id)?.card;
      if (card?.status === "done") finish(savedLabel(item.card.title));
      else {
        setItems((xs) => (xs ?? []).filter((x) => x.id !== item.id));
        setError(
          `Couldn't save it${card?.result ? `: ${card.result}` : ""}. Try again, or put it in your Inbox.`,
        );
      }
    } catch (e) {
      setError(isOffline(e) ? "Saving needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toInbox = () => {
    if (!message) return;
    saveToInbox(message.text);
    finish("Inbox");
  };

  const cards = (items ?? []).filter((i) => i.card?.status === "waiting");
  const words = (items ?? []).filter((i) => i.role === "assistant" && i.text).map((i) => i.text);

  return (
    <Sheet open={!!message} onClose={onClose} tone="cell" accessibilityLabel="Save this message">
      <Text style={[s.label, { color: t.fg2 }]}>{action ?? "Save"} · only you see this</Text>
      {message ? (
        <View style={[s.quote, { backgroundColor: t.fill }]}>
          <Text style={[s.quoteWho, { color: t.fg2 }]}>{message.author}</Text>
          <Text style={[s.quoteText, { color: t.fg }]} numberOfLines={4}>
            {message.text}
          </Text>
        </View>
      ) : null}
      {message && canAsk && onAsk ? (
        <Tap
          accessibilityRole="button"
          onPress={() => onAsk(message)}
          style={[s.secondary, { backgroundColor: t.fill }]}
        >
          <Text style={[s.secondaryText, { color: t.accent }]}>Ask about this</Text>
        </Tap>
      ) : null}
      {done ? (
        <Text style={[s.done, { color: t.good }]}>Saved to {done} ✓</Text>
      ) : !canAsk ? (
        <Tap
          accessibilityRole="button"
          onPress={toInbox}
          haptic="light"
          style={[s.primary, { backgroundColor: t.accent }]}
        >
          <Text style={[s.primaryText, { color: t.onAccent }]}>Save to my Inbox</Text>
        </Tap>
      ) : items === null ? (
        <View style={s.wait}>
          <ActivityIndicator color={t.accent} />
          <Text style={[s.small, { color: t.fg2 }]}>Finding where it goes…</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 10 }}>
          {cards.map((item) => (
            <View key={item.id} style={[s.card, { borderColor: t.accent }]}>
              <Text style={[s.cardTitle, { color: t.accent }]}>{item.card!.title}</Text>
              {item.card!.details.map((d) => (
                <Text key={d} style={[s.detail, { color: t.fg }]}>
                  {d}
                </Text>
              ))}
              <View style={s.row}>
                <Tap
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void answer(item, "confirm")}
                  haptic="light"
                  style={[s.primary, s.grow, { backgroundColor: t.accent }]}
                >
                  <Text style={[s.primaryText, { color: t.onAccent }]}>{item.card!.title}</Text>
                </Tap>
                <Tap
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void answer(item, "cancel")}
                  style={[s.secondary, { backgroundColor: t.fill }]}
                >
                  <Text style={[s.secondaryText, { color: t.fg }]}>Not this</Text>
                </Tap>
              </View>
            </View>
          ))}
          {words.length && !cards.length ? (
            <Text style={[s.small, { color: t.fg2 }]}>{words.join("\n\n")}</Text>
          ) : null}
          {!cards.length ? (
            <Tap
              accessibilityRole="button"
              onPress={toInbox}
              style={[s.secondary, { backgroundColor: t.fill }]}
            >
              <Text style={[s.secondaryText, { color: t.fg }]}>Put it in my Inbox instead</Text>
            </Tap>
          ) : null}
        </ScrollView>
      )}
      {error ? <Text style={[s.small, { color: t.danger }]}>{error}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  quote: { borderRadius: 14, padding: 12, gap: 2 },
  quoteWho: { fontSize: 12, fontWeight: "800" },
  quoteText: { fontSize: 15, lineHeight: 21 },
  wait: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 60 },
  small: { fontSize: 14, lineHeight: 20 },
  done: { fontSize: 17, fontWeight: "800", textAlign: "center", paddingVertical: 14 },
  card: { borderRadius: radius.card, borderWidth: 1.5, padding: 12, gap: 4 },
  cardTitle: { fontSize: 12, fontWeight: "800" },
  detail: { fontSize: 15, lineHeight: 21 },
  row: { flexDirection: "row", gap: 8, marginTop: 8 },
  grow: { flex: 1 },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryText: { fontSize: 15, fontWeight: "800" },
  secondary: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryText: { fontSize: 14, fontWeight: "700" },
});
