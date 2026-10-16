// Chats (decision 2026-10-13 "Chats with people", from the approved mock-up): the assistant
// first (only you see it), then groups and chats for two, newest first, with what's unread.
// "+" starts one with people you know here: one person is a chat for two, more is a group.
import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Sheet } from "@/components/Sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "@assistant/cards/native";
import { isOffline } from "@/api";
import { chatPeople, startChat, useChats, type ChatPerson, type GroupSummary } from "@/chats";
import { useSession } from "@/session";
import { Avatar, when } from "@/components/ChatBits";
import { radius, useTheme } from "@/theme";

export default function Chats() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { me } = useSession();
  const { chats, offline, reload } = useChats();
  const [pulling, setPulling] = useState(false);
  const [starting, setStarting] = useState(false);
  const open = (id: string) => router.push({ pathname: "/talk", params: { id } });
  const assistant = me?.assistant !== false;

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 6 }]}>
      <View style={s.column}>
        <View style={s.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={[s.round, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New chat"
            onPress={() => setStarting(true)}
            style={[s.round, { backgroundColor: t.fg }]}
          >
            <Text style={{ color: t.page, fontSize: 24, fontWeight: "700", lineHeight: 26 }}>+</Text>
          </Pressable>
        </View>
        <Text style={[s.title, { color: t.fg }]}>Chats</Text>
        {offline ? (
          <Text style={[s.note, { color: t.fg2 }]}>Offline: showing what this phone kept.</Text>
        ) : null}
        <FlatList
          data={chats ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40, gap: 8 }}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                void reload().finally(() => setPulling(false));
              }}
            />
          }
          ListHeaderComponent={
            <View style={{ gap: 8 }}>
              {assistant ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Your assistant, only you see it"
                  onPress={() => router.push("/chat")}
                  style={({ pressed }) => [s.row, { backgroundColor: t.cell }, pressed && s.pressed]}
                >
                  <View style={[s.avatar, s.gs, { backgroundColor: t.hero }]}>
                    <Text style={[s.gsText, { color: t.onHero }]}>Gs</Text>
                  </View>
                  <View style={s.body}>
                    <Text style={[s.name, { color: t.fg }]}>Assistant</Text>
                    <Text style={[s.only, { color: t.good }]}>Only you see this one</Text>
                  </View>
                </Pressable>
              ) : null}
              {chats?.length ? <Text style={[s.section, { color: t.fg2 }]}>People</Text> : null}
            </View>
          }
          ListEmptyComponent={
            chats === null ? (
              <ActivityIndicator color={t.fg3} style={{ marginTop: 30 }} />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setStarting(true)}
                style={[s.empty, { backgroundColor: t.cell }]}
              >
                <Text style={[s.emptyTitle, { color: t.fg }]}>Talk to the people you share things with</Text>
                <Text style={[s.emptyText, { color: t.fg2 }]}>
                  Save anything they say to your lists with a tap, and share cards everyone sees live. Tap to
                  start a chat.
                </Text>
              </Pressable>
            )
          }
          renderItem={({ item }) => <ChatRow chat={item} onPress={() => open(item.id)} />}
        />
      </View>
      <NewChat
        open={starting}
        onClose={() => setStarting(false)}
        onMade={(id) => {
          setStarting(false);
          void reload();
          open(id);
        }}
      />
    </View>
  );
}

function ChatRow({ chat, onPress }: { chat: GroupSummary; onPress: () => void }) {
  const { t } = useTheme();
  const { me } = useSession();
  const who = chat.last?.author === me?.user.name ? "You" : chat.last?.author;
  const last = chat.last
    ? chat.direct && who !== "You"
      ? chat.last.text
      : `${who}: ${chat.last.text}`
    : chat.direct
      ? "Say hello"
      : `${chat.members} people`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${chat.name}${chat.unread ? `, ${chat.unread} unread` : ""}`}
      onPress={onPress}
      style={({ pressed }) => [s.row, { backgroundColor: t.cell }, pressed && s.pressed]}
    >
      <Avatar name={chat.name} />
      <View style={s.body}>
        <View style={s.line}>
          <Text style={[s.name, { color: t.fg }]} numberOfLines={1}>
            {chat.name}
          </Text>
          <Text style={[s.time, { color: chat.unread ? t.accent : t.fg3 }]}>
            {chat.last ? when(chat.last.at) : ""}
          </Text>
        </View>
        <View style={s.line}>
          <Text style={[s.last, { color: t.fg2 }]} numberOfLines={1}>
            {last}
          </Text>
          {chat.unread ? (
            <View style={[s.badge, { backgroundColor: t.accent }]}>
              <Text style={[s.badgeText, { color: t.onAccent }]}>
                {chat.unread > 99 ? "99+" : chat.unread}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/** Pick people you know; one is a chat for two, more need a group name. */
function NewChat({
  open,
  onClose,
  onMade,
}: {
  open: boolean;
  onClose: () => void;
  onMade: (id: string) => void;
}) {
  const { t } = useTheme();
  const [people, setPeople] = useState<ChatPerson[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const group = picked.length > 1;
  const names = useMemo(() => new Map((people ?? []).map((p) => [p.user_id, p.name])), [people]);

  const load = () => {
    setPicked([]);
    setName("");
    setError("");
    setPeople(null);
    chatPeople()
      .then(setPeople)
      .catch((e: unknown) => {
        setPeople([]);
        setError(
          isOffline(e) ? "Starting a chat needs a connection." : e instanceof Error ? e.message : String(e),
        );
      });
  };
  const go = async () => {
    if (!picked.length || (group && !name.trim())) return;
    setBusy(true);
    setError("");
    try {
      const made = await startChat({ people: picked, ...(group ? { name: name.trim() } : {}) });
      onMade(made.id);
    } catch (e) {
      setError(
        isOffline(e) ? "Starting a chat needs a connection." : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} onShow={load} accessibilityLabel="New chat">
      <Text style={[s.sheetTitle, { color: t.fg }]}>New chat</Text>
      <Text style={[s.emptyText, { color: t.fg2 }]}>
        With people you know here: people you share with, who share with you, or who are in your groups.
      </Text>
      <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 6 }}>
        {people === null ? <ActivityIndicator color={t.fg3} /> : null}
        {people?.length === 0 && !error ? (
          <Text style={[s.emptyText, { color: t.fg2 }]}>
            Nobody yet. Share a card with someone first (from the home: hold a card, then Share); once they
            join, you can chat with them.
          </Text>
        ) : null}
        {people?.map((p) => {
          const on = picked.includes(p.user_id);
          return (
            <Pressable
              key={p.user_id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => setPicked((x) => (on ? x.filter((y) => y !== p.user_id) : [...x, p.user_id]))}
              style={[s.person, { backgroundColor: on ? t.accentSoft : t.cell }]}
            >
              <Avatar name={p.name} size={36} />
              <Text style={[s.personName, { color: t.fg }]} numberOfLines={1}>
                {p.name}
              </Text>
              <View
                style={[
                  s.check,
                  { borderColor: on ? t.accent : t.fill2, backgroundColor: on ? t.accent : t.cell },
                ]}
              >
                {on ? <Text style={{ color: t.onAccent, fontWeight: "800", fontSize: 13 }}>✓</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {group ? (
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Group name, e.g. Flatmates"
          placeholderTextColor={t.fg3}
          maxLength={60}
          style={[s.input, { backgroundColor: t.cell, color: t.fg }]}
        />
      ) : null}
      {error ? <Text style={[s.emptyText, { color: t.danger }]}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !picked.length || (group && !name.trim())}
        onPress={() => void go()}
        style={[
          s.go,
          {
            backgroundColor: t.accent,
            opacity: busy || !picked.length || (group && !name.trim()) ? 0.5 : 1,
          },
        ]}
      >
        <Text style={[s.goText, { color: t.onAccent }]}>
          {busy
            ? "Starting…"
            : group
              ? `Make the group (${picked.length + 1} people)`
              : picked.length
                ? `Chat with ${names.get(picked[0]!) ?? ""}`
                : "Pick someone"}
        </Text>
      </Pressable>
    </Sheet>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" },
  top: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 4 },
  round: {
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
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -1, paddingHorizontal: 20, paddingBottom: 10 },
  note: { fontSize: 13, paddingHorizontal: 20, paddingBottom: 6 },
  section: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingTop: 10,
    paddingHorizontal: 4,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 18, minHeight: 68 },
  pressed: { transform: [{ scale: 0.98 }] },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  gs: { borderRadius: 14 },
  gsText: { fontSize: 17, fontWeight: "800", fontStyle: "italic" },
  body: { flex: 1, minWidth: 0, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { flexShrink: 1, fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  only: { fontSize: 12, fontWeight: "700" },
  time: { fontSize: 12, fontWeight: "600" },
  last: { flex: 1, fontSize: 14 },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "800" },
  empty: { borderRadius: radius.card, padding: 18, gap: 6, marginTop: 4 },
  emptyTitle: { fontSize: 17, fontWeight: "800" },
  emptyText: { fontSize: 14, lineHeight: 20 },
  sheetTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 16,
    minHeight: 56,
  },
  personName: { flex: 1, fontSize: 16, fontWeight: "700" },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  input: { minHeight: 48, borderRadius: 16, paddingHorizontal: 16, fontSize: 16 },
  go: { minHeight: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  goText: { fontSize: 16, fontWeight: "800" },
});
