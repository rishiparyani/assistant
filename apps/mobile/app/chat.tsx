// The chat, one pull away from the home. Opened from a card it knows which one (and a card's
// menu can start the message: "Share this with "). Confirm cards are answered here. Messages
// typed offline wait in the outbox and go when the connection is back.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import { Tap, Text, TextInput, ThinkingDots, motion, type } from "@assistant/cards/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatItem, ChatView, CollectionView, HistoryItem, LiveRef } from "@assistant/shared";
import { Changes, fetchChanges } from "@/components/Changes";
import { LiveCard, LiveRecords } from "@/components/LiveCard";
import { ImportSheet, uploadedWords } from "@/components/ImportSheet";
import { SetupEditSheet } from "@/components/SetupEditSheet";
import { ApiError, isOffline, request } from "@/api";
import { send } from "@/outbox";
import { useLive } from "@/live-socket";
import { radius, useTheme } from "@/theme";
import { useKeyboardRoom } from "@/keyboard";

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
  "Remind me to call the venue at 6",
  "Pin my expenses to the home",
];

export default function Chat() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { card, ask } = useLocalSearchParams<{ card?: string; ask?: string }>();
  const [view, setView] = useState<ChatView | null>(null);
  // The newest answer gets 👍 / 👎 (not one waiting behind a newer message of mine).
  const lastReply = (() => {
    const items = view?.items ?? [];
    const at = items.findLastIndex((i) => i.role === "assistant" && !!i.text);
    return at >= 0 && !items.slice(at + 1).some((i) => i.role === "user") ? items[at]!.id : null;
  })();
  const [text, setText] = useState(ask ?? "");
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
    if (m.type !== "assistant_progress" || m.chat !== MAIN) return;
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
  // Scroll anchoring (decision 2026-10-15 "Feel: the ChatGPT bar"): the list follows new
  // messages only while the person is at the bottom; reading older ones, it stays put. The
  // first fill lands at the bottom without a scroll.
  const atBottom = useRef(true);
  const firstFill = useRef(true);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
  };
  const follow = () => {
    if (!atBottom.current) return;
    list.current?.scrollToEnd({ animated: !firstFill.current });
    firstFill.current = false;
  };
  // Items from before this screen opened don't animate in; new ones rise into place.
  const openedAt = useRef(Date.now());
  const shownItems = useMemo(() => groupRecords(view?.items ?? []), [view]);
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
    atBottom.current = true;
    setBusy(true);
    const sentAt = new Date().toISOString();
    try {
      const next = await request<ChatView>("POST", `/api/chats/${MAIN}`, { text: msg });
      setView(next);
      setNote("");
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
          path: `/api/chats/${MAIN}`,
          body: { text: msg },
          label: "Message to the assistant",
        });
        setNote("Waiting to send: it goes when you're back online.");
      } else setNote(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // online-only: a confirm card runs (or drops) its action on the server, once; a setup card
  // may run with the person's own changes to it.
  const answer = async (actionId: string, what: "confirm" | "cancel", args?: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      setView(
        await request<ChatView>(
          "POST",
          `/api/chats/${MAIN}/actions/${enc(actionId)}/${what}`,
          args ? { args } : {},
        ),
      );
      setEditing(null);
      setNote("");
    } catch (e) {
      setNote(isOffline(e) ? "Confirming needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.root, { backgroundColor: t.page }]}>
      <View style={[s.root, { paddingBottom: room }]}>
        <View style={s.head}>
          {/* Between Changes and Done: a long card name is cut short, "about this card" under it. */}
          <View style={s.titleBox}>
            <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
              {card ? card : "Gigspree"}
            </Text>
            {card ? (
              <Text style={[s.ctx, { color: t.fg2 }]} numberOfLines={1}>
                about this card
              </Text>
            ) : null}
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
          <Tap accessibilityRole="button" onPress={() => router.back()} style={s.done} hitSlop={10}>
            <Text style={[type.label, { color: t.accent }]}>Done</Text>
          </Tap>
        </View>
        <FlatList
          ref={list}
          extraData={[lastReply, busy]}
          data={shownItems}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 14, gap: 4 }}
          onScroll={onScroll}
          scrollEventThrottle={48}
          onContentSizeChange={follow}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
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
              />
            );
            return fresh ? (
              <Animated.View entering={FadeInUp.duration(motion.enter).springify().damping(18)}>
                {bubble}
              </Animated.View>
            ) : (
              bubble
            );
          }}
          ListFooterComponent={
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
              // The first run (home-first.md §2 point 15): a conversation about the week.
              <View style={[s.bub, s.them, { backgroundColor: t.cell, borderColor: t.hair, marginTop: 8 }]}>
                <Text style={[s.bubText, { color: t.fg }]}>
                  Hi! Tell me about your week: what you do, what you keep forgetting, what money moves. I'll
                  start the lists you need, each with a card on your home.
                </Text>
              </View>
            ) : (
              <Text style={[s.sys, { color: t.fg2 }]}>{note || "Loading…"}</Text>
            )
          }
        />
        {changed.length ? (
          <Changes items={changed} inline onChange={setChanged} onClose={() => setChanged([])} />
        ) : null}
        {note && view?.items.length ? <Text style={[s.sys, { color: t.fg2 }]}>{note}</Text> : null}
        {showChanges ? <Changes onClose={() => setShowChanges(false)} /> : null}
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
              haptic="selection"
              style={[s.chip, { backgroundColor: t.cell, borderColor: t.sep }]}
            >
              <Text style={[type.caption, { color: t.accent, fontSize: 13.5 }]}>{item}</Text>
            </Tap>
          )}
        />
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
              onContentSizeChange={(e) => setTypedHeight(e.nativeEvent.contentSize.height)}
              style={[s.input, type.body, { color: t.fg, height: Math.min(110, Math.max(22, typedHeight)) }]}
            />
          </View>
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: busy || !text.trim() }}
            onPress={() => say(text)}
            disabled={busy}
            scale={0.88}
            haptic="light"
            style={[s.send, { backgroundColor: t.accent, opacity: busy || !text.trim() ? 0.45 : 1 }]}
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
}) {
  const { t } = useTheme();
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
        <Text style={[s.bubText, { color: t.fg }]}>{item.text}</Text>
      </View>
      {rate ? <Rate id={item.id} /> : null}
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: { height: 56, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  // Clear of Changes (left) and Done (right).
  titleBox: { flex: 1, alignItems: "center", paddingHorizontal: 100 },
  title: { ...type.heading, fontSize: 16 },
  ctx: { ...type.caption, marginTop: 1 },
  done: { position: "absolute", right: 16, height: 56, justifyContent: "center" },
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
  input: { paddingVertical: 0, paddingTop: 0, paddingBottom: 0, outlineWidth: 0 },
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
