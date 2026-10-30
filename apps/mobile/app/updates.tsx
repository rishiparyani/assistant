// The Inbox, opened from the bell at the top of Chats (docs/design/chats-base.md, "The bell: one
// inbox"; decision 2026-10-30 "Updates"): Needs you on top (questions, approvals and forms
// waiting on me, answered in place), then Updates (what others did that I should know, newest
// first; owner: "some kind of a thing like a message that it has been approved"). Opening it
// marks the updates read (new ones stay tinted until I leave).
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isClassicPath, type NotificationView } from "@assistant/shared";
import { Tap, Text, type } from "@assistant/cards/native";
import { isOffline } from "@/api";
import { when } from "@/components/ChatBits";
import { NeedsList, onMe, useNeeds } from "@/components/NeedsList";
import { loadUpdates, markUpdatesRead, savedUpdates, updatesOnly } from "@/updates";
import { useTheme } from "@/theme";

export default function Inbox() {
  const { t, colour } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<NotificationView[]>(() => updatesOnly(savedUpdates().items));
  const [note, setNote] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const needs = useNeeds();

  const load = useCallback(async () => {
    try {
      const got = await loadUpdates();
      setItems(updatesOnly(got.items));
      setNote("");
      if (got.unread) void markUpdatesRead().catch(() => undefined);
    } catch (e) {
      setNote(
        isOffline(e)
          ? "Offline: these are the updates saved on this device."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Where an update leads: a screen of this app opens itself.
  const open = (u: NotificationView) => {
    if (!u.url) return;
    // A flow's message names a list (and record) by the old site's address: open the list here.
    const list = /^\/c\/([^/?]+)(?:\/[^/?]+)?(?:\?space=([^&]+))?/.exec(u.url);
    if (list)
      return router.push({
        pathname: "/list",
        params: { collection: list[1]!, ...(list[2] ? { space: decodeURIComponent(list[2]) } : {}) },
      });
    if (u.url.startsWith("/") && !isClassicPath(u.url.split("?")[0]!)) router.push(u.url as Href);
  };

  const mine = needs.needs?.filter(onMe) ?? null;
  const others = needs.needs?.filter((c) => !onMe(c)) ?? [];
  const head = (
    <View style={s.top}>
      <View style={s.head}>
        <Text style={[type.title, { color: t.fg }]}>Inbox</Text>
        <Text style={[type.caption, { color: t.fg2 }]}>What needs you, then what happened</Text>
      </View>
      {needs.error ? <Text style={[s.note, { color: t.danger }]}>{needs.error}</Text> : null}
      <View style={s.section}>
        <Text style={[type.eyebrow, { color: t.fg2 }]}>NEEDS YOU</Text>
        {mine?.length ? (
          <View style={[s.count, { backgroundColor: colour("time") }]}>
            <Text style={[s.countText, { color: t.tileInk }]}>{mine.length > 99 ? "99+" : mine.length}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 12 }}>
        {mine === null ? (
          <Text style={[type.small, { color: t.fg3 }]}> </Text>
        ) : (
          <NeedsList
            needs={mine}
            reload={needs.reload}
            onError={needs.setError}
            empty="Nothing waiting on you."
          />
        )}
      </View>
      {others.length ? (
        <>
          <View style={[s.section, { marginTop: 18 }]}>
            <Text style={[type.eyebrow, { color: t.fg2 }]}>WAITING ON OTHERS</Text>
          </View>
          <View style={{ gap: 12 }}>
            <NeedsList needs={others} reload={needs.reload} onError={needs.setError} />
          </View>
        </>
      ) : null}
      <View style={[s.section, { marginTop: 18 }]}>
        <Text style={[type.eyebrow, { color: t.fg2 }]}>UPDATES</Text>
      </View>
      {note ? <Text style={[s.note, { color: t.fg2 }]}>{note}</Text> : null}
    </View>
  );

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 6 }]}>
      <View style={s.column}>
        <View style={s.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            style={[s.back, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
          </Pressable>
        </View>
        <FlatList
          data={items}
          keyExtractor={(u) => u.id}
          ListHeaderComponent={head}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 8 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await Promise.all([load(), needs.reload()]);
                setRefreshing(false);
              }}
              tintColor={t.fg2}
            />
          }
          ListEmptyComponent={
            <Text style={[s.empty, { color: t.fg2 }]}>
              Nothing yet. When a flow tells you something, or someone answers about something you added, it
              shows here.
            </Text>
          }
          renderItem={({ item }) => {
            const body = (
              <>
                {!item.read_at ? <View style={[s.dot, { backgroundColor: t.accent }]} /> : null}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={s.line}>
                    <Text style={[type.body, { color: t.fg, fontWeight: "700", flex: 1 }]} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={[type.caption, { color: t.fg3 }]}>{when(item.at)}</Text>
                  </View>
                  {item.body ? (
                    <Text style={[type.small, { color: t.fg2 }]} numberOfLines={3}>
                      {item.body}
                    </Text>
                  ) : null}
                </View>
              </>
            );
            const look = [
              s.row,
              { backgroundColor: item.read_at ? t.cell : t.accentSoft, borderColor: t.hair },
            ];
            // Only an update that leads somewhere is a button (one that doesn't isn't dimmed).
            return item.url ? (
              <Tap accessibilityRole="button" onPress={() => open(item)} scale={0.985} style={look}>
                {body}
              </Tap>
            ) : (
              <View style={look}>{body}</View>
            );
          }}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  bar: { paddingHorizontal: 16, paddingBottom: 4 },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  top: { gap: 8, paddingBottom: 4 },
  head: { paddingHorizontal: 4, paddingTop: 2, gap: 2 },
  section: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, marginTop: 10 },
  count: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  countText: { fontSize: 12, fontWeight: "800" },
  note: { paddingHorizontal: 4, fontSize: 13 },
  empty: { padding: 20, fontSize: 15, lineHeight: 21, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    minHeight: 56,
    padding: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 8 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
});
