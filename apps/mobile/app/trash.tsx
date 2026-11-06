// Recently deleted (decision 2026-10-14 "Recently deleted", owner: "30 days is fine"): what
// was deleted from my lists in the last 30 days, newest first, each with Restore and Delete
// forever. Opened from a list (just that list's) or the All lists page (everything).
// online-only: what was deleted, restoring and erasing all live on the server.
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { TRASH_DAYS, type DeletedList, type DeletedSpace, type TrashItem } from "@assistant/shared";
import { Text } from "@assistant/cards/native";
import { isOffline, request } from "@/api";
import { COMPOSER_ROOM, Composer } from "@/components/Composer";
import { radius, useTheme } from "@/theme";

const enc = encodeURIComponent;

export default function Trash() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { collection, space } = useLocalSearchParams<{ collection?: string; space?: string }>();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  // Whole lists deleted (with what they took), above the records; not when one list's opened.
  const [lists, setLists] = useState<DeletedList[]>([]);
  // Whole spaces I deleted: on the main page only (not a space's or a list's).
  const [spaces, setSpaces] = useState<DeletedSpace[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = [
        ...(collection ? [`collection=${enc(collection)}`] : []),
        ...(space ? [`space=${enc(space)}`] : []),
      ];
      const q = params.length ? `?${params.join("&")}` : "";
      const inSpace = space ? `?space=${enc(space)}` : "";
      const [records, deletedLists, deletedSpaces] = await Promise.all([
        request<TrashItem[]>("GET", `/api/trash${q}`),
        collection ? Promise.resolve([]) : request<DeletedList[]>("GET", `/api/trash/lists${inSpace}`),
        collection || space ? Promise.resolve([]) : request<DeletedSpace[]>("GET", "/api/trash/spaces"),
      ]);
      setItems(records);
      setLists(deletedLists);
      setSpaces(deletedSpaces);
      setNote("");
    } catch (e) {
      setItems((xs) => xs ?? []);
      setNote(
        isOffline(e) ? "Recently deleted needs a connection." : e instanceof Error ? e.message : String(e),
      );
    }
  }, [collection, space]);
  useEffect(() => {
    void load();
  }, [load]);

  const inSpace = space ? `?space=${enc(space)}` : "";
  const restoreSpace = async (d: DeletedSpace) => {
    if (busy) return;
    setBusy(d.space_id);
    try {
      await request("POST", `/api/trash/spaces/${enc(d.space_id)}/restore`, {});
      setSpaces((xs) => xs.filter((x) => x.space_id !== d.space_id));
      setNote(`The space “${d.name}” is back.`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      setNote(isOffline(e) ? "That needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const actList = async (l: DeletedList, what: "restore" | "erase") => {
    if (busy) return;
    setBusy(l.collection_id);
    try {
      if (what === "restore")
        await request("POST", `/api/trash/lists/${enc(l.collection_id)}/restore${inSpace}`, {});
      else await request("DELETE", `/api/trash/lists/${enc(l.collection_id)}${inSpace}`);
      setLists((xs) => xs.filter((x) => x.collection_id !== l.collection_id));
      setConfirming(null);
      setNote(what === "restore" ? `The list “${l.name}” is back.` : `The list “${l.name}” was erased.`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      setNote(isOffline(e) ? "That needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const act = async (item: TrashItem, what: "restore" | "erase") => {
    if (busy) return;
    setBusy(item.record_id);
    try {
      if (what === "restore")
        await request("POST", `/api/trash/${enc(item.record_id)}/restore${inSpace}`, {});
      else await request("DELETE", `/api/trash/${enc(item.record_id)}${inSpace}`);
      setItems((xs) => (xs ?? []).filter((x) => x.record_id !== item.record_id));
      setConfirming(null);
      setNote(
        what === "restore" ? `“${item.title}” is back in ${item.collection}.` : `“${item.title}” was erased.`,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e) {
      setNote(isOffline(e) ? "That needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

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
        <View style={s.head}>
          <Text style={[s.title, { color: t.fg }]}>Recently deleted</Text>
          <Text style={[s.meta, { color: t.fg2 }]}>
            {collection ? `${collection} · ` : ""}kept {TRASH_DAYS} days, then erased for good
          </Text>
        </View>
        {note ? <Text style={[s.note, { color: t.fg2 }]}>{note}</Text> : null}
        <FlatList
          data={items ?? []}
          keyExtractor={(x) => x.record_id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + COMPOSER_ROOM, gap: 10 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            lists.length || spaces.length ? (
              <View style={{ gap: 10, paddingBottom: 6 }}>
                {spaces.length ? <Text style={[s.section, { color: t.fg2 }]}>SPACES</Text> : null}
                {spaces.map((d) => (
                  <View key={d.space_id} style={[s.card, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
                    <Text style={[s.itemTitle, { color: t.fg }]} numberOfLines={2}>
                      {d.name}
                    </Text>
                    <Text style={[s.line, { color: t.fg2 }]}>
                      {d.lists
                        ? `With ${d.lists} ${d.lists === 1 ? "list" : "lists"} and what's in them`
                        : "Empty"}
                    </Text>
                    <Text style={[s.when, { color: t.fg3 }]}>
                      Deleted {day(d.deleted_at)} · erased in {daysLeft(d.erase_at)}
                    </Text>
                    <View style={s.row}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Restore the space ${d.name}`}
                        disabled={busy !== null}
                        onPress={() => void restoreSpace(d)}
                        style={[s.btn, s.grow, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
                      >
                        <Text style={[s.btnText, { color: t.onAccent }]}>Restore</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
                {lists.length ? <Text style={[s.section, { color: t.fg2 }]}>LISTS</Text> : null}
                {lists.map((l) => (
                  <View
                    key={l.collection_id}
                    style={[s.card, { backgroundColor: t.cell, shadowColor: t.shadow }]}
                  >
                    <Text style={[s.itemTitle, { color: t.fg }]} numberOfLines={2}>
                      {l.name}
                    </Text>
                    <Text style={[s.line, { color: t.fg2 }]}>{tookWords(l)}</Text>
                    <Text style={[s.when, { color: t.fg3 }]}>
                      Deleted by {l.deleted_by} · {day(l.deleted_at)} · erased in {daysLeft(l.erase_at)}
                    </Text>
                    {confirming === l.collection_id ? (
                      <View style={[s.confirm, { backgroundColor: t.fill }]}>
                        <Text style={[s.line, { color: t.fg, fontWeight: "600" }]}>
                          Erase the list “{l.name}” and its records for good? It can’t be brought back.
                        </Text>
                        <View style={s.row}>
                          <Pressable
                            accessibilityRole="button"
                            disabled={busy !== null}
                            onPress={() => void actList(l, "erase")}
                            style={[s.btn, s.grow, { backgroundColor: t.danger, opacity: busy ? 0.6 : 1 }]}
                          >
                            <Text style={[s.btnText, { color: t.onAccent }]}>Delete forever</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setConfirming(null)}
                            style={[s.btn, { backgroundColor: t.cell }]}
                          >
                            <Text style={[s.btnText, { color: t.fg }]}>Keep</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={s.row}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Restore the list ${l.name}`}
                          disabled={busy !== null}
                          onPress={() => void actList(l, "restore")}
                          style={[s.btn, s.grow, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
                        >
                          <Text style={[s.btnText, { color: t.onAccent }]}>Restore</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Delete the list ${l.name} forever`}
                          disabled={busy !== null}
                          onPress={() => setConfirming(l.collection_id)}
                          style={[s.btn, { backgroundColor: t.fill }]}
                        >
                          <Text style={[s.btnText, { color: t.danger }]}>Delete forever</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))}
                {items?.length ? <Text style={[s.section, { color: t.fg2 }]}>RECORDS</Text> : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            lists.length || spaces.length ? null : items ? (
              <Text style={[s.empty, { color: t.fg2 }]}>Nothing deleted in the last {TRASH_DAYS} days.</Text>
            ) : (
              <Text style={[s.empty, { color: t.fg2 }]}>Loading…</Text>
            )
          }
          renderItem={({ item }) => (
            <View style={[s.card, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
              <Text style={[s.itemTitle, { color: t.fg }]} numberOfLines={2}>
                {item.title || "Untitled"}
                {!collection ? (
                  <Text style={{ color: t.fg2, fontWeight: "500" }}> · {item.collection}</Text>
                ) : null}
              </Text>
              {item.lines.map((l) => (
                <Text key={l} style={[s.line, { color: t.fg2 }]} numberOfLines={1}>
                  {l}
                </Text>
              ))}
              {item.also_restores ? (
                <Text style={[s.line, { color: t.fg2 }]}>
                  With {item.also_restores} linked {item.also_restores === 1 ? "record" : "records"}
                </Text>
              ) : null}
              <Text style={[s.when, { color: t.fg3 }]}>
                Deleted by {item.deleted_by} · {day(item.deleted_at)} · erased in {daysLeft(item.erase_at)}
              </Text>
              {confirming === item.record_id ? (
                <View style={[s.confirm, { backgroundColor: t.fill }]}>
                  <Text style={[s.line, { color: t.fg, fontWeight: "600" }]}>
                    Erase “{item.title || "Untitled"}” for good? It can’t be brought back.
                  </Text>
                  <View style={s.row}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy !== null}
                      onPress={() => void act(item, "erase")}
                      style={[s.btn, s.grow, { backgroundColor: t.danger, opacity: busy ? 0.6 : 1 }]}
                    >
                      <Text style={[s.btnText, { color: t.onAccent }]}>Delete forever</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setConfirming(null)}
                      style={[s.btn, { backgroundColor: t.cell }]}
                    >
                      <Text style={[s.btnText, { color: t.fg }]}>Keep</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={s.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${item.title}`}
                    disabled={busy !== null}
                    onPress={() => void act(item, "restore")}
                    style={[s.btn, s.grow, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
                  >
                    <Text style={[s.btnText, { color: t.onAccent }]}>Restore</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${item.title} forever`}
                    disabled={busy !== null}
                    onPress={() => setConfirming(item.record_id)}
                    style={[s.btn, { backgroundColor: t.fill }]}
                  >
                    <Text style={[s.btnText, { color: t.danger }]}>Delete forever</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        />
      </View>
      <Composer about={{ kind: "screen", title: "Recently deleted" }} />
    </View>
  );
}

/** What a deleted list took with it, in a line ("3 records, 1 view, 1 flow, 1 share link"). */
function tookWords(l: DeletedList): string {
  const n = (k: number, one: string, many: string) => (k ? [`${k} ${k === 1 ? one : many}`] : []);
  const parts = [
    ...n(l.records, "record", "records"),
    ...n(l.views, "view", "views"),
    ...n(l.flows, "flow", "flows"),
    ...n(l.links, "share link", "share links"),
  ];
  return parts.length ? `With ${parts.join(", ")}` : "Empty";
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function daysLeft(iso: string): string {
  const d = Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));
  return d <= 1 ? "a day" : `${d} days`;
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
    shadowOffset: { width: 0, height: 3 },
  },
  head: { paddingHorizontal: 20, paddingTop: 6, gap: 2 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  meta: { fontSize: 14 },
  note: { paddingHorizontal: 20, paddingTop: 10, fontSize: 14 },
  empty: { textAlign: "center", padding: 32, fontSize: 15 },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, paddingHorizontal: 4 },
  card: {
    borderRadius: radius.card,
    padding: 14,
    gap: 4,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  itemTitle: { fontSize: 16, fontWeight: "700" },
  line: { fontSize: 14, lineHeight: 20 },
  when: { fontSize: 12, marginTop: 2 },
  row: { flexDirection: "row", gap: 8, marginTop: 8 },
  grow: { flex: 1 },
  btn: {
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 14, fontWeight: "800" },
  confirm: { borderRadius: 16, padding: 12, gap: 6, marginTop: 8 },
});
