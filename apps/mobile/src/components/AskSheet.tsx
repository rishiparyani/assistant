// Asking my own assistant about a chat (decision 2026-10-13 "Chats with people", step 3, as in
// the mock-up): a dark panel over the chat that only I see, as many messages as I like. It reads
// the chat's conversation (its newest part, the older part as a summary; chats-home.md), and only
// when I ask. "Share to chat" puts one of its answers in the chat for everyone, once.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import { SAVE_TURN_PREFIX, type ChatItem, type ChatView, type CollectionView } from "@assistant/shared";
import { Text, TextInput } from "@assistant/cards/native";
import { isOffline, request } from "../api.ts";
import { radius, useTheme } from "../theme.ts";
import { LiveCard } from "./LiveCard.tsx";

const enc = encodeURIComponent;
/** One tap asks about the chat (the "catch-up" of chats-home.md). */
const QUICK = ["Catch me up", "What's still open?", "Who said they'd do what?"];

export function AskSheet({
  groupId,
  chatName,
  open,
  onClose,
  onShared,
  sharedAnswers = [],
  send,
  draft,
  topic,
}: {
  groupId: string;
  chatName: string;
  /** Answers I already shared here (kept by the chat), so they show "Shared ✓". */
  sharedAnswers?: string[];
  open: boolean;
  onClose: () => void;
  /** An answer went into the chat (load it again). */
  onShared: () => void;
  /** Asked at once when the panel opens (what was typed in the chat's box before tapping Gs). */
  send?: string | null;
  /** Put in the panel's box when it opens, to finish and send ("Ask about this" on a message). */
  draft?: string | null;
  /** Asked from inside a topic: the assistant reads that topic's messages. */
  topic?: { id: string; name: string };
}) {
  const { t } = useTheme();
  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shared, setShared] = useState<Set<string>>(new Set());
  const scroll = useRef<ScrollView>(null);
  const collections = useRef<Promise<CollectionView[]> | null>(null);
  const getCollections = useCallback(() => {
    collections.current ??= request<CollectionView[]>("GET", "/api/collections").catch((e: unknown) => {
      collections.current = null;
      throw e;
    });
    return collections.current;
  }, []);
  const fail = (e: unknown) =>
    setError(isOffline(e) ? "The assistant needs a connection." : e instanceof Error ? e.message : String(e));

  // What to ask or write as the panel opens, taken once per opening.
  const opening = useRef<{ send?: string | null; draft?: string | null; topic?: { id: string } }>({});
  opening.current = { send, draft, topic };
  // online-only: the assistant runs on the server.
  useEffect(() => {
    if (!open) return;
    setError("");
    // The topic it was asked in goes with it, even if another topic is open by the time the
    // panel has loaded (Codex on PR 221).
    const { send: first, draft: start, topic: about } = opening.current;
    if (start) setText(start);
    request<ChatView>("GET", `/api/groups/${enc(groupId)}/assistant`)
      .then((v) => {
        setItems(v.items);
        if (first?.trim()) void askRef.current(first, about ?? null);
      })
      .catch((e: unknown) => {
        setItems([]);
        fail(e);
        if (first?.trim()) setText(first);
      });
  }, [open, groupId]);

  // online-only: asking the assistant needs the server.
  /** `about`: the topic it was asked in (null: General); the panel's own topic when not given. */
  const ask = async (said?: string, about: { id: string } | null | undefined = topic) => {
    const body = (said ?? text).trim();
    if (!body) return;
    // Still answering the last one: a question handed in (Gs with words typed) waits in the box
    // instead of being dropped (Codex on PR 221).
    if (busy) {
      if (said) setText((now) => now || body);
      return;
    }
    setBusy(true);
    setError("");
    setText("");
    setItems((xs) => [
      ...(xs ?? []),
      { id: `local-${Date.now()}`, role: "user", text: body, created_at: new Date().toISOString() },
    ]);
    try {
      const v = await request<ChatView>("POST", `/api/groups/${enc(groupId)}/assistant`, {
        text: body,
        ...(about ? { topic: about.id } : {}),
      });
      setItems(v.items);
    } catch (e) {
      // What I asked comes back to the box, so it isn't lost (also when it came from the chat's box).
      setText((now) => now || body);
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const askRef = useRef(ask);
  askRef.current = ask;
  // online-only: a card the assistant proposed is carried out on the server.
  const answer = async (actionId: string, what: "confirm" | "cancel") => {
    setBusy(true);
    try {
      const v = await request<ChatView>(
        "POST",
        `/api/chats/${enc(groupId)}/actions/${enc(actionId)}/${what}`,
        {},
      );
      setItems(v.items);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  // online-only: sharing posts into the chat on the server (once per answer).
  const share = async (item: ChatItem) => {
    setBusy(true);
    try {
      await request(
        "POST",
        `/api/groups/${enc(groupId)}/share`,
        { item_id: item.id, ...(topic ? { topic: topic.id } : {}) },
        `share-${item.id}`,
      );
      setShared((s) => new Set(s).add(item.id));
      onShared();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const ink = { color: t.onInk };
  const soft = { color: t.onInk, opacity: 0.6 };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      tone="ink"
      keyboard
      padding={14}
      gap={10}
      accessibilityLabel="Ask the assistant"
    >
      <View style={s.head}>
        <Text style={[s.title, ink]}>Assistant · only you see this</Text>
        <Text style={[s.about, soft]} numberOfLines={1}>
          about {topic ? `${topic.name} · ${chatName}` : chatName}
        </Text>
      </View>
      <ScrollView
        ref={scroll}
        style={s.list}
        contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {items === null ? <ActivityIndicator color={t.onInk} /> : null}
        {items?.length === 0 && !error ? (
          <Text style={[s.small, soft]}>
            Ask about this chat or your lists: what was decided, who said they'd do what, dates, money. Only
            you see this; share an answer if the chat should.
          </Text>
        ) : null}
        {(items ?? []).map((item) => {
          // A Save turn (hold a message → Save) shows as a short note, not its instructions.
          if (item.role === "user" && item.text.startsWith(SAVE_TURN_PREFIX))
            return (
              <Text key={item.id} style={[s.small, soft]}>
                You asked where to save a message.
              </Text>
            );
          if (item.role === "user")
            return (
              <View key={item.id} style={[s.bubble, s.mine, { backgroundColor: t.accent }]}>
                <Text style={[s.text, { color: t.onAccent }]}>{item.text}</Text>
              </View>
            );
          if (item.role === "live" && item.live)
            return (
              <View key={item.id} style={s.live}>
                <LiveCard live={item.live} collections={getCollections} />
              </View>
            );
          if (item.role === "card" && item.card)
            return (
              <View key={item.id} style={[s.card, { backgroundColor: t.cell }]}>
                <Text style={[s.cardTitle, { color: t.accent }]}>{item.card.title}</Text>
                {item.card.details.map((d) => (
                  <Text key={d} style={[s.text, { color: t.fg }]}>
                    {d}
                  </Text>
                ))}
                {item.card.status === "waiting" ? (
                  <View style={s.row}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void answer(item.card!.action_id, "confirm")}
                      style={[s.btn, s.grow, { backgroundColor: t.accent }]}
                    >
                      <Text style={[s.btnText, { color: t.onAccent }]}>Confirm</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void answer(item.card!.action_id, "cancel")}
                      style={[s.btn, { backgroundColor: t.fill }]}
                    >
                      <Text style={[s.btnText, { color: t.fg }]}>Not now</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={[s.small, { color: t.fg2 }]}>
                    {item.card.status === "done" ? "Done." : "Not done."}
                    {item.card.result ? ` ${item.card.result}` : ""}
                  </Text>
                )}
              </View>
            );
          if (item.role === "note")
            return (
              <Text key={item.id} style={[s.small, soft]}>
                {item.text}
              </Text>
            );
          const done = shared.has(item.id) || sharedAnswers.includes(item.id);
          return (
            <View key={item.id} style={s.answer}>
              <View style={[s.bubble, s.them, { backgroundColor: t.onInk }]}>
                <Text style={[s.text, { color: t.ink }]}>{item.text}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={busy || done}
                onPress={() => void share(item)}
                hitSlop={8}
                style={[s.share, { borderColor: t.onInk, opacity: done ? 0.6 : 1 }]}
              >
                <Text style={[s.shareText, ink]}>{done ? "Shared ✓" : "Share to chat"}</Text>
              </Pressable>
            </View>
          );
        })}
        {busy && !shared.size ? <Text style={[s.small, soft]}>Thinking…</Text> : null}
      </ScrollView>
      {error ? <Text style={[s.small, { color: t.danger }]}>{error}</Text> : null}
      {!busy && !text ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {QUICK.map((q) => (
            <Pressable
              key={q}
              accessibilityRole="button"
              onPress={() => void ask(q)}
              style={[s.chip, { borderColor: t.onInk }]}
            >
              <Text style={[s.chipText, ink]}>{q}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={[s.box, { borderColor: t.onInk }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask about this chat or your lists…"
          placeholderTextColor={t.fg3}
          multiline
          maxLength={2000}
          accessibilityLabel="Ask your assistant"
          style={[s.input, ink]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask"
          disabled={!text.trim() || busy}
          onPress={() => void ask()}
          hitSlop={6}
          style={[s.send, { backgroundColor: t.accent, opacity: text.trim() && !busy ? 1 : 0.4 }]}
        >
          <Text style={{ color: t.onAccent, fontSize: 17, fontWeight: "800", lineHeight: 19 }}>↑</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  chips: { gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "700" },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15, fontWeight: "800" },
  about: { flexShrink: 1, fontSize: 12, fontWeight: "700" },
  list: { maxHeight: 460 },
  small: { fontSize: 13, lineHeight: 19 },
  bubble: { maxWidth: "86%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  mine: { alignSelf: "flex-end", borderBottomRightRadius: 6 },
  them: { alignSelf: "flex-start", borderBottomLeftRadius: 6 },
  text: { fontSize: 15, lineHeight: 21 },
  answer: { gap: 6, alignItems: "flex-start" },
  share: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, justifyContent: "center" },
  shareText: { fontSize: 13, fontWeight: "800" },
  live: { alignSelf: "stretch" },
  card: { borderRadius: radius.card, padding: 12, gap: 4 },
  cardTitle: { fontSize: 12, fontWeight: "800" },
  row: { flexDirection: "row", gap: 8, marginTop: 6 },
  grow: { flex: 1 },
  btn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 14, fontWeight: "800" },
  box: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    minHeight: 50,
    borderRadius: 25,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 16,
    paddingRight: 7,
    paddingVertical: 7,
  },
  input: { flex: 1, fontSize: 16, maxHeight: 110, paddingTop: 6, paddingBottom: 6 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
