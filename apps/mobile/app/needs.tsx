// Needs you (docs/design/chats-home.md, "What the owner chose" 4): every question, approval and
// form waiting on me, each with its buttons. The bar at the top of Chats opens it,
// so the chats are never pushed down however many there are. Reads what Today keeps on the
// device first (offline-first rule 17).
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Boundary, Card, Text, type } from "@assistant/cards/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_URL } from "@/config";
import { isOffline } from "@/api";
import { answerWaiting, nudgeWaiting, onHomeChanged, type HomeCard } from "@/home";
import { loadToday, savedToday, type Today } from "@/today";
import { useLive } from "@/live-socket";
import { useSession } from "@/session";
import { useTheme } from "@/theme";

export default function Needs() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { me } = useSession();
  const userId = me?.user.id ?? null;
  const [today, setToday] = useState<Today | null>(() => (userId ? savedToday(userId) : null));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setToday(await loadToday(userId));
      setError("");
    } catch (e) {
      if (!isOffline(e)) setError(e instanceof Error ? e.message : String(e));
    }
  }, [userId]);
  useEffect(() => void load(), [load]);
  useEffect(() => onHomeChanged(() => void load()), [load]);
  useLive((m) => {
    if (m.type === "space_changed" || m.type === "reconnected") void load();
  });

  // online-only: the website's shared pages (a form to fill in) open in the browser.
  const openOnWeb = (card: HomeCard) =>
    card.shared && void Linking.openURL(`${API_URL}/shared/${encodeURIComponent(card.shared.share_id)}`);
  // online-only: answering a step runs it on the server, which moves the workflow on.
  const act = (card: HomeCard, go: () => Promise<unknown>) => async () => {
    setBusy(card.id);
    try {
      await go();
      await load();
      setTimeout(() => void load(), 1500);
    } catch (e) {
      setError(isOffline(e) ? "Answering needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Steps waiting on me first, then the rest, then questions and forms shared with me.
  const needs = today?.needs ?? [];

  return (
    <View style={[s.root, { backgroundColor: t.canvas, paddingTop: insets.top }]}>
      <View style={s.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={[s.round, { backgroundColor: t.cell, shadowColor: t.shadow }]}
        >
          <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { color: t.fg }]}>Needs you</Text>
          <Text style={[type.caption, { color: t.fg2 }]}>
            {today === null ? " " : needs.length ? `${needs.length} waiting` : "All done"}
          </Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 40 }]}
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
        {error ? <Text style={[type.small, { color: t.danger }]}>{error}</Text> : null}
        {today !== null && !needs.length ? (
          <View style={[s.done, { backgroundColor: t.cell }]}>
            <Text style={[type.heading, { color: t.fg }]}>You're all caught up.</Text>
            <Text style={[type.small, { color: t.fg2 }]}>
              New questions and approvals show up here and on the bar at the top of Chats.
            </Text>
          </View>
        ) : null}
        {needs.map((card) => (
          <Boundary key={card.id} where="needs you">
            <Card
              card={card}
              natural
              onOpen={() =>
                card.waiting
                  ? router.push({
                      pathname: "/process",
                      params: { id: card.waiting.workflow_id, waiting: JSON.stringify(card.waiting) },
                    })
                  : card.shared?.kind === "form"
                    ? openOnWeb(card)
                    : undefined
              }
              onAnswer={
                card.waiting
                  ? (answer) => void act(card, () => answerWaiting(card.waiting!, answer))()
                  : undefined
              }
              onNudge={
                card.waiting?.share_id
                  ? undefined
                  : card.waiting
                    ? act(card, () => nudgeWaiting(card.waiting!))
                    : undefined
              }
              busy={busy === card.id}
            />
          </Boundary>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  body: { paddingHorizontal: 16, gap: 12, width: "100%", maxWidth: 760, alignSelf: "center" },
  done: { borderRadius: 22, padding: 18, gap: 6 },
});
