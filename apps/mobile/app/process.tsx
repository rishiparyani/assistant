// A process on the phone (home-first.md §2 point 9; backlog step 4 "process detail"): the
// workflow in plain words, what it's waiting on right now (answer or nudge from here), and its
// last runs in plain words. Read fresh from the server; the card on the home stays the quick way.
// online-only: a process's state lives in its space's object.
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { WaitingItem, WorkflowDetail } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { answerWaiting, nudgeWaiting } from "@/home";
import { radius, useTheme } from "@/theme";

export default function Process() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, waiting: given } = useLocalSearchParams<{ id?: string; waiting?: string }>();
  // The step waiting on me (from the card), shown even when the process itself is someone
  // else's (their space answers 404 to me).
  const mine = parseWaiting(given);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setDetail(await request<WorkflowDetail>("GET", `/api/workflows/${encodeURIComponent(id)}`));
      setNote("");
    } catch (e) {
      setNote(
        isOffline(e)
          ? "This needs a connection."
          : mine
            ? "" // someone else's process: the question below is all I can see
            : e instanceof Error
              ? e.message
              : String(e),
      );
    }
  }, [id, mine]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = (key: string, go: () => Promise<unknown>) => async () => {
    setBusy(key);
    try {
      await go();
      await load();
      // The run goes on from the space's alarm a moment later: read once more.
      setTimeout(() => void load(), 1500);
    } catch (e) {
      setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const waiting: WaitingItem[] = detail?.waiting ?? (mine ? [mine] : []);
  const title = detail?.workflow.name ?? mine?.workflow ?? "Process";
  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
          {title}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 14 }}>
        {detail ? (
          <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
            <Text style={[s.label, { color: t.fg2 }]}>
              {detail.workflow.enabled ? "On" : "Off"} · ran {detail.workflow.runs} time
              {detail.workflow.runs === 1 ? "" : "s"}
            </Text>
            {detail.workflow.words.map((w, i) => (
              <Text key={i} style={[s.line, { color: t.fg }]}>
                {i + 1}. {w}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={[s.h2, { color: t.fg }]}>Waiting on</Text>
        {waiting.length ? (
          waiting.map((w) => {
            const open = w.on.filter((p) => p.answer === null);
            const askedMe = !!w.share_id && w.mine === null;
            return (
              <View key={w.id} style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
                <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>{w.record}</Text>
                <Text style={[s.line, { color: t.fg }]}>{w.text}</Text>
                {w.on.map((p) => (
                  <Text key={p.user_id} style={[s.label, { color: t.fg2 }]}>
                    {p.name}: {p.answer ?? "no answer yet"}
                  </Text>
                ))}
                <Text style={[s.label, { color: t.fg3 }]}>
                  Asked{" "}
                  {new Date(w.asked_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  {w.nudges ? ` · nudged ${w.nudges} time${w.nudges === 1 ? "" : "s"}` : ""}
                </Text>
                {askedMe && w.choices ? (
                  <View style={s.row}>
                    {w.choices.map((c) => (
                      <Pressable
                        key={c}
                        accessibilityRole="button"
                        accessibilityLabel={`Answer ${c}`}
                        disabled={busy !== null}
                        onPress={act(`answer:${w.id}`, () => answerWaiting(w, c))}
                        style={[s.btn, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
                      >
                        <Text style={[s.btnText, { color: t.onAccent }]}>{c}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : askedMe ? (
                  <Text style={[s.label, { color: t.accent }]}>Answer in the chat</Text>
                ) : open.length && !w.share_id ? (
                  <View style={s.row}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Nudge"
                      disabled={busy !== null}
                      onPress={act(`nudge:${w.id}`, () => nudgeWaiting(w))}
                      style={[s.btn, { backgroundColor: t.fill, opacity: busy ? 0.6 : 1 }]}
                    >
                      <Text style={[s.btnText, { color: t.accent }]}>
                        {w.nudges ? `Nudge again (${w.nudges})` : "Nudge"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })
        ) : (
          <Text style={[s.label, { color: t.fg2 }]}>
            {detail ? "Nothing right now." : note || "Loading…"}
          </Text>
        )}

        {detail?.history.length ? (
          <>
            <Text style={[s.h2, { color: t.fg }]}>What happened</Text>
            <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
              {detail.history.map((r) => (
                <View key={r.id} style={{ gap: 2 }}>
                  <Text style={[s.line, { color: r.ok ? t.fg : t.danger }]}>
                    {r.record ? `${r.record}: ` : ""}
                    {r.detail}
                  </Text>
                  <Text style={[s.label, { color: t.fg3 }]}>
                    {new Date(r.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
        {note && (detail || waiting.length) ? (
          <Text style={[s.label, { color: t.danger }]}>{note}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function parseWaiting(s: string | undefined): WaitingItem | null {
  if (!s) return null;
  try {
    const w = JSON.parse(s) as WaitingItem;
    return w && typeof w.id === "string" && Array.isArray(w.on) ? w : null;
  } catch {
    return null;
  }
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    gap: 12,
  },
  title: { flex: 1, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  h2: { fontSize: 15, fontWeight: "700", marginTop: 4 },
  card: { padding: 14, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  line: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  btn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 15, fontWeight: "700" },
});
