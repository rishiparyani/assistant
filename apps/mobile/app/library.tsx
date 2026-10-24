// The library (docs/design/from-scratch.md, FS1): everything the person has, in one place:
// every list and view, what's shared with them, the flows, and practice copies. A row opens the
// list. Nothing is added to or arranged on Today from here: Today sorts itself.
// online-only: the library reads every space, share, question and flow; it needs a connection.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Tap, Text } from "@assistant/cards/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SpaceView, WorkflowView } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { API_URL } from "@/config";
import { openChat } from "@/chat-open";
import { COMPOSER_ROOM, Composer } from "@/components/Composer";
import { playAs } from "@/components/PracticeBanner";
import { loadCatalog, rememberCatalog, savedCatalog, type Catalog, type CatalogEntry } from "@/home";
import { useSession } from "@/session";
import { Mark } from "@/components/Mark";
import { colourFor, radius, useTheme } from "@/theme";

const KIND: Record<CatalogEntry["kind"], string> = {
  view: "A saved view",
  list: "A whole list",
  share: "Shared with you",
  wait: "Waiting on an answer",
  now: "What's coming up next, from your cards",
  memory: "What the assistant remembers for you",
};

export default function Library() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { me, refresh } = useSession();
  const userId = me?.user.id ?? null;
  // Drawn at once from the catalog this device last loaded (the home just did), refreshed after.
  const saved = useMemo(() => (userId ? savedCatalog(userId) : null), [userId]);
  const [entries, setEntries] = useState<CatalogEntry[] | null>(saved?.entries ?? null);
  const [emptySpaces, setEmptySpaces] = useState<{ id: string; name: string }[]>(saved?.emptySpaces ?? []);
  const [note, setNote] = useState("");
  // Flows (owner, 2026-10-19: "how do I rehearse it? … Add a flow section"): what the app does
  // on its own, in every space, each opening on its own page to rehearse it or turn it on.
  const [flows, setFlows] = useState<{ flow: WorkflowView; space: SpaceView }[] | null>(null);
  // Practice copies (owner, 2026-10-24, after the chat made one with no way to open it): each
  // opens on its practice page; End erases it (two taps).
  const [practices, setPractices] = useState<SpaceView[]>([]);
  const [ending, setEnding] = useState<string | null>(null);

  const loadFlows = useCallback(async () => {
    try {
      const all0 = await request<SpaceView[]>("GET", "/api/spaces");
      setPractices(all0.filter((sp) => !!sp.practice_of));
      const spaces = all0.filter((sp) => !sp.practice_of);
      const all = await Promise.all(
        spaces.map((sp) =>
          request<WorkflowView[]>("GET", `/api/workflows?space=${encodeURIComponent(sp.id)}`)
            .then((list) => list.map((flow) => ({ flow, space: sp })))
            // A space where this person can't see workflows simply shows none.
            .catch(() => []),
        ),
      );
      setFlows(all.flat());
    } catch {
      setFlows([]);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const cat: Catalog = await loadCatalog();
      if (userId) rememberCatalog(userId, cat);
      setEntries(cat.entries);
      setEmptySpaces(cat.emptySpaces);
      setNote("");
    } catch (e) {
      // With a saved copy on screen, a failed refresh changes nothing (offline: it stays).
      if (saved) return;
      setNote(isOffline(e) ? "The library needs a connection." : e instanceof Error ? e.message : String(e));
    }
  }, [userId, saved]);
  useEffect(() => {
    void load();
    void loadFlows();
  }, [load, loadFlows]);

  const groups = new Map<string, CatalogEntry[]>();
  for (const e of entries ?? []) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.title, { color: t.fg }]}>Library</Text>
          <Text style={[s.label, { color: t.fg2 }]}>Every list, view and flow you have, in one place.</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + COMPOSER_ROOM, gap: 18 }}>
        {flows ? (
          <View style={{ gap: 8 }}>
            <Text style={[s.h2, { color: t.fg }]}>Flows</Text>
            <Text style={[s.label, { color: t.fg2 }]}>
              What the app does on its own. Open one to rehearse it, see what it did, or turn it on.
            </Text>
            <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
              {flows.length ? (
                flows.map(({ flow, space }, i) => {
                  const open = () =>
                    router.push({ pathname: "/process", params: { id: flow.id, space: space.id } });
                  return (
                    <View
                      key={flow.id}
                      style={[
                        s.row,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
                      ]}
                    >
                      <Mark name={flow.name} tone={colourFor(flow.name)} />
                      <Pressable accessibilityRole="link" onPress={open} style={s.words}>
                        <Text style={[s.name, { color: t.fg }]} numberOfLines={2}>
                          {flow.name}
                        </Text>
                        <Text style={[s.label, { color: t.fg2 }]} numberOfLines={2}>
                          {flow.enabled ? "On" : "Off · rehearse it, then turn it on"}
                          {space.kind === "personal" ? "" : ` · ${space.name}`}
                        </Text>
                      </Pressable>
                      <Tap
                        accessibilityRole="button"
                        accessibilityLabel={`Rehearse ${flow.name}`}
                        onPress={open}
                        style={[s.btn, { backgroundColor: flow.enabled ? t.fill : t.accent }]}
                      >
                        <Text style={[s.btnText, { color: flow.enabled ? t.fg : t.onAccent }]}>Rehearse</Text>
                      </Tap>
                    </View>
                  );
                })
              ) : (
                <View style={[s.row, { paddingVertical: 12 }]}>
                  <View style={s.words}>
                    <Text style={[s.name, { color: t.fg }]}>No flows yet</Text>
                    <Text style={[s.label, { color: t.fg2 }]}>
                      Ask the chat, like “when a bill is due, remind me the day before”.
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        ) : null}
        {practices.length ? (
          <View style={{ gap: 8 }}>
            <Text style={[s.h2, { color: t.fg }]}>Practice copies</Text>
            <Text style={[s.label, { color: t.fg2 }]}>
              Copies to try things in. Nothing in them reaches anyone; End erases one.
            </Text>
            <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
              {practices.map((sp, i) => {
                // The copy as the whole app, as yourself; Switch on the banner plays its people.
                const open = () =>
                  me &&
                  sp.practice_of &&
                  void playAs(
                    {
                      space: sp.id,
                      of: sp.practice_of,
                      as: me.user.id,
                      name: me.user.name,
                      self: me.user.id,
                    },
                    refresh,
                  ).then(() => router.replace("/"));
                const sure = ending === sp.id;
                return (
                  <View
                    key={sp.id}
                    style={[
                      s.row,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
                    ]}
                  >
                    <Mark name={sp.name} tone={colourFor(sp.name)} />
                    <Pressable accessibilityRole="link" onPress={open} style={s.words}>
                      <Text style={[s.name, { color: t.fg }]} numberOfLines={2}>
                        {sp.name}
                      </Text>
                      <Text style={[s.label, { color: t.fg2 }]}>
                        Open: the app as it is in the copy; Switch plays its people
                      </Text>
                    </Pressable>
                    <Tap
                      accessibilityRole="button"
                      accessibilityLabel={sure ? `Sure? End ${sp.name}` : `End ${sp.name}`}
                      onPress={() => {
                        if (!sure) {
                          setEnding(sp.id);
                          setTimeout(() => setEnding((e) => (e === sp.id ? null : e)), 4000);
                          return;
                        }
                        setEnding(null);
                        // online-only: ending a practice copy erases it on the server.
                        void request("DELETE", `/api/spaces/${encodeURIComponent(sp.id)}/practice`)
                          .then(() => loadFlows())
                          .catch((e) =>
                            setNote(
                              isOffline(e)
                                ? "Ending a practice copy needs a connection."
                                : e instanceof Error
                                  ? e.message
                                  : String(e),
                            ),
                          );
                      }}
                      style={[s.btn, { backgroundColor: sure ? t.danger : t.fill }]}
                    >
                      <Text style={[s.btnText, { color: sure ? t.onAccent : t.fg }]}>
                        {sure ? "Sure?" : "End"}
                      </Text>
                    </Tap>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
        {entries && note ? (
          // An action that failed after the library loaded (ending a practice copy): say so here,
          // not only on the loading screen.
          <Text style={[s.label, { color: t.danger }]}>{note}</Text>
        ) : null}
        {!entries ? (
          <Text style={[s.label, { color: note ? t.danger : t.fg2 }]}>{note || "Loading…"}</Text>
        ) : (
          [...groups.entries()].map(([group, list]) => (
            <View key={group} style={{ gap: 8 }}>
              <Text style={[s.h2, { color: t.fg }]}>{group}</Text>
              <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
                {list.map((e, i) => {
                  const opens = e.collection ? e.collection.id : null;
                  // online-only: a thing shared with me opens on the website's shared page.
                  const shared = e.kind === "share" ? e.share!.share_id : null;
                  return (
                    <View
                      key={e.key}
                      style={[
                        s.row,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
                      ]}
                    >
                      <Mark name={e.title} tone={colourFor(e.collection?.name ?? e.title)} />
                      <Pressable
                        accessibilityRole={opens || shared ? "link" : "text"}
                        disabled={!opens && !shared}
                        onPress={() => {
                          if (opens)
                            router.push({
                              pathname: "/list",
                              params: {
                                collection: opens,
                                ...(e.view ? { view: e.view.id } : {}),
                                ...(e.space ? { space: e.space } : {}),
                              },
                            });
                          else if (shared)
                            void Linking.openURL(`${API_URL}/shared/${encodeURIComponent(shared)}`);
                        }}
                        style={s.words}
                      >
                        <Text style={[s.name, { color: t.fg }]} numberOfLines={2}>
                          {e.title}
                        </Text>
                        <Text style={[s.label, { color: t.fg2 }]} numberOfLines={1}>
                          {KIND[e.kind]}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
        {/* A space with no lists has no cards yet: shown here, with a way to start it. */}
        {entries
          ? emptySpaces.map((sp) => (
              <View key={`space:${sp.id}`} style={{ gap: 8 }}>
                <Text style={[s.h2, { color: t.fg }]}>{sp.name}</Text>
                <View style={[s.card, s.row, { backgroundColor: t.cell, borderColor: t.hair }]}>
                  <Mark name={sp.name} />
                  <View style={s.words}>
                    <Text style={[s.name, { color: t.fg }]}>Nothing in it yet</Text>
                    <Text style={[s.label, { color: t.fg2 }]} numberOfLines={2}>
                      A space with no lists. Tell the chat what it's for.
                    </Text>
                  </View>
                  <Tap
                    accessibilityRole="button"
                    accessibilityLabel={`Start building ${sp.name}`}
                    onPress={() => openChat({ space: sp.id, ask: "Set up the lists for this space" })}
                    style={[s.btn, { backgroundColor: t.accent }]}
                  >
                    <Text style={[s.btnText, { color: t.onAccent }]}>Start</Text>
                  </Tap>
                </View>
              </View>
            ))
          : null}
        {entries ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/trash")}
            style={[s.card, s.trash, { backgroundColor: t.fill, borderColor: t.hair }]}
          >
            <Text style={[s.name, { color: t.fg2 }]}>Recently deleted</Text>
            <Text style={[s.label, { color: t.fg3 }]}>Kept 30 days ›</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <Composer about={{ kind: "screen", title: "Library" }} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  head: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 12 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  h2: { fontSize: 15, fontWeight: "700" },
  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, minHeight: 60 },
  words: { flex: 1, paddingVertical: 10, gap: 2 },
  name: { fontSize: 15, fontWeight: "700" },
  label: { fontSize: 13, lineHeight: 18 },
  btn: {
    minHeight: 44,
    minWidth: 76,
    paddingHorizontal: 14,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 14, fontWeight: "700" },
  trash: { padding: 14, gap: 2 },
});
