// The home (docs/design/home-first.md §2): pages of cards, the chat bar under them. Two pages
// for now: Now (arranged by the assistant) and My day (the person's: hold and move to arrange,
// hold for the card's menu). Ticks work offline; the chat is one tap away.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Text } from "@assistant/cards/native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { nextUp, type CardSize } from "@assistant/cards";
import type { StoredValue } from "@assistant/shared";
import { Card, CardGrid, HeroCard } from "@assistant/cards/native";
import { CardMenu } from "@/components/CardMenu";
import { SearchSheet } from "@/components/SearchSheet";
import { HelpSheet } from "@/components/HelpSheet";
import { Tour, markTourSeen, resetTour, tourSeen, tourSteps, type TourRefs } from "@/components/Tour";
import { API_URL } from "@/config";
import {
  answerWaiting,
  loadHome,
  nudgeWaiting,
  rememberHome,
  replaceCard,
  resize,
  saveOrder,
  setValue,
  stillShown,
  tick,
  unpin,
  type HomeCard,
  type HomePage,
  onHomeChanged,
} from "@/home";
import { dropFailed, outboxState, subscribe } from "@/outbox";
import { useSession } from "@/session";
import { useChats } from "@/chats";
import { useLive } from "@/live-socket";
import { colourFor, radius, useTheme } from "@/theme";
import { isOffline } from "@/api";
import { usePendingPath } from "@/intents";
import { useTestLaunch } from "@/test-launch";

const logoDark = require("../assets/logo-dark.png");
const SIDE = 16;
/** From this width the home is one dashboard (four columns) instead of swipeable pages. */
const WIDE = 900;
const DASH_MAX = 1180;

export default function Home() {
  const { me, loaded, refresh } = useSession();
  const { t, colour } = useTheme();
  // The clock the greeting, the date and Next up read: moves on at every minute.
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
  const { width } = useWindowDimensions();
  const [pages, setPages] = useState<HomePage[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [menu, setMenu] = useState<HomeCard | null>(null);
  const list = useRef<FlatList<HomePage>>(null);
  const [failed, setFailed] = useState(() => outboxState().failed);
  const userId = me?.user.id ?? null;
  useTestLaunch();
  usePendingPath();
  // Guidance (decision 2026-10-13 "Guide people, no presets"): the first-run tour lights up
  // the real parts of the home; Help ("?") takes it again, and has ideas and "How do I…?".
  const tourRefs = {
    chat: useRef<View>(null),
    cards: useRef<View>(null),
    pages: useRef<View>(null),
    search: useRef<View>(null),
    help: useRef<View>(null),
  } satisfies TourRefs;
  const [touring, setTouring] = useState(false);
  const [help, setHelp] = useState(false);

  // Loaded while changes were still waiting to be sent (offline): load again once they are,
  // so the screen shows what the server now has.
  const loadedWithWaiting = useRef(false);
  // Every load also asks who I am again (the assistant switch can change while the app is
  // open); kept in a ref so a fresh `me` doesn't make `load` a new function and load again.
  const refreshMe = useRef(refresh);
  refreshMe.current = refresh;
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      loadedWithWaiting.current = outboxState().waiting.length > 0;
      void refreshMe.current();
      setPages(await loadHome(userId));
      setError("");
    } catch (e) {
      setError(
        isOffline(e)
          ? "Offline, and nothing saved on this device yet."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }, [userId]);
  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);
  // The tour, once per person on this device, when the home has loaded.
  const homeReady = pages !== null;
  useEffect(() => {
    if (userId && homeReady && !tourSeen(userId)) setTouring(true);
  }, [userId, homeReady]);
  useEffect(() => onHomeChanged(() => void load()), [load]);
  // Live: when something on my cards changes elsewhere (another phone, a bandmate), load again,
  // a moment later so a burst of changes loads once. Not while my own changes are still on their
  // way (that load follows when they're sent).
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
  // A change the server refused: say so, and show the home as the server has it.
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

  // Every change to the pages shows at once and is kept on the device. Worked out from the
  // latest pages here (not in a state updater: the changes also queue outbox sends).
  const pagesRef = useRef<HomePage[] | null>(null);
  pagesRef.current = pages;
  const update = useCallback(
    (fn: (prev: HomePage[]) => HomePage[]) => {
      const prev = pagesRef.current;
      if (!prev) return;
      const next = fn(prev);
      pagesRef.current = next;
      setPages(next);
      if (userId) rememberHome(userId, next);
    },
    [userId],
  );

  // Chats with something unread (the dot on the Chats button); refreshes on live pings.
  const unread = (useChats().chats ?? []).filter((c) => c.unread > 0).length;
  const [search, setSearch] = useState(false);

  if (loaded && !me) return <Redirect href="/login" />;

  const onTick = (card: HomeCard) => (record: Parameters<typeof tick>[1], value: boolean) => {
    update((prev) => {
      const current = prev.flatMap((p) => p.cards).find((c) => c.id === card.id) ?? card;
      const records = current.records.map((r) => (r.id === record.id ? tick(current, r, value) : r));
      return replaceCard(prev, { ...current, records });
    });
    // Ticked off a card that only shows what's open ("Today"): it stays a beat, struck
    // through with its box filled, then slides away (the motion demo the owner approved).
    const field = card.spec.sources[0]?.answer_field;
    const after = field ? { ...record, values: { ...record.values, [field]: value } } : record;
    if (value && !stillShown(card, after, userId))
      setTimeout(
        () =>
          update((prev) => {
            const current = prev.flatMap((p) => p.cards).find((c) => c.id === card.id);
            if (!current) return prev;
            const records = current.records.filter(
              (r) => r.id !== record.id || stillShown(current, r, userId),
            );
            return replaceCard(prev, { ...current, records });
          }),
        650,
      );
  };
  const onSet = (card: HomeCard) => (record: Parameters<typeof tick>[1], field: string, value: StoredValue) =>
    update((prev) => {
      const current = prev.flatMap((p) => p.cards).find((c) => c.id === card.id) ?? card;
      // A row the change takes out of the card's filters leaves it ("Paid" on "Unpaid").
      const records = current.records.flatMap((r) => {
        if (r.id !== record.id) return [r];
        const next = setValue(current, r, field, value);
        return stillShown(current, next, userId) ? [next] : [];
      });
      return replaceCard(prev, { ...current, records });
    });
  const assistant = me?.assistant !== false;
  // online-only: the website's shared pages (a form to fill in, a card's parts) open in the browser.
  const openOnWeb = (card: HomeCard) =>
    card.shared && void Linking.openURL(`${API_URL}/shared/${encodeURIComponent(card.shared.share_id)}`);
  const ask = (card: HomeCard, prompt?: string) => {
    // No assistant (a collaborator): a shared card opens on the website instead of in the chat.
    if (!assistant && card.shared) return openOnWeb(card);
    if (!assistant) return;
    router.push({ pathname: "/chat", params: { card: card.spec.title, ...(prompt ? { ask: prompt } : {}) } });
  };
  /** A whole list, on its own screen (its saved view chosen when the card is one). */
  const openList = (collection: string, view?: string) =>
    router.push({ pathname: "/list", params: { collection, ...(view ? { view } : {}) } });
  // Process cards: my answer, or a nudge; then the home reads again (the run went on).
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const processAction = (card: HomeCard, go: () => Promise<unknown>) => async () => {
    setBusyCard(card.id);
    try {
      await go();
      await load();
      // The run goes on from the space's alarm a moment later (it may ask the next question):
      // read once more so the next step shows without a pull.
      setTimeout(() => void load(), 1500);
    } catch (e) {
      setError(isOffline(e) ? "Answering needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusyCard(null);
    }
  };
  const menuActions = {
    ask,
    resize: (card: HomeCard, size: CardSize) => update((prev) => replaceCard(prev, resize(card, size))),
    unpin: (card: HomeCard) => {
      unpin(card);
      update((prev) => prev.map((p) => ({ ...p, cards: p.cards.filter((c) => c.id !== card.id) })));
    },
  };
  const reorder = (pageIndex: number) => (from: number, to: number) =>
    update((prev) =>
      prev.map((p, i) => {
        if (i !== pageIndex) return p;
        const cards = [...p.cards];
        const [moved] = cards.splice(from, 1);
        if (moved) cards.splice(to, 0, moved);
        return { ...p, cards };
      }),
    );
  const dropped = (pageIndex: number) => () =>
    update((prev) => prev.map((p, i) => (i !== pageIndex ? p : { ...p, cards: saveOrder(p.cards) })));

  // A laptop or a wide window (home-first.md §2 point 17): the pages flatten into one
  // dashboard, four columns of cards, the same cards and data; the chat stays one tap away.
  const wide = width >= WIDE;
  const pageWidth = wide ? Math.min(width, DASH_MAX) : width;
  const gridWidth = pageWidth - SIDE * 2;
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
      tintColor={t.fg2}
    />
  );
  // The soonest thing coming up across every card (decision 2026-10-13 "A warmer home").
  const next = nextUp(
    (pages ?? []).flatMap((p) => p.cards),
    now,
  );
  const renderPage = (item: HomePage, index: number) => (
    <View key={item.name} style={{ gap: 12 }}>
      {item.auto ? (
        // Now: today's date and a greeting, then what's next, big.
        <View style={s.greetRow}>
          <View style={s.greet}>
            <Text style={[s.eyebrow, { color: t.fg2 }]}>{todayWords(new Date(now))}</Text>
            <Text style={[s.h2, { color: t.fg }]}>{greeting(me?.user.name, new Date(now))}</Text>
          </View>
          {/* Chats with people (decision 2026-10-13 "Chats with people"), with a dot when
              something's unread. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unread ? `Chats, ${unread} with new messages` : "Chats"}
            onPress={() => router.push("/chats")}
            style={({ pressed }) => [
              s.searchBtn,
              { backgroundColor: t.cell, shadowColor: t.shadow, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={[s.bubbleIcon, { borderColor: t.fg }]} />
            {unread ? (
              <View style={[s.unread, { backgroundColor: t.accent, borderColor: t.cell }]}>
                <Text style={[s.unreadText, { color: t.onAccent }]}>{unread > 9 ? "9+" : unread}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      ) : (
        <View style={s.pageHead}>
          <Text style={[s.h2, { color: t.fg }]}>{item.name}</Text>
          <Text style={[s.metaText, { color: t.fg2 }]}>
            {item.lists ? "every list, whole" : "hold a card to arrange"}
          </Text>
        </View>
      )}
      {item.auto && next ? (
        // On a laptop it keeps a phone card's width, so its buttons stay buttons.
        <View style={wide ? s.heroWide : undefined}>
          <HeroCard next={next} now={now} onOpen={() => ask(next.card)} />
        </View>
      ) : null}
      {item.lists ? (
        // All lists: a tile per list, each opening its whole list.
        <View style={s.lists}>
          {item.lists.map((l) => (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${l.name}`}
              onPress={() => openList(l.id)}
              style={({ pressed }) => [
                s.listTile,
                {
                  backgroundColor: t.cell,
                  shadowColor: t.shadow,
                  width: wide ? (gridWidth - 30) / 4 : (gridWidth - 10) / 2,
                },
                pressed && { transform: [{ scale: 0.97 }] },
              ]}
            >
              <View style={[s.listDot, { backgroundColor: colour(colourFor(l.name)) }]} />
              <Text style={[s.listName, { color: t.fg }]} numberOfLines={2}>
                {l.name}
              </Text>
              <Text style={[s.listMeta, { color: t.fg2 }]}>See all ›</Text>
            </Pressable>
          ))}
        </View>
      ) : item.cards.length ? (
        <View ref={index === (wide ? 0 : page) ? tourRefs.cards : undefined} collapsable={false}>
          <CardGrid
            cards={item.cards}
            width={gridWidth}
            arrangeable={!item.auto}
            onHold={setMenu}
            onReorder={reorder(index)}
            onDrop={dropped(index)}
            renderCard={(card, canOpen) => (
              <Card
                card={card}
                onTick={onTick(card)}
                onSet={onSet(card)}
                onSeeAll={
                  card.collection && !card.shared && !card.waiting && !card.memory
                    ? () => canOpen() && openList(card.collection!.id, card.view?.id)
                    : undefined
                }
                onOpen={() =>
                  canOpen() &&
                  (card.memory
                    ? router.push("/memory")
                    : card.waiting
                      ? router.push({
                          pathname: "/process",
                          params: { id: card.waiting.workflow_id, waiting: JSON.stringify(card.waiting) },
                        })
                      : card.shared?.kind === "form"
                        ? openOnWeb(card)
                        : ask(card))
                }
                onAnswer={
                  card.waiting
                    ? (answer) => void processAction(card, () => answerWaiting(card.waiting!, answer))()
                    : undefined
                }
                onNudge={
                  card.waiting?.share_id
                    ? undefined
                    : card.waiting
                      ? processAction(card, () => nudgeWaiting(card.waiting!))
                      : undefined
                }
                busy={busyCard === card.id}
              />
            )}
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tell me about your week"
          disabled={!pages || !assistant}
          onPress={() => router.push({ pathname: "/chat", params: { ask: "Here's my week: " } })}
          style={[s.empty, { backgroundColor: t.cell, borderColor: t.hair }]}
        >
          <Text style={[s.sub, { color: t.fg, fontWeight: "700", fontSize: 15 }]}>
            {error
              ? error
              : !pages
                ? "Loading…"
                : assistant
                  ? "Tell me about your week"
                  : "Nothing shared with you yet"}
          </Text>
          {pages && !error ? (
            <Text style={[s.sub, { color: t.fg2 }]}>
              {assistant
                ? "What you do, what you keep forgetting, what money moves. The lists you need start from that, each with a card here."
                : "When someone shares a list, a card or a question with you, it shows here."}
            </Text>
          ) : null}
        </Pressable>
      )}
    </View>
  );
  return (
    <View style={[s.root, { backgroundColor: t.canvas }]}>
      {wide ? (
        <ScrollView
          contentContainerStyle={{
            width: pageWidth,
            alignSelf: "center",
            paddingTop: insets.top + 20,
            paddingHorizontal: SIDE,
            paddingBottom: insets.bottom + 150,
            gap: 28,
          }}
          refreshControl={refreshControl}
        >
          {(pages ?? []).map(renderPage)}
        </ScrollView>
      ) : (
        <FlatList
          ref={list}
          data={pages ?? []}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(p) => p.name}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / pageWidth))}
          renderItem={({ item, index }) => (
            <ScrollView
              style={{ width: pageWidth }}
              contentContainerStyle={{
                paddingTop: insets.top + 12,
                paddingHorizontal: SIDE,
                paddingBottom: insets.bottom + 150,
                gap: 10,
              }}
              refreshControl={refreshControl}
            >
              {renderPage(item, index)}
            </ScrollView>
          )}
        />
      )}

      <View
        style={[s.bottom, { paddingBottom: insets.bottom + 10, backgroundColor: t.page }]}
        pointerEvents="box-none"
      >
        {failed[0] ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={() => dropFailed(failed[0]!.id)}
            style={[s.failed, wide && s.wideRow, { backgroundColor: t.cell, borderColor: t.danger }]}
          >
            <Text style={[s.failedText, { color: t.fg }]} numberOfLines={2}>
              Couldn't save “{failed[0].label}”: {failed[0].reason}
            </Text>
            <Text style={{ color: t.accent, fontWeight: "700", fontSize: 13 }}>OK</Text>
          </Pressable>
        ) : null}
        <View ref={tourRefs.pages} collapsable={false} style={s.dots}>
          {(wide ? [] : (pages ?? [])).map((p, i) => (
            <View
              key={p.name}
              style={[s.dotI, { backgroundColor: i === page ? t.accent : t.fg3, width: i === page ? 18 : 7 }]}
            />
          ))}
        </View>
        <View style={[s.barRow, wide && s.wideRow]}>
          <Pressable
            ref={tourRefs.help}
            accessibilityRole="button"
            accessibilityLabel="Help"
            onPress={() => setHelp(true)}
            style={({ pressed }) => [
              s.searchBtn,
              { backgroundColor: t.cell, shadowColor: t.shadow, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={{ color: t.fg, fontSize: 18, fontWeight: "800", lineHeight: 20 }}>?</Text>
          </Pressable>
          {assistant ? (
            <Pressable
              ref={tourRefs.search}
              accessibilityRole="button"
              accessibilityLabel="Search"
              onPress={() => setSearch(true)}
              style={({ pressed }) => [
                s.searchBtn,
                { backgroundColor: t.cell, shadowColor: t.shadow, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={{ color: t.fg, fontSize: 20, fontWeight: "700", lineHeight: 22 }}>⌕</Text>
            </Pressable>
          ) : null}
          <Pressable
            ref={assistant ? tourRefs.chat : tourRefs.search}
            accessibilityRole="button"
            accessibilityLabel={assistant ? "Ask Gigspree" : "Search your cards"}
            onPress={() => (assistant ? router.push("/chat") : setSearch(true))}
            style={({ pressed }) => [
              s.bar,
              { backgroundColor: t.ink, shadowColor: t.shadow, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Image source={logoDark} style={{ width: 26, height: 26 }} accessibilityIgnoresInvertColors />
            <Text style={[s.barText, { color: t.onInk }]} numberOfLines={1}>
              {assistant ? "Ask, add or arrange…" : "Search your cards"}
            </Text>
            <View style={[s.send, { backgroundColor: t.accent }]}>
              <Text style={{ color: t.onAccent, fontSize: 17, fontWeight: "800", lineHeight: 19 }}>↑</Text>
            </View>
          </Pressable>
        </View>
      </View>
      <CardMenu card={menu} onClose={() => setMenu(null)} actions={menuActions} />
      <HelpSheet
        open={help}
        onClose={() => setHelp(false)}
        actions={[
          {
            title: "Take the tour again",
            text: "A quick look around the home, under a minute",
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
                  go: () => router.push({ pathname: "/chat", params: { ask: "How do I " } }),
                },
              ]
            : []),
        ]}
      />
      {touring && userId ? (
        <Tour
          steps={tourSteps({
            assistant,
            cards: (pages ?? []).some((p) => p.cards.length > 0),
            pages: !wide && (pages ?? []).length > 1,
          })}
          refs={tourRefs}
          onDone={() => {
            markTourSeen(userId);
            setTouring(false);
          }}
          onStart={
            assistant && !(pages ?? []).some((p) => p.cards.length > 0)
              ? {
                  label: "Tell me about your week",
                  go: () => router.push({ pathname: "/chat", params: { ask: "Here's my week: " } }),
                }
              : undefined
          }
        />
      ) : null}
      {search ? (
        <SearchSheet
          cards={pagesRef.current?.flatMap((p) => p.cards) ?? []}
          lists={pagesRef.current?.find((p) => p.lists)?.lists ?? []}
          onOpenList={(id) => {
            setSearch(false);
            openList(id);
          }}
          onClose={() => setSearch(false)}
          onOpen={(card) => {
            setSearch(false);
            if (assistant) ask(card);
            else openOnWeb(card);
          }}
          onOpenResult={(hit) => {
            setSearch(false);
            if (assistant)
              router.push({
                pathname: "/chat",
                params: { ask: `About "${hit.title}" in ${hit.collection}: ` },
              });
          }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  pageHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  h2: { fontSize: 30, fontWeight: "800", letterSpacing: -1 },
  greet: { flex: 1, gap: 2, paddingHorizontal: 4 },
  greetRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bubbleIcon: { width: 20, height: 16, borderRadius: 6, borderWidth: 2, borderBottomLeftRadius: 2 },
  unread: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { fontSize: 10, fontWeight: "800" },
  heroWide: { maxWidth: 560 },
  lists: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  listTile: {
    minHeight: 104,
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
    justifyContent: "space-between",
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  listDot: { width: 12, height: 12, borderRadius: 4 },
  listName: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  listMeta: { fontSize: 12.5, fontWeight: "700" },
  eyebrow: { fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  metaText: { fontSize: 12, fontWeight: "600" },
  empty: {
    borderRadius: radius.card,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  sub: { fontSize: 14, textAlign: "center" },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 21,
  },
  /** On a laptop the bar keeps a phone's width, centred under the dashboard. */
  wideRow: { alignSelf: "center", width: "100%", maxWidth: 640 },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dotI: { height: 7, borderRadius: 4 },
  searchBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  barRow: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 8 },
  bar: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 14,
    paddingRight: 9,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  barText: { flex: 1, fontSize: 15, fontWeight: "600", opacity: 0.75 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
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

/** "TUE 13 OCT", India time. */
function todayWords(now = new Date()): string {
  const d = new Date(now.getTime() + 330 * 60_000);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Good morning, Rishi" by the India-time hour; the first name only. */
function greeting(name: string | undefined, now = new Date()): string {
  const h = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  const part = h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}
