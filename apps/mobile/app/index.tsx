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
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CardSize } from "@assistant/cards";
import type { StoredValue } from "@assistant/shared";
import { Card, CardGrid } from "@assistant/cards/native";
import { CardMenu } from "@/components/CardMenu";
import { SearchSheet } from "@/components/SearchSheet";
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
  tick,
  unpin,
  type HomeCard,
  type HomePage,
  onHomeChanged,
} from "@/home";
import { dropFailed, outboxState, subscribe } from "@/outbox";
import { useSession } from "@/session";
import { radius, useTheme } from "@/theme";
import { isOffline } from "@/api";
import { usePendingPath } from "@/intents";
import { useTestLaunch } from "@/test-launch";

const logoLight = require("../assets/logo-light.png");
const logoDark = require("../assets/logo-dark.png");
const SIDE = 16;
/** From this width the home is one dashboard (four columns) instead of swipeable pages. */
const WIDE = 900;
const DASH_MAX = 1180;

export default function Home() {
  const { me, loaded, refresh } = useSession();
  const { t, dark } = useTheme();
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
  useEffect(() => onHomeChanged(() => void load()), [load]);
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

  if (loaded && !me) return <Redirect href="/login" />;

  const onTick = (card: HomeCard) => (record: Parameters<typeof tick>[1], value: boolean) =>
    update((prev) => {
      const current = prev.flatMap((p) => p.cards).find((c) => c.id === card.id) ?? card;
      const records = current.records.map((r) => (r.id === record.id ? tick(current, r, value) : r));
      return replaceCard(prev, { ...current, records });
    });
  const onSet = (card: HomeCard) => (record: Parameters<typeof tick>[1], field: string, value: StoredValue) =>
    update((prev) => {
      const current = prev.flatMap((p) => p.cards).find((c) => c.id === card.id) ?? card;
      const records = current.records.map((r) =>
        r.id === record.id ? setValue(current, r, field, value) : r,
      );
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
  const [search, setSearch] = useState(false);
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
  const renderPage = (item: HomePage, index: number) => (
    <View key={item.name} style={{ gap: 10 }}>
      <View style={s.pageHead}>
        <Text style={[s.h2, { color: t.fg }]}>{item.name}</Text>
        <View style={s.meta}>
          {item.auto ? <View style={[s.pulse, { backgroundColor: t.accent }]} /> : null}
          <Text style={[s.metaText, { color: t.fg2 }]}>
            {item.auto ? "arranged for you" : "hold a card to arrange"}
          </Text>
        </View>
      </View>
      {item.cards.length ? (
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

      <View style={[s.bottom, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
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
        <View style={s.dots}>
          {(wide ? [] : (pages ?? [])).map((p, i) => (
            <View
              key={p.name}
              style={[s.dotI, { backgroundColor: i === page ? t.accent : t.fg3, width: i === page ? 18 : 7 }]}
            />
          ))}
        </View>
        <View style={[s.barRow, wide && s.wideRow]}>
          {assistant ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search"
              onPress={() => setSearch(true)}
              style={({ pressed }) => [
                s.searchBtn,
                { backgroundColor: t.glass, borderColor: t.hair, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={{ color: t.fg2, fontSize: 18, lineHeight: 20 }}>⌕</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={assistant ? "Ask Gigspree" : "Search your cards"}
            onPress={() => (assistant ? router.push("/chat") : setSearch(true))}
            style={({ pressed }) => [
              s.bar,
              { backgroundColor: t.glass, borderColor: t.hair, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Image
              source={dark ? logoDark : logoLight}
              style={{ width: 28, height: 28 }}
              accessibilityIgnoresInvertColors
            />
            <Text style={[s.barText, { color: t.fg2 }]}>
              {assistant ? "Ask, add or arrange…" : "Search your cards"}
            </Text>
          </Pressable>
        </View>
      </View>
      <CardMenu card={menu} onClose={() => setMenu(null)} actions={menuActions} />
      {search ? (
        <SearchSheet
          cards={pagesRef.current?.flatMap((p) => p.cards) ?? []}
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
  h2: { fontSize: 26, fontWeight: "800", letterSpacing: -1 },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontWeight: "600" },
  pulse: { width: 8, height: 8, borderRadius: 4 },
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
    paddingHorizontal: 21,
  },
  /** On a laptop the bar keeps a phone's width, centred under the dashboard. */
  wideRow: { alignSelf: "center", width: "100%", maxWidth: 640 },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dotI: { height: 7, borderRadius: 4 },
  searchBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  barRow: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 8 },
  bar: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  barText: { fontSize: 15, fontWeight: "600" },
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
