// The home (docs/design/home-first.md §2): pages of cards, the chat bar under them. Two pages
// for now: Now (arranged by the assistant) and My day (the person's: hold and move to arrange,
// hold for the card's menu). Ticks work offline; the chat is one tap away.
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
import type { CardSize } from "@assistant/shared";
import { Card } from "@/components/Card";
import { CardGrid } from "@/components/CardGrid";
import { CardMenu } from "@/components/CardMenu";
import {
  answerWaiting,
  loadHome,
  nudgeWaiting,
  rememberHome,
  replaceCard,
  resize,
  saveOrder,
  tick,
  unpin,
  type HomeCard,
  type HomePage,
} from "@/home";
import { dropFailed, outboxState, subscribe } from "@/outbox";
import { useSession } from "@/session";
import { radius, useTheme } from "@/theme";
import { isOffline } from "@/api";
import { useTestLaunch } from "@/test-launch";

const logoLight = require("../assets/logo-light.png");
const logoDark = require("../assets/logo-dark.png");
const SIDE = 16;

export default function Home() {
  const { me, loaded } = useSession();
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

  // Loaded while changes were still waiting to be sent (offline): load again once they are,
  // so the screen shows what the server now has.
  const loadedWithWaiting = useRef(false);
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      loadedWithWaiting.current = outboxState().waiting.length > 0;
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
  const ask = (card: HomeCard, prompt?: string) =>
    router.push({ pathname: "/chat", params: { card: card.spec.title, ...(prompt ? { ask: prompt } : {}) } });
  // Process cards: my answer, or a nudge; then the home reads again (the run went on).
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const processAction = (card: HomeCard, go: () => Promise<unknown>) => async () => {
    setBusyCard(card.id);
    try {
      await go();
      await load();
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

  const pageWidth = width;
  const gridWidth = width - SIDE * 2;
  return (
    <View style={[s.root, { backgroundColor: t.canvas }]}>
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
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true);
                  await load();
                  setRefreshing(false);
                }}
                tintColor={t.fg2}
              />
            }
          >
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
                    onOpen={() => canOpen() && ask(card)}
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
              <View style={[s.empty, { backgroundColor: t.cell, borderColor: t.hair }]}>
                <Text style={[s.sub, { color: t.fg2 }]}>
                  {error || (pages ? "Nothing here yet. Ask the chat to pin something." : "Loading…")}
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      />

      <View style={[s.bottom, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
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
        <View style={s.dots}>
          {(pages ?? []).map((p, i) => (
            <View
              key={p.name}
              style={[s.dotI, { backgroundColor: i === page ? t.accent : t.fg3, width: i === page ? 18 : 7 }]}
            />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask Gigspree"
          onPress={() => router.push("/chat")}
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
          <Text style={[s.barText, { color: t.fg2 }]}>Ask, add or arrange…</Text>
        </Pressable>
      </View>
      <CardMenu card={menu} onClose={() => setMenu(null)} actions={menuActions} />
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
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dotI: { height: 7, borderRadius: 4 },
  bar: {
    alignSelf: "stretch",
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
