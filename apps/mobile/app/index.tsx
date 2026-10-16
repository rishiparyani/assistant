// The home (docs/design/home-first.md §2): pages of cards, the chat bar under them. Two pages
// for now: Now (arranged by the assistant) and My day (the person's: hold and move to arrange,
// hold for the card's menu). Ticks work offline; the chat is one tap away.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Text } from "@assistant/cards/native";
import { Boundary, Skeleton, Tap } from "@assistant/cards/native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { nextUp, type CardSize } from "@assistant/cards";
import type { StoredValue } from "@assistant/shared";
import { Card, CardGrid, HeroCard } from "@assistant/cards/native";
import { CardMenu } from "@/components/CardMenu";
import { HomeBar } from "@/components/HomeBar";
import { HelpSheet } from "@/components/HelpSheet";
import { Tour, markTourSeen, resetTour, tourSeen, tourSteps, type TourRefs } from "@/components/Tour";
import { API_URL } from "@/config";
import {
  answerWaiting,
  loadHome,
  savedHome,
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
  // True while what's on screen is the device's saved copy and the fresh one is on its way.
  const [stale, setStale] = useState(false);
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
  // One bar asks and searches (decision 2026-10-16 "One bar"): both tour steps point at it.
  const barRef = useRef<View>(null);
  const tourRefs = {
    chat: barRef,
    cards: useRef<View>(null),
    pages: useRef<View>(null),
    search: barRef,
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
  // The saved home shows in the first frame (the owner, 2026-10-16: "the upper screen is
  // empty… a user might not know it's loading"); the fresh one replaces it when it arrives.
  useEffect(() => {
    if (!userId) return;
    const saved = savedHome(userId);
    if (saved) {
      setPages((p) => p ?? saved);
      setStale(true);
    }
    void load();
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
  // What's typed in the bar; while there's something, matches show above it over a scrim.
  const [barText, setBarText] = useState("");
  const [busyCard, setBusyCard] = useState<string | null>(null);

  // No hook below this line (the signed-out home crashed on the phone and the web, 2026-10-15:
  // a useState after this return made the first render one hook longer than the next).
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
    // A space's card opens that space's chat (decision 2026-10-16 "Spaces").
    router.push({
      pathname: "/chat",
      params: {
        card: card.spec.title,
        ...(prompt ? { ask: prompt } : {}),
        ...(card.space ? { space: card.space } : {}),
      },
    });
  };
  /** A whole list, on its own screen (its saved view chosen when the card is one). */
  const openList = (collection: string, view?: string, space?: string) =>
    router.push({
      pathname: "/list",
      params: { collection, ...(view ? { view } : {}), ...(space ? { space } : {}) },
    });
  // Process cards: my answer, or a nudge; then the home reads again (the run went on).
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
  // Before anything has loaded: the greeting and the date (nothing to wait for) over soft
  // placeholder cards, never a blank page.
  const shownPages: HomePage[] = pages ?? [{ name: "Now", auto: true, cards: [] }];
  const loading = pages === null;
  const renderPage = (item: HomePage, index: number) => (
    <View key={item.space?.id ?? item.name} style={{ gap: 12 }}>
      {item.auto ? (
        // Now: today's date and a greeting, then what's next, big.
        <View style={s.greetRow}>
          <View style={s.greet}>
            <Text style={[s.eyebrow, { color: t.fg2 }]}>
              {todayWords(new Date(now))}
              {stale ? "  ·  Updating…" : ""}
            </Text>
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
          <Text style={[s.h2, { color: t.fg, flexShrink: 1 }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[s.metaText, { color: t.fg2 }]}>
            {item.space
              ? "your space · ask below"
              : item.lists
                ? "every list, whole"
                : "hold a card to arrange"}
          </Text>
        </View>
      )}
      {item.auto && next ? (
        // On a laptop it keeps a phone card's width, so its buttons stay buttons.
        <View style={wide ? s.heroWide : undefined}>
          <HeroCard next={next} now={now} onOpen={() => ask(next.card)} />
        </View>
      ) : null}
      {item.lists && !item.space ? (
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recently deleted"
            onPress={() => router.push("/trash")}
            style={({ pressed }) => [
              s.listTile,
              {
                backgroundColor: t.fill,
                shadowColor: "transparent",
                width: wide ? (gridWidth - 30) / 4 : (gridWidth - 10) / 2,
              },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            <Text style={[s.listName, { color: t.fg2 }]} numberOfLines={2}>
              Recently deleted
            </Text>
            <Text style={[s.listMeta, { color: t.fg3 }]}>Kept 30 days ›</Text>
          </Pressable>
        </View>
      ) : loading ? (
        <Skeleton />
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
              <Boundary where="home card">
                <Card
                  card={card}
                  onTick={onTick(card)}
                  onSet={onSet(card)}
                  onSeeAll={
                    card.collection && !card.shared && !card.waiting && !card.memory
                      ? () => canOpen() && openList(card.collection!.id, card.view?.id, card.space)
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
              </Boundary>
            )}
          />
        </View>
      ) : item.space ? (
        <View style={[s.empty, { backgroundColor: t.cell, borderColor: t.hair }]}>
          <Text style={[s.sub, { color: t.fg, fontWeight: "700", fontSize: 15 }]}>
            Nothing pinned in {item.space.name} yet.
          </Text>
          <Text style={[s.sub, { color: t.fg2 }]}>
            Ask below to start its lists; a card for each one lands here.
          </Text>
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
      {item.space && item.lists?.length ? (
        // A space's lists under its cards, each opening whole (in that space).
        <View style={s.lists}>
          {item.lists.map((l) => (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${l.name}`}
              onPress={() => openList(l.id, undefined, item.space!.id)}
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
      ) : null}
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
          {shownPages.map(renderPage)}
        </ScrollView>
      ) : (
        <FlatList
          ref={list}
          data={shownPages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(p) => p.space?.id ?? p.name}
          // The dots and the bar follow the page as it moves (a trackpad on the web never
          // sends a momentum end), settled again when the swipe ends.
          scrollEventThrottle={100}
          onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / pageWidth))}
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

      {barText.trim() ? (
        // While searching from the bar: a tap anywhere on the page closes the matches.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close search"
          onPress={() => setBarText("")}
          style={[StyleSheet.absoluteFill, { backgroundColor: t.shadow }]}
        />
      ) : null}
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
          {(wide ? [] : shownPages).map((p, i) => (
            <View
              key={p.space?.id ?? p.name}
              style={[s.dotI, { backgroundColor: i === page ? t.accent : t.fg3, width: i === page ? 18 : 7 }]}
            />
          ))}
        </View>
        <View style={[s.barRow, wide && s.wideRow]}>
          <Tap
            ref={tourRefs.help}
            accessibilityRole="button"
            accessibilityLabel="Help"
            onPress={() => setHelp(true)}
            scale={0.92}
            style={[s.searchBtn, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 18, fontWeight: "800", lineHeight: 20 }}>?</Text>
          </Tap>
          <HomeBar
            ref={barRef}
            assistant={!!assistant}
            text={barText}
            onChangeText={setBarText}
            space={wide ? undefined : shownPages[page]?.space}
            cards={(pages ?? []).flatMap((p) => p.cards)}
            lists={(pages ?? []).flatMap((p) =>
              (p.lists ?? []).map((l) => ({
                ...l,
                ...(p.space ? { space: p.space.id, space_name: p.space.name } : {}),
              })),
            )}
            onAsk={(words, space) =>
              router.push({
                pathname: "/chat",
                params: { ask: words, send: "1", ...(space ? { space } : {}) },
              })
            }
            onOpenCard={(card) =>
              card.collection && !card.shared
                ? openList(card.collection.id, card.view?.id, card.space)
                : assistant
                  ? ask(card)
                  : openOnWeb(card)
            }
            onOpenList={(id, space) => openList(id, undefined, space)}
            onOpenHit={(hit, q) => {
              if (hit.kind === "message") {
                router.push({ pathname: "/talk", params: { id: hit.group_id, message: hit.message_id, q } });
                return;
              }
              if (assistant)
                router.push({
                  pathname: "/chat",
                  params: { ask: `About "${hit.title}" in ${hit.collection}: ` },
                });
              else openList(hit.collection_id);
            }}
          />
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
                {
                  title: "Quick and Careful",
                  text: "Quick answers everyday things in a second. Careful builds setups and takes harder questions; its replies say so.",
                  go: () =>
                    router.push({
                      pathname: "/chat",
                      params: { ask: "What do you do as Quick, and what as Careful?", send: "1" },
                    }),
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
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  pageHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
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
