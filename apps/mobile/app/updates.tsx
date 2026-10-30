// Updates (decision 2026-10-30 "Updates"; owner: "some kind of a thing like a message that it
// has been approved"): what others did that I should know, newest first. Needs you is what I
// must do; this is what happened. Opened from the bell at the top of Chats; opening it marks
// everything read (new ones stay tinted until I leave).
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isClassicPath, type NotificationView } from "@assistant/shared";
import { Tap, Text, type } from "@assistant/cards/native";
import { isOffline } from "@/api";
import { when } from "@/components/ChatBits";
import { loadUpdates, markUpdatesRead, savedUpdates } from "@/updates";
import { useTheme } from "@/theme";

export default function Updates() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<NotificationView[]>(() => savedUpdates().items);
  const [note, setNote] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const got = await loadUpdates();
      setItems(got.items);
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

  // Where an update leads: a question opens Needs you; a screen of this app opens itself.
  const open = (u: NotificationView) => {
    if (!u.url) return;
    if (u.url.startsWith("/cards/")) return router.push("/needs");
    // A flow's message names a list (and record) by the old site's address: open the list here.
    const list = /^\/c\/([^/?]+)(?:\/[^/?]+)?(?:\?space=([^&]+))?/.exec(u.url);
    if (list)
      return router.push({
        pathname: "/list",
        params: { collection: list[1]!, ...(list[2] ? { space: decodeURIComponent(list[2]) } : {}) },
      });
    if (u.url.startsWith("/") && !isClassicPath(u.url.split("?")[0]!)) router.push(u.url as Href);
  };

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
        </View>
        <View style={s.head}>
          <Text style={[type.title, { color: t.fg }]}>Updates</Text>
          <Text style={[type.caption, { color: t.fg2 }]}>What happened that you should know</Text>
        </View>
        {note ? <Text style={[s.note, { color: t.fg2 }]}>{note}</Text> : null}
        <FlatList
          data={items}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 8 }}
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
  top: { paddingHorizontal: 16, paddingBottom: 4 },
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
  head: { paddingHorizontal: 20, paddingTop: 6, gap: 2 },
  note: { paddingHorizontal: 20, paddingTop: 8, fontSize: 13 },
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
