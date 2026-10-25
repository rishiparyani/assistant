// A space's page (docs/design/from-scratch.md §3 "Space", FS4): the same idea as Today, for one
// space, plus what only a space has: its chats, its workflows and its people. Today's Spaces
// section opens it. Reads what Today keeps on the device first (offline-first rule 17), and keeps
// the workflows and people it last read, so it opens with no connection.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Boundary, Card, Text } from "@assistant/cards/native";
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
import { useTheme } from "@/theme";

/** The personal space's key in Today's rows. */
const PERSONAL = "p";
const enc = encodeURIComponent;

const ROLE_WORDS: Record<SpacePerson["role"], string> = {
  owner: "Owner",
  editor: "Can change things",
  viewer: "Can see",
  shared: "",
};

export default function SpacePage() {
  const { t } = useTheme();
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
  const ava = (letter: string, soft = true) => (
    <View style={[s.ava, { backgroundColor: soft ? t.accentSoft : t.fill }]}>
      <Text style={[s.avaText, { color: soft ? t.accent : t.fg2 }]}>
        {letter.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
  const others = (people ?? []).filter((p) => p.user_id !== userId);

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 6 }]}>
      <View style={s.column}>
        <View style={s.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={[s.back, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
          </Pressable>
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
          <View style={s.head}>
            <Text style={[s.title, { color: t.fg }]} numberOfLines={2}>
              {name}
            </Text>
            <Text style={[s.meta, { color: t.fg2 }]}>
              {personal
                ? "Only you"
                : people
                  ? `${people.length} ${people.length === 1 ? "person" : "people"}`
                  : ""}
            </Text>
          </View>
          {note ? <Text style={[s.note, { color: t.fg2 }]}>{note}</Text> : null}

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
                      onNudge={
                        card.waiting!.share_id ? undefined : act(card, () => nudgeWaiting(card.waiting!))
                      }
                      busy={busyCard === card.id}
                    />
                  </Boundary>
                ))}
              </View>
            </>
          ) : null}

          {upnext.length ? (
            <>
              {section("Up next here", "7 days")}
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

          {section("Chats")}
          {groupChats.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={c.unread ? `${c.name}, ${c.unread} new` : c.name}
              onPress={() => router.push({ pathname: "/talk", params: { id: c.id } })}
              style={rowStyle}
            >
              {ava(c.name)}
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
              ) : null}
            </Pressable>
          ))}
          {assistant ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openChat(chatIn, { kind: "space", title: name })}
              style={rowStyle}
            >
              {ava("✦")}
              <View style={s.words}>
                <Text style={[s.rowTitle, { color: t.fg }]}>The assistant</Text>
                <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
                  {personal
                    ? "Your own chats, only you see them"
                    : `Your chats about ${name}, only you see them`}
                </Text>
              </View>
              <Text style={[s.rowEnd, { color: t.fg3 }]}>›</Text>
            </Pressable>
          ) : null}
          {!groupChats.length && !assistant ? (
            <Text style={[s.empty, { color: t.fg3 }]}>No chats here yet.</Text>
          ) : null}

          {section("Lists", row?.lists.length ? String(row.lists.length) : undefined)}
          {row?.lists.length ? (
            row.lists.map((l) => (
              <Pressable
                key={l.key}
                accessibilityRole="button"
                onPress={() => openList(l.collection, l.view)}
                style={rowStyle}
              >
                <View style={[s.dot, { backgroundColor: t.accent }]} />
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

          {workflows?.length ? (
            <>
              {section("Workflows", String(workflows.length))}
              {workflows.map((w) => (
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
              ))}
            </>
          ) : null}

          {!personal && people ? (
            <>
              {section("People", String(people.length))}
              {people.map((p) => (
                <View key={p.user_id} style={[s.row, { borderBottomColor: t.hair }]}>
                  {ava(p.name, p.role !== "shared")}
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
              {assistant && !others.length ? (
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
          ) : null}
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
  top: { paddingHorizontal: 16, paddingBottom: 4, flexDirection: "row", alignItems: "center" },
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
  head: { gap: 2, paddingHorizontal: 4, paddingTop: 6 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -1 },
  meta: { fontSize: 13, fontWeight: "700" },
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
});
