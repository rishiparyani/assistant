// The chat, one pull away from the home. Opened from a card it knows which one. Messages typed
// offline wait in the outbox and go when the connection is back.
import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatItem, ChatView } from "@assistant/shared";
import { ApiError, isOffline, request } from "@/api";
import { send } from "@/outbox";
import { radius, useTheme } from "@/theme";

const MAIN = "main";
const SUGGEST = [
  "What's due this week?",
  "Spent 450 on chai",
  "Remind me to call the venue at 6",
  "Pin my expenses to the home",
];

export default function Chat() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { card } = useLocalSearchParams<{ card?: string }>();
  const [view, setView] = useState<ChatView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const list = useRef<FlatList<ChatItem>>(null);

  useEffect(() => {
    request<ChatView>("GET", `/api/chats/${MAIN}`)
      .then(setView)
      .catch((e: unknown) =>
        setNote(
          isOffline(e)
            ? "Offline: messages wait and go when you're back."
            : e instanceof Error
              ? e.message
              : String(e),
        ),
      );
  }, []);

  const say = async (raw: string) => {
    const body = raw.trim();
    if (!body || busy) return;
    const msg = card && view?.items.length === 0 ? `About "${card}": ${body}` : body;
    setText("");
    const mine: ChatItem = {
      id: `local-${Date.now()}`,
      role: "user",
      text: msg,
      created_at: new Date().toISOString(),
    };
    setView((v) => (v ? { ...v, items: [...v.items, mine] } : v));
    setBusy(true);
    try {
      const next = await request<ChatView>("POST", `/api/chats/${MAIN}`, { text: msg });
      setView(next);
      setNote("");
    } catch (e) {
      if (isOffline(e)) {
        send({
          kind: "assistant.message",
          method: "POST",
          path: `/api/chats/${MAIN}`,
          body: { text: msg },
          label: "Message to the assistant",
        });
        setNote("Waiting to send: it goes when you're back online.");
      } else setNote(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
      list.current?.scrollToEnd({ animated: true });
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[s.root, { backgroundColor: t.page }]}
    >
      <View style={s.head}>
        <Text style={[s.title, { color: t.fg }]}>{card ? card : "Gigspree"}</Text>
        {card ? (
          <Text style={[s.ctx, { color: t.fg2, backgroundColor: t.fill }]}>about this card</Text>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={s.done} hitSlop={10}>
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <FlatList
        ref={list}
        data={view?.items ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 14, gap: 4 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => <Bubble item={item} />}
        ListEmptyComponent={
          <Text style={[s.sys, { color: t.fg2 }]}>
            {note || (view ? "Say anything. Ask, add, or arrange your home." : "Loading…")}
          </Text>
        }
      />
      {note && view?.items.length ? <Text style={[s.sys, { color: t.fg2 }]}>{note}</Text> : null}
      <FlatList
        horizontal
        data={SUGGEST}
        keyExtractor={(x) => x}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14, gap: 6, paddingVertical: 6 }}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => say(item)}
            style={[s.chip, { backgroundColor: t.cell, borderColor: t.sep }]}
          >
            <Text style={{ color: t.accent, fontSize: 13.5, fontWeight: "600" }}>{item}</Text>
          </Pressable>
        )}
      />
      <View style={[s.compose, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          accessibilityLabel="Message Gigspree"
          placeholder={card ? `Ask about ${card}` : "Ask, add or arrange"}
          placeholderTextColor={t.fg2}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => say(text)}
          returnKeyType="send"
          style={[s.input, { backgroundColor: t.cell, color: t.fg, borderColor: t.sep }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={() => say(text)}
          disabled={busy}
          style={[s.send, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={{ color: t.onAccent, fontWeight: "800", fontSize: 18, lineHeight: 20 }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ item }: { item: ChatItem }) {
  const { t } = useTheme();
  if (item.role === "user")
    return (
      <View style={[s.bub, s.me, { backgroundColor: t.accent }]}>
        <Text style={[s.bubText, { color: t.onAccent }]}>{item.text}</Text>
      </View>
    );
  if (item.role === "card" || item.role === "live") {
    const title = item.card?.title ?? (item.live && "title" in item.live ? String(item.live.title) : "Card");
    return (
      <View style={[s.inline, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.cardTitle, { color: t.accent }]}>{title}</Text>
        {item.card?.details.map((d) => (
          <Text key={d} style={[s.bubText, { color: t.fg }]}>
            {d}
          </Text>
        ))}
        {item.text ? <Text style={[s.bubText, { color: t.fg2 }]}>{item.text}</Text> : null}
        {item.card?.status === "waiting" ? (
          <Text style={[s.sys, { color: t.fg2, textAlign: "left", padding: 0 }]}>
            Open the website to confirm this one; confirm cards come to the app next.
          </Text>
        ) : null}
      </View>
    );
  }
  if (item.role === "note") return <Text style={[s.sys, { color: t.fg2 }]}>{item.text}</Text>;
  return (
    <View style={[s.bub, s.them, { backgroundColor: t.bubbleThem, borderColor: t.hair }]}>
      <Text style={[s.bubText, { color: t.fg }]}>{item.text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: { height: 56, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  title: { fontSize: 16, fontWeight: "700" },
  ctx: {
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: "hidden",
  },
  done: { position: "absolute", right: 16, height: 56, justifyContent: "center" },
  bub: { maxWidth: "82%", paddingVertical: 9, paddingHorizontal: 13, borderRadius: 19 },
  me: { alignSelf: "flex-end", borderBottomRightRadius: 5 },
  them: { alignSelf: "flex-start", borderBottomLeftRadius: 5, borderWidth: StyleSheet.hairlineWidth },
  bubText: { fontSize: 15, lineHeight: 20 },
  inline: {
    alignSelf: "stretch",
    borderRadius: radius.card,
    padding: 12,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  cardTitle: { fontSize: 12, fontWeight: "700" },
  sys: { fontSize: 12, fontWeight: "600", textAlign: "center", padding: 6 },
  chip: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  compose: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 6 },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
