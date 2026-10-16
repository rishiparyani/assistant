// A rehearsal (decisions 2026-10-16 "Rehearse a workflow" and "Rehearse as each person"): a
// practice copy of a space whose workflows run for real, played person by person. "You" sets
// things off in the copy's lists; switching to someone shows their app as it would be (only
// what's shared with them, their questions, what they've been told) and acts as them, checked
// as theirs. Nothing reaches anyone; ending it erases the copy, the real space is never touched.
// online-only: a rehearsal lives in its practice copy's object.
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Boundary, Card, Text, cardHeight } from "@assistant/cards/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  CollectionView,
  PracticeAsView,
  PracticePerson,
  PracticeView,
  RecordView,
  SharedOpened,
  WorkflowDetail,
  StoredValue,
} from "@assistant/shared";
import { isOffline, request } from "@/api";
import { useLive } from "@/live-socket";
import { homeChanged, sharedCard, type HomeCard } from "@/home";
import { useSession } from "@/session";
import { colourFor, radius, useTheme } from "@/theme";

const enc = encodeURIComponent;
const ME = "";

export default function Practice() {
  const { t, colour } = useTheme();
  const myId = useSession().me?.user.id ?? null;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // The workflow being rehearsed (from its screen): its steps and a Start button lead the way.
  const { space, workflow } = useLocalSearchParams<{ space?: string; workflow?: string }>();
  const [flow, setFlow] = useState<WorkflowDetail | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [view, setView] = useState<PracticeView | null>(null);
  const [lists, setLists] = useState<CollectionView[]>([]);
  // Who is being played: "" is you (the one practising), otherwise a person's id.
  const [who, setWho] = useState(ME);
  const [as, setAs] = useState<{ view: PracticeAsView; cards: HomeCard[] } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const base = space ? `/api/spaces/${enc(space)}/practice` : "";

  const load = useCallback(async () => {
    if (!space) return;
    try {
      const [v, cols] = await Promise.all([
        request<PracticeView>("GET", base),
        request<CollectionView[]>("GET", `/api/collections?space=${enc(space)}`),
      ]);
      setView(v);
      setLists(cols);
      if (workflow)
        setFlow(
          await request<WorkflowDetail>("GET", `/api/workflows/${enc(workflow)}?space=${enc(space)}`).catch(
            () => null,
          ),
        );
      if (who) {
        const pv = await request<PracticeAsView>("GET", `${base}/as/${enc(who)}`);
        // Each card opened through their share, so it shows what they may see and nothing more.
        const opened = await Promise.all(
          pv.cards.map((c) =>
            request<SharedOpened>("GET", `${base}/as/${enc(who)}/cards/${enc(c.share_id)}`)
              .then((o) => sharedCard(c, o, []))
              .catch(() => null),
          ),
        );
        setAs({ view: pv, cards: opened.filter((c): c is HomeCard => !!c) });
      } else setAs(null);
      setNote("");
    } catch (e) {
      setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
    }
  }, [space, base, who, workflow]);
  useEffect(() => {
    void load();
    // Workflows run a moment after a change; without the live connection, read again now and then.
    const every = setInterval(() => void load(), 4000);
    return () => clearInterval(every);
  }, [load]);
  useLive((m) => {
    if (m.type === "space_changed" || m.type === "reconnected") void load();
  });

  /** Does something as the person being played; the workflows go on a moment later. */
  const act = async (key: string, go: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await go();
      await load();
      setTimeout(() => void load(), 1500);
    } catch (e) {
      setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  // Starts the workflow as it would start for real: a sample record, or a run now.
  const start = () =>
    flow &&
    void act("start", async () => {
      const r = await request<{ record: { id: string; title: string } | null }>("POST", `${base}/run`, {
        workflow_id: flow.workflow.id,
      });
      setStarted(r.record ? r.record.title : flow.workflow.name);
    });
  const when = flow?.workflow.when;
  const startLabel = !when
    ? ""
    : when.event === "added"
      ? `Start: add a sample to ${when.collection}`
      : when.event === "schedule"
        ? "Start: run it now"
        : `Start: run it on the newest in ${when.collection}`;
  const setAsThem = (card: HomeCard, record: RecordView, field: string, value: StoredValue) =>
    card.shared &&
    void act(card.id, () =>
      request(
        "PATCH",
        `${base}/as/${enc(who)}/cards/${enc(card.shared!.share_id)}/records/${enc(record.id)}`,
        {
          values: { [field]: value },
        },
      ),
    );

  const end = async () => {
    if (!space) return;
    if (!ending) return setEnding(true);
    setBusy("end");
    try {
      await request("DELETE", base);
      homeChanged();
      router.back();
    } catch (e) {
      setNote(isOffline(e) ? "Ending needs a connection." : e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const people = view?.people ?? [];
  const person = people.find((p) => p.user_id === who) ?? null;
  // Questions waiting on you (the one practising), answered right here.
  const mine = (view?.waiting ?? []).filter((w) => w.on.some((o) => o.user_id === myId && o.answer === null));
  // Whose turn it is next among the others (yours show as questions in your own view).
  const turn = people.find((p) => p.waiting > 0) ?? null;
  const waitingOn = (p: PracticePerson) =>
    view?.waiting.find((w) => w.on.some((o) => o.user_id === p.user_id && o.answer === null)) ?? null;

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
            Practice run
          </Text>
          <Text style={[s.label, { color: t.fg2 }]} numberOfLines={1}>
            {view ? `${view.name} · nothing here reaches anyone` : note || "Loading…"}
          </Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>

      {/* Who you're playing: you, then everyone the space works with. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.rolesBar}
        contentContainerStyle={s.roles}
      >
        {[{ user_id: ME, name: "You", waiting: 0 } as const, ...people].map((p) => {
          const on = who === p.user_id;
          return (
            <Pressable
              key={p.user_id || "me"}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.waiting ? `${p.name}, ${p.waiting} waiting` : p.name}
              onPress={() => {
                setAs(null);
                setWho(p.user_id);
              }}
              style={[s.role, { backgroundColor: on ? t.ink : t.fill }]}
            >
              <Text style={[s.roleText, { color: on ? t.onInk : t.fg }]}>{p.name}</Text>
              {p.waiting ? (
                <View style={[s.badge, { backgroundColor: t.accent }]}>
                  <Text style={[s.badgeText, { color: t.onAccent }]}>{p.waiting}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 14 }}>
        {/* What happens next, and a way to get there. */}
        {view ? (
          turn && turn.user_id !== who ? (
            <View style={[s.card, { backgroundColor: t.accentSoft, borderColor: t.hair }]}>
              <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>{turn.name}'s turn</Text>
              {waitingOn(turn) ? (
                <Text style={[s.label, { color: t.fg2 }]}>
                  {waitingOn(turn)!.workflow} is waiting on {turn.name}: “{waitingOn(turn)!.text}”
                </Text>
              ) : null}
              <View style={s.row}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setAs(null);
                    setWho(turn.user_id);
                  }}
                  style={[s.btn, { backgroundColor: t.accent }]}
                >
                  <Text style={[s.btnText, { color: t.onAccent }]}>See {turn.name}'s app ›</Text>
                </Pressable>
              </View>
            </View>
          ) : mine.length && who ? (
            <View style={[s.card, { backgroundColor: t.accentSoft, borderColor: t.hair }]}>
              <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>Your turn</Text>
              <Text style={[s.label, { color: t.fg2 }]}>“{mine[0]!.text}” is waiting on you.</Text>
              <View style={s.row}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setWho(ME)}
                  style={[s.btn, { backgroundColor: t.accent }]}
                >
                  <Text style={[s.btnText, { color: t.onAccent }]}>Back to You ›</Text>
                </Pressable>
              </View>
            </View>
          ) : !turn && !mine.length && flow && !who ? (
            // The workflow being rehearsed, step by step, and how to start it.
            <View style={[s.card, { backgroundColor: t.accentSoft, borderColor: t.hair }]}>
              <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>
                Rehearsing {flow.workflow.name}
              </Text>
              {flow.workflow.words.map((w, i) => (
                <Text key={i} style={[s.label, { color: t.fg }]}>
                  {i + 1}. {w}
                </Text>
              ))}
              <Text style={[s.label, { color: t.fg2 }]}>
                {started
                  ? `Started with “${started}”. See what happened below, or start again.`
                  : "Tap Start to set it off with made-up details. You play whoever adds it; then a card shows whose turn it is, and you switch to them to see their app and answer."}
              </Text>
              <View style={s.row}>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null}
                  onPress={start}
                  style={[s.btn, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
                >
                  <Text style={[s.btnText, { color: t.onAccent }]}>
                    {busy === "start" ? "Starting…" : started ? "Start again" : startLabel}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : !turn && !mine.length ? (
            <View style={[s.card, { backgroundColor: t.accentSoft, borderColor: t.hair }]}>
              <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>
                {who ? `Nothing is waiting on ${person?.name ?? "them"}` : "Your move"}
              </Text>
              <Text style={[s.label, { color: t.fg2 }]}>
                {who
                  ? "Switch back to You and add or change a record to set a workflow off."
                  : "Add or change a record in one of the lists below: the workflows take it from there, and you'll see whose turn it is next."}
              </Text>
              {who ? (
                <View style={s.row}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setWho(ME)}
                    style={[s.btn, { backgroundColor: t.fill }]}
                  >
                    <Text style={[s.btnText, { color: t.fg }]}>Back to You</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null
        ) : null}

        {who && person ? (
          // Their app, as it would be: only what's shared with them, acting as them.
          <View style={[s.phone, { borderColor: t.hair, backgroundColor: t.cell }]}>
            <View style={{ gap: 2 }}>
              <Text style={[s.h2, { color: t.fg, marginTop: 0 }]}>{person.name}'s app</Text>
              <Text style={[s.label, { color: t.fg2 }]}>
                {person.role === "member"
                  ? `${person.name} is in this space, so they see all its lists, as you do. Below: what they've been asked and told.`
                  : person.role === "standin"
                    ? `Made up for this practice run: nobody fills this role yet. In real use, the person in that field gets exactly this.`
                    : `Only what's shared with ${person.name}, with the fields they may see. Everything else here stays hidden from them.`}
              </Text>
            </View>
            {as ? (
              <>
                {as.cards.length ? (
                  as.cards.map((card) => (
                    <Boundary key={card.id} where="practice card">
                      <View style={{ height: cardHeight(card) }}>
                        <Card
                          card={card}
                          busy={busy === card.id}
                          onAnswer={
                            card.waiting && card.shared
                              ? (a) =>
                                  void act(card.id, () =>
                                    request(
                                      "POST",
                                      `${base}/as/${enc(who)}/cards/${enc(card.shared!.share_id)}/answer`,
                                      { answer: a },
                                    ),
                                  )
                              : undefined
                          }
                          onTick={(record, value) => {
                            const field = card.spec.sources[0]?.answer_field;
                            if (field) setAsThem(card, record, field, value);
                          }}
                          onSet={(record, field, value) => setAsThem(card, record, field, value)}
                        />
                      </View>
                    </Boundary>
                  ))
                ) : (
                  <Text style={[s.label, { color: t.fg2 }]}>Nothing is shared with {person.name} now.</Text>
                )}
                <Text style={[s.h3, { color: t.fg }]}>Their notifications</Text>
                {as.view.got.length ? (
                  as.view.got.map((g) => (
                    <View key={g.id} style={[s.notif, { backgroundColor: t.fill }]}>
                      <Text style={[s.label, { color: t.fg, fontWeight: "700" }]}>{g.title}</Text>
                      <Text style={[s.line, { color: t.fg }]}>{g.body ?? ""}</Text>
                      <Text style={[s.label, { color: t.fg3 }]}>
                        {new Date(g.at).toLocaleString("en-IN", { timeStyle: "short", dateStyle: "medium" })}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={[s.label, { color: t.fg2 }]}>None yet.</Text>
                )}
              </>
            ) : (
              <Text style={[s.label, { color: t.fg2 }]}>Loading…</Text>
            )}
          </View>
        ) : view ? (
          <>
            {mine.map((w) => (
              <View key={w.id} style={[s.card, { backgroundColor: t.accentSoft, borderColor: t.hair }]}>
                <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>Your turn: {w.workflow}</Text>
                <Text style={[s.line, { color: t.fg }]}>{w.text}</Text>
                <View style={s.row}>
                  {(w.choices ?? ["Done"]).map((c) => (
                    <Pressable
                      key={c}
                      accessibilityRole="button"
                      accessibilityLabel={`Answer ${c}`}
                      disabled={busy !== null}
                      onPress={() =>
                        void act(w.id, () =>
                          request("POST", `${base}/answer`, { wait_id: w.id, as_user_id: myId, answer: c }),
                        )
                      }
                      style={[s.btn, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
                    >
                      <Text style={[s.btnText, { color: t.onAccent }]}>{c}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            <Text style={[s.h2, { color: t.fg }]}>What happened</Text>
            {view.log.length ? (
              <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
                {view.log.map((l) => (
                  <View key={l.id} style={{ gap: 2 }}>
                    <Text style={[s.line, { color: t.fg }]}>
                      <Text style={{ fontWeight: "700" }}>{l.user_id === myId ? "You" : l.name}</Text>
                      {l.kind === "question"
                        ? l.user_id === myId
                          ? " were asked: "
                          : " was asked: "
                        : l.user_id === myId
                          ? " were told: "
                          : " was told: "}
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
              <Text style={[s.label, { color: t.fg2 }]}>Nothing yet.</Text>
            )}
            <Text style={[s.h2, { color: t.fg }]}>The lists in this copy</Text>
            <View style={s.row}>
              {lists.map((c) => {
                const tint = colour(colourFor(c.name));
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="link"
                    onPress={() =>
                      router.push({ pathname: "/list", params: { collection: c.id, space: space! } })
                    }
                    style={[s.list, { backgroundColor: t.cell, borderColor: tint }]}
                  >
                    <Text style={[s.line, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={[s.label, { color: tint }]}>Open ›</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {view ? (
          <View style={s.row}>
            <Pressable
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={() => void end()}
              style={[s.btn, { backgroundColor: ending ? t.danger : t.fill, opacity: busy ? 0.6 : 1 }]}
            >
              <Text style={[s.btnText, { color: ending ? t.onAccent : t.danger }]}>
                {ending ? "Tap again to erase this practice run" : "End practice run"}
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
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  h2: { fontSize: 15, fontWeight: "700", marginTop: 4 },
  h3: { fontSize: 14, fontWeight: "700", marginTop: 4 },
  rolesBar: { flexGrow: 0, flexShrink: 0 },
  roles: { gap: 8, paddingVertical: 10 },
  role: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roleText: { fontSize: 15, fontWeight: "700" },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 12, fontWeight: "800", paddingHorizontal: 5 },
  card: { padding: 14, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  phone: { padding: 14, borderRadius: 28, borderWidth: 1, gap: 12 },
  notif: { padding: 12, borderRadius: 14, gap: 2 },
  list: {
    minHeight: 64,
    minWidth: 140,
    flexGrow: 1,
    padding: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: 4,
  },
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
});
