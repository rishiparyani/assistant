// The library (decision 2026-10-16 "A home you arrange"): every card the person could have,
// like a phone's app library. Each says whether it's on the home (which page) and adds or
// removes it there; a list's card opens the whole list. Lists and views are where the data
// lives; this only changes what the home shows.
// online-only: the library reads every space, share and question; it needs a connection.
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Tap, Text } from "@assistant/cards/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isOffline } from "@/api";
import { arrange, homeChanged, loadCatalog, saveLayout, type CatalogEntry } from "@/home";
import { Mark } from "@/components/Mark";
import { colourFor, radius, useTheme } from "@/theme";

const PER_PAGE = 12;
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
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [layout, setLayout] = useState<{ pages: string[][]; seen: string[] } | null>(null);
  const [emptySpaces, setEmptySpaces] = useState<{ id: string; name: string }[]>([]);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const cat = await loadCatalog();
      setEntries(cat.entries);
      setEmptySpaces(cat.emptySpaces);
      setLayout(arrange(cat));
      setNote("");
    } catch (e) {
      setNote(isOffline(e) ? "The library needs a connection." : e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const change = (pages: string[][]) => {
    if (!layout) return;
    const next = { pages: pages.filter((p) => p.length), seen: layout.seen };
    setLayout(next);
    saveLayout(next);
    homeChanged();
  };
  const add = (key: string) => {
    if (!layout) return;
    const pages = layout.pages.map((p) => [...p]);
    const last = pages[pages.length - 1];
    if (last && last.length < PER_PAGE) last.push(key);
    else pages.push([key]);
    change(pages);
  };
  const remove = (key: string) => layout && change(layout.pages.map((p) => p.filter((k) => k !== key)));
  const pageOf = (key: string) => (layout ? layout.pages.findIndex((p) => p.includes(key)) : -1);

  const groups = new Map<string, CatalogEntry[]>();
  for (const e of entries ?? []) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.title, { color: t.fg }]}>Library</Text>
          <Text style={[s.label, { color: t.fg2 }]}>Every card. Add one to your home, or take it off.</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 18 }}>
        {!entries ? (
          <Text style={[s.label, { color: note ? t.danger : t.fg2 }]}>{note || "Loading…"}</Text>
        ) : (
          [...groups.entries()].map(([group, list]) => (
            <View key={group} style={{ gap: 8 }}>
              <Text style={[s.h2, { color: t.fg }]}>{group}</Text>
              <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
                {list.map((e, i) => {
                  const at = pageOf(e.key);
                  const opens = e.collection ? e.collection.id : null;
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
                        accessibilityRole={opens ? "link" : "text"}
                        disabled={!opens}
                        onPress={() =>
                          opens &&
                          router.push({
                            pathname: "/list",
                            params: {
                              collection: opens,
                              ...(e.view ? { view: e.view.id } : {}),
                              ...(e.space ? { space: e.space } : {}),
                            },
                          })
                        }
                        style={s.words}
                      >
                        <Text style={[s.name, { color: t.fg }]} numberOfLines={2}>
                          {e.title}
                        </Text>
                        <Text style={[s.label, { color: t.fg2 }]} numberOfLines={1}>
                          {at >= 0 ? `On page ${at + 1}` : KIND[e.kind]}
                        </Text>
                      </Pressable>
                      {at >= 0 ? (
                        <Tap
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${e.title} from home`}
                          onPress={() => remove(e.key)}
                          style={[s.btn, { backgroundColor: t.fill }]}
                        >
                          <Text style={[s.btnText, { color: t.fg }]}>Remove</Text>
                        </Tap>
                      ) : (
                        <Tap
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${e.title} to home`}
                          onPress={() => add(e.key)}
                          style={[s.btn, { backgroundColor: t.accent }]}
                        >
                          <Text style={[s.btnText, { color: t.onAccent }]}>Add</Text>
                        </Tap>
                      )}
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
                    onPress={() =>
                      router.push({
                        pathname: "/chat",
                        params: { space: sp.id, ask: "Set up the lists for this space" },
                      })
                    }
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
