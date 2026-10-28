// A space's page (docs/design/from-scratch.md §3 "Space", FS4): the same idea as Today, for one
// space, plus what only a space has: its chats, its workflows and its people. Today's Spaces
// section opens it. Reads what Today keeps on the device first (offline-first rule 17), and keeps
// the workflows and people it last read, so it opens with no connection.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Boundary, Card, Text, type } from "@assistant/cards/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SpacePerson, SpaceView, WorkflowView } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { COMPOSER_ROOM, Composer } from "@/components/Composer";
import { RecordSheet } from "@/components/RecordSheet";
import { answerWaiting, nudgeWaiting, onHomeChanged, type HomeCard } from "@/home";
import { useLive } from "@/live-socket";
import { loadToday, savedToday, tileOf, touchSpace, whenWords, type Today, type UpNextItem } from "@/today";
import { useChats } from "@/chats";
import { openChat } from "@/chat-open";
import { useSession } from "@/session";
import { readJson, writeJson } from "@/storage";
import { colourFor, useTheme } from "@/theme";
import { Avatar, when } from "@/components/ChatBits";

/** The personal space's key in Today's rows. */
const PERSONAL = "p";
const enc = encodeURIComponent;

type Tab = "chats" | "lists" | "flows" | "people";

const ROLE_WORDS: Record<SpacePerson["role"], string> = {
  owner: "Owner",
  editor: "Can change things",
  viewer: "Can see",
  shared: "",
};

export default function SpacePage() {
  const { t, colour, cardTint } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { me } = useSession();
  const userId = me?.user.id ?? null;
  const { id = PERSONAL } = useLocalSearchParams<{ id?: string }>();
  const [today, setToday] = useState<Today | null>(() => (userId ? savedToday(userId) : null));
  const row = today?.spaces.find((sp) => sp.id === id) ?? null;
  // The space's own id (the personal one's too); an older saved Today doesn't have it.
  const [spaceId, setSpaceId] = useState<string | null>(id === PERSONAL ? null : id);
  const saved = (what: string) => `gigspree:space:${id}:${what}`;
  const [workflows, setWorkflows] = useState<WorkflowView[] | null>(() => readJson(saved("workflows")));
  const [people, setPeople] = useState<SpacePerson[] | null>(() => readJson(saved("people")));
  const [note, setNote] = useState("");
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [opened, setOpened] = useState<UpNextItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Every space has the same top (chats-home.md 5): Chats · Lists · Flows · People.
  const [tab, setTab] = useState<Tab>("chats");
  const chats = useChats().chats ?? [];
  const assistant = me?.assistant !== false;

  useEffect(() => {
    if (userId) touchSpace(userId, id);
  }, [userId, id]);
  useEffect(() => {
    if (row?.spaceId) setSpaceId(row.spaceId);
  }, [row?.spaceId]);

  const load = useCallback(async () => {
    if (!userId) return;
    const where = id === PERSONAL ? "" : `?space=${enc(id)}`;
    try {
      const [fresh, wf, sp] = await Promise.all([
        loadToday(userId),
        request<WorkflowView[]>("GET", `/api/workflows${where}`),
        spaceId
          ? Promise.resolve(spaceId)
          : request<SpaceView[]>("GET", "/api/spaces").then(
              (all) => all.find((x) => x.kind === "personal")?.id,
            ),
      ]);
      setToday(fresh);
      setWorkflows(wf);
      writeJson(saved("workflows"), wf);
      if (sp) {
        setSpaceId(sp);
        const ps = await request<SpacePerson[]>("GET", `/api/spaces/${enc(sp)}/people`);
        setPeople(ps);
        writeJson(saved("people"), ps);
      }
      setNote("");
    } catch (e) {
      setNote(
        isOffline(e) ? "Offline: showing what this phone saved." : e instanceof Error ? e.message : String(e),
      );
    }
  }, [userId, id, spaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  // What the chat or anyone else changes shows here too (Codex, PR 205): "Start building"
  // reveals its lists once they're made. A burst of changes loads once.
  useEffect(() => onHomeChanged(() => void load()), [load]);
  const liveLoad = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLive((m) => {
    if (m.type !== "space_changed" && m.type !== "reconnected") return;
    clearTimeout(liveLoad.current);
    liveLoad.current = setTimeout(() => void load(), 400);
  });

  const personal = id === PERSONAL;
  const name = row?.name ?? (personal ? "Personal" : "Space");
  const inHere = (space: string | null | undefined) =>
    personal ? !space || space === spaceId : space === id;
  const needs = (today?.needs ?? []).filter((c) => c.waiting && inHere(c.waiting.space_id));
  const upnext = (today?.upnext ?? []).filter((u) => (personal ? !u.space : u.space === id));
  const groupChats = spaceId ? chats.filter((c) => c.space_id === spaceId) : [];
  const chatIn = personal ? {} : { space: id };
  const openList = (collection: string, view?: string) =>
    router.push({
      pathname: "/list",
      params: { collection, ...(view ? { view } : {}), ...(personal ? {} : { space: id }) },
    });
  const act = (card: HomeCard, go: () => Promise<unknown>) => async () => {
    setBusyCard(card.id);
    try {
      await go();
      await load();
    } catch (e) {
      setNote(isOffline(e) ? "Answering needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusyCard(null);
    }
  };

  const section = (title: string, aside?: string) => (
    <View style={s.sec}>
      <Text style={[s.secTitle, { color: t.fg }]}>{title}</Text>
      {aside ? <Text style={[s.secAside, { color: t.fg3 }]}>{aside}</Text> : null}
    </View>
  );
  const rowStyle = ({ pressed }: { pressed: boolean }) => [
    s.row,
    { borderBottomColor: t.hair, opacity: pressed ? 0.7 : 1 },
  ];

  const c = colourFor(name);
  const flowCount = workflows?.length ?? 0;
  const listCount = row?.lists.length ?? 0;
  const tabs: { key: Tab; label: string; n?: number }[] = [
    { key: "chats", label: "Chats", n: groupChats.reduce((n, g) => n + g.unread, 0) || undefined },
    { key: "lists", label: "Lists" },
    { key: "flows", label: "Flows" },
    ...(personal ? [] : [{ key: "people" as const, label: "People" }]),
  ];
  // Everyone's chat first (all the space's people are in it), then the rest by newest message.
  const everyone = people?.length ?? 0;
  const chatsHere = [...groupChats].sort((a, b) => {
    const all = (g: typeof a) => (everyone && g.members >= everyone ? 1 : 0);
    return all(b) - all(a) || Date.parse(b.last?.at ?? b.updated_at) - Date.parse(a.last?.at ?? a.updated_at);
  });
  const metaWords = personal
    ? "Only you"
    : [
        people ? `${people.length} ${people.length === 1 ? "person" : "people"}` : "",
        `${listCount} ${listCount === 1 ? "list" : "lists"}`,
        flowCount ? `${flowCount} ${flowCount === 1 ? "flow" : "flows"}` : "",
      ]
        .filter(Boolean)
        .join(" · ");

  const chatsTab = (
    <>
      {needs.length ? (
        <>
          {section("Needs you here", String(needs.length))}
          <View style={{ gap: 10 }}>
            {needs.map((card) => (
              <Boundary key={card.id} where="needs you here">
                <Card
                  card={card}
                  natural
                  onOpen={() =>
                    router.push({
                      pathname: "/process",
                      params: { id: card.waiting!.workflow_id, waiting: JSON.stringify(card.waiting) },
                    })
                  }
                  onAnswer={(answer) => void act(card, () => answerWaiting(card.waiting!, answer))()}
                  onNudge={card.waiting!.share_id ? undefined : act(card, () => nudgeWaiting(card.waiting!))}
                  busy={busyCard === card.id}
                />
              </Boundary>
            ))}
          </View>
        </>
      ) : null}
      {needs.length ? section("Chats") : null}
      {chatsHere.map((g) => {
        const some = !!everyone && g.members < everyone;
        const who = g.last?.author === me?.user.name ? "You" : g.last?.author;
        return (
          <Pressable
            key={g.id}
            accessibilityRole="button"
            accessibilityLabel={`${g.name}${some ? `, ${g.members} people, private` : ""}${g.unread ? `, ${g.unread} new` : ""}`}
            onPress={() => router.push({ pathname: "/talk", params: { id: g.id } })}
            style={rowStyle}
          >
            <View style={[s.hash, { backgroundColor: some ? t.fill : cardTint(c) }]}>
              <Text style={[s.hashText, { color: some ? t.fg2 : colour(c) }]}>{some ? "◔" : "#"}</Text>
            </View>
            <View style={s.words}>
              <View style={s.line}>
                <Text style={[s.rowTitle, { color: t.fg, flex: 1 }]} numberOfLines={1}>
                  {g.name}
                </Text>
                <Text style={[s.rowEnd, { color: g.unread ? t.accent : t.fg3 }]}>
                  {g.last ? when(g.last.at) : ""}
                </Text>
              </View>
              <View style={s.line}>
                <Text style={[s.rowSub, { color: t.fg2, flex: 1 }]} numberOfLines={1}>
                  {some ? `${g.members} people · private · ` : ""}
                  {g.last ? `${who}: ${g.last.text}` : "No messages yet"}
                </Text>
                {g.unread ? (
                  <View style={[s.badge, { backgroundColor: t.accent }]}>
                    <Text style={[s.badgeText, { color: t.onAccent }]}>{g.unread > 9 ? "9+" : g.unread}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      })}
      {assistant ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => openChat(chatIn, { kind: "space", title: name })}
          style={rowStyle}
        >
          <View style={[s.hash, { backgroundColor: t.ink }]}>
            <Text style={[s.hashText, { color: t.onInk }]}>✦</Text>
          </View>
          <View style={s.words}>
            <Text style={[s.rowTitle, { color: t.fg }]}>The assistant</Text>
            <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
              {personal ? "Your own chats, only you see them" : `Your chats about ${name}, only you see them`}
            </Text>
          </View>
          <Text style={[s.rowEnd, { color: t.fg3 }]}>›</Text>
        </Pressable>
      ) : null}
      {!chatsHere.length && !assistant ? (
        <Text style={[s.empty, { color: t.fg3 }]}>No chats here yet.</Text>
      ) : null}
    </>
  );

  const listsTab = (
    <>
      {upnext.length ? (
        <>
          {section("This week", String(upnext.length))}
          {upnext.map((u) => {
            const tile = tileOf(u);
            return (
              <Pressable
                key={u.key}
                accessibilityRole="button"
                accessibilityLabel={`Open ${u.title}`}
                onPress={() => setOpened(u)}
                style={rowStyle}
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
                <Text style={[s.rowEnd, { color: t.fg3 }]}>{whenWords(u)}</Text>
              </Pressable>
            );
          })}
        </>
      ) : null}
      {section("Lists", listCount ? String(listCount) : undefined)}
      {row?.lists.length ? (
        row.lists.map((l) => (
          <Pressable
            key={l.key}
            accessibilityRole="button"
            onPress={() => openList(l.collection, l.view)}
            style={rowStyle}
          >
            <View style={[s.dot, { backgroundColor: colour(colourFor(l.title)) }]} />
            <View style={s.words}>
              <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
                {l.title}
              </Text>
            </View>
            <Text style={[s.rowEnd, { color: t.fg3 }]}>›</Text>
          </Pressable>
        ))
      ) : assistant ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            openChat({
              ask: `I'd like to set up the lists for ${name}. Ask me what I want to keep track of.`,
              send: "1",
              ...chatIn,
            })
          }
          style={rowStyle}
        >
          <View style={[s.dot, { backgroundColor: t.fg3 }]} />
          <View style={s.words}>
            <Text style={[s.rowTitle, { color: t.accent }]}>Start building</Text>
          </View>
        </Pressable>
      ) : (
        <Text style={[s.empty, { color: t.fg3 }]}>No lists here yet.</Text>
      )}
    </>
  );

  const flowsTab = (
    <>
      {section("Flows", flowCount ? String(flowCount) : undefined)}
      {workflows?.length ? (
        workflows.map((w) => (
          <Pressable
            key={w.id}
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/process",
                params: { id: w.id, ...(personal ? {} : { space: id }) },
              })
            }
            style={rowStyle}
          >
            <View style={[s.dot, { backgroundColor: w.enabled ? t.good : t.fg3 }]} />
            <View style={s.words}>
              <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
                {w.name}
              </Text>
              <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
                {w.enabled ? "On" : "Off"} · {w.when.collection}
              </Text>
            </View>
            <Text style={[s.rowEnd, { color: t.fg3 }]}>›</Text>
          </Pressable>
        ))
      ) : (
        <Text style={[s.empty, { color: t.fg3 }]}>
          {workflows === null
            ? "Loading…"
            : "No flows here yet. Flows run steps for you when something changes."}
        </Text>
      )}
      {assistant ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => openChat({ ask: `I'd like a flow in ${name} that `, ...chatIn })}
          style={rowStyle}
        >
          <View style={[s.dot, { backgroundColor: t.fg3 }]} />
          <View style={s.words}>
            <Text style={[s.rowTitle, { color: t.accent }]}>New flow, in the chat</Text>
          </View>
        </Pressable>
      ) : null}
    </>
  );

  const peopleTab = people ? (
    <>
      {section("People", String(people.length))}
      {people.map((p) => (
        <View key={p.user_id} style={[s.row, { borderBottomColor: t.hair }]}>
          <Avatar name={p.name} size={38} />
          <View style={s.words}>
            <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
              {p.name}
              {p.user_id === userId ? " (you)" : ""}
            </Text>
            <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
              {p.role === "shared" ? `Has ${p.shares.join(", ")}` : ROLE_WORDS[p.role]}
            </Text>
          </View>
        </View>
      ))}
      {assistant ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            openChat({ ask: `Who should I invite to ${name}, and what should they see? `, ...chatIn })
          }
          style={rowStyle}
        >
          <View style={[s.dot, { backgroundColor: t.fg3 }]} />
          <View style={s.words}>
            <Text style={[s.rowTitle, { color: t.accent }]}>Invite people, in the chat</Text>
          </View>
        </Pressable>
      ) : null}
    </>
  ) : (
    <Text style={[s.empty, { color: t.fg3 }]}>Loading…</Text>
  );

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 6 }]}>
      <View style={s.column}>
        <View style={s.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            style={[s.back, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
          </Pressable>
          <View style={[s.square, { backgroundColor: colour(c) }]}>
            <Text style={[s.squareText, { color: t.onAccent }]}>{name.trim().charAt(0).toUpperCase()}</Text>
          </View>
          <View style={s.words}>
            <Text style={[type.heading, { color: t.fg }]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
              {metaWords}
            </Text>
          </View>
        </View>
        <View style={[s.tabs, { backgroundColor: t.fill }]} accessibilityRole="tablist">
          {tabs.map((x) => {
            const on = tab === x.key;
            return (
              <Pressable
                key={x.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setTab(x.key)}
                style={[s.tab, on && { backgroundColor: t.cell, shadowColor: t.shadow }, on && s.tabOn]}
              >
                <Text style={[type.label, { color: on ? t.fg : t.fg2, fontSize: 14 }]}>{x.label}</Text>
                {x.n ? (
                  <View style={[s.tabBadge, { backgroundColor: t.accent }]}>
                    <Text style={[s.badgeText, { color: t.onAccent }]}>{x.n > 9 ? "9+" : x.n}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + COMPOSER_ROOM,
            gap: 4,
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
          {note ? <Text style={[s.note, { color: t.fg2 }]}>{note}</Text> : null}
          {tab === "chats" ? chatsTab : tab === "lists" ? listsTab : tab === "flows" ? flowsTab : peopleTab}
        </ScrollView>
        <Composer about={{ kind: "space", title: name }} params={chatIn} />
      </View>
      <RecordSheet
        record={opened?.record ?? null}
        collection={opened?.collection ?? null}
        onClose={() => setOpened(null)}
        onOpenList={
          opened
            ? () => {
                const o = opened;
                setOpened(null);
                openList(o.collection.id, o.view);
              }
            : undefined
        }
        onAsk={
          opened && assistant
            ? () => {
                const o = opened;
                setOpened(null);
                openChat(chatIn, { kind: "record", title: o.record.title, in: o.collection.name });
              }
            : undefined
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" },
  top: { paddingHorizontal: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  square: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  squareText: { fontSize: 17, fontWeight: "800" },
  tabs: { flexDirection: "row", marginHorizontal: 16, marginBottom: 6, padding: 3, borderRadius: 14, gap: 2 },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  tabOn: { shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  hash: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 3,
  },
  hashText: { fontSize: 16, fontWeight: "800" },
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
  note: { fontSize: 13, paddingHorizontal: 4, paddingTop: 6 },
  sec: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 18,
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
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "800" },
});
