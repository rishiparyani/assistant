// A chat's info (docs/design/chats-base.md, step 2): tap a chat's name to see what it holds, like
// WhatsApp's group info. Lists (each with the flows that work on it), then People. A chat for two
// is a group of two (decision 2026-11-01): the same screen. Lists and flows are made by asking
// the assistant (decision "Chat makes, screens use"); this screen opens them. It reads what the
// phone kept first (the chat, Today's lists, the flows), so it opens with no connection.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text, type } from "@assistant/cards/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SpacePerson, WorkflowView } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { useChat } from "@/chats";
import { onHomeChanged } from "@/home";
import { useLive } from "@/live-socket";
import { useSession } from "@/session";
import { readJson, writeJson } from "@/storage";
import { colourFor, useTheme } from "@/theme";
import { loadToday, savedToday, type Today } from "@/today";
import { Avatar } from "@/components/ChatBits";
import { PeopleSheet } from "@/components/PeopleSheet";
import { SpaceNewChat } from "@/components/SpaceNewChat";

const enc = encodeURIComponent;

export default function ChatInfo() {
  const { t, colour } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { me } = useSession();
  const userId = me?.user.id ?? null;
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  // Its messages aren't shown here, so opening the info marks nothing read (Codex on PR 222).
  const { chat, reload } = useChat(id, undefined, undefined, { read: false });
  const space = chat?.space_id ?? null;
  const [today, setToday] = useState<Today | null>(() => (userId ? savedToday(userId) : null));
  // The same kept copy as a space's page (one list of flows per space on the phone).
  const flowsKey = space ? `gigspree:space:${space}:workflows` : "";
  const [flows, setFlows] = useState<WorkflowView[] | null>(() => (flowsKey ? readJson(flowsKey) : null));
  // The home's people (for a new chat over the same lists), kept like a space's page keeps them.
  const peopleKey = space ? `gigspree:space:${space}:people` : "";
  const [homePeople, setHomePeople] = useState<SpacePerson[] | null>(() =>
    peopleKey ? readJson(peopleKey) : null,
  );
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState("");
  const [people, setPeople] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (flowsKey) setFlows(readJson(flowsKey));
    if (peopleKey) setHomePeople(readJson(peopleKey));
  }, [flowsKey, peopleKey]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [fresh, wf, ps] = await Promise.all([
        loadToday(userId),
        space ? request<WorkflowView[]>("GET", `/api/workflows?space=${enc(space)}`) : Promise.resolve(null),
        space ? request<SpacePerson[]>("GET", `/api/spaces/${enc(space)}/people`) : Promise.resolve(null),
      ]);
      if (ps && peopleKey) {
        setHomePeople(ps);
        writeJson(peopleKey, ps);
      }
      setToday(fresh);
      if (wf && flowsKey) {
        setFlows(wf);
        writeJson(flowsKey, wf);
      }
      setNote("");
    } catch (e) {
      setNote(
        isOffline(e) ? "Offline: showing what this phone saved." : e instanceof Error ? e.message : String(e),
      );
    }
  }, [userId, space, flowsKey, peopleKey]);
  useEffect(() => {
    void load();
  }, [load]);
  // Lists made from the chat (by anyone) show here too; a burst of changes loads once.
  useEffect(() => onHomeChanged(() => void load()), [load]);
  const liveLoad = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLive((m) => {
    if (m.type !== "space_changed" && m.type !== "reconnected") return;
    clearTimeout(liveLoad.current);
    liveLoad.current = setTimeout(() => void load(), 400);
  });

  const back = () =>
    router.canGoBack() ? router.back() : router.replace({ pathname: "/talk", params: { id } });
  const lists = (space && today?.spaces.find((sp) => sp.spaceId === space)?.lists) || [];
  // Each flow under the list it works on (its first row, when the list shows in several views).
  const shownLists = new Set<string>();
  const flowsOf = (collection: string) => {
    if (shownLists.has(collection)) return [];
    shownLists.add(collection);
    return (flows ?? []).filter((w) => w.when.collection_id === collection);
  };
  const listed = new Set(lists.map((l) => l.collection));
  const otherFlows = (flows ?? []).filter((w) => !listed.has(w.when.collection_id));
  const openList = (collection: string, view?: string) =>
    router.push({
      pathname: "/list",
      params: { collection, ...(view ? { view } : {}), ...(space ? { space } : {}) },
    });
  const openFlow = (w: WorkflowView) =>
    router.push({ pathname: "/process", params: { id: w.id, ...(space ? { space } : {}) } });
  const askForList = () =>
    router.replace({
      pathname: "/talk",
      params: { id, ask: "Make a list for this chat to keep track of " },
    });

  const name = chat?.name ?? "";
  const others = chat?.members.filter((m) => m.user_id !== userId) ?? [];
  const sub = chat
    ? chat.direct
      ? "Chat for two"
      : `${chat.members.length} ${chat.members.length === 1 ? "person" : "people"}`
    : "";
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
  const flowRow = (w: WorkflowView, under: boolean) => (
    <Pressable
      key={w.id}
      accessibilityRole="button"
      accessibilityLabel={`Flow: ${w.name}, ${w.enabled ? "on" : "off"}`}
      onPress={() => openFlow(w)}
      style={(st) => [rowStyle(st), under && s.under]}
    >
      <View style={[s.flowDot, { borderColor: w.enabled ? t.good : t.fg3 }]} />
      <View style={s.words}>
        <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
          {w.name}
        </Text>
        <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
          Flow · {w.enabled ? "On" : "Off"}
        </Text>
      </View>
      <Text style={[s.rowEnd, { color: t.fg3 }]}>›</Text>
    </Pressable>
  );

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 6 }]}>
      <View style={s.column}>
        <View style={s.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={back}
            style={[s.back, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32, gap: 4 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await Promise.all([load(), reload()]);
                setRefreshing(false);
              }}
              tintColor={t.fg2}
            />
          }
        >
          <View style={s.head}>
            <Avatar name={name || "?"} size={72} />
            <Text style={[type.heading, s.center, { color: t.fg }]} numberOfLines={2}>
              {name}
            </Text>
            <Text style={[type.caption, s.center, { color: t.fg2 }]}>{sub}</Text>
          </View>
          {note ? <Text style={[s.note, { color: t.fg2 }]}>{note}</Text> : null}

          {section("Lists", lists.length ? String(lists.length) : undefined)}
          {lists.map((l) => {
            const fs = flowsOf(l.collection);
            return (
              <View key={l.key}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`List: ${l.title}${fs.length ? `, ${fs.length} flow${fs.length === 1 ? "" : "s"}` : ""}`}
                  onPress={() => openList(l.collection, l.view)}
                  style={rowStyle}
                >
                  <View style={[s.dot, { backgroundColor: colour(colourFor(l.title)) }]} />
                  <View style={s.words}>
                    <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
                      {l.title}
                    </Text>
                    {fs.length ? (
                      <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
                        {fs.length === 1 ? "1 flow" : `${fs.length} flows`}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[s.rowEnd, { color: t.fg3 }]}>›</Text>
                </Pressable>
                {fs.map((w) => flowRow(w, true))}
              </View>
            );
          })}
          {otherFlows.map((w) => flowRow(w, false))}
          {!lists.length ? (
            <Text style={[s.empty, { color: t.fg3 }]}>
              {chat?.can_ask
                ? "No lists yet. Ask your assistant for one: it makes it here, for everyone in this chat."
                : "No lists yet."}
            </Text>
          ) : null}
          {chat?.can_ask ? (
            <Pressable accessibilityRole="button" onPress={askForList} style={rowStyle}>
              <View style={[s.dot, { backgroundColor: t.fg3 }]} />
              <View style={s.words}>
                <Text style={[s.rowTitle, { color: t.accent }]}>New list, with your assistant</Text>
              </View>
            </Pressable>
          ) : null}

          {/* Another chat over the same lists: for everyone, or a private one for some (chats-home.md 6). */}
          {chat && space && !chat.direct && homePeople ? (
            <Pressable accessibilityRole="button" onPress={() => setStarting(true)} style={rowStyle}>
              <View style={[s.dot, { backgroundColor: t.fg3 }]} />
              <View style={s.words}>
                <Text style={[s.rowTitle, { color: t.accent }]}>New chat over these lists</Text>
                <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
                  For everyone, or a private one for some people
                </Text>
              </View>
            </Pressable>
          ) : null}

          {section("People", chat ? String(chat.members.length) : undefined)}
          {chat
            ? [...chat.members]
                .sort((a, b) => Number(b.user_id === userId) - Number(a.user_id === userId))
                .map((m) => (
                  <View key={m.user_id} style={[s.row, { borderBottomColor: t.hair }]}>
                    <Avatar name={m.name} size={38} />
                    <View style={s.words}>
                      <Text style={[s.rowTitle, { color: t.fg }]} numberOfLines={1}>
                        {m.user_id === userId ? "You" : m.name}
                      </Text>
                    </View>
                    {m.role === "owner" && !chat.direct ? (
                      <Text style={[s.badge, { backgroundColor: t.accentSoft, color: t.accent }]}>Admin</Text>
                    ) : null}
                  </View>
                ))
            : null}
          {chat ? (
            <Pressable accessibilityRole="button" onPress={() => setPeople(true)} style={rowStyle}>
              <View style={[s.dot, { backgroundColor: t.fg3 }]} />
              <View style={s.words}>
                <Text style={[s.rowTitle, { color: t.accent }]}>
                  {chat.direct ? "Settings" : "Admins and settings"}
                </Text>
                <Text style={[s.rowSub, { color: t.fg2 }]} numberOfLines={1}>
                  {chat.direct
                    ? `Suggestions, for you and ${others[0]?.name ?? "them"}`
                    : "Who's an admin, suggestions for you"}
                </Text>
              </View>
              <Text style={[s.rowEnd, { color: t.fg3 }]}>›</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
      {chat && space && !chat.direct && homePeople ? (
        <SpaceNewChat
          open={starting}
          space={{ id: space, name }}
          people={homePeople.filter((p) => p.role !== "shared" && p.user_id !== userId)}
          onClose={() => setStarting(false)}
          onMade={(chatId) => {
            setStarting(false);
            router.push({ pathname: "/talk", params: { id: chatId } });
          }}
        />
      ) : null}
      {chat ? (
        <PeopleSheet
          chat={chat}
          myId={userId}
          open={people}
          onClose={() => setPeople(false)}
          onChanged={() => void reload()}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 640, alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 4 },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  head: { alignItems: "center", gap: 6, paddingVertical: 8 },
  center: { textAlign: "center" },
  note: { fontSize: 13, paddingVertical: 6 },
  sec: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingTop: 18, paddingBottom: 4 },
  secTitle: { fontSize: 17, fontWeight: "800" },
  secAside: { fontSize: 13, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  under: { paddingLeft: 24 },
  words: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: "700" },
  rowSub: { fontSize: 13, marginTop: 1 },
  rowEnd: { fontSize: 18, fontWeight: "700" },
  dot: { width: 12, height: 12, borderRadius: 6 },
  flowDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  badge: {
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
  },
  empty: { fontSize: 14, lineHeight: 20, paddingVertical: 8 },
});
