// Today (docs/design/from-scratch.md §2.2 and §3, FS1; approved 2026-10-24): the first screen,
// sorted by what needs the person: questions and forms first, then what's coming up across
// every space, then chats, then spaces with their lists. Nobody arranges it, so it can never go
// blank. The switcher under the greeting is a shortcut (the three spaces used last, then More),
// not a filter people need. The bar at the bottom is the chat.
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Boundary, Card, Skeleton, Tap, Text, TextInput } from "@assistant/cards/native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RecordSheet } from "@/components/RecordSheet";
import { HomeBar } from "@/components/HomeBar";
import { HelpSheet } from "@/components/HelpSheet";
import { Sheet } from "@/components/Sheet";
import { Tour, markTourSeen, resetTour, tourSeen, tourSteps, type TourRefs } from "@/components/Tour";
import { API_URL } from "@/config";
import { answerWaiting, nudgeWaiting, onHomeChanged, type HomeCard } from "@/home";
import {
  loadToday,
  recentSpaces,
  savedToday,
  sharedItem,
  tileOf,
  touchSpace,
  whenWords,
  type SpaceRow,
  type Today,
  type UpNextItem,
} from "@/today";
import { dropFailed, outboxState, subscribe } from "@/outbox";
import { useSession } from "@/session";
import { useChats } from "@/chats";
import { useLive } from "@/live-socket";
import { useKeyboardHeight } from "@/keyboard";
import { lastChat } from "@/last-chat";
import { radius, useTheme } from "@/theme";
import { isOffline } from "@/api";
import { openChat, useContentWidth } from "@/chat-open";
import { usePendingPath } from "@/intents";
import { useTestLaunch } from "@/test-launch";

const SIDE = 16;
/** On a laptop Today keeps a readable column. */
const COLUMN = 760;
/** The personal space's id in the catalogue. */
const PERSONAL = "p";
const ALL = "all";
/** How many spaces the switcher shows before More. */
const RECENT = 3;

export default function Home() {
  const { me, loaded, refresh } = useSession();
  const { t } = useTheme();
  // The clock the greeting and Up next read: moves on at every minute.
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
  // The bar rides up with the keyboard, for its own box only (owner, 2026-10-16 and 2026-10-19).
  const keyboard = useKeyboardHeight();
  const barFocused = useSharedValue(false);
  const lift = useAnimatedStyle(() => ({
    paddingBottom: Math.max(barFocused.value ? keyboard.value : 0, insets.bottom) + 10,
  }));
  const router = useRouter();
  // Less the chat panel when it is open beside the screen (a wide website window).
  const width = useContentWidth();
  const [today, setToday] = useState<Today | null>(null);
  // True while what's on screen is the device's saved copy and the fresh one is on its way.
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [space, setSpace] = useState(ALL);
  const [more, setMore] = useState(false);
  const [find, setFind] = useState("");
  // A row tapped under Up next: that record, opened (owner, 2026-10-24).
  const [opened, setOpened] = useState<UpNextItem | null>(null);
  const [failed, setFailed] = useState(() => outboxState().failed);
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const userId = me?.user.id ?? null;
  useTestLaunch();
  usePendingPath();
  // Guidance (decision 2026-10-13 "Guide people, no presets"): the first-run tour lights up the
  // real parts of the screen; Help ("?") takes it again, and has ideas and "How do I…?".
  const barRef = useRef<View>(null);
  const tourRefs = { chat: barRef, search: barRef, help: useRef<View>(null) } satisfies TourRefs;
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
  // A change the server refused: say so, and show Today as the server has it.
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
  const chats = useChats().chats ?? [];
  // `?q=` opens Today with the bar already searching, the keyboard up (a link from Siri).
  const { q: startQuery } = useLocalSearchParams<{ q?: string }>();
  const [barText, setBarText] = useState(startQuery ?? "");

  // The switcher: Everything, the spaces used last, More.
  const recent = useMemo(() => {
    const all = today?.spaces ?? [];
    const used = userId ? recentSpaces(userId) : [];
    const picked: SpaceRow[] = [];
    for (const id of used) {
      const sp = all.find((x) => x.id === id);
      if (sp && !picked.includes(sp)) picked.push(sp);
      if (picked.length >= RECENT) break;
    }
    for (const sp of all) {
      if (picked.length >= RECENT) break;
      if (!picked.includes(sp)) picked.push(sp);
    }
    return picked;
  }, [today, userId]);

  // No hook below this line (the signed-out screen crashed on the phone and the web, 2026-10-15).
  if (loaded && !me) return <Redirect href="/login" />;

  const assistant = me?.assistant !== false;
  const pick = (id: string) => {
    setSpace(id);
    if (userId) touchSpace(userId, id);
    setMore(false);
    setFind("");
  };
  const inSpace = (id: string | undefined) => space === ALL || (id ?? PERSONAL) === space;
  /** A whole list, on its own screen (its saved view chosen when the row is one). */
  const openList = (collection: string, view?: string, spaceId?: string) =>
    router.push({
      pathname: "/list",
      params: { collection, ...(view ? { view } : {}), ...(spaceId ? { space: spaceId } : {}) },
    });
  // online-only: the website's shared pages (a form to fill in) open in the browser.
  const openOnWeb = (card: HomeCard) =>
    card.shared && void Linking.openURL(`${API_URL}/shared/${encodeURIComponent(card.shared.share_id)}`);
  // Process cards: my answer, or a nudge; then Today reads again (the run went on).
  const processAction = (card: HomeCard, go: () => Promise<unknown>) => async () => {
    setBusyCard(card.id);
    try {
      await go();
      await load();
      setTimeout(() => void load(), 1500);
    } catch (e) {
      setError(isOffline(e) ? "Answering needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusyCard(null);
    }
  };

  const shared = today?.shared ?? [];
  const needs = (today?.needs ?? []).filter((c) => (c.waiting ? inSpace(c.waiting.space_id) : space === ALL));
  const upnext = (today?.upnext ?? []).filter((u) => inSpace(u.space));
  const spaces = (today?.spaces ?? []).filter((sp) => inSpace(sp.id === PERSONAL ? undefined : sp.id));
  const shownChats = space === ALL ? chats : [];
  const wide = width >= COLUMN + SIDE * 2;
  const loading = today === null;

  const section = (title: string, aside?: string, onAside?: () => void) => (
    <View style={s.sec}>
      <Text style={[s.secTitle, { color: t.fg }]}>{title}</Text>
      {aside ? (
        onAside ? (
          <Pressable accessibilityRole="link" onPress={onAside} hitSlop={8}>
            <Text style={[s.secAside, { color: t.accent }]}>{aside}</Text>
          </Pressable>
        ) : (
          <Text style={[s.secAside, { color: t.fg3 }]}>{aside}</Text>
        )
      ) : null}
    </View>
  );
  const header = (
    <View style={{ gap: 6 }}>
      <View style={s.greetRow}>
        <View style={s.greet}>
          <Text style={[s.eyebrow, { color: t.fg2 }]}>
            {todayWords(new Date(now))}
            {stale ? "  ·  Updating…" : ""}
          </Text>
          <Text style={[s.h2, { color: t.fg }]}>{greeting(me?.user.name, new Date(now))}</Text>
        </View>
        {/* The library: every list, workflow and practice copy, by space. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Library"
          onPress={() => router.push("/library")}
          style={({ pressed }) => [
            s.roundBtn,
            { backgroundColor: t.cell, shadowColor: t.shadow, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <View style={s.gridIcon}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[s.gridDot, { borderColor: t.fg }]} />
            ))}
          </View>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pills}>
        {[{ id: ALL, name: "Everything" }, ...recent].map((sp) => (
          <Pressable
            key={sp.id}
            accessibilityRole="button"
            accessibilityState={{ selected: space === sp.id }}
            onPress={() => pick(sp.id)}
            style={[
              s.pill,
              space === sp.id
                ? { backgroundColor: t.accentSoft, borderColor: t.accentSoft }
                : { backgroundColor: t.cell, borderColor: t.hair },
            ]}
          >
            <Text style={[s.pillText, { color: space === sp.id ? t.accent : t.fg2 }]}>{sp.name}</Text>
          </Pressable>
        ))}
        {(today?.spaces.length ?? 0) > RECENT ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More spaces"
            onPress={() => setMore(true)}
            style={[s.pill, { backgroundColor: t.cell, borderColor: t.hair }]}
          >
            <Text style={[s.pillText, { color: t.fg2 }]}>More · {today!.spaces.length}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );

  const body = loading ? (
    <View style={{ gap: 12 }}>
      {error ? <Text style={[s.sub, { color: t.danger }]}>{error}</Text> : null}
      <Skeleton />
    </View>
  ) : (
    <View style={{ gap: 4 }}>
      {error ? <Text style={[s.sub, { color: t.danger }]}>{error}</Text> : null}
      {section("Needs you", needs.length ? String(needs.length) : undefined)}
      {needs.length ? (
        <View style={{ gap: 10 }}>
          {needs.map((card) => (
            <Boundary key={card.id} where="needs you">
              <Card
                card={card}
                natural
                onOpen={() =>
                  card.waiting
                    ? router.push({
                        pathname: "/process",
                        params: { id: card.waiting.workflow_id, waiting: JSON.stringify(card.waiting) },
                      })
                    : card.shared?.kind === "form"
                      ? openOnWeb(card)
                      : undefined
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
          ))}
        </View>
      ) : (
        <Text style={[s.empty, { color: t.fg3 }]}>Nothing is waiting on you.</Text>
      )}

      {space === ALL && shared.length ? (
        <>
          {section("Shared with you", String(shared.length))}
          <View style={{ gap: 10 }}>
            {shared.map((card) => (
              <Boundary key={card.id} where="shared with you">
                <Card
                  card={card}
                  natural
                  onOpen={() => openOnWeb(card)}
                  onOpenRecord={(record) => setOpened(sharedItem(card, record))}
                />
              </Boundary>
            ))}
          </View>
        </>
      ) : null}

      {section("Up next", "7 days")}
      {upnext.length ? (
        upnext.map((u) => {
          const tile = tileOf(u);
          return (
            <Pressable
              key={u.key}
              accessibilityRole="button"
              accessibilityLabel={`Open ${u.title}`}
              onPress={() => setOpened(u)}
              style={({ pressed }) => [s.row, { borderBottomColor: t.hair, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={[s.tile, { backgroundColor: t.accentSoft }]}>
                <Text style={[s.tileDow, { color: t.accent }]}>{tile.dow}</Text>
                <Text style={[s.tileDay, { color: t.accent }]}>{tile.day}</Text>
              </View>
              <View style={s.words}>
                <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
                  {u.title}
                </Text>
                <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
                  {u.sub}
                </Text>
              </View>
              <Text style={[s.rowEnd, { color: t.fg3 }]}>{whenWords(u, now)}</Text>
            </Pressable>
          );
        })
      ) : (
        <Text style={[s.empty, { color: t.fg3 }]}>
          {space === ALL ? "Nothing dated in the next week." : "Nothing dated here in the next week."}
        </Text>
      )}

      {space === ALL ? (
        <>
          {section("Chats", "All chats ›", () => router.push("/chats"))}
          {shownChats.length ? (
            shownChats.slice(0, 5).map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={c.unread ? `${c.name}, ${c.unread} new` : c.name}
                onPress={() => router.push({ pathname: "/talk", params: { id: c.id } })}
                style={({ pressed }) => [s.row, { borderBottomColor: t.hair, opacity: pressed ? 0.7 : 1 }]}
              >
                <View style={[s.ava, { backgroundColor: t.accentSoft }]}>
                  <Text style={[s.avaText, { color: t.accent }]}>
                    {c.name.trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={s.words}>
                  <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
                    {c.last ? `${c.last.author}: ${c.last.text}` : "No messages yet"}
                  </Text>
                </View>
                {c.unread ? (
                  <View style={[s.badge, { backgroundColor: t.accent }]}>
                    <Text style={[s.badgeText, { color: t.onAccent }]}>{c.unread > 9 ? "9+" : c.unread}</Text>
                  </View>
                ) : (
                  <Text style={[s.rowEnd, { color: t.fg3 }]}>{ago(c.updated_at, now)}</Text>
                )}
              </Pressable>
            ))
          ) : (
            <Text style={[s.empty, { color: t.fg3 }]}>No chats with people yet.</Text>
          )}
        </>
      ) : null}

      {section(
        "Spaces",
        assistant ? "New, in the chat ›" : undefined,
        assistant ? () => openChat({ ask: "I'd like to start a new space for " }) : undefined,
      )}
      {spaces.map((sp) => (
        <View key={sp.id} style={{ gap: 0 }}>
          <View style={s.spaceHead}>
            <Text style={[s.spaceName, { color: t.fg }]}>{sp.name}</Text>
            <Text style={[s.secAside, { color: t.fg3 }]}>
              {sp.lists.length
                ? `${sp.lists.length} list${sp.lists.length === 1 ? "" : "s"}`
                : "no lists yet"}
            </Text>
          </View>
          {sp.lists.map((l) => (
            <Pressable
              key={l.key}
              accessibilityRole="button"
              onPress={() => openList(l.collection, l.view, sp.personal ? undefined : sp.id)}
              style={({ pressed }) => [s.row, { borderBottomColor: t.hair, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={[s.dot, { backgroundColor: t.accent }]} />
              <View style={s.words}>
                <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
                  {l.title}
                </Text>
              </View>
              <Text style={[s.rowEnd, { color: t.fg3 }]}>›</Text>
            </Pressable>
          ))}
          {!sp.lists.length && assistant ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                openChat({
                  ask: `I'd like to set up the lists for ${sp.name}. Ask me what I want to keep track of.`,
                  send: "1",
                  ...(sp.personal ? {} : { space: sp.id }),
                })
              }
              style={({ pressed }) => [s.row, { borderBottomColor: t.hair, opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={[s.dot, { backgroundColor: t.fg3 }]} />
              <View style={s.words}>
                <Text style={[s.rowTitle, { color: t.accent }]}>Start building</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );

  return (
    <View style={[s.root, { backgroundColor: t.canvas }]}>
      <ScrollView
        style={{ marginTop: insets.top }}
        contentContainerStyle={{
          width: wide ? COLUMN + SIDE * 2 : "100%",
          alignSelf: "center",
          paddingTop: 12,
          paddingHorizontal: SIDE,
          paddingBottom: insets.bottom + 150,
          gap: 14,
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
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {header}
        {body}
      </ScrollView>

      {barText.trim() ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close search"
          onPress={() => setBarText("")}
          style={[StyleSheet.absoluteFill, { backgroundColor: t.shadow }]}
        />
      ) : null}
      <Animated.View style={[s.bottom, { backgroundColor: t.canvas }, lift]} pointerEvents="box-none">
        <View pointerEvents="none" style={s.fade}>
          {FADE.map((o, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: t.canvas, opacity: o }} />
          ))}
        </View>
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
        <View style={[s.barRow, wide && s.wideRow]}>
          <Tap
            ref={tourRefs.help}
            accessibilityRole="button"
            accessibilityLabel="Help"
            onPress={() => setHelp(true)}
            scale={0.92}
            style={[s.roundBtn, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 18, fontWeight: "800", lineHeight: 20 }}>?</Text>
          </Tap>
          <HomeBar
            ref={barRef}
            assistant={!!assistant}
            text={barText}
            autoFocus={!!startQuery}
            onChangeText={setBarText}
            onFocusChange={(on) => {
              barFocused.value = on;
            }}
            cards={today?.needs ?? []}
            lists={today?.lists ?? []}
            space={
              space !== ALL && space !== PERSONAL
                ? { id: space, name: recent.find((x) => x.id === space)?.name ?? "" }
                : undefined
            }
            onAsk={(words, sp) => openChat({ ask: words, send: "1", ...(sp ? { space: sp } : {}) })}
            onOpenChat={(sp) => {
              const last = userId ? lastChat(userId) : null;
              openChat(last ? { id: last } : sp ? { space: sp } : {});
            }}
            onOpenCard={(card) =>
              card.waiting
                ? router.push({
                    pathname: "/process",
                    params: { id: card.waiting.workflow_id, waiting: JSON.stringify(card.waiting) },
                  })
                : openOnWeb(card)
            }
            onOpenList={(id, sp) => openList(id, undefined, sp)}
            onOpenHit={(hit, q) => {
              if (hit.kind === "message") {
                router.push({ pathname: "/talk", params: { id: hit.group_id, message: hit.message_id, q } });
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
                else if (hit.what === "space") openChat(inSp);
                else if (hit.what === "memory") router.push("/memory");
                else void Linking.openURL(`${API_URL}/shared/${encodeURIComponent(hit.id)}`);
                return;
              }
              if (assistant) openChat({}, { kind: "record", title: hit.title, in: hit.collection });
              else openList(hit.collection_id);
            }}
          />
        </View>
      </Animated.View>

      <RecordSheet
        record={opened?.record ?? null}
        collection={opened?.collection ?? null}
        onClose={() => setOpened(null)}
        onOpenList={
          opened && !opened.shared
            ? () => {
                const o = opened;
                setOpened(null);
                openList(o.collection.id, o.view, o.space);
              }
            : undefined
        }
        onAsk={
          opened && assistant
            ? () => {
                const o = opened;
                setOpened(null);
                openChat(o.space ? { space: o.space } : {}, {
                  kind: "record",
                  title: o.record.title,
                  in: o.collection.name,
                });
              }
            : undefined
        }
      />
      {/* More: every space, by last use, with a search (design §4). */}
      <Sheet open={more} onClose={() => setMore(false)} accessibilityLabel="Your spaces" keyboard>
        <Text style={[s.sheetTitle, { color: t.fg }]}>Your spaces</Text>
        <TextInput
          accessibilityLabel="Find a space"
          placeholder="Find a space"
          placeholderTextColor={t.fg3}
          value={find}
          onChangeText={setFind}
          style={[s.find, { color: t.fg, backgroundColor: t.fill }]}
        />
        <View style={{ gap: 6 }}>
          {[
            { id: ALL, name: "Everything", lists: [] as SpaceRow["lists"], personal: false },
            ...(today?.spaces ?? []),
          ]
            .filter((sp) => !find.trim() || sp.name.toLowerCase().includes(find.trim().toLowerCase()))
            .map((sp) => (
              <Tap
                key={sp.id}
                accessibilityRole="button"
                accessibilityState={{ selected: space === sp.id }}
                onPress={() => pick(sp.id)}
                scale={0.985}
                style={[s.spaceRow, { backgroundColor: space === sp.id ? t.accentSoft : t.cell }]}
              >
                <Text style={[s.rowTitle, { color: space === sp.id ? t.accent : t.fg }]}>{sp.name}</Text>
                <Text style={[s.rowSub, { color: t.fg2 }]}>
                  {sp.id === ALL
                    ? "Every space at once"
                    : sp.lists.length
                      ? `${sp.lists.length} ${sp.lists.length === 1 ? "list" : "lists"}`
                      : "No lists yet"}
                </Text>
              </Tap>
            ))}
        </View>
      </Sheet>
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

/** The fade above the bar's area: its height, and each strip's opacity from top to bottom. */
const FADE_HEIGHT = 36;
const FADE = Array.from({ length: 12 }, (_, i) => ((i + 1) / 12) ** 1.6);

const s = StyleSheet.create({
  root: { flex: 1 },
  h2: { fontSize: 30, fontWeight: "800", letterSpacing: -1 },
  greet: { flex: 1, gap: 2, paddingHorizontal: 4 },
  greetRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  gridIcon: { width: 18, height: 18, flexDirection: "row", flexWrap: "wrap", gap: 3 },
  gridDot: { width: 7.5, height: 7.5, borderRadius: 2, borderWidth: 1.75 },
  pills: { flexDirection: "row", gap: 6, paddingVertical: 4, paddingHorizontal: 2 },
  pill: { minHeight: 36, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, justifyContent: "center" },
  pillText: { fontSize: 13.5, fontWeight: "700" },
  sec: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 16,
    marginBottom: 6,
  },
  secTitle: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  secAside: { fontSize: 12.5, fontWeight: "700" },
  empty: { fontSize: 13.5, paddingVertical: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  words: { flex: 1, minWidth: 0, gap: 1 },
  rowTitle: { fontSize: 15.5, fontWeight: "600" },
  rowSub: { fontSize: 12.5, fontWeight: "500" },
  rowEnd: { fontSize: 12.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  tile: { width: 44, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tileDow: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  tileDay: { fontSize: 19, fontWeight: "800", letterSpacing: -0.5, lineHeight: 22 },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 17 },
  ava: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 3,
  },
  avaText: { fontSize: 14, fontWeight: "800" },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "800" },
  spaceHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: 12,
    paddingBottom: 4,
  },
  spaceName: { fontSize: 14, fontWeight: "800", letterSpacing: 0.2, textTransform: "uppercase" },
  eyebrow: { fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  sub: { fontSize: 14 },
  sheetTitle: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  find: { minHeight: 44, borderRadius: 22, paddingHorizontal: 16, fontSize: 16 },
  spaceRow: {
    minHeight: 56,
    borderRadius: radius.row,
    paddingHorizontal: 14,
    justifyContent: "center",
    gap: 2,
  },
  fade: { position: "absolute", left: 0, right: 0, top: -FADE_HEIGHT, height: FADE_HEIGHT },
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
  wideRow: { alignSelf: "center", width: "100%", maxWidth: 640 },
  roundBtn: {
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

/** "4 min", "2 h", "3 d". */
function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!(ms > 0)) return "";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
