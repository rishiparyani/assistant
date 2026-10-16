// A process on the phone (home-first.md §2 point 9; backlog step 4 "process detail"): the
// workflow in plain words, what it's waiting on right now (answer or nudge from here), and its
// last runs in plain words. Read fresh from the server; the card on the home stays the quick way.
// online-only: a process's state lives in its space's object.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "@assistant/cards/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Rehearsal, RehearsalAnswer, WaitingItem, WorkflowDetail } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { answerWaiting, nudgeWaiting } from "@/home";
import { radius, useTheme } from "@/theme";

export default function Process() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, waiting: given } = useLocalSearchParams<{ id?: string; waiting?: string }>();
  // The step waiting on me (from the card), shown even when the process itself is someone
  // else's (their space answers 404 to me). Parsed once; refreshed from /api/waiting after I act.
  const fromCard = useMemo(() => parseWaiting(given), [given]);
  const [mine, setMine] = useState<WaitingItem | null>(fromCard);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Rehearse (decision 2026-10-16 "Rehearse a workflow"): the run in words, nothing kept or
  // sent; each answer given to a question is kept here and sent again to go further.
  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null);
  const [answers, setAnswers] = useState<RehearsalAnswer[]>([]);
  const [typed, setTyped] = useState("");

  const space = fromCard?.space_id;
  const load = useCallback(async () => {
    if (!id) return;
    const where = space ? `?space=${encodeURIComponent(space)}` : "";
    try {
      setDetail(await request<WorkflowDetail>("GET", `/api/workflows/${encodeURIComponent(id)}${where}`));
      setNote("");
    } catch (e) {
      if (isOffline(e)) return setNote("This needs a connection.");
      if (!fromCard) return setNote(e instanceof Error ? e.message : String(e));
      // Someone else's process: the question waiting on me is all I can see; read it fresh.
      setNote("");
      const all = await request<WaitingItem[]>("GET", "/api/waiting").catch(() => null);
      if (all) setMine(all.find((w) => w.id === fromCard.id) ?? null);
    }
  }, [id, space, fromCard]);
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

  const rehearse = async (given: RehearsalAnswer[]) => {
    if (!id) return;
    setBusy("rehearse");
    try {
      const r = await request<Rehearsal>("POST", `/api/workflows/${encodeURIComponent(id)}/rehearse`, {
        answers: given,
        ...(space ? { space } : {}),
        ...(rehearsal?.record ? { record_id: rehearsal.record.id } : {}),
      });
      setAnswers(given);
      setRehearsal(r);
      setTyped("");
      setNote("");
    } catch (e) {
      setNote(isOffline(e) ? "Rehearsing needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  // A practice copy of the whole space, to try it with people (nothing reaches them).
  const practise = async () => {
    setBusy("practice");
    try {
      const made = await request<{ id: string }>(
        "POST",
        `/api/spaces/${encodeURIComponent(space ?? "Personal")}/practice`,
        {},
      );
      router.push({ pathname: "/practice", params: { space: made.id } });
    } catch (e) {
      setNote(
        isOffline(e) ? "A practice copy needs a connection." : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(null);
    }
  };
  // Each person asked answers in turn (as the real run waits for everyone, or the first).
  const answer = (a: string) => {
    const w = rehearsal?.waiting;
    if (w) void rehearse([...answers, { step: w.step, time: w.time, person: w.next, answer: a }]);
  };

  const waiting: WaitingItem[] = detail?.waiting ?? (mine ? [mine] : []);
  const title = detail?.workflow.name ?? mine?.workflow ?? fromCard?.workflow ?? "Process";
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

        {detail ? (
          <>
            <Text style={[s.h2, { color: t.fg }]}>Rehearse</Text>
            <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
              {rehearsal ? (
                <>
                  <Text style={[s.label, { color: t.fg2 }]}>
                    {rehearsal.record ? `On “${rehearsal.record.title}”` : "As a scheduled run"} · nothing is
                    kept, nobody is told
                  </Text>
                  {rehearsal.lines.map((l, i) => (
                    <Text
                      key={i}
                      style={[s.line, { color: l.startsWith("It would stop") ? t.danger : t.fg }]}
                    >
                      {l}
                    </Text>
                  ))}
                  {rehearsal.waiting ? (
                    <>
                      <Text style={[s.label, { color: t.fg2 }]}>
                        {rehearsal.waiting.people.length > 1
                          ? rehearsal.waiting.until === "first"
                            ? `The first answer goes on. Answer as ${rehearsal.waiting.next}:`
                            : `It goes on once all ${rehearsal.waiting.people.length} have answered. Answer as ${rehearsal.waiting.next}:`
                          : rehearsal.waiting.next === "me"
                            ? "Answer to go on:"
                            : `Answer as ${rehearsal.waiting.next} to go on:`}
                      </Text>
                      {rehearsal.waiting.choices ? (
                        <View style={s.row}>
                          {rehearsal.waiting.choices.map((c) => (
                            <Pressable
                              key={c}
                              accessibilityRole="button"
                              accessibilityLabel={`Answer ${c}`}
                              disabled={busy !== null}
                              onPress={() => answer(c)}
                              style={[s.btn, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
                            >
                              <Text style={[s.btnText, { color: t.onAccent }]}>{c}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : (
                        <View style={s.row}>
                          <TextInput
                            accessibilityLabel="Their answer"
                            placeholder="Their answer"
                            placeholderTextColor={t.fg3}
                            value={typed}
                            onChangeText={setTyped}
                            onSubmitEditing={() => typed.trim() && answer(typed.trim())}
                            style={[s.input, { color: t.fg, backgroundColor: t.fill }]}
                          />
                          <Pressable
                            accessibilityRole="button"
                            disabled={busy !== null || !typed.trim()}
                            onPress={() => answer(typed.trim())}
                            style={[
                              s.btn,
                              { backgroundColor: t.accent, opacity: busy || !typed.trim() ? 0.6 : 1 },
                            ]}
                          >
                            <Text style={[s.btnText, { color: t.onAccent }]}>Go on</Text>
                          </Pressable>
                        </View>
                      )}
                    </>
                  ) : rehearsal.finished ? (
                    <Text style={[s.label, { color: t.fg2 }]}>That's the whole run.</Text>
                  ) : null}
                  <View style={s.row}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy !== null}
                      onPress={() => void rehearse([])}
                      style={[s.btn, { backgroundColor: t.fill, opacity: busy ? 0.6 : 1 }]}
                    >
                      <Text style={[s.btnText, { color: t.accent }]}>Start again</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={[s.label, { color: t.fg2 }]}>
                    Play it through as it will really happen: a copy of this space where the workflows run for
                    real. You set it off, then switch to each person to see their app (only what they may see)
                    and do their part. Nothing reaches anyone.
                  </Text>
                  <View style={s.row}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy !== null}
                      onPress={() => void practise()}
                      style={[s.btn, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
                    >
                      <Text style={[s.btnText, { color: t.onAccent }]}>
                        {busy === "practice" ? "Setting it up…" : "Rehearse with everyone"}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy !== null}
                      onPress={() => void rehearse([])}
                      style={[s.btn, { backgroundColor: t.fill, opacity: busy ? 0.6 : 1 }]}
                    >
                      <Text style={[s.btnText, { color: t.accent }]}>
                        {busy === "rehearse" ? "Running…" : "Quick run in words"}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </>
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
            {detail
              ? "Nothing right now."
              : fromCard && !mine
                ? "Nothing is waiting on you here now."
                : note || "Loading…"}
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
  input: { flex: 1, minWidth: 0, minHeight: 44, borderRadius: 22, paddingHorizontal: 16, fontSize: 16 },
});
