// The home (docs/design/home-first.md §2): pages of cards, the chat bar under them. This first
// slice has two pages (Now, My day), cards drawn from pinned views, ticks that work offline,
// and the chat one tap away.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/Card";
import { loadHome, rememberHome, tick, type HomePage } from "@/home";
import { useSession } from "@/session";
import { radius, useTheme } from "@/theme";
import { isOffline } from "@/api";

const logoLight = require("../assets/logo-light.png");
const logoDark = require("../assets/logo-dark.png");

export default function Home() {
  const { me, loaded } = useSession();
  const { t, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [pages, setPages] = useState<HomePage[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const list = useRef<FlatList<HomePage>>(null);

  const load = useCallback(async () => {
    try {
      setPages(await loadHome());
      setError("");
    } catch (e) {
      setError(
        isOffline(e)
          ? "Offline, and nothing saved on this device yet."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }, []);
  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (loaded && !me) return <Redirect href="/login" />;

  const onTick =
    (pageIndex: number, cardId: string) => (record: Parameters<typeof tick>[1], value: boolean) => {
      setPages((prev) => {
        if (!prev) return prev;
        const next = prev.map((p, i) =>
          i !== pageIndex
            ? p
            : {
                ...p,
                cards: p.cards.map((c) =>
                  c.id !== cardId
                    ? c
                    : { ...c, records: c.records.map((r) => (r.id === record.id ? tick(c, r, value) : r)) },
                ),
              },
        );
        rememberHome(next);
        return next;
      });
    };

  const pageWidth = width;
  return (
    <View style={[s.root, { backgroundColor: t.canvas }]}>
      <FlatList
        ref={list}
        data={pages ?? []}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(p) => p.name}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / pageWidth))}
        renderItem={({ item, index }) => (
          <View style={{ width: pageWidth, paddingTop: insets.top + 12, paddingHorizontal: 16, gap: 10 }}>
            <View style={s.pageHead}>
              <Text style={[s.h2, { color: t.fg }]}>{item.name}</Text>
              {item.auto ? (
                <View style={s.meta}>
                  <View style={[s.pulse, { backgroundColor: t.accent }]} />
                  <Text style={[s.metaText, { color: t.fg2 }]}>arranged for you</Text>
                </View>
              ) : null}
            </View>
            <FlatList
              data={item.cards}
              keyExtractor={(c) => c.id}
              numColumns={2}
              columnWrapperStyle={{ gap: 10 }}
              contentContainerStyle={{ gap: 10, paddingBottom: insets.bottom + 150 }}
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
              renderItem={({ item: card }) => (
                <View
                  style={{ flex: card.spec.size === "s" ? 1 : 2, height: card.spec.size === "l" ? 322 : 156 }}
                >
                  <Card
                    card={card}
                    onTick={onTick(index, card.id)}
                    onOpen={() => router.push({ pathname: "/chat", params: { card: card.spec.title } })}
                  />
                </View>
              )}
              ListEmptyComponent={
                <View style={[s.empty, { backgroundColor: t.cell, borderColor: t.hair }]}>
                  <Text style={[s.sub, { color: t.fg2 }]}>
                    {error || (pages ? "Nothing here yet. Ask the chat to pin something." : "Loading…")}
                  </Text>
                </View>
              }
            />
          </View>
        )}
      />

      <View style={[s.bottom, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
        <View style={s.dots}>
          {(pages ?? []).map((p, i) => (
            <View
              key={p.name}
              style={[s.dotI, { backgroundColor: i === page ? t.accent : t.fg3, width: i === page ? 18 : 7 }]}
            />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask Gigspree"
          onPress={() => router.push("/chat")}
          style={({ pressed }) => [
            s.bar,
            { backgroundColor: t.glass, borderColor: t.hair, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Image
            source={dark ? logoDark : logoLight}
            style={{ width: 28, height: 28 }}
            accessibilityIgnoresInvertColors
          />
          <Text style={[s.barText, { color: t.fg2 }]}>Ask, add or arrange…</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  pageHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  h2: { fontSize: 26, fontWeight: "800", letterSpacing: -1 },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontWeight: "600" },
  pulse: { width: 8, height: 8, borderRadius: 4 },
  empty: {
    borderRadius: radius.card,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    width: Dimensions.get("window").width - 32,
  },
  sub: { fontSize: 14, textAlign: "center" },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 21,
  },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dotI: { height: 7, borderRadius: 4 },
  bar: {
    alignSelf: "stretch",
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  barText: { fontSize: 15, fontWeight: "600" },
});
