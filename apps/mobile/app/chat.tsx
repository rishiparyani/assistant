// The chat, one pull away from the home. Opened from a card it knows which one (and a card's
// menu can start the message: "Share this with "). Confirm cards are answered here. Messages
// typed offline wait in the outbox and go when the connection is back.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, StyleSheet, View, type TextInput as RNTextInput } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  Boundary,
  Markdown,
  Tap,
  Text,
  TextInput,
  ThinkingDots,
  motion,
  type,
} from "@assistant/cards/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ulid,
  type ChatItem,
  type ChatSummary,
  type ChatView,
  type CollectionView,
  type HistoryItem,
  type LiveRef,
} from "@assistant/shared";
import { Changes, fetchChanges } from "@/components/Changes";
import { LiveCard, LiveRecords } from "@/components/LiveCard";
import { ImportSheet, uploadedWords } from "@/components/ImportSheet";
import { SetupEditSheet } from "@/components/SetupEditSheet";
import { ChatsSheet } from "@/components/ChatsSheet";
import { ModelSheet, pickLabel, useModelPick } from "@/components/ModelPicker";
import { ApiError, isOffline, request } from "@/api";
import { send } from "@/outbox";
import { useLive } from "@/live-socket";
import { radius, useTheme } from "@/theme";
import { useKeyboardRoom } from "@/keyboard";
import { useSession } from "@/session";
import { rememberChat } from "@/last-chat";

const MAIN = "main";

/** What the list draws: the chat's items, with records the assistant showed in one go as one widget. */
type Shown = ChatItem | { id: string; role: "records"; created_at: string; refs: LiveRef[] };
function groupRecords(items: ChatItem[]): Shown[] {
  const out: Shown[] = [];
  for (const i of items) {
    const ref = i.role === "live" && i.live?.kind === "record" ? i.live : null;
    const last = out[out.length - 1];
    if (
      ref &&
      last?.role === "records" &&
      last.refs[0]?.kind === "record" &&
      last.refs[0].collection_id === ref.collection_id
    ) {
      last.refs.push(ref);
      continue;
    }
    out.push(ref ? { id: `records:${i.id}`, role: "records", created_at: i.created_at, refs: [ref] } : i);
  }
  return out;
}
const enc = encodeURIComponent;
const SUGGEST = [
  "What's due this week?",
  "Spent 450 on chai",
  "Remind me to pay the electricity bill at 6",
  "Pin my expenses to the home",
];

export default function Chat() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    card,
    ask,
    id,
    send: sendNow,
    space,
  } = useLocalSearchParams<{
    card?: string;
    ask?: string;
    id?: string;
    send?: string;
    /** Open the current chat of this space (decision 2026-10-16 "Spaces"). */
    space?: string;
  }>();
  const [view, setView] = useState<ChatView | null>(null);
  // Which chat is open (decision 2026-10-16 "Chats like Claude"): the one asked for, else the
  // current one (the server picks: the latest if used in the last two hours, else a new one).
  const [chatId, setChatId] = useState<string | null>(id ?? null);
  // Kept on the device, so the home's empty-bar button comes back here.
  const { me } = useSession();
  const myId = me?.user.id ?? null;
  useEffect(() => {
    if (myId && chatId) rememberChat(myId, chatId);
  }, [myId, chatId]);
  const [showChats, setShowChats] = useState(false);
  // Auto, Quick or Careful, kept on the device (decision 2026-10-18 "Pick the model").
  const [pick, setPick] = useModelPick();
  const [showModel, setShowModel] = useState(false);
  // The very first chat ever gets the "tell me about your week" opening; later new chats a line.
  const [firstEver, setFirstEver] = useState<boolean | null>(null);
  // The newest answer gets 👍 / 👎 (not one waiting behind a newer message of mine).
  const lastReply = (() => {
    const items = view?.items ?? [];
    const at = items.findLastIndex((i) => i.role === "assistant" && !!i.text);
    return at >= 0 && !items.slice(at + 1).some((i) => i.role === "user") ? items[at]!.id : null;
  })();
  // From the home's bar with send=1, the words go the moment the chat is open (not just typed in).
  const sendAtOnce = !!ask && sendNow === "1";
  const sentAtOnce = useRef(false);
  const [text, setText] = useState(sendAtOnce ? "" : (ask ?? ""));
  // The box's height follows what's typed (one line to about five), measured the same way on
  // every platform rather than left to the platform's own idea of a text area.
  const [typedHeight, setTypedHeight] = useState(0);
  useEffect(() => {
    // Back to one line once the box is empty (the web doesn't always report the shrink).
    if (!text) setTypedHeight(0);
  }, [text]);
  const [busy, setBusy] = useState(false);
  // What the assistant is doing right now (decision 2026-10-15 "Feel: the ChatGPT bar"): the
  // server says over the live socket as it thinks and runs each tool; without the socket the
  // words still move on their own.
  const [status, setStatus] = useState<string | null>(null);
  useLive((m) => {
    if (m.type !== "assistant_progress" || m.chat !== chatId) return;
    setStatus(m.step === "done" ? null : typeof m.label === "string" ? m.label : "Thinking…");
  });
  useEffect(() => {
    if (!busy) {
      setStatus(null);
      return;
    }
    setStatus("Thinking…");
    const later = setTimeout(() => setStatus((x) => (x === "Thinking…" ? "Still thinking…" : x)), 9000);
    return () => clearTimeout(later);
  }, [busy]);
  const [note, setNote] = useState("");
  // What the last reply changed (shown under it, with Undo), and the full list (the sheet).
  const [changed, setChanged] = useState<HistoryItem[]>([]);
  const [showChanges, setShowChanges] = useState(false);
  // A CSV for the assistant to put somewhere (decision 2026-10-15 "Toward Excel", 3).
  const [showImport, setShowImport] = useState(false);
  // A setup card changed by hand before Confirm (decision 2026-10-15 "Chat makes, screens can fix").
  const [editing, setEditing] = useState<ChatItem["card"] | null>(null);
  const list = useRef<FlatList<Shown>>(null);
  // The list is upside down (the owner, 2026-10-16: "it opens at the middle", "it scrolled up
  // and hid my message"): the newest message is the anchor, so it opens at the end by
  // construction and a new message appears at the bottom without any scrolling code; reading
  // older ones, the list stays put (maintainVisibleContentPosition), and when the person is
  // near the bottom it follows.
  // Items from before this screen opened don't animate in; new ones rise into place.
  const openedAt = useRef(Date.now());
  const shownItems = useMemo(() => groupRecords(view?.items ?? []), [view]);
  const newestFirst = useMemo(() => [...shownItems].reverse(), [shownItems]);
  // A question with answers to tap: what was answered (the next thing the person said), if anything.
  const answers = useMemo(() => {
    const out = new Map<string, string | null>();
    const all = view?.items ?? [];
    all.forEach((it, i) => {
      if (it.role !== "choices") return;
      out.set(it.id, all.slice(i + 1).find((x) => x.role === "user")?.text ?? null);
    });
    return out;
  }, [view]);
  // Cards still waiting for a tap, oldest first (owner, 2026-10-18: four or five in a row meant
  // scrolling up to each one, then down to see what they made): one bar above the box does all.
  const waiting = useMemo(
    () => (view?.items ?? []).filter((i) => i.role === "card" && i.card?.status === "waiting"),
    [view],
  );
  const box = useRef<RNTextInput>(null);
  // Room for the keyboard, measured when it comes up (this sheet may still be sliding in when
  // it first lays out, opened from Help or a card).
  const room = useKeyboardRoom();
  // Opened from a card: the first message from this sheet names it, whatever the chat holds.
  const attached = useRef(false);
  // The person's collections, once for every live card in the chat.
  const collections = useRef<Promise<CollectionView[]> | null>(null);
  const getCollections = useCallback(() => {
    collections.current ??= request<CollectionView[]>("GET", "/api/collections").catch((e: unknown) => {
      collections.current = null;
      throw e;
    });
    return collections.current;
  }, []);

  const openChat = useCallback(
    (which: string | null) => {
      // Nothing can be sent until the chat is known (never to the one just left, never to "current").
      setChatId(null);
      setView(null);
      setChanged([]);
      openedAt.current = Date.now();
      const path = which
        ? `/api/chats/${which}`
        : `/api/chats/current${space ? `?space=${encodeURIComponent(space)}` : ""}`;
      request<ChatView>("GET", path)
        .then((v) => {
          setChatId(v.id);
          setView(v);
          setNote("");
        })
        .catch((e: unknown) =>
          setNote(
            isOffline(e)
              ? "Offline: messages wait and go when you're back."
              : e instanceof Error
                ? e.message
                : String(e),
          ),
        );
    },
    [space],
  );
  useEffect(() => openChat(id ?? null), [id, openChat]);
  useEffect(() => {
    request<ChatSummary[]>("GET", "/api/chats")
      .then((l) => setFirstEver(l.filter((c) => c.id !== MAIN).length <= 1))
      .catch(() => setFirstEver(false));
  }, []);
  // online-only: a new chat is a row in the person's list on the server.
  const newChat = async () => {
    if (busy) return;
    try {
      // The id is made here, so a retry after a lost reply lands on the same chat (rule 8).
      // A new chat stays in the space of the one on screen (or the one asked for).
      const inSpace = view?.space_id ?? space;
      const v = await request<ChatView>("POST", "/api/chats", {
        id: ulid(),
        ...(inSpace ? { space: inSpace } : {}),
      });
      setChatId(v.id);
      setView(v);
      setChanged([]);
      setNote("");
      setFirstEver(false);
      openedAt.current = Date.now();
    } catch (e) {
      setNote(isOffline(e) ? "A new chat needs a connection." : e instanceof Error ? e.message : String(e));
    }
  };

  const say = async (raw: string) => {
    const body = raw.trim();
    if (!body || busy || !chatId) return;
    const msg = card && !attached.current ? `About "${card}": ${body}` : body;
    attached.current = true;
    setText("");
    const mine: ChatItem = {
      id: `local-${Date.now()}`,
      role: "user",
      text: msg,
      created_at: new Date().toISOString(),
    };
    setView((v) => (v ? { ...v, items: [...v.items, mine] } : v));
    // The person's own message is what they want to see: to the bottom whatever they were reading.
    list.current?.scrollToOffset({ offset: 0, animated: true });
    setBusy(true);
    const sentAt = new Date().toISOString();
    try {
      const next = await request<ChatView>("POST", `/api/chats/${chatId}`, { text: msg, model: pick });
      setView(next);
      setNote("");
      // The answer to what was just sent is what the person wants to see, wherever they were.
      setTimeout(() => list.current?.scrollToOffset({ offset: 0, animated: true }), 60);
      // What this reply changed, from the audit log, with Undo.
      fetchChanges(5)
        // Only this person's changes since the message went (another person's work in the
        // same space while the assistant was answering isn't this reply's).
        .then((items) => setChanged(items.filter((i) => i.at >= sentAt && i.by === "you" && i.undoable)))
        .catch(() => undefined);
    } catch (e) {
      if (isOffline(e)) {
        send({
          kind: "assistant.message",
          method: "POST",
          path: `/api/chats/${chatId}`,
          body: { text: msg, model: pick },
          label: "Message to the assistant",
        });
        setNote("Waiting to send: it goes when you're back online.");
      } else setNote(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!view || !sendAtOnce || sentAtOnce.current) return;
    sentAtOnce.current = true;
    // say is this render's; the send happens once, when the chat first shows.
    void say(ask!);
  }, [view, sendAtOnce]);

  // online-only: a confirm card runs (or drops) its action on the server, once; a setup card
  // may run with the person's own changes to it.
  const answer = async (actionId: string, what: "confirm" | "cancel", args?: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      setView(
        await request<ChatView>(
          "POST",
          `/api/chats/${chatId ?? MAIN}/actions/${enc(actionId)}/${what}`,
          args ? { args } : {},
        ),
      );
      setEditing(null);
      setNote("");
      if (!waiting.some((w) => w.card!.action_id !== actionId)) toEnd();
    } catch (e) {
      setNote(isOffline(e) ? "Confirming needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  /** The newest message, where what the cards made shows up. */
  const toEnd = () => setTimeout(() => list.current?.scrollToOffset({ offset: 0, animated: true }), 60);
  // online-only: every waiting card runs its action on the server, once, in the order proposed
  // (a list before the view that shows it); the first one that fails stops the rest.
  const confirmAll = async () => {
    if (busy || !waiting.length) return;
    setBusy(true);
    try {
      for (const w of waiting) {
        const id = w.card!.action_id;
        const next = await request<ChatView>(
          "POST",
          `/api/chats/${chatId ?? MAIN}/actions/${enc(id)}/confirm`,
          {},
        );
        setView(next);
        // A card that couldn't be done comes back marked "failed" (not as an error): the ones
        // after it may need it, so they wait.
        if (next.items.find((i) => i.card?.action_id === id)?.card?.status !== "done") break;
      }
      setNote("");
      toEnd();
    } catch (e) {
      setNote(isOffline(e) ? "Confirming needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  /** Up to the first card still waiting, to read them before confirming. */
  const review = () => {
    const index = newestFirst.findIndex((i) => i.id === waiting[0]?.id);
    if (index >= 0) list.current?.scrollToIndex({ index, viewPosition: 0.9, animated: true });
  };

  return (
    <View style={[s.root, { backgroundColor: t.page }]}>
      <View style={[s.root, { paddingBottom: room }]}>
        <View style={s.head}>
          {/* Between Changes and Done: a long card name is cut short, "about this card" under it. */}
          <View style={s.titleBox}>
            <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
              {card ? card : view && view.id !== MAIN && view.title !== "New chat" ? view.title : "Gigspree"}
            </Text>
            {/* Under the title: the model (tap to change it) and what the chat is about. */}
            <Tap
              accessibilityRole="button"
              accessibilityLabel={`Model: ${pickLabel(pick)}. Change`}
              onPress={() => setShowModel(true)}
              hitSlop={{ top: 6, bottom: 12, left: 12, right: 12 }}
              style={s.pick}
            >
              <Text style={[s.ctx, { color: t.accent, fontWeight: "700" }]}>{pickLabel(pick)} ▾</Text>
              {card || view?.space_name ? (
                <Text style={[s.ctx, { color: t.fg2, flexShrink: 1 }]} numberOfLines={1}>
                  {card ? " · about this card" : ` · in ${view!.space_name}`}
                </Text>
              ) : null}
            </Tap>
          </View>
          <Tap
            accessibilityRole="button"
            accessibilityLabel="What changed"
            onPress={() => setShowChanges(true)}
            style={s.changes}
            hitSlop={10}
          >
            <Text style={[type.label, { color: t.accent, fontWeight: "600" }]}>Changes</Text>
          </Tap>
          <View style={s.tools}>
            <Tap
              accessibilityRole="button"
              accessibilityLabel="Chats"
              onPress={() => setShowChats(true)}
              scale={0.9}
              hitSlop={6}
              style={[s.tool, { backgroundColor: t.cell, borderColor: t.hair }]}
            >
              <Text style={{ color: t.fg, fontSize: 15, lineHeight: 17, fontWeight: "700" }}>☰</Text>
            </Tap>
            <Tap
              accessibilityRole="button"
              accessibilityLabel="New chat"
              onPress={() => void newChat()}
              scale={0.9}
              hitSlop={6}
              haptic="selection"
              style={[s.tool, { backgroundColor: t.cell, borderColor: t.hair }]}
            >
              <Text style={{ color: t.fg, fontSize: 16, lineHeight: 18, fontWeight: "700" }}>✎</Text>
            </Tap>
          </View>
          <Tap accessibilityRole="button" onPress={() => router.back()} style={s.done} hitSlop={10}>
            <Text style={[type.label, { color: t.accent }]}>Done</Text>
          </Tap>
        </View>
        <ModelSheet
          open={showModel}
          pick={pick}
          carefulOn={view?.smart_available !== false}
          onPick={setPick}
          onClose={() => setShowModel(false)}
        />
        <ChatsSheet
          open={showChats}
          current={chatId}
          onClose={() => setShowChats(false)}
          onOpen={(which) => openChat(which)}
          onNew={() => void newChat()}
        />
        <FlatList
          ref={list}
          inverted={newestFirst.length > 0}
          extraData={[lastReply, busy]}
          data={newestFirst}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 14, gap: 4 }}
          // Near the bottom, a new message pulls the list down to it; higher up, nothing moves.
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 120 }}
          // A card far up isn't measured yet: get near it, then go to it.
          onScrollToIndexFailed={(info) => {
            list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(
              () => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.9, animated: true }),
              120,
            );
          }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const fresh = item.id.startsWith("local-") || Date.parse(item.created_at) > openedAt.current;
            const bubble = (
              <Bubble
                item={item}
                rate={item.id === lastReply}
                onAnswer={answer}
                onEdit={(card) => setEditing(card)}
                busy={busy}
                collections={getCollections}
                onAsk={(title) => setText((t) => t || `About "${title}": `)}
                answered={answers.get(item.id)}
                onPick={(label) => void say(label)}
                onOther={() => box.current?.focus()}
              />
            );
            const safe = <Boundary where="chat item">{bubble}</Boundary>;
            // In the upside-down list a cell's "down" is up on screen: new messages rise in.
            return fresh ? (
              <Animated.View entering={FadeInDown.duration(motion.enter).springify().damping(18)}>
                {safe}
              </Animated.View>
            ) : (
              safe
            );
          }}
          // Upside down, the header is the visual bottom: the thinking bubble sits under the newest message.
          ListHeaderComponent={
            busy && view?.items.length ? (
              <Animated.View
                entering={FadeIn.duration(motion.fade)}
                style={[s.bub, s.them, s.thinking, { backgroundColor: t.bubbleThem, borderColor: t.hair }]}
              >
                <ThinkingDots />
                {status ? (
                  <Animated.Text
                    key={status}
                    entering={FadeIn.duration(motion.fade)}
                    style={[type.caption, { color: t.fg2 }]}
                    accessibilityLiveRegion="polite"
                  >
                    {status}
                  </Animated.Text>
                ) : null}
              </Animated.View>
            ) : null
          }
          ListEmptyComponent={
            view && !note ? (
              firstEver !== false ? (
                // The first run (home-first.md §2 point 15): a conversation about the week.
                <View style={[s.bub, s.them, { backgroundColor: t.cell, borderColor: t.hair, marginTop: 8 }]}>
                  <Text style={[s.bubText, { color: t.fg }]}>
                    Hi! Tell me about your week: what you do, what you keep forgetting, what money moves. I'll
                    start the lists you need, each with a card on your home.
                  </Text>
                </View>
              ) : (
                // A fresh chat (ChatGPT's way): one line, the ideas below, the box ready.
                <Animated.View entering={FadeIn.duration(motion.enter)} style={s.fresh}>
                  <Text style={[type.title, { color: t.fg, textAlign: "center" }]}>
                    What can I help with?
                  </Text>
                </Animated.View>
              )
            ) : (
              <Text style={[s.sys, { color: t.fg2 }]}>{note || "Loading…"}</Text>
            )
          }
        />
        {changed.length ? (
          <Changes items={changed} inline onChange={setChanged} onClose={() => setChanged([])} />
        ) : null}
        {note && view?.items.length ? <Text style={[s.sys, { color: t.fg2 }]}>{note}</Text> : null}
        {waiting.length > 1 ? (
          <Animated.View
            entering={FadeInDown.duration(motion.enter)}
            style={[s.waitBar, { backgroundColor: t.cell, borderColor: t.hair }]}
          >
            <Text style={[type.label, { color: t.fg, flex: 1, fontSize: 14 }]} numberOfLines={2}>
              {waiting.length} changes to confirm
            </Text>
            <Tap
              accessibilityRole="button"
              accessibilityLabel="Show the first one"
              disabled={busy}
              onPress={review}
              style={[s.answer, { backgroundColor: t.fill, paddingHorizontal: 14 }]}
            >
              <Text style={[type.label, { color: t.fg, fontSize: 14, fontWeight: "600" }]}>Review</Text>
            </Tap>
            <Tap
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void confirmAll()}
              haptic="light"
              style={[s.answer, { backgroundColor: t.accent, paddingHorizontal: 14 }]}
            >
              <Text style={[type.label, { color: t.onAccent, fontSize: 14 }]}>Confirm all</Text>
            </Tap>
          </Animated.View>
        ) : null}
        {showChanges ? <Changes onClose={() => setShowChanges(false)} /> : null}
        {/* Ideas to start with, only until the conversation has begun (ChatGPT's way). */}
        {!view?.items.length ? (
          <FlatList
            horizontal
            data={SUGGEST}
            keyExtractor={(x) => x}
            showsHorizontalScrollIndicator={false}
            style={s.chips}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 6, paddingVertical: 6 }}
            renderItem={({ item }) => (
              <Tap
                accessibilityRole="button"
                onPress={() => say(item)}
                disabled={busy || !chatId}
                haptic="selection"
                style={[s.chip, { backgroundColor: t.cell, borderColor: t.sep }]}
              >
                <Text style={[type.caption, { color: t.accent, fontSize: 13.5 }]}>{item}</Text>
              </Tap>
            )}
          />
        ) : null}
        {editing ? (
          <SetupEditSheet
            tool={editing.tool}
            args={editing.args ?? null}
            busy={busy}
            onClose={() => setEditing(null)}
            onConfirm={(args) => void answer(editing.action_id, "confirm", args)}
          />
        ) : null}
        <ImportSheet
          open={showImport}
          onClose={() => setShowImport(false)}
          onUploaded={(file) => {
            setShowImport(false);
            void say(uploadedWords(file));
          }}
        />
        <View style={[s.compose, { paddingBottom: room ? 8 : insets.bottom + 8 }]}>
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Add a CSV file"
            onPress={() => setShowImport(true)}
            disabled={busy}
            scale={0.9}
            style={[s.attach, { borderColor: t.sep, backgroundColor: t.cell }]}
          >
            <Text style={{ color: t.fg2, fontWeight: "800", fontSize: 20, lineHeight: 22 }}>+</Text>
          </Tap>
          <View style={[s.inputBox, { backgroundColor: t.cell, borderColor: t.sep }]}>
            <TextInput
              ref={box}
              autoFocus={!!ask}
              accessibilityLabel="Message Gigspree"
              placeholder={card ? `Ask about ${card}` : "Ask, add or arrange"}
              placeholderTextColor={t.fg2}
              value={text}
              onChangeText={setText}
              onSubmitEditing={() => say(text)}
              returnKeyType="send"
              submitBehavior="submit"
              multiline
              // The phone sizes a growing box itself, up to maxHeight, then it scrolls inside (an
              // explicit height from onContentSizeChange stayed one line on the iPhone, owner
              // 2026-10-17); the web needs its height set.
              onContentSizeChange={
                Platform.OS === "web" ? (e) => setTypedHeight(e.nativeEvent.contentSize.height) : undefined
              }
              style={[
                s.input,
                type.body,
                { color: t.fg },
                Platform.OS === "web" ? { height: Math.min(110, Math.max(22, typedHeight)) } : null,
              ]}
            />
          </View>
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: busy || !chatId || !text.trim() }}
            onPress={() => say(text)}
            disabled={busy || !chatId || !text.trim()}
            scale={0.88}
            haptic="light"
            style={[s.send, { backgroundColor: t.accent }]}
          >
            <Text style={{ color: t.onAccent, fontWeight: "800", fontSize: 18, lineHeight: 20 }}>↑</Text>
          </Tap>
        </View>
      </View>
    </View>
  );
}

// 👍 / 👎 given in this session, by message (only the rating goes to the server).
const rated = new Map<string, "good" | "bad">();

/** 👍 / 👎 under the newest answer: a count for the app team, nothing about the answer. */
function Rate({ id }: { id: string }) {
  const { t } = useTheme();
  const [mine, setMine] = useState(rated.get(id) ?? null);
  // online-only: a rating is only a count; with no connection it's simply not sent.
  const vote = (rating: "good" | "bad") => {
    if (mine) return;
    rated.set(id, rating);
    setMine(rating);
    request("POST", "/api/chat/feedback", { rating }).catch(() => {
      rated.delete(id);
      setMine(null);
    });
  };
  return (
    <View style={s.rate}>
      {(["good", "bad"] as const).map((r) => (
        <Tap
          key={r}
          accessibilityRole="button"
          accessibilityLabel={r === "good" ? "Good answer" : "Bad answer"}
          accessibilityState={{ selected: mine === r, disabled: !!mine }}
          disabled={!!mine}
          onPress={() => vote(r)}
          haptic="selection"
          scale={0.85}
          style={[s.rateBtn, mine === r && { backgroundColor: t.accentSoft }]}
        >
          <Text style={{ fontSize: 16, opacity: mine && mine !== r ? 0.3 : 0.8 }}>
            {r === "good" ? "👍" : "👎"}
          </Text>
        </Tap>
      ))}
      {mine ? <Text style={[s.rateNote, { color: t.fg3 }]}>Thanks</Text> : null}
    </View>
  );
}

function Bubble({
  item,
  rate,
  onAnswer,
  onEdit,
  busy,
  collections,
  onAsk,
  answered,
  onPick,
  onOther,
}: {
  item: Shown;
  /** The newest answer: show 👍 / 👎 under it. */
  rate?: boolean;
  onAnswer: (actionId: string, what: "confirm" | "cancel") => void;
  /** A setup card: change it by hand before Confirm. */
  onEdit?: (card: NonNullable<ChatItem["card"]>) => void;
  busy: boolean;
  collections: () => Promise<CollectionView[]>;
  onAsk: (title: string) => void;
  /** A question with answers to tap: what the person answered (undefined/null: not yet). */
  answered?: string | null;
  onPick?: (label: string) => void;
  /** "Other…": type your own answer. */
  onOther?: () => void;
}) {
  const { t } = useTheme();
  if (item.role === "choices" && item.choices) {
    const open = answered == null;
    return (
      <View style={[s.inline, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.choiceQ, { color: t.fg }]}>{item.choices.question}</Text>
        {item.choices.options.map((o, i) => {
          const picked = !open && answered === o.label;
          const row = [
            s.choice,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
            !open && !picked && { opacity: 0.45 },
          ];
          const words = (
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.choiceLabel, { color: picked ? t.accent : t.fg }]}>{o.label}</Text>
              {o.description ? <Text style={[type.caption, { color: t.fg2 }]}>{o.description}</Text> : null}
            </View>
          );
          // Answered: a record of what was picked, nothing to tap (and nothing dimmed but the rest).
          if (!open)
            return (
              <View key={o.label} style={row} accessibilityState={{ selected: picked }}>
                {words}
                {picked ? <Text style={{ color: t.accent, fontWeight: "800", fontSize: 16 }}>✓</Text> : null}
              </View>
            );
          return (
            <Tap
              key={o.label}
              accessibilityRole="button"
              accessibilityLabel={o.description ? `${o.label}: ${o.description}` : o.label}
              disabled={busy}
              onPress={() => onPick?.(o.label)}
              haptic="selection"
              style={row}
            >
              {words}
              <Text style={{ color: t.fg3, fontWeight: "700", fontSize: 16 }}>›</Text>
            </Tap>
          );
        })}
        {open ? (
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Answer in your own words"
            disabled={busy}
            onPress={() => onOther?.()}
            style={[s.choice, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep }]}
          >
            <Text style={[s.choiceLabel, { color: t.fg2, fontWeight: "600" }]}>Other…</Text>
          </Tap>
        ) : null}
      </View>
    );
  }
  if (item.role === "records")
    return (
      <View style={{ marginVertical: 6 }}>
        <LiveRecords refs={item.refs} collections={collections} onAsk={onAsk} />
      </View>
    );
  if (item.role === "live" && item.live)
    return (
      <View style={{ marginVertical: 4 }}>
        <LiveCard live={item.live} collections={collections} onAsk={onAsk} />
      </View>
    );
  if (item.role === "user")
    return (
      <View style={[s.bub, s.me, { backgroundColor: t.accent }]}>
        <Text style={[s.bubText, { color: t.onAccent }]}>{item.text}</Text>
      </View>
    );
  if (item.role === "card") {
    const title = item.card?.title ?? "Card";
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
          <View style={s.answers}>
            <Tap
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onAnswer(item.card!.action_id, "confirm")}
              haptic="light"
              style={[s.answer, { backgroundColor: t.accent }]}
            >
              <Text style={[type.label, { color: t.onAccent, fontSize: 14 }]}>Confirm</Text>
            </Tap>
            <Tap
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onAnswer(item.card!.action_id, "cancel")}
              style={[s.answer, { backgroundColor: t.fill }]}
            >
              <Text style={[type.label, { color: t.fg, fontSize: 14, fontWeight: "600" }]}>Not now</Text>
            </Tap>
            {item.card.editable && onEdit ? (
              <Tap
                accessibilityRole="button"
                accessibilityLabel="Change it first"
                disabled={busy}
                onPress={() => onEdit(item.card!)}
                style={[s.answer, { backgroundColor: t.fill }]}
              >
                <Text style={[type.label, { color: t.accent, fontSize: 14 }]}>Change…</Text>
              </Tap>
            ) : null}
          </View>
        ) : item.card && item.card.status !== "done" ? (
          <Text style={[s.sys, { color: t.fg2, textAlign: "left", padding: 0 }]}>
            {item.card.status === "cancelled"
              ? "Not done."
              : item.card.status === "expired"
                ? "Expired."
                : "Failed."}
            {item.card.result ? ` ${item.card.result}` : ""}
          </Text>
        ) : item.card?.result ? (
          <Text style={[s.sys, { color: t.fg2, textAlign: "left", padding: 0 }]}>{item.card.result}</Text>
        ) : null}
      </View>
    );
  }
  if (item.role === "note") return <Text style={[s.sys, { color: t.fg2 }]}>{item.text}</Text>;
  return (
    <>
      <View style={[s.bub, s.them, { backgroundColor: t.bubbleThem, borderColor: t.hair }]}>
        <Markdown text={item.text} style={[s.bubText, { color: t.fg }]} />
      </View>
      {/* Only the exception is marked (decision 2026-10-16 "Quick and Careful"): Quick is the default. */}
      {item.level === 2 ? <Text style={[type.caption, s.careful, { color: t.fg2 }]}>Careful</Text> : null}
      {rate ? <Rate id={item.id} /> : null}
    </>
  );
}

const s = StyleSheet.create({
  careful: { marginLeft: 12, marginTop: -2, marginBottom: 2, fontWeight: "600", letterSpacing: 0.2 },
  choiceQ: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3, lineHeight: 23, marginBottom: 4 },
  choice: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingVertical: 10 },
  choiceLabel: { fontSize: 16, fontWeight: "700" },
  root: { flex: 1 },
  head: { height: 56, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  // Clear of Changes (left) and Done (right).
  // Clear of Changes (left) and the two tools + Done (right); a long title is cut short.
  titleBox: { flex: 1, alignItems: "center", paddingLeft: 92, paddingRight: 152 },
  title: { ...type.heading, fontSize: 16 },
  ctx: { ...type.caption, marginTop: 1 },
  pick: { flexDirection: "row", alignItems: "center", maxWidth: "100%" },
  done: { position: "absolute", right: 16, height: 56, justifyContent: "center" },
  tools: { position: "absolute", right: 64, height: 56, flexDirection: "row", alignItems: "center", gap: 6 },
  tool: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  fresh: { paddingTop: 120, paddingHorizontal: 24 },
  changes: { position: "absolute", left: 16, height: 56, justifyContent: "center" },
  bub: { maxWidth: "82%", paddingVertical: 9, paddingHorizontal: 13, borderRadius: 19 },
  me: { alignSelf: "flex-end", borderBottomRightRadius: 5 },
  them: { alignSelf: "flex-start", borderBottomLeftRadius: 5, borderWidth: StyleSheet.hairlineWidth },
  bubText: { ...type.body },
  thinking: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inline: {
    alignSelf: "stretch",
    borderRadius: radius.card,
    padding: 12,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  cardTitle: { fontSize: 12, fontWeight: "700" },
  answers: { flexDirection: "row", gap: 8, marginTop: 6 },
  answer: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  waitBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 6,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sys: { fontSize: 12, fontWeight: "600", textAlign: "center", padding: 6 },
  rate: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: -2 },
  rateBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  rateNote: { fontSize: 12, fontWeight: "600", marginLeft: 4 },
  // A horizontal list grows to fill the column by default; the chips sit above the box.
  chips: { flexGrow: 0, flexShrink: 0 },
  chip: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  compose: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 6 },
  // The box grows with the message, to about five lines, then scrolls inside.
  inputBox: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: "center",
  },
  input: {
    minHeight: 22,
    maxHeight: 110,
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
    outlineWidth: 0,
  },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  attach: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
