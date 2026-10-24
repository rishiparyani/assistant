// The chat, one pull away from the home. Opened from a card it knows which one (and a card's
// menu can start the message: "Share this with "). Confirm cards are answered here. Messages
// typed offline wait in the outbox and go when the connection is back.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Clipboard from "expo-clipboard";
import { LinkNote } from "./LinkNote.tsx";
import * as Haptics from "expo-haptics";
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type TextInput as RNTextInput,
} from "react-native";
import Animated, { FadeIn, FadeInDown, useAnimatedStyle } from "react-native-reanimated";
import {
  Boundary,
  Markdown,
  Tap,
  type ExampleAct,
  Text,
  TextInput,
  ThinkingDots,
  motion,
  type,
} from "@assistant/cards/native";
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
import { AddRecordSheet, addableFields } from "@/components/AddRecordSheet";
import { ImportSheet, uploadedWords } from "@/components/ImportSheet";
import { SetupEditSheet } from "@/components/SetupEditSheet";
import { SetupCard, setupOf } from "@/components/SetupCard";
import { ChatsSheet } from "@/components/ChatsSheet";
import { ModelSheet, pickLabel, useModelPick } from "@/components/ModelPicker";
import { ApiError, isOffline, request, newKey } from "@/api";
import { send } from "@/outbox";
import { useLive } from "@/live-socket";
import { radius, useTheme } from "@/theme";
import { useKeyboardHeight, useKeyboardRoom } from "@/keyboard";
import { useSession } from "@/session";
import { rememberChat } from "@/last-chat";
import { savedCatalog, type CatalogEntry } from "@/home";
import { aboutLabel, aboutWords, parseAbout, type ChatParams } from "@/chat-open";

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
/**
 * The assistant's words before the cards it made on the way to them: the cards are saved as
 * the tools run and the words when it finishes, so "Here's the setup to check" came under the
 * setup it meant (owner, 2026-10-19: "why do I get the confirm message … above the main
 * message?"). Only within one reply; a note, a question to answer or my next message ends it.
 */
function wordsFirst(items: Shown[]): Shown[] {
  const out: Shown[] = [];
  let cards: Shown[] = [];
  for (const i of items) {
    if (i.role === "card" || i.role === "live" || i.role === "records") cards.push(i);
    else if (i.role === "assistant" && cards.length) {
      out.push(i, ...cards);
      cards = [];
    } else {
      out.push(...cards, i);
      cards = [];
    }
  }
  return [...out, ...cards];
}
const enc = encodeURIComponent;
const SUGGEST = [
  "What's due this week?",
  "Spent 450 on chai",
  "Remind me to pay the electricity bill at 6",
  "Pin my expenses to the home",
];

/**
 * The chat (docs/design/from-scratch.md §3 "Chat sheet"): a sheet over whatever screen the
 * composer was on, or the panel beside the screen on a wide website window. `onClose` puts it
 * away; it never leaves the screen under it.
 */
export function ChatScreen({ params, onClose }: { params: ChatParams; onClose: () => void }) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  // card: a home card's title; ask: words for the box (send=1: sent at once); id: which chat;
  // space: open the current chat of this space (decision 2026-10-16 "Spaces"); about: what the
  // screen it was opened from shows, as a chip the person can tap away.
  const { card, ask, id, send: sendNow, space } = params;
  const [about, setAbout] = useState(() => parseAbout(params.about));
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
  // The reply as it's being written (decision 2026-10-22 "Replies as they're written"): the
  // server sends its words over the live socket for the message this screen sent (its key);
  // each part (a new step, or the next model) starts the draft again.
  const [draft, setDraft] = useState<{ part: number; text: string } | null>(null);
  // Cards and questions as they're made, before the turn is saved (the saved turn replaces them).
  const [draftItems, setDraftItems] = useState<ChatItem[]>([]);
  const sentKey = useRef<string | null>(null);
  // Whether this reply was already on screen as it was written: then the saved turn takes the
  // draft's place where it stands, with no second entrance (owner, 2026-10-25: things in the
  // chat "appear suddenly and the chat scrolls abruptly").
  const streamed = useRef(false);
  const quiet = useRef(new Set<string>());
  useLive((m) => {
    if (m.chat !== chatId) return;
    if (m.type === "assistant_item" && m.key === sentKey.current && typeof m.item === "string") {
      const item = JSON.parse(m.item) as ChatItem;
      streamed.current = true;
      setDraftItems((xs) => (xs.some((x) => x.id === item.id) ? xs : [...xs, item]));
      return;
    }
    if (m.type === "assistant_delta" && m.key === sentKey.current) {
      const part = Number(m.part);
      const text = String(m.text ?? "");
      streamed.current = true;
      setDraft((d) => (d && d.part === part ? { part, text: d.text + text } : { part, text }));
      return;
    }
    if (m.type !== "assistant_progress") return;
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
  const shownItems = useMemo(() => wordsFirst(groupRecords(view?.items ?? [])), [view]);
  const newestFirst = useMemo(() => [...shownItems].reverse(), [shownItems]);
  // 👍 / 👎 go under the whole reply: after the cards that now follow its words.
  const rateAt = useMemo(() => {
    let at = shownItems.findIndex((i) => i.id === lastReply);
    if (at < 0) return null;
    while (["card", "live", "records"].includes(shownItems[at + 1]?.role ?? "")) at++;
    return shownItems[at]!.id;
  }, [shownItems, lastReply]);
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
  // The room under the chat follows the keyboard frame by frame on the iPhone, so the messages
  // and the box ride up with it instead of jumping when it starts to move.
  const keyboard = useKeyboardHeight();
  // The box keeps its safe-area room underneath, so the keyboard takes over from it smoothly.
  const bottomInset = insets.bottom;
  const lifted = useAnimatedStyle(() => ({
    paddingBottom: Platform.OS === "ios" ? Math.max(0, keyboard.value - bottomInset) : room,
  }));
  // A tap on the conversation (not a drag, not a button) puts the keyboard away.
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const touchStart = (e: GestureResponderEvent) => {
    touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, at: Date.now() };
  };
  const touchEnd = (e: GestureResponderEvent) => {
    const t0 = touch.current;
    touch.current = null;
    if (!room || !t0) return;
    const moved = Math.abs(e.nativeEvent.pageX - t0.x) + Math.abs(e.nativeEvent.pageY - t0.y);
    if (moved < 10 && Date.now() - t0.at < 350) Keyboard.dismiss();
  };
  // Opened from a card: the first message from this sheet names it, whatever the chat holds.
  const attached = useRef(false);
  // The collections of the chat's space, once for every live card in the chat.
  const collections = useRef<Promise<CollectionView[]> | null>(null);
  const chatSpace = view?.space_id ?? null;
  // Another space's chat: its own lists.
  const spaceRef = useRef(chatSpace);
  if (spaceRef.current !== chatSpace) {
    spaceRef.current = chatSpace;
    collections.current = null;
  }
  // `fresh`: a card names a list the copy doesn't have (made in this chat since): ask again.
  const getCollections = useCallback((fresh?: boolean) => {
    if (fresh) collections.current = null;
    collections.current ??= request<CollectionView[]>(
      "GET",
      `/api/collections${spaceRef.current ? `?space=${encodeURIComponent(spaceRef.current)}` : ""}`,
    ).catch((e: unknown) => {
      collections.current = null;
      throw e;
    });
    return collections.current;
  }, []);
  // Pills that act (owner, 2026-10-24: "perform an action instead of just pasting that same
  // message"): the model names a saved view or list, or a list and values; the app finds it in
  // the catalog this device holds (no model call) and shows the card here, or opens the list's
  // add form filled in. Nothing by that name: the words go to the box, as a plain pill would.
  const [adding, setAdding] = useState<{ entry: CatalogEntry; values: Record<string, string> } | null>(null);
  const act = useCallback(
    (a: ExampleAct, _words: string): ReactNode | boolean | null => {
      const cat = myId ? savedCatalog(myId) : null;
      if (!cat) return null;
      const same = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
      // This chat's space first; else the one space that has it. Two spaces with the same
      // name: nothing is picked (no silent guess on a name, AGENTS.md; Codex on PR 192), so
      // the words go to the box and the model asks which.
      const inSpace = (e: CatalogEntry) => (e.space ?? null) === chatSpace;
      const pick = (ok: (e: CatalogEntry) => boolean) => {
        const here = cat.entries.find((e) => ok(e) && inSpace(e));
        if (here) return here;
        const spaces = new Set(cat.entries.filter(ok).map((e) => e.space ?? ""));
        return spaces.size === 1 ? (cat.entries.find(ok) ?? null) : null;
      };
      if (a.kind === "show") {
        const e =
          pick((x) => x.kind === "view" && !!x.view && same(x.view.name, a.name)) ??
          pick(
            (x) =>
              (x.kind === "view" || x.kind === "list") && !!x.collection && same(x.collection.name, a.name),
          );
        if (!e) return null;
        const live: LiveRef =
          e.kind === "view" && e.view
            ? { kind: "view", view_id: e.view.id }
            : { kind: "list", collection_id: e.collection!.id, title: e.collection!.name, query: {} };
        // The card's list comes with the entry (its own space), not from this chat's space.
        const own = e.collection;
        return (
          <LiveCard
            live={live}
            collections={own ? async () => [own] : getCollections}
            space={e.space ?? null}
            onAsk={(title) => setText((t) => t || `About "${title}": `)}
          />
        );
      }
      const e = pick(
        (x) => (x.kind === "view" || x.kind === "list") && !!x.collection && same(x.collection.name, a.list),
      );
      if (!e?.collection) return null;
      // A required field the sheet can't fill (a link, a person): the add would fail after
      // "Added", so the words go to the box and the model does it (Codex on PR 192).
      const fillable = new Set(addableFields(e.collection).map((f) => f.id));
      if (e.collection.fields.some((f) => f.required && !fillable.has(f.id))) return null;
      setAdding({ entry: e, values: a.values });
      return true;
    },
    [myId, chatSpace, getCollections],
  );

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
    // What the chat was opened about goes at the front of the first message, in words.
    const msg =
      card && !attached.current
        ? `About "${card}": ${body}`
        : about && !attached.current
          ? aboutWords(about) + body
          : body;
    attached.current = true;
    setAbout(null);
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
    setDraft(null);
    setDraftItems([]);
    streamed.current = false;
    sentKey.current = newKey();
    const sentAt = new Date().toISOString();
    try {
      const next = await request<ChatView>(
        "POST",
        `/api/chats/${chatId}`,
        { text: msg, model: pick },
        sentKey.current,
      );
      if (streamed.current) {
        const had = new Set((view?.items ?? []).map((i) => i.id));
        for (const i of next.items) if (!had.has(i.id) && i.role !== "user") quiet.current.add(i.id);
      }
      setView(next);
      setDraftItems([]);
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
      setDraft(null);
      sentKey.current = null;
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
      <Animated.View style={[s.root, lifted]}>
        {/* The top, as Claude's and ChatGPT's (owner, 2026-10-23: "the top section is pretty
            clunky"): back on the left, the title in the middle (tap: the model, what this
            chat changed), chats and a new chat on the right. Nothing else. */}
        <View style={s.head}>
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onClose}
            scale={0.9}
            hitSlop={8}
            style={s.tool}
          >
            <Text style={[s.toolGlyph, { color: t.fg }]}>‹</Text>
          </Tap>
          <Tap
            accessibilityRole="button"
            accessibilityLabel={`${card ? card : (view?.title ?? "Chat")}. Model: ${pickLabel(pick)}. Options`}
            onPress={() => setShowModel(true)}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            style={s.titleBox}
          >
            <View style={s.titleRow}>
              <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
                {card
                  ? card
                  : view && view.id !== MAIN && view.title !== "New chat"
                    ? view.title
                    : "Gigspree"}
              </Text>
              <Text style={[s.title, { color: t.fg3 }]}> ▾</Text>
            </View>
            {/* Only the exception is named: a model picked by hand, or what the chat is about. */}
            {pick !== "auto" || card || view?.space_name ? (
              <Text style={[s.ctx, { color: t.fg2 }]} numberOfLines={1}>
                {[
                  pick !== "auto" ? pickLabel(pick) : "",
                  card ? "about this card" : view?.space_name ? `in ${view.space_name}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
          </Tap>
          <View style={s.tools}>
            <Tap
              accessibilityRole="button"
              accessibilityLabel="Chats"
              onPress={() => setShowChats(true)}
              scale={0.9}
              hitSlop={6}
              style={s.tool}
            >
              <Text style={[s.toolGlyph, { color: t.fg, fontSize: 17 }]}>☰</Text>
            </Tap>
            <Tap
              accessibilityRole="button"
              accessibilityLabel="New chat"
              onPress={() => void newChat()}
              scale={0.9}
              hitSlop={6}
              haptic="selection"
              style={s.tool}
            >
              <Text style={[s.toolGlyph, { color: t.fg, fontSize: 18 }]}>✎</Text>
            </Tap>
          </View>
        </View>
        <AddRecordSheet
          open={!!adding}
          onClose={() => setAdding(null)}
          collection={adding?.entry.collection ?? null}
          space={adding?.entry.space ?? null}
          where={adding?.entry.space ? adding.entry.group : null}
          values={adding?.values ?? {}}
        />
        <ModelSheet
          open={showModel}
          pick={pick}
          carefulOn={view?.smart_available !== false}
          onPick={setPick}
          onClose={() => setShowModel(false)}
          onChanges={() => setShowChanges(true)}
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
          extraData={[rateAt, busy]}
          data={newestFirst}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingVertical: 14,
            gap: 10,
            width: "100%",
            maxWidth: COLUMN,
            alignSelf: "center",
          }}
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
          // Any drag on the conversation, or a tap on it, puts the keyboard away (owner,
          // 2026-10-25: pulling it down from just above the keyboard was the only way).
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onTouchStart={touchStart}
          onTouchEnd={touchEnd}
          renderItem={({ item }) => {
            const fresh =
              !quiet.current.has(item.id) &&
              (item.id.startsWith("local-") || Date.parse(item.created_at) > openedAt.current);
            const bubble = (
              <Bubble
                item={item}
                onAnswer={answer}
                onEdit={(card) => setEditing(card)}
                busy={busy}
                collections={getCollections}
                space={chatSpace}
                onAsk={(title) => setText((t) => t || `About "${title}": `)}
                onSay={(words) => {
                  setText(words);
                  box.current?.focus();
                }}
                onAct={act}
                answered={answers.get(item.id)}
                onPick={(label) => void say(label)}
                onOther={() => box.current?.focus()}
              />
            );
            const safe = (
              <Boundary where="chat item">
                <View style={{ gap: 2 }}>
                  {bubble}
                  {item.id === rateAt && lastReply ? (
                    <Rate id={lastReply} text={view?.items.find((i) => i.id === lastReply)?.text ?? ""} />
                  ) : null}
                </View>
              </Boundary>
            );
            // In the upside-down list a cell's "down" is up on screen: new messages rise in.
            return fresh ? (
              <Animated.View entering={FadeInDown.duration(motion.enter)}>{safe}</Animated.View>
            ) : (
              safe
            );
          }}
          // Upside down, the header is the visual bottom: the thinking bubble sits under the newest message.
          ListHeaderComponent={
            busy && view?.items.length ? (
              <View style={{ gap: 4 }}>
                {/* Cards and questions as they're made: a full-width column of their own, never
                    in the thinking row (Codex on PR 187). */}
                {draftItems.map((item) => (
                  <View key={item.id} style={{ opacity: 0.85, alignSelf: "stretch" }}>
                    <Bubble
                      item={item}
                      onAnswer={answer}
                      busy
                      collections={getCollections}
                      space={chatSpace}
                      onAsk={() => undefined}
                    />
                  </View>
                ))}
                <Animated.View
                  entering={FadeIn.duration(motion.fade)}
                  style={draft?.text ? s.reply : s.thinking}
                >
                  {draft?.text ? (
                    // The words so far, with a mark where the next ones land.
                    <Markdown text={`${draft.text}▍`} style={[s.replyText, { color: t.fg }]} />
                  ) : (
                    <ThinkingDots />
                  )}
                  {status && !draft?.text ? (
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
              </View>
            ) : null
          }
          ListEmptyComponent={
            view && !note ? (
              firstEver !== false ? (
                // The first run (home-first.md §2 point 15): a conversation about the week.
                <View style={[s.reply, { marginTop: 8 }]}>
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
        {about ? (
          <View style={s.aboutRow}>
            <View style={[s.about, { backgroundColor: t.accentSoft }]}>
              <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]} numberOfLines={1}>
                About: {aboutLabel(about)}
              </Text>
              <Tap
                accessibilityRole="button"
                accessibilityLabel="Not about this"
                onPress={() => setAbout(null)}
                hitSlop={12}
                style={s.aboutOff}
              >
                <Text style={{ color: t.accent, fontWeight: "800", fontSize: 14, lineHeight: 16 }}>✕</Text>
              </Tap>
            </View>
          </View>
        ) : null}
        <View style={[s.compose, { paddingBottom: insets.bottom + 8 }]}>
          {room ? (
            // While typing, the button beside the box puts the keyboard away.
            <Tap
              accessibilityRole="button"
              accessibilityLabel="Hide keyboard"
              onPress={() => Keyboard.dismiss()}
              hitSlop={8}
              scale={0.9}
              style={[s.attach, { borderColor: t.sep, backgroundColor: t.cell }]}
            >
              <Text style={{ color: t.fg2, fontWeight: "800", fontSize: 18, lineHeight: 20 }}>⌄</Text>
            </Tap>
          ) : (
            <Tap
              accessibilityRole="button"
              accessibilityLabel="Add a CSV file"
              onPress={() => setShowImport(true)}
              disabled={busy}
              hitSlop={8}
              scale={0.9}
              style={[s.attach, { borderColor: t.sep, backgroundColor: t.cell }]}
            >
              <Text style={{ color: t.fg2, fontWeight: "800", fontSize: 20, lineHeight: 22 }}>+</Text>
            </Tap>
          )}
          <View style={[s.inputBox, { backgroundColor: t.cell, borderColor: t.sep }]}>
            <TextInput
              ref={box}
              autoFocus={!!ask}
              accessibilityLabel="Message Gigspree"
              placeholder={
                about ? `Ask about ${about.title}` : card ? `Ask about ${card}` : "Ask, add or arrange"
              }
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
      </Animated.View>
    </View>
  );
}

// 👍 / 👎 given in this session, by message (only the rating goes to the server).
const rated = new Map<string, "good" | "bad">();

/** 👍 / 👎 under the newest answer: a count for the app team, nothing about the answer. */
function Rate({ id, text }: { id: string; text: string }) {
  const { t } = useTheme();
  const [mine, setMine] = useState(rated.get(id) ?? null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
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
          <Text style={{ fontSize: 14, opacity: mine && mine !== r ? 0.25 : mine === r ? 1 : 0.55 }}>
            {r === "good" ? "👍" : "👎"}
          </Text>
        </Tap>
      ))}
      <Tap
        accessibilityRole="button"
        accessibilityLabel="Copy the answer"
        onPress={copy}
        haptic="selection"
        scale={0.9}
        style={s.copyBtn}
      >
        <Text style={[s.rateNote, { color: copied ? t.good : t.fg2, marginLeft: 0 }]}>
          {copied ? "Copied" : "Copy"}
        </Text>
      </Tap>
      {mine ? <Text style={[s.rateNote, { color: t.fg3 }]}>Thanks</Text> : null}
    </View>
  );
}

function Bubble({
  item,
  onAnswer,
  onEdit,
  busy,
  collections,
  space,
  onAsk,
  onSay,
  onAct,
  answered,
  onPick,
  onOther,
}: {
  item: Shown;
  onAnswer: (actionId: string, what: "confirm" | "cancel") => void;
  /** A setup card: change it by hand before Confirm. */
  onEdit?: (card: NonNullable<ChatItem["card"]>) => void;
  busy: boolean;
  collections: (fresh?: boolean) => Promise<CollectionView[]>;
  /** The chat's space (null: the person's own): the cards' lists live there. */
  space: string | null;
  onAsk: (title: string) => void;
  /** Words put in the box by a card (a next step), for the person to finish. */
  onSay?: (text: string) => void;
  /** A pill that acts (show a card here, open an add form); see Markdown's onAct. */
  onAct?: (act: ExampleAct, words: string) => ReactNode | boolean | null;
  /** A question with answers to tap: what the person answered (undefined/null: not yet). */
  answered?: string | null;
  onPick?: (label: string) => void;
  /** "Other…": type your own answer. */
  onOther?: () => void;
}) {
  const { t } = useTheme();
  // Several questions asked together (the model asks all at once, one turn): the card walks
  // through them one at a time, Claude's way (owner, 2026-10-24: "both the follow-ups come at
  // the same time, but we work on that one after the other"). Each pick is kept here; an
  // answered question folds to one line (tap it to change); the last pick sends every answer
  // as one message, a line per question in the same order.
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [step, setStep] = useState(0);
  if (item.role === "choices" && item.choices) {
    const open = answered == null;
    const questions = item.choices.questions?.length ? item.choices.questions : [item.choices];
    const many = questions.length > 1;
    const given = answered?.split("\n") ?? [];
    const pickAt = (k: number, label: string) => {
      const next = { ...picks, [k]: label };
      setPicks(next);
      if (questions.every((_, i) => next[i])) onPick?.(questions.map((_, i) => next[i]!).join("\n"));
      else setStep(questions.findIndex((_, i) => !next[i]));
    };
    const backTo = (k: number) => {
      const next = { ...picks };
      for (const i of Object.keys(next)) if (Number(i) >= k) delete next[Number(i)];
      setPicks(next);
      setStep(k);
    };
    // A question reads as a question: a soft tint, no edge (design pass, 2026-10-23: the
    // chat's boxes should each say what they are at a glance).
    return (
      <View style={[s.inline, { backgroundColor: t.accentSoft, borderColor: "transparent" }]}>
        {questions.map((q, k) => {
          // Still open, several questions: only the one being answered is spread out.
          if (open && many && k > step) return null;
          if (open && many && k < step)
            return (
              <Tap
                key={k}
                accessibilityRole="button"
                accessibilityLabel={`${q.question} ${picks[k] ?? ""}. Change`}
                disabled={busy}
                onPress={() => backTo(k)}
                haptic="selection"
                style={[s.doneQ, { borderBottomColor: t.sep }]}
              >
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
                    {q.question}
                  </Text>
                  <Text style={[s.choiceLabel, { color: t.accent }]} numberOfLines={1}>
                    {picks[k]}
                  </Text>
                </View>
                <Text style={[type.caption, { color: t.fg3, fontWeight: "600" }]}>Change</Text>
              </Tap>
            );
          return (
            <View key={k} style={k > 0 ? s.nextQ : null}>
              {open && many ? (
                <Text style={[type.caption, s.stepQ, { color: t.fg3 }]}>
                  {k + 1} of {questions.length}
                </Text>
              ) : null}
              <Text style={[s.choiceQ, { color: t.fg }]}>{q.question}</Text>
              {q.options.map((o, i) => {
                const mine = questions.length > 1 ? given[k] : answered;
                const picked = (!open && mine === o.label) || (open && picks[k] === o.label);
                const row = [
                  s.choice,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
                  !open && !picked && { opacity: 0.45 },
                ];
                const words = (
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[s.choiceLabel, { color: picked ? t.accent : t.fg }]}>{o.label}</Text>
                    {o.description ? (
                      <Text style={[type.caption, { color: t.fg2 }]}>{o.description}</Text>
                    ) : null}
                  </View>
                );
                // Answered: a record of what was picked, nothing to tap (and nothing dimmed but the rest).
                if (!open)
                  return (
                    <View key={o.label} style={row} accessibilityState={{ selected: picked }}>
                      {words}
                      {picked ? (
                        <Text style={{ color: t.accent, fontWeight: "800", fontSize: 16 }}>✓</Text>
                      ) : null}
                    </View>
                  );
                return (
                  <Tap
                    key={o.label}
                    accessibilityRole="button"
                    accessibilityLabel={o.description ? `${o.label}: ${o.description}` : o.label}
                    accessibilityState={{ selected: picked }}
                    disabled={busy}
                    onPress={() => (many ? pickAt(k, o.label) : onPick?.(o.label))}
                    haptic="selection"
                    style={row}
                  >
                    {words}
                    <Text style={{ color: picked ? t.accent : t.fg3, fontWeight: "700", fontSize: 16 }}>
                      {picked ? "✓" : "›"}
                    </Text>
                  </Tap>
                );
              })}
            </View>
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
        <LiveRecords refs={item.refs} collections={collections} space={space} onAsk={onAsk} />
      </View>
    );
  if (item.role === "live" && item.live)
    return (
      <View style={{ marginVertical: 4 }}>
        <LiveCard live={item.live} collections={collections} space={space} onAsk={onAsk} onSay={onSay} />
      </View>
    );
  if (item.role === "user")
    return (
      <View style={[s.bub, s.me, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.bubText, { color: t.fg }]}>{item.text}</Text>
      </View>
    );
  if (item.role === "card") {
    const title = item.card?.title ?? "Card";
    // A card waiting for a tap carries a firm accent edge; once answered it settles back.
    const waiting = item.card?.status === "waiting";
    return (
      <View
        style={[
          s.inline,
          { backgroundColor: t.cell, borderColor: t.hair },
          waiting && { borderLeftWidth: 3, borderLeftColor: t.accent },
        ]}
      >
        <Text style={[s.cardTitle, { color: t.accent }]}>{waiting ? `To confirm · ${title}` : title}</Text>
        {item.card && setupOf(item.card.tool, item.card.args) ? (
          // A setup drawn, not listed (owner, 2026-10-24: "a little too much to read").
          <SetupCard tool={item.card.tool} args={item.card.args} />
        ) : (
          item.card?.details.map((d) => (
            <Text key={d} style={[s.bubText, { color: t.fg }]}>
              {d}
            </Text>
          ))
        )}
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
  // A link in a note (a share's join link) comes with Copy and Share.
  if (item.role === "note") return <LinkNote text={item.text} style={[s.sys, { color: t.fg2 }]} />;
  return (
    <>
      <Pressable
        accessibilityHint="Hold to copy"
        delayLongPress={350}
        onLongPress={() => {
          void Clipboard.setStringAsync(item.text);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        }}
        style={s.reply}
      >
        <Markdown text={item.text} style={[s.replyText, { color: t.fg }]} onTry={onSay} onAct={onAct} />
      </Pressable>
      {/* Only the exception is marked (decision 2026-10-16 "Quick and Careful"): Quick is the default. */}
      {item.level === 2 ? <Text style={[type.caption, s.careful, { color: t.fg2 }]}>Careful</Text> : null}
    </>
  );
}

// On a laptop the conversation keeps to a readable column, centred (Claude's and ChatGPT's way).
const COLUMN = 760;

const s = StyleSheet.create({
  careful: { marginLeft: 12, marginTop: -2, marginBottom: 2, fontWeight: "600", letterSpacing: 0.2 },
  choiceQ: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3, lineHeight: 23, marginBottom: 4 },
  choice: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingVertical: 10 },
  choiceLabel: { fontSize: 16, fontWeight: "700" },
  nextQ: { marginTop: 14 },
  // An answered question, folded to a line while the next is open.
  doneQ: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingVertical: 8,
    marginBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepQ: { fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 2 },
  root: { flex: 1 },
  head: { height: 56, alignItems: "center", flexDirection: "row", paddingHorizontal: 8, gap: 4 },
  // The title takes the middle; a long one is cut short.
  titleBox: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", maxWidth: "100%" },
  title: { ...type.heading, fontSize: 16, flexShrink: 1 },
  ctx: { ...type.caption, marginTop: 1 },
  tools: { flexDirection: "row", alignItems: "center" },
  // Quiet round targets, no edge: the page is the chrome.
  tool: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  toolGlyph: { fontSize: 22, lineHeight: 26, fontWeight: "700" },
  fresh: { paddingTop: 120, paddingHorizontal: 24 },
  // The person's words in a soft bubble on the right; the assistant's as plain text on the
  // page, the width of the screen (decision 2026-10-22 "The chat reads like Claude's").
  bub: {
    maxWidth: "82%",
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  me: { alignSelf: "flex-end", borderBottomRightRadius: 6 },
  bubText: { ...type.body, lineHeight: 23 },
  reply: { alignSelf: "stretch", paddingVertical: 2, paddingHorizontal: 2, gap: 4 },
  replyText: { ...type.body, fontSize: 16.5, lineHeight: 25 },
  thinking: {
    paddingVertical: 8,
    paddingHorizontal: 2,
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inline: {
    alignSelf: "stretch",
    borderRadius: 18,
    padding: 14,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 2,
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
  rate: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: -4, marginLeft: -10 },
  rateBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  rateNote: { fontSize: 12, fontWeight: "600", marginLeft: 4 },
  copyBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  // A horizontal list grows to fill the column by default; the chips sit above the box.
  chips: { flexGrow: 0, flexShrink: 0 },
  chip: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  aboutRow: { paddingHorizontal: 16, paddingTop: 6, flexDirection: "row" },
  about: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: 16,
    maxWidth: "100%",
  },
  aboutOff: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  compose: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 6,
    width: "100%",
    maxWidth: COLUMN,
    alignSelf: "center",
  },
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
