// One chat with people (decision 2026-10-13 "Chats with people", from the approved mock-up):
// messages newest at the bottom, mine on the right in ink, others' on the left with their
// name in their colour, notes ("Dev added Meera") in the middle. Sending works offline: the
// message shows as "sending" and goes when there's a connection. Opening it marks it read.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "@assistant/cards/native";
import { sendChatMessage, useChat, type GroupMessage, type Pending } from "@/chats";
import { dropFailed } from "@/outbox";
import { SaveSheet } from "@/components/SaveSheet";
import { AskSheet } from "@/components/AskSheet";
import { AskEveryoneSheet, PollCard } from "@/components/Poll";
import { useSession } from "@/session";
import { colourFor, useTheme } from "@/theme";
import { Avatar, when } from "@/components/ChatBits";
import { ChatHome } from "@/components/ChatHome";
import { PeopleSheet } from "@/components/PeopleSheet";

type Item =
  | { kind: "day"; id: string; label: string }
  | { kind: "msg"; id: string; m: GroupMessage; first: boolean }
  | { kind: "pending"; id: string; p: Pending };

export default function Talk() {
  const { t, dark, colour } = useTheme();
  // My messages: ink on the light page; the deep indigo in the dark, so they stand apart.
  const mineBg = dark ? t.hero : t.ink;
  const mineFg = dark ? t.onHero : t.onInk;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // `message`: opened from a search hit, around that message (highlighted).
  const {
    id,
    message,
    q,
    tab: firstTab,
  } = useLocalSearchParams<{
    id: string;
    message?: string;
    q?: string;
    /** "home": open on the chat's home (a chat just started about a record). */
    tab?: string;
  }>();
  const { me } = useSession();
  const myId = me?.user.id ?? null;
  const { chat, pending, error, reload } = useChat(id ?? "", message || undefined);
  const [text, setText] = useState("");
  // The message being saved (the Save sheet is open for it).
  const [saving, setSaving] = useState<GroupMessage | null>(null);
  // The private assistant panel is open.
  const [asking, setAsking] = useState(false);
  // The "Ask everyone" sheet is open.
  const [polling, setPolling] = useState(false);
  // The chat or its home (decision 2026-10-14 "A home for each chat"), and the people sheet.
  const [tab, setTab] = useState<"chat" | "home">(firstTab === "home" ? "home" : "chat");
  const [people, setPeople] = useState(false);
  const list = useRef<FlatList<Item>>(null);

  // Newest at the bottom: the list is drawn upside down, so it opens at the latest message.
  const items = useMemo(() => {
    const out: Item[] = [];
    let lastDay = "";
    let lastAuthor: string | null = null;
    for (const m of chat?.messages ?? []) {
      const day = dayLabel(m.created_at);
      if (day !== lastDay) {
        out.push({ kind: "day", id: `d:${m.created_at.slice(0, 10)}:${m.id}`, label: day });
        lastDay = day;
        lastAuthor = null;
      }
      out.push({ kind: "msg", id: m.id, m, first: m.kind !== "person" || m.author_id !== lastAuthor });
      lastAuthor = m.kind === "person" ? m.author_id : null;
    }
    for (const p of pending) out.push({ kind: "pending", id: `p:${p.id}`, p });
    return out.reverse();
  }, [chat, pending]);

  // From a search hit: the hit is a piece of conversation starting at `message`; the ring goes
  // on the message in it that has the words searched for (else on its first message).
  const ring = { borderWidth: 2, borderColor: t.accent };
  const marked = useMemo(() => {
    const all = chat?.messages ?? [];
    const start = all.findIndex((m) => m.id === message);
    if (start < 0) return message;
    const words = (q ?? "").trim().toLowerCase();
    const piece = all.slice(start, start + 6).filter((m) => m.kind !== "note");
    return (words && piece.find((m) => m.text.toLowerCase().includes(words))?.id) || message;
  }, [chat, message, q]);
  const shownAt = useRef(false);
  useEffect(() => {
    if (!message || shownAt.current || !chat) return;
    const index = items.findIndex((x) => x.id === marked);
    if (index < 0) return;
    shownAt.current = true;
    setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }), 50);
  }, [message, marked, chat, items]);

  const go = () => {
    const body = text.trim();
    if (!body || !id) return;
    sendChatMessage(id, body);
    setText("");
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };
  useEffect(() => {
    if (!id) router.back();
  }, [id, router]);

  const subtitle = chat
    ? chat.direct
      ? "Chat for two"
      : ["You", ...chat.members.filter((m) => m.user_id !== myId).map((m) => m.name)].join(", ")
    : "";

  return (
    <View style={[s.root, { backgroundColor: t.page }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.root}>
        <View style={[s.column, { paddingTop: insets.top + 6 }]}>
          <View style={s.head}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => router.back()}
              style={[s.back, { backgroundColor: t.cell, shadowColor: t.shadow }]}
            >
              <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
            </Pressable>
            <Avatar name={chat?.name ?? "?"} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
                {chat?.name ?? ""}
              </Text>
              <Text style={[s.sub, { color: t.fg2 }]} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            {chat ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="People and admins"
                onPress={() => setPeople(true)}
                style={[s.back, { backgroundColor: t.cell, shadowColor: t.shadow }]}
              >
                <Text style={{ color: t.fg, fontSize: 18, fontWeight: "800", lineHeight: 20 }}>···</Text>
              </Pressable>
            ) : null}
          </View>
          {chat ? (
            <View style={[s.tabs, { backgroundColor: t.fill }]} accessibilityRole="tablist">
              {(["chat", "home"] as const).map((x) => (
                <Pressable
                  key={x}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === x }}
                  onPress={() => setTab(x)}
                  style={[s.tab, tab === x && { backgroundColor: t.accentSoft }]}
                >
                  <Text style={[s.tabText, { color: tab === x ? t.accent : t.fg2 }]}>
                    {x === "chat" ? "Chat" : "Home"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {error ? <Text style={[s.note, { color: t.fg2 }]}>{error}</Text> : null}
          {!chat && !error ? <ActivityIndicator color={t.fg3} style={{ marginTop: 40 }} /> : null}
          {chat && tab === "home" ? (
            <ChatHome
              chat={chat}
              myId={myId}
              onStarted={() => void reload()}
              onAsk={chat.can_ask ? () => setAsking(true) : null}
            />
          ) : null}
          {tab === "chat" ? (
            <>
              <FlatList
                ref={list}
                inverted
                data={items}
                onScrollToIndexFailed={(info) =>
                  setTimeout(
                    () =>
                      list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false }),
                    150,
                  )
                }
                keyExtractor={(x) => x.id}
                style={s.list}
                contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 4 }}
                keyboardShouldPersistTaps="handled"
                ListFooterComponent={
                  chat && !chat.messages.some((m) => m.kind === "person") ? (
                    <Text style={[s.hello, { color: t.fg2 }]}>
                      {chat.direct
                        ? `This is your chat with ${chat.name}. Only the two of you see it. Hold any message to save it to your lists.`
                        : `Only the people in ${chat.name} see what's written here. Hold any message to save it to your lists.`}
                    </Text>
                  ) : null
                }
                renderItem={({ item }) => {
                  if (item.kind === "day") return <Text style={[s.day, { color: t.fg3 }]}>{item.label}</Text>;
                  if (item.kind === "pending")
                    return (
                      <Pressable
                        accessibilityRole={item.p.failed ? "button" : undefined}
                        accessibilityLabel={item.p.failed ? "Not sent. Tap to remove." : undefined}
                        disabled={!item.p.failed}
                        onPress={() => dropFailed(item.p.id)}
                        style={[
                          s.bubble,
                          s.mine,
                          { backgroundColor: mineBg, opacity: item.p.failed ? 1 : 0.7 },
                        ]}
                      >
                        <Text style={[s.text, { color: mineFg }]}>
                          {item.p.poll ? `Asking everyone: ${item.p.text}` : item.p.text}
                        </Text>
                        <Text style={[s.meta, { color: item.p.failed ? t.danger : mineFg }]}>
                          {item.p.failed ? `Not sent: ${item.p.failed} · tap to remove` : "Sending…"}
                        </Text>
                      </Pressable>
                    );
                  const m = item.m;
                  if (m.kind === "note")
                    return (
                      <Text style={[s.notice, { color: t.fg2, backgroundColor: t.fill }]}>{m.text}</Text>
                    );
                  const poll = m.kind === "poll" ? chat?.polls?.[m.id] : undefined;
                  if (poll)
                    return (
                      <PollCard
                        groupId={id ?? ""}
                        messageId={m.id}
                        poll={poll}
                        asker={m.author}
                        mine={m.author_id === myId}
                        me={me?.user.name ?? ""}
                        highlight={m.id === marked}
                        onLongPress={() => setSaving(m)}
                        saved={chat?.saved?.[m.id]}
                      />
                    );
                  const mine = m.kind === "person" && m.author_id === myId;
                  const saved = chat?.saved?.[m.id];
                  const savedNote = saved ? (
                    <Text style={[s.saved, { color: t.good }, mine && s.savedMine]}>Saved to {saved} ✓</Text>
                  ) : null;
                  // Hold any message to save it to your lists (only you see the proposal).
                  const hold = {
                    onLongPress: () => setSaving(m),
                    delayLongPress: 350,
                    accessibilityHint: "Hold to save it to your lists",
                    accessibilityActions: [{ name: "longpress" as const, label: "Save" }],
                    onAccessibilityAction: () => setSaving(m),
                  };
                  if (mine)
                    return (
                      <Animated.View entering={FadeInDown.duration(180)} style={s.mineWrap}>
                        <Pressable
                          {...hold}
                          style={[s.bubble, s.mine, { backgroundColor: mineBg }, m.id === marked && ring]}
                        >
                          <Text style={[s.text, { color: mineFg }]}>{m.text}</Text>
                          <Text style={[s.meta, { color: mineFg }]}>{when(m.created_at)}</Text>
                        </Pressable>
                        {savedNote}
                      </Animated.View>
                    );
                  const c = colour(colourFor(m.author));
                  return (
                    <Animated.View
                      entering={FadeInDown.duration(180)}
                      style={[s.themCol, item.first && { marginTop: 6 }]}
                    >
                      <View style={s.theirs}>
                        {!chat?.direct || m.kind === "assistant" ? (
                          item.first ? (
                            m.kind === "assistant" ? (
                              <View style={[s.gsAvatar, { backgroundColor: t.hero }]}>
                                <Text style={[s.gsAvatarText, { color: t.onHero }]}>Gs</Text>
                              </View>
                            ) : (
                              <Avatar name={m.author} size={28} />
                            )
                          ) : (
                            <View style={{ width: 28 }} />
                          )
                        ) : null}
                        <Pressable
                          {...hold}
                          style={[s.bubble, s.them, { backgroundColor: t.cell }, m.id === marked && ring]}
                        >
                          {(!chat?.direct || m.kind === "assistant") && item.first ? (
                            <Text style={[s.author, { color: m.kind === "assistant" ? t.accent : c }]}>
                              {m.author}
                            </Text>
                          ) : null}
                          <Text style={[s.text, { color: t.fg }]}>{m.text}</Text>
                          <Text style={[s.meta, { color: t.fg3 }]}>{when(m.created_at)}</Text>
                        </Pressable>
                      </View>
                      {saved ? <View style={!chat?.direct && s.savedIndent}>{savedNote}</View> : null}
                    </Animated.View>
                  );
                }}
              />
              {message ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.replace({ pathname: "/talk", params: { id: id ?? "" } })}
                  style={[s.latest, { backgroundColor: t.fg }]}
                >
                  <Text style={[s.latestText, { color: t.page }]}>Latest messages ↓</Text>
                </Pressable>
              ) : null}
              <View style={[s.composer, { paddingBottom: insets.bottom + 10 }]}>
                {/* + : ask everyone a question (Yes / No / Maybe, or your own answers). */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ask everyone a question"
                  onPress={() => setPolling(true)}
                  style={[s.plus, { backgroundColor: t.cell }]}
                >
                  <Text style={{ color: t.fg, fontSize: 24, fontWeight: "700", lineHeight: 26 }}>+</Text>
                </Pressable>
                <View style={[s.box, { backgroundColor: t.cell }]}>
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    placeholder="Message"
                    placeholderTextColor={t.fg3}
                    multiline
                    maxLength={2000}
                    accessibilityLabel="Message"
                    style={[s.input, { color: t.fg }]}
                  />
                  {chat?.can_ask ? (
                    // Ask my own assistant (only I see it), as in the mock-up.
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Ask your assistant privately"
                      onPress={() => setAsking(true)}
                      hitSlop={6}
                      style={[s.gs, { backgroundColor: t.accentSoft }]}
                    >
                      <Text style={[s.gsText, { color: t.accent }]}>Gs</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send"
                    disabled={!text.trim()}
                    onPress={go}
                    hitSlop={6}
                    style={[s.send, { backgroundColor: t.accent, opacity: text.trim() ? 1 : 0.4 }]}
                  >
                    <Text style={{ color: t.onAccent, fontSize: 17, fontWeight: "800", lineHeight: 19 }}>
                      ↑
                    </Text>
                  </Pressable>
                </View>
              </View>
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
      {chat ? (
        <PeopleSheet
          chat={chat}
          myId={myId}
          open={people}
          onClose={() => setPeople(false)}
          onChanged={() => void reload()}
        />
      ) : null}
      <AskEveryoneSheet
        groupId={id ?? ""}
        cards={chat?.cards ?? []}
        canAct={
          !!chat &&
          (chat.direct ||
            chat.members.some((m) => m.user_id === myId && m.role === "owner") ||
            chat.cards.some((c) => c.owner_id === myId))
        }
        open={polling}
        onClose={() => setPolling(false)}
      />
      <AskSheet
        groupId={id ?? ""}
        chatName={chat?.name ?? ""}
        open={asking}
        onClose={() => setAsking(false)}
        onShared={() => void reload()}
        sharedAnswers={chat?.shared_answers ?? []}
      />
      <SaveSheet
        groupId={id ?? ""}
        message={saving}
        canAsk={chat?.can_ask ?? false}
        onClose={() => {
          setSaving(null);
          void reload();
        }}
      />
    </View>
  );
}

/** "Today", "Yesterday", or "Mon 12 Oct" (India time). */
function dayLabel(iso: string): string {
  const ist = (ms: number) => new Date(ms + 330 * 60_000);
  const d = ist(Date.parse(iso));
  const now = ist(Date.now());
  const key = (x: Date) => x.toISOString().slice(0, 10);
  if (key(d) === key(now)) return "Today";
  if (key(d) === key(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingBottom: 8 },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  title: { fontSize: 17, fontWeight: "800" },
  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 22, marginHorizontal: 12, marginBottom: 6 },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0,
  },
  tabText: { fontSize: 14, fontWeight: "800" },
  sub: { fontSize: 12 },
  note: { fontSize: 13, paddingHorizontal: 20 },
  list: { flex: 1 },
  hello: { fontSize: 13, textAlign: "center", paddingHorizontal: 30, paddingVertical: 20, lineHeight: 19 },
  day: { alignSelf: "center", fontSize: 12, fontWeight: "700", paddingVertical: 8 },
  notice: {
    alignSelf: "center",
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
    marginVertical: 4,
  },
  theirs: { flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "86%" },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, gap: 2, maxWidth: "82%" },
  mine: { alignSelf: "flex-end", borderBottomRightRadius: 6, maxWidth: "100%" },
  them: { flexShrink: 1, maxWidth: "100%", borderBottomLeftRadius: 6 },
  mineWrap: { alignSelf: "flex-end", maxWidth: "82%", gap: 3 },
  themCol: { gap: 3 },
  savedIndent: { marginLeft: 36 },
  saved: { fontSize: 12, fontWeight: "700", paddingHorizontal: 6 },
  savedMine: { alignSelf: "flex-end" },
  author: { fontSize: 12, fontWeight: "800" },
  text: { fontSize: 16, lineHeight: 22 },
  meta: { fontSize: 11, opacity: 0.6, alignSelf: "flex-end" },
  latest: {
    alignSelf: "center",
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    justifyContent: "center",
    marginTop: 6,
  },
  latestText: { fontSize: 13, fontWeight: "800" },
  composer: { paddingHorizontal: 12, paddingTop: 6, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  plus: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  box: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    minHeight: 50,
    borderRadius: 25,
    paddingLeft: 16,
    paddingRight: 7,
    paddingVertical: 7,
  },
  input: { flex: 1, fontSize: 16, maxHeight: 120, paddingTop: 6, paddingBottom: 6 },
  gsAvatar: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  gsAvatarText: { fontSize: 11, fontWeight: "800", fontStyle: "italic" },
  gs: { height: 36, paddingHorizontal: 10, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  gsText: { fontSize: 14, fontWeight: "800", fontStyle: "italic" },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
