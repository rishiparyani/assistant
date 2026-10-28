// Chats, the first screen (docs/design/chats-home.md; the owner chose it 2026-10-28 and said
// build): like a messaging app. The assistant is a dark card pinned at the top, saying what's
// coming up; under it one list of spaces and chats, newest activity first, each kind drawn its
// own way (a space is a tinted tile with what's waiting in it, a person one face, a group
// stacked faces). "Needs you" is one slim bar that opens its own screen, so the chats are never
// pushed down. Search appears when the list is pulled down (or with the magnifier). Nobody
// arranges it, so it can never go blank; it reads what the device kept first (rule 17).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type TextInput as NativeTextInput,
} from "react-native";
import { Boundary, Card, Skeleton, Tap, Text, TextInput, type } from "@assistant/cards/native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HelpSheet } from "@/components/HelpSheet";
import { SearchResults } from "@/components/SearchResults";
import { Sheet } from "@/components/Sheet";
import { Avatar, when } from "@/components/ChatBits";
import { Tour, markTourSeen, resetTour, tourSeen, tourSteps, type TourRefs } from "@/components/Tour";
import { NewChat } from "./chats";
import { API_URL } from "@/config";
import { onHomeChanged, type HomeCard } from "@/home";
import { loadToday, recentSpaces, savedToday, whenWords, type Today } from "@/today";
import {
  filterEntries,
  homeEntries,
  matchEntries,
  watchingWords,
  type ChatEntry,
  type HomeFilter,
  type SpaceEntry,
} from "@/home-list";
import { dropFailed, outboxState, subscribe } from "@/outbox";
import { useSession } from "@/session";
import { useChats } from "@/chats";
import { useLive } from "@/live-socket";
import { lastChat } from "@/last-chat";
import { colourFor, radius, useTheme } from "@/theme";
import { isOffline } from "@/api";
import { openChat, useContentWidth } from "@/chat-open";
import { usePendingPath } from "@/intents";
import { useTestLaunch } from "@/test-launch";

const SIDE = 16;
/** On a laptop the list keeps a readable column. */
const COLUMN = 760;
/** The search box above the list, out of sight until the list is pulled down. */
const SEARCH_H = 60;
const FILTERS: { key: HomeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "spaces", label: "Spaces" },
  { key: "chats", label: "Chats" },
];

export default function Home() {
  const { me, loaded, refresh } = useSession();
  const { t, colour, cardTint } = useTheme();
  // The clock "Coming up" reads: moves on at every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      id = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    id = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(id);
  }, []);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Less the chat panel when it is open beside the screen (a wide website window).
  const width = useContentWidth();
  const [today, setToday] = useState<Today | null>(null);
  // True while what's on screen is the device's saved copy and the fresh one is on its way.
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(() => outboxState().failed);
  const [filter, setFilter] = useState<HomeFilter>("all");
  const [making, setMaking] = useState(false);
  const [starting, setStarting] = useState(false);
  const userId = me?.user.id ?? null;
  useTestLaunch();
  usePendingPath();
  // Guidance (decision 2026-10-13 "Guide people, no presets"): the first-run tour lights up the
  // real parts of the screen; Help ("?") takes it again, and has ideas and "How do I…?".
  const tourRefs = {
    chat: useRef<View>(null),
    search: useRef<View>(null),
    help: useRef<View>(null),
  } satisfies TourRefs;
  const [touring, setTouring] = useState(false);
  const [help, setHelp] = useState(false);

  // Loaded while changes were still waiting to be sent (offline): load again once they are.
  const loadedWithWaiting = useRef(false);
  // Every load also asks who I am again (the assistant switch can change while the app is open).
  const refreshMe = useRef(refresh);
  refreshMe.current = refresh;
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      loadedWithWaiting.current = outboxState().waiting.length > 0;
      void refreshMe.current();
      setToday(await loadToday(userId));
      setStale(false);
      setError("");
    } catch (e) {
      setStale(false);
      setError(
        isOffline(e)
          ? "Offline, and nothing saved on this device yet."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }, [userId]);
  // The saved copy shows in the first frame; the fresh one replaces it when it arrives.
  useEffect(() => {
    if (!userId) return;
    const saved = savedToday(userId);
    if (saved) {
      setToday((p) => p ?? saved);
      setStale(true);
    }
    void load();
  }, [userId, load]);
  const ready = today !== null;
  useEffect(() => {
    // Not while rehearsing as someone: the tour is for a person's own first time.
    if (userId && ready && !me?.practice && !tourSeen(userId)) setTouring(true);
  }, [userId, ready]);
  useEffect(() => onHomeChanged(() => void load()), [load]);
  // Live: when something changes elsewhere, load again a moment later (a burst loads once).
  const liveLoad = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLive((m) => {
    if (m.type !== "space_changed" && m.type !== "reconnected") return;
    clearTimeout(liveLoad.current);
    liveLoad.current = setTimeout(() => {
      if (!outboxState().waiting.length) void load();
    }, 400);
  });
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && userId) void load();
    });
    return () => sub.remove();
  }, [userId, load]);
  // A change the server refused: say so, and show the list as the server has it.
  const waitingBefore = useRef(outboxState().waiting.length);
  useEffect(
    () =>
      subscribe(() => {
        const { failed: now, waiting } = outboxState();
        if (waitingBefore.current > 0 && waiting.length === 0 && loadedWithWaiting.current) void load();
        waitingBefore.current = waiting.length;
        setFailed((prev) => {
          if (now.length > prev.length) void load();
          return now;
        });
      }),
    [load],
  );
  // Chats with people, by activity (the hook keeps them fresh on live pings).
  const { chats: chatList, reload: reloadChats } = useChats();
  // `?q=` opens Chats with the search box showing and the keyboard up (a link from Siri).
  const { q: startQuery } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(startQuery ?? "");
  const searchBox = useRef<NativeTextInput>(null);
  const scroller = useRef<ScrollView>(null);
  // The search box starts out of sight above the list; pulling down shows it (once per open).
  const tucked = useRef(!!startQuery);
  // The list is always at least one screen plus the search box tall, so it can be tucked away.
  const [viewH, setViewH] = useState(0);
  const showSearch = () => {
    scroller.current?.scrollTo({ y: 0, animated: true });
    searchBox.current?.focus();
  };

  // Spaces by last use (opening a space's page moves it to the front), the rest as they come;
  // then everything by its newest message.
  const entries = useMemo(() => {
    const all = today?.spaces ?? [];
    const used = userId ? recentSpaces(userId) : [];
    const rank = (id: string) => {
      const i = used.indexOf(id);
      return i < 0 ? used.length : i;
    };
    return homeEntries({
      spaces: [...all].sort((a, b) => rank(a.id) - rank(b.id)),
      chats: chatList ?? [],
      needs: today?.needs ?? [],
      upnext: today?.upnext ?? [],
    });
  }, [today, chatList, userId]);

  // No hook below this line (the signed-out screen crashed on the phone and the web, 2026-10-15).
  if (loaded && !me) return <Redirect href="/login" />;

  const assistant = me?.assistant !== false;
  /** A whole list, on its own screen (its saved view chosen when the row is one). */
  const openList = (collection: string, view?: string, spaceId?: string) =>
    router.push({
      pathname: "/list",
      params: { collection, ...(view ? { view } : {}), ...(spaceId ? { space: spaceId } : {}) },
    });
  // online-only: the website's shared pages (a form to fill in) open in the browser.
  const openOnWeb = (card: HomeCard) =>
    card.shared && void Linking.openURL(`${API_URL}/shared/${encodeURIComponent(card.shared.share_id)}`);
  const openAssistant = () => {
    const last = userId ? lastChat(userId) : null;
    openChat(last ? { id: last } : {});
  };
  const openEntry = (e: SpaceEntry | ChatEntry) =>
    e.kind === "space"
      ? router.push({ pathname: "/space", params: { id: e.space.id } })
      : router.push({ pathname: "/talk", params: { id: e.chat.id } });

  const needs = today?.needs ?? [];
  const shared = today?.shared ?? [];
  const wide = width >= COLUMN + SIDE * 2;
  const loading = today === null;
  const q = query.trim();
  const shown = q ? matchEntries(entries, q) : filterEntries(entries, filter);
  const coming = (today?.upnext ?? []).filter((u) => u.at >= now - 3_600_000);

  const spaceTile = (e: SpaceEntry) => {
    const c = colourFor(e.space.name);
    const chips: { text: string; waiting?: boolean }[] = [];
    if (e.waiting) chips.push({ text: `${e.waiting} waiting on you`, waiting: true });
    if (e.soon) chips.push({ text: `${e.soon} this week` });
    chips.push({ text: e.space.lists.length === 1 ? "1 list" : `${e.space.lists.length} lists` });
    const who = e.last && e.last.author === me?.user.name ? "You" : e.last?.author;
    return (
      <Tap
        key={e.key}
        accessibilityRole="button"
        accessibilityLabel={`${e.space.name}, space${e.unread ? `, ${e.unread} unread` : ""}${e.waiting ? `, ${e.waiting} waiting on you` : ""}`}
        onPress={() => openEntry(e)}
        scale={0.985}
        style={[s.tile, { backgroundColor: cardTint(c) }]}
      >
        <View style={[s.square, { backgroundColor: colour(c) }]}>
          <Text style={[s.squareText, { color: t.onAccent }]}>
            {e.space.name.trim().charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={s.words}>
          <View style={s.line}>
            <Text style={[s.name, { color: t.fg }]} numberOfLines={1}>
              {e.space.name}
              <Text style={[s.kind, { color: t.fg2 }]}> · space</Text>
            </Text>
            <Text style={[s.time, { color: e.unread ? t.accent : t.fg3 }]}>
              {e.last ? when(e.last.at) : ""}
            </Text>
          </View>
          <View style={s.chips}>
            {chips.map((ch) => (
              <View
                key={ch.text}
                style={[s.chip, { backgroundColor: ch.waiting ? cardTint("time") : t.glass }]}
              >
                <Text style={[s.chipText, { color: ch.waiting ? t.warn : t.fg2 }]}>{ch.text}</Text>
              </View>
            ))}
          </View>
          <View style={s.line}>
            <Text style={[s.last, { color: t.fg2 }]} numberOfLines={1}>
              {e.last
                ? `${who}: ${e.last.text}`
                : e.space.lists.length
                  ? e.space.lists
                      .slice(0, 3)
                      .map((l) => l.title)
                      .join(", ")
                  : e.space.personal
                    ? "Only you"
                    : "No messages yet"}
            </Text>
            {e.unread ? <Badge n={e.unread} /> : null}
          </View>
        </View>
      </Tap>
    );
  };
  const chatRow = (e: ChatEntry) => {
    const c = e.chat;
    const who = c.last?.author === me?.user.name ? "You" : c.last?.author;
    const last = c.last
      ? c.direct && who !== "You"
        ? c.last.text
        : `${who}: ${c.last.text}`
      : c.direct
        ? "Say hello"
        : `${c.members} people`;
    return (
      <Tap
        key={e.key}
        accessibilityRole="button"
        accessibilityLabel={`${c.name}${c.unread ? `, ${c.unread} unread` : ""}`}
        onPress={() => openEntry(e)}
        scale={0.985}
        style={[s.row, { borderBottomColor: t.hair }]}
      >
        {c.direct ? (
          <Avatar name={c.name} size={46} />
        ) : (
          // A group: its face with the others stacked behind.
          <View style={s.faces}>
            <Avatar name={c.name} size={38} />
            <View style={[s.more, { backgroundColor: t.fill2, borderColor: t.canvas }]}>
              <Text style={[s.moreText, { color: t.fg2 }]}>
                {c.members > 99 ? "99+" : `+${c.members - 1}`}
              </Text>
            </View>
          </View>
        )}
        <View style={s.words}>
          <View style={s.line}>
            <Text style={[s.name, { color: t.fg }]} numberOfLines={1}>
              {c.name}
            </Text>
            <Text style={[s.time, { color: c.unread ? t.accent : t.fg3 }]}>
              {c.last ? when(c.last.at) : ""}
            </Text>
          </View>
          <View style={s.line}>
            <Text style={[s.last, { color: t.fg2 }]} numberOfLines={1}>
              {last}
            </Text>
            {c.unread ? <Badge n={c.unread} /> : null}
          </View>
        </View>
      </Tap>
    );
  };

  const searchRow = (
    <View style={s.search}>
      <View style={[s.searchBox, { backgroundColor: t.fill }]}>
        <Magnifier colour={t.fg2} size={16} />
        <TextInput
          ref={searchBox}
          accessibilityLabel="Search chats, people and lists"
          placeholder="Search chats, people and lists"
          placeholderTextColor={t.fg3}
          value={query}
          onChangeText={setQuery}
          autoFocus={!!startQuery}
          autoCorrect={false}
          returnKeyType="search"
          style={[s.searchInput, type.body, { color: t.fg }]}
        />
        {query ? (
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Clear"
            onPress={() => setQuery("")}
            style={s.clear}
          >
            <Text style={{ color: t.fg2, fontSize: 18, fontWeight: "700" }}>×</Text>
          </Tap>
        ) : null}
      </View>
    </View>
  );

  const list = loading ? (
    <View style={{ gap: 12, paddingTop: 8 }}>
      {error ? <Text style={[type.small, { color: t.danger }]}>{error}</Text> : null}
      <Skeleton />
    </View>
  ) : q ? (
    <View style={{ gap: 10 }}>
      {shown.map((e) => (e.kind === "space" ? spaceTile(e) : chatRow(e)))}
      <SearchResults
        q={q}
        assistant={assistant}
        cards={needs}
        lists={today?.lists ?? []}
        others={shown.length > 0}
        onAsk={(words) => {
          setQuery("");
          openChat({ ask: words, send: "1" });
        }}
        onOpenCard={(card) => {
          setQuery("");
          if (card.waiting)
            router.push({
              pathname: "/process",
              params: { id: card.waiting.workflow_id, waiting: JSON.stringify(card.waiting) },
            });
          else openOnWeb(card);
        }}
        onOpenList={(id, sp) => {
          setQuery("");
          openList(id, undefined, sp);
        }}
        onOpenHit={(hit, words) => {
          setQuery("");
          if (hit.kind === "message") {
            router.push({
              pathname: "/talk",
              params: { id: hit.group_id, message: hit.message_id, q: words },
            });
            return;
          }
          if (hit.kind === "conversation") {
            openChat({ id: hit.chat_id });
            return;
          }
          if (hit.kind === "item") {
            const inSp = hit.space_id ? { space: hit.space_id } : {};
            if (hit.what === "list" || hit.what === "view")
              openList(hit.collection_id!, hit.what === "view" ? hit.id : undefined, hit.space_id);
            else if (hit.what === "workflow")
              router.push({ pathname: "/process", params: { id: hit.id, ...inSp } });
            else if (hit.what === "space")
              router.push({ pathname: "/space", params: { id: hit.space_id ?? "p" } });
            else if (hit.what === "memory") router.push("/memory");
            else void Linking.openURL(`${API_URL}/shared/${encodeURIComponent(hit.id)}`);
            return;
          }
          if (assistant) openChat({}, { kind: "record", title: hit.title, in: hit.collection });
          else openList(hit.collection_id);
        }}
      />
    </View>
  ) : (
    <View style={{ gap: 10 }}>
      {error ? <Text style={[type.small, { color: t.danger }]}>{error}</Text> : null}
      {needs.length ? (
        <Tap
          accessibilityRole="button"
          accessibilityLabel={`${needs.length === 1 ? "1 thing needs" : `${needs.length} things need`} you`}
          onPress={() => router.push("/needs")}
          scale={0.985}
          style={[s.needs, { backgroundColor: cardTint("time") }]}
        >
          <View style={[s.needsN, { backgroundColor: colour("time") }]}>
            <Text style={[s.needsNText, { color: t.tileInk }]}>
              {needs.length > 99 ? "99+" : needs.length}
            </Text>
          </View>
          <View style={s.words}>
            <Text style={[s.name, { color: t.fg }]}>
              {needs.length === 1 ? "1 thing needs you" : `${needs.length} things need you`}
            </Text>
            <Text style={[s.last, { color: t.fg2 }]} numberOfLines={1}>
              {needs[0]!.spec.title}
            </Text>
          </View>
          <Text style={[s.chev, { color: t.fg2 }]}>›</Text>
        </Tap>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <Tap
              key={f.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setFilter(f.key)}
              style={[s.filter, { backgroundColor: on ? t.accent : t.fill }]}
            >
              <Text style={[type.label, { color: on ? t.onAccent : t.fg }]}>{f.label}</Text>
            </Tap>
          );
        })}
      </ScrollView>
      {assistant && filter === "all" ? (
        <Tap
          ref={tourRefs.chat}
          accessibilityRole="button"
          accessibilityLabel="Assistant, only you see it"
          onPress={openAssistant}
          scale={0.985}
          style={[s.ai, { backgroundColor: t.ink, shadowColor: t.shadow }]}
        >
          <View style={[s.aiIcon, { backgroundColor: t.accent }]}>
            <Text style={[s.aiIconText, { color: t.onAccent }]}>✦</Text>
          </View>
          <View style={s.words}>
            <Text style={[s.name, { color: t.onInk }]}>Assistant</Text>
            <Text style={[s.last, { color: t.onInk, opacity: 0.8 }]} numberOfLines={2}>
              {watchingWords(coming, (u) => whenWords(u, now))}
            </Text>
          </View>
          <Text style={[s.chev, { color: t.onInk, opacity: 0.7 }]}>›</Text>
        </Tap>
      ) : null}
      {shown.map((e) => (e.kind === "space" ? spaceTile(e) : chatRow(e)))}
      {!shown.length ? (
        <Text style={[s.empty, { color: t.fg3 }]}>
          {filter === "unread"
            ? "Nothing unread."
            : filter === "chats"
              ? "No chats with people yet. Tap the pencil to start one."
              : "No spaces yet."}
        </Text>
      ) : null}
      {shared.length && filter === "all" ? (
        <View style={{ gap: 10, marginTop: 10 }}>
          <Text style={[type.eyebrow, { color: t.fg2 }]}>Shared with you</Text>
          {shared.map((card) => (
            <Boundary key={card.id} where="shared with you">
              <Card card={card} natural onOpen={() => openOnWeb(card)} />
            </Boundary>
          ))}
        </View>
      ) : null}
      <Text style={[s.foot, { color: t.fg3 }]}>A group chat becomes a space once it has lists.</Text>
    </View>
  );

  return (
    <View style={[s.root, { backgroundColor: t.canvas, paddingTop: insets.top }]}>
      <View style={[s.head, wide && s.wideRow]}>
        <View style={{ flex: 1 }}>
          <Text style={[type.display, { color: t.fg }]}>Chats</Text>
          {stale ? <Text style={[type.caption, { color: t.fg3 }]}>Updating…</Text> : null}
        </View>
        <Tap
          ref={tourRefs.search}
          accessibilityRole="button"
          accessibilityLabel="Search"
          onPress={showSearch}
          scale={0.92}
          style={[s.round, { backgroundColor: t.cell, shadowColor: t.shadow }]}
        >
          <Magnifier colour={t.fg} size={20} />
        </Tap>
        <Tap
          ref={tourRefs.help}
          accessibilityRole="button"
          accessibilityLabel="Help"
          onPress={() => setHelp(true)}
          scale={0.92}
          style={[s.round, { backgroundColor: t.cell, shadowColor: t.shadow }]}
        >
          <Text style={{ color: t.fg, fontSize: 18, fontWeight: "800", lineHeight: 20 }}>?</Text>
        </Tap>
        {/* The library: every list, workflow and practice copy, by space. */}
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Library"
          onPress={() => router.push("/library")}
          scale={0.92}
          style={[s.round, { backgroundColor: t.cell, shadowColor: t.shadow }]}
        >
          <View style={s.gridIcon}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[s.gridDot, { borderColor: t.fg }]} />
            ))}
          </View>
        </Tap>
      </View>
      <ScrollView
        ref={scroller}
        // The search box starts above the top edge (the iPhone opens there; elsewhere it scrolls
        // there once the list is laid out).
        contentOffset={tucked.current ? undefined : { x: 0, y: SEARCH_H }}
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => {
          if (tucked.current || !viewH || h < viewH + SEARCH_H - 1) return;
          tucked.current = true;
          scroller.current?.scrollTo({ y: SEARCH_H, animated: false });
        }}
        contentContainerStyle={{
          width: wide ? COLUMN + SIDE * 2 : "100%",
          alignSelf: "center",
          paddingHorizontal: SIDE,
          paddingBottom: insets.bottom + 120,
          minHeight: viewH ? viewH + SEARCH_H : "100%",
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([load(), reloadChats()]);
              setRefreshing(false);
            }}
            tintColor={t.fg2}
          />
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {searchRow}
        {list}
      </ScrollView>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {failed[0] ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={() => dropFailed(failed[0]!.id)}
            style={[s.failed, { backgroundColor: t.cell, borderColor: t.danger }]}
          >
            <Text style={[s.failedText, { color: t.fg }]} numberOfLines={2}>
              Couldn't save “{failed[0].label}”: {failed[0].reason}
            </Text>
            <Text style={{ color: t.accent, fontWeight: "700", fontSize: 13 }}>OK</Text>
          </Pressable>
        ) : null}
        <Tap
          accessibilityRole="button"
          accessibilityLabel="New chat or space"
          onPress={() => setMaking(true)}
          scale={0.92}
          haptic="light"
          style={[s.fab, { backgroundColor: t.accent, shadowColor: t.shadow }]}
        >
          <Text style={{ color: t.onAccent, fontSize: 22, fontWeight: "800", lineHeight: 24 }}>✎</Text>
        </Tap>
      </View>

      <Sheet open={making} onClose={() => setMaking(false)} accessibilityLabel="New">
        <Text style={[type.title, { color: t.fg }]}>New</Text>
        <Tap
          accessibilityRole="button"
          onPress={() => {
            setMaking(false);
            setStarting(true);
          }}
          style={[s.option, { backgroundColor: t.cell }]}
        >
          <Text style={[type.heading, { color: t.fg }]}>Chat with people</Text>
          <Text style={[type.small, { color: t.fg2 }]}>One person, or a group with a name</Text>
        </Tap>
        {assistant ? (
          <Tap
            accessibilityRole="button"
            onPress={() => {
              setMaking(false);
              openChat({ ask: "I'd like to start a new space for " });
            }}
            style={[s.option, { backgroundColor: t.cell }]}
          >
            <Text style={[type.heading, { color: t.fg }]}>A space</Text>
            <Text style={[type.small, { color: t.fg2 }]}>
              Its own chats, lists and people. Tell the assistant what it's for.
            </Text>
          </Tap>
        ) : null}
      </Sheet>
      <NewChat
        open={starting}
        onClose={() => setStarting(false)}
        onMade={(id) => {
          setStarting(false);
          void reloadChats();
          router.push({ pathname: "/talk", params: { id } });
        }}
      />
      <HelpSheet
        open={help}
        onClose={() => setHelp(false)}
        actions={[
          {
            title: "Take the tour again",
            text: "A quick look around, under a minute",
            go: () => {
              if (userId) resetTour(userId);
              setTouring(true);
            },
          },
          {
            title: "Ideas for cards",
            text: "Lists, totals, countdowns, controls… see what cards can do",
            go: () => router.push("/gallery"),
          },
          ...(assistant
            ? [
                {
                  title: "How do I…?",
                  text: "Ask in the chat, in your own words",
                  go: () => openChat({ ask: "How do I " }),
                },
                {
                  title: "Quick and Careful",
                  text: "Quick answers everyday things in a second. Careful builds setups and takes harder questions; its replies say so.",
                  go: () => openChat({ ask: "What do you do as Quick, and what as Careful?", send: "1" }),
                },
              ]
            : []),
        ]}
      />
      {touring && userId ? (
        <Tour
          steps={tourSteps({ assistant, cards: false, pages: false })}
          refs={tourRefs}
          onDone={() => {
            markTourSeen(userId);
            setTouring(false);
          }}
          onStart={
            assistant && !(today?.spaces ?? []).some((sp) => sp.lists.length)
              ? {
                  label: "Tell me about your week",
                  go: () => openChat({ ask: "Here's my week: " }),
                }
              : undefined
          }
        />
      ) : null}
    </View>
  );
}

/** A magnifier drawn from a ring and a handle (the font's ⌕ is tiny on most phones). */
function Magnifier({ colour, size }: { colour: string; size: number }) {
  const ring = Math.round(size * 0.72);
  const line = Math.max(2, Math.round(size / 9));
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{ width: ring, height: ring, borderRadius: ring / 2, borderWidth: line, borderColor: colour }}
      />
      <View
        style={{
          position: "absolute",
          width: Math.round(size * 0.42),
          height: line,
          borderRadius: line,
          backgroundColor: colour,
          right: -1,
          bottom: Math.round(size * 0.12),
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

function Badge({ n }: { n: number }) {
  const { t } = useTheme();
  return (
    <View style={[s.badge, { backgroundColor: t.accent }]}>
      <Text style={[s.badgeText, { color: t.onAccent }]}>{n > 99 ? "99+" : n}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: SIDE,
    paddingTop: 10,
    paddingBottom: 6,
  },
  wideRow: { alignSelf: "center", width: "100%", maxWidth: COLUMN + SIDE * 2 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  gridIcon: { width: 18, height: 18, flexDirection: "row", flexWrap: "wrap", gap: 3 },
  gridDot: { width: 7.5, height: 7.5, borderRadius: 2, borderWidth: 1.75 },
  search: { height: SEARCH_H, justifyContent: "center" },
  searchBox: {
    minHeight: 44,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 4,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    ...(Platform.OS === "web" ? ({ outlineWidth: 0, outlineStyle: "none" } as object) : {}),
  },
  clear: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  needs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.row,
  },
  needsN: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  needsNText: { fontSize: 14, fontWeight: "800" },
  filters: { gap: 6, paddingVertical: 2 },
  filter: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  ai: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: radius.card,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  aiIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  aiIconText: { fontSize: 20, fontWeight: "800" },
  tile: { flexDirection: "row", gap: 12, padding: 12, borderRadius: radius.card },
  square: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  squareText: { fontSize: 19, fontWeight: "800" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  faces: { width: 46, height: 46 },
  more: {
    position: "absolute",
    right: -2,
    bottom: -2,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  moreText: { fontSize: 10, fontWeight: "800" },
  words: { flex: 1, minWidth: 0, gap: 4 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: "700", letterSpacing: -0.2 },
  kind: { fontSize: 14, fontWeight: "600" },
  time: { fontSize: 12.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  last: { flex: 1, fontSize: 14, lineHeight: 19 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 12.5, fontWeight: "700" },
  chev: { fontSize: 22, fontWeight: "600" },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "800" },
  empty: { fontSize: 14, paddingVertical: 10 },
  foot: { fontSize: 13, marginTop: 14, paddingRight: 72 },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: SIDE,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  option: { borderRadius: radius.row, padding: 14, gap: 4, minHeight: 56 },
  failed: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  failedText: { flex: 1, fontSize: 13 },
});
