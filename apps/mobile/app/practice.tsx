// A practice copy of a space (decision 2026-10-16 "Rehearse a workflow", second part): its
// workflows run for real, but what they'd tell or ask people lands here instead of reaching
// anyone. Questions waiting on someone are answered from here, as that person. Ending it
// erases the copy; the real space is never touched.
// online-only: a practice copy lives in its space's object.
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@assistant/cards/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PracticeView } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { useLive } from "@/live-socket";
import { homeChanged } from "@/home";
import { radius, useTheme } from "@/theme";

const enc = encodeURIComponent;

export default function Practice() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { space } = useLocalSearchParams<{ space?: string }>();
  const [view, setView] = useState<PracticeView | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Whose messages to show: everyone, or one person (what they'd have got).
  const [who, setWho] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const load = useCallback(async () => {
    if (!space) return;
    try {
      setView(await request<PracticeView>("GET", `/api/spaces/${enc(space)}/practice`));
      setNote("");
    } catch (e) {
      setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
    }
  }, [space]);
  useEffect(() => {
    void load();
    // Workflows run a moment after a change; without the live connection, read again now and then.
    const every = setInterval(() => void load(), 4000);
    return () => clearInterval(every);
  }, [load]);
  // The workflows run a moment after a change: read again when the space says it changed.
  useLive((m) => {
    if (m.type === "space_changed" || m.type === "reconnected") void load();
  });

  const answer = async (waitId: string, asUserId: string, a: string) => {
    if (!space) return;
    setBusy(`${waitId}:${asUserId}`);
    try {
      setView(
        await request<PracticeView>("POST", `/api/spaces/${enc(space)}/practice/answer`, {
          wait_id: waitId,
          as_user_id: asUserId,
          answer: a,
        }),
      );
      // The run goes on a moment later; read again then.
      setTimeout(() => void load(), 1500);
    } catch (e) {
      setNote(isOffline(e) ? "Answering needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const end = async () => {
    if (!space) return;
    if (!ending) return setEnding(true);
    setBusy("end");
    try {
      await request("DELETE", `/api/spaces/${enc(space)}/practice`);
      homeChanged();
      router.back();
    } catch (e) {
      setNote(isOffline(e) ? "Ending needs a connection." : e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const people = view ? [...new Map(view.log.map((l) => [l.user_id, l.name])).entries()] : [];
  const log = view ? view.log.filter((l) => !who || l.user_id === who) : [];
  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
          {view?.name ?? "Practice"}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 14 }}>
        <View style={[s.card, { backgroundColor: t.accentSoft, borderColor: t.hair }]}>
          <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>Nothing here reaches anyone</Text>
          <Text style={[s.label, { color: t.fg2 }]}>
            This is a copy. Add records or change them in its page and the workflows run for real, but what
            they would tell or ask people shows below instead. Answer for them to see what happens next.
          </Text>
        </View>

        <Text style={[s.h2, { color: t.fg }]}>Waiting on</Text>
        {view?.waiting.length ? (
          view.waiting.map((w) => (
            <View key={w.id} style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
              <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>{w.record}</Text>
              <Text style={[s.line, { color: t.fg }]}>{w.text}</Text>
              {w.on.map((p) =>
                p.answer !== null ? (
                  <Text key={p.user_id} style={[s.label, { color: t.fg2 }]}>
                    {p.name}: {p.answer}
                  </Text>
                ) : (
                  <View key={p.user_id} style={{ gap: 6 }}>
                    <Text style={[s.label, { color: t.fg2 }]}>Answer as {p.name}:</Text>
                    <View style={s.row}>
                      {(w.choices ?? ["Done"]).map((c) => (
                        <Pressable
                          key={c}
                          accessibilityRole="button"
                          accessibilityLabel={`Answer ${c} as ${p.name}`}
                          disabled={busy !== null}
                          onPress={() => void answer(w.id, p.user_id, c)}
                          style={[s.btn, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
                        >
                          <Text style={[s.btnText, { color: t.onAccent }]}>{c}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ),
              )}
            </View>
          ))
        ) : (
          <Text style={[s.label, { color: t.fg2 }]}>{view ? "Nothing right now." : note || "Loading…"}</Text>
        )}

        <Text style={[s.h2, { color: t.fg }]}>What people would have got</Text>
        {people.length > 1 ? (
          <View style={s.row}>
            {[[null, "Everyone"] as const, ...people].map(([id, name]) => (
              <Pressable
                key={id ?? "all"}
                accessibilityRole="button"
                accessibilityState={{ selected: who === id }}
                onPress={() => setWho(id)}
                style={[s.chip, { backgroundColor: who === id ? t.ink : t.fill }]}
              >
                <Text style={[s.chipText, { color: who === id ? t.onInk : t.fg }]}>{name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {log.length ? (
          <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
            {log.map((l) => (
              <View key={l.id} style={{ gap: 2 }}>
                <Text style={[s.line, { color: t.fg }]}>
                  <Text style={{ fontWeight: "700" }}>{l.name}</Text>
                  {l.kind === "question" ? " would be asked: " : " would be told: "}
                  {l.body ?? l.title}
                </Text>
                <Text style={[s.label, { color: t.fg3 }]}>
                  {l.title} ·{" "}
                  {new Date(l.at).toLocaleString("en-IN", { timeStyle: "short", dateStyle: "medium" })}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[s.label, { color: t.fg2 }]}>
            {view ? "Nothing yet. Add a record in this copy's page to start a workflow." : ""}
          </Text>
        )}

        {view ? (
          <View style={s.row}>
            <Pressable
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={() => void end()}
              style={[s.btn, { backgroundColor: ending ? t.danger : t.fill, opacity: busy ? 0.6 : 1 }]}
            >
              <Text style={[s.btnText, { color: ending ? t.onAccent : t.danger }]}>
                {ending ? "Tap again to erase this copy" : "End practice"}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {note && view ? <Text style={[s.label, { color: t.danger }]}>{note}</Text> : null}
      </ScrollView>
    </View>
  );
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
  card: { padding: 14, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  line: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 15, fontWeight: "700" },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "600" },
});
