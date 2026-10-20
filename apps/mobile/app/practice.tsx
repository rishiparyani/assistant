// A rehearsal (decisions 2026-10-16 "Rehearse a workflow" and "Rehearse as each person"): a
// practice copy of a space whose workflows run for real, played person by person. "You" sets
// things off in the copy's lists; switching to someone shows their app as it would be (only
// what's shared with them, their questions, what they've been told) and acts as them, checked
// as theirs. Nothing reaches anyone; ending it erases the copy, the real space is never touched.
// online-only: a rehearsal lives in its practice copy's object.
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Boundary, Card, Text } from "@assistant/cards/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type {
  CollectionView,
  PracticeAsView,
  PracticePerson,
  PracticeView,
  SharedOpened,
  WorkflowDetail,
  StoredValue,
} from "@assistant/shared";
import { ulid } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { useLive } from "@/live-socket";
import { homeChanged, sharedCard, type HomeCard } from "@/home";
import { useSession } from "@/session";
import { Sheet } from "@/components/Sheet";
import { SharedPage } from "@/components/SharedPage";
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
  const [as, setAs] = useState<{
    view: PracticeAsView;
    cards: HomeCard[];
    opened: Record<string, SharedOpened>;
  } | null>(null);
  // The card of theirs that's open (its share), and the sheet to switch who's played.
  const [openShare, setOpenShare] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [note, setNote] = useState("");
  // What went wrong with the last thing tapped: kept until the next tap (the screen reads again
  // every few seconds, which cleared it before anyone saw it; owner, 2026-10-19: "it is showing
  // starting, but nothing happens after that").
  const [problem, setProblem] = useState("");
  const [allLists, setAllLists] = useState(false);
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
            request<SharedOpened>("GET", `${base}/as/${enc(who)}/cards/${enc(c.share_id)}`).catch(() => null),
          ),
        );
        const cards: HomeCard[] = [];
        const byShare: Record<string, SharedOpened> = {};
        pv.cards.forEach((c, i) => {
          const o = opened[i];
          if (!o) return;
          byShare[c.share_id] = o;
          const card = sharedCard(c, o, []);
          // A form says what it is here: it opens in the app, as theirs.
          if (card && o.share.kind === "form" && card.shared)
            card.shared = { ...card.shared, fields: [{ name: "A form to fill in", display: "Tap to open" }] };
          if (card) cards.push(card);
        });
        setAs({ view: pv, cards, opened: byShare });
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
    setProblem("");
    try {
      await go();
      await load();
      setTimeout(() => void load(), 1500);
    } catch (e) {
      setProblem(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
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
  // What the person being played does, through their shares (checked as theirs).
  const asThem = `${base}/as/${enc(who)}/cards`;
  const setAsThem = (shareId: string, recordId: string, field: string, value: StoredValue) =>
    request("PATCH", `${asThem}/${enc(shareId)}/records/${enc(recordId)}`, { values: { [field]: value } });
  const addAsThem = (shareId: string, section: string, values: Record<string, unknown>) =>
    request("POST", `${asThem}/${enc(shareId)}/records`, { id: ulid(), section, values });
  const answerAsThem = (shareId: string, answer: string) =>
    request("POST", `${asThem}/${enc(shareId)}/answer`, { answer });
  const play = (id: string) => {
    setAs(null);
    setOpenShare(null);
    setSwitching(false);
    setProblem("");
    setWho(id);
  };

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
  // The lists the flow being rehearsed works with: its own and the ones it links to. The copy
  // holds the whole space (owner, 2026-10-19: "why are these expenses list showing in this
  // rehearse window?"), but only these matter here; the rest are a tap away.
  const used = (() => {
    const own = flow?.workflow.when.collection_id;
    if (!own) return null;
    const ids = new Set([own]);
    for (const f of lists.find((c) => c.id === own)?.fields ?? [])
      if (f.type === "link" && typeof f.options.target === "string") ids.add(f.options.target);
    return ids;
  })();
  // Questions waiting on you (the one practising), answered right here.
  const mine = (view?.waiting ?? []).filter((w) => w.on.some((o) => o.user_id === myId && o.answer === null));
  // Whose turn it is next among the others (yours show as questions in your own view).
  const turn = people.find((p) => p.waiting > 0) ?? null;
  const waitingOn = (p: PracticePerson) =>
    view?.waiting.find((w) => w.on.some((o) => o.user_id === p.user_id && o.answer === null)) ?? null;

  // Their app, the whole screen (owner, 2026-10-20: "use it from one role's perspective exactly
  // as they'll be able to see it"): only what's shared with them, acting as them.
  const theirs = openShare && as ? (as.opened[openShare] ?? null) : null;
  const switcher = (
    <Sheet open={switching} onClose={() => setSwitching(false)} accessibilityLabel="Play as someone else">
      <Text style={[s.h2, { color: t.fg, marginTop: 0 }]}>Play as</Text>
      {[{ user_id: ME, name: "You", waiting: mine.length }, ...people].map((p) => {
        const on = who === p.user_id;
        return (
          <Pressable
            key={p.user_id || "me"}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={p.waiting ? `${p.name}, ${p.waiting} waiting` : p.name}
            onPress={() => play(p.user_id)}
            style={[s.person, { backgroundColor: on ? t.accentSoft : t.cell, borderColor: t.hair }]}
          >
            <Text style={[s.line, { color: t.fg, fontWeight: "700", flex: 1 }]} numberOfLines={1}>
              {p.user_id ? p.name : "You (the one practising)"}
            </Text>
            {p.waiting ? (
              <View style={[s.badge, { backgroundColor: t.accent }]}>
                <Text style={[s.badgeText, { color: t.onAccent }]}>{p.waiting}</Text>
              </View>
            ) : null}
            {on ? <Text style={[s.label, { color: t.fg2 }]}>Now</Text> : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
  if (who && person)
    return (
      <View style={[s.playRoot, { backgroundColor: t.page }]}>
        <View style={[s.bar, { backgroundColor: t.accent, paddingTop: insets.top + 8 }]}>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={[s.barSmall, { color: t.onAccent }]}>PRACTISING AS</Text>
            <Text style={[s.barName, { color: t.onAccent }]} numberOfLines={1}>
              {person.name}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch who you play"
            onPress={() => setSwitching(true)}
            style={[s.barBtn, { borderColor: t.onAccent }]}
          >
            <Text style={[s.btnText, { color: t.onAccent }]}>Switch</Text>
            {turn && turn.user_id !== who ? <View style={[s.dot, { backgroundColor: t.onAccent }]} /> : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to you"
            onPress={() => play(ME)}
            style={[s.barBtn, { borderColor: t.onAccent }]}
          >
            <Text style={[s.btnText, { color: t.onAccent }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[s.playBody, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {problem ? (
            <View style={[s.card, { backgroundColor: t.cell, borderColor: t.danger }]}>
              <Text style={[s.line, { color: t.danger, fontWeight: "700" }]}>That didn't work</Text>
              <Text style={[s.label, { color: t.fg }]}>{problem}</Text>
            </View>
          ) : null}
          {theirs && openShare ? (
            // One of their cards, opened as they'd open it.
            <>
              <Pressable accessibilityRole="button" onPress={() => setOpenShare(null)} hitSlop={10}>
                <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>
                  ‹ {person.name}'s home
                </Text>
              </Pressable>
              <SharedPage
                opened={theirs}
                busy={busy}
                run={(key, go) => void act(key, go)}
                onSet={(recordId, field, value) => setAsThem(openShare, recordId, field, value)}
                onAdd={async (section, values) => {
                  await addAsThem(openShare, section, values);
                  await load();
                  setTimeout(() => void load(), 1500);
                }}
                onAnswer={(answer) => answerAsThem(openShare, answer)}
              />
            </>
          ) : (
            <>
              <View style={{ gap: 4 }}>
                <Text style={[s.title, { color: t.fg }]}>Hi {person.name.split(" ")[0]}</Text>
                <Text style={[s.label, { color: t.fg2 }]}>
                  {person.role === "member"
                    ? `${person.name} is in this space, so they see all its lists, as you do. Here: what they've been asked and told.`
                    : person.role === "standin"
                      ? "Made up for this practice run: nobody fills this role yet. Whoever does will get exactly this."
                      : `This is ${person.name}'s app: only what's shared with them, with the fields they may see.`}
                </Text>
              </View>
              {turn && turn.user_id !== who ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => play(turn.user_id)}
                  style={[s.card, { backgroundColor: t.accentSoft, borderColor: t.hair }]}
                >
                  <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>
                    Now it's {turn.name}'s turn
                  </Text>
                  <Text style={[s.label, { color: t.accent, fontWeight: "700" }]}>Play as {turn.name} ›</Text>
                </Pressable>
              ) : mine.length ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => play(ME)}
                  style={[s.card, { backgroundColor: t.accentSoft, borderColor: t.hair }]}
                >
                  <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>Now it's your turn</Text>
                  <Text style={[s.label, { color: t.accent, fontWeight: "700" }]}>Back to you ›</Text>
                </Pressable>
              ) : null}
              {as ? (
                <>
                  {as.cards.length ? (
                    as.cards.map((card) => (
                      <Boundary key={card.id} where="practice card">
                        <Card
                          card={card}
                          natural
                          busy={busy === card.id}
                          onOpen={() => card.shared && setOpenShare(card.shared.share_id)}
                          onAnswer={
                            card.waiting && card.shared
                              ? (a) => void act(card.id, () => answerAsThem(card.shared!.share_id, a))
                              : undefined
                          }
                          onTick={(record, value) => {
                            const field = card.spec.sources[0]?.answer_field;
                            if (field && card.shared)
                              void act(card.id, () =>
                                setAsThem(card.shared!.share_id, record.id, field, value),
                              );
                          }}
                          onSet={(record, field, value) =>
                            card.shared &&
                            void act(card.id, () => setAsThem(card.shared!.share_id, record.id, field, value))
                          }
                        />
                      </Boundary>
                    ))
                  ) : (
                    <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
                      <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>
                        {as.view.got.length
                          ? `Nothing is waiting on ${person.name} now`
                          : `Nothing is shared with ${person.name} yet`}
                      </Text>
                      <Text style={[s.label, { color: t.fg2 }]}>
                        {as.view.got.length
                          ? "What they were asked and told is below."
                          : "Their home stays empty until something is. Ask the chat to share a list or a form with them (in the real space), then start a new practice run."}
                      </Text>
                    </View>
                  )}
                  <Text style={[s.h2, { color: t.fg }]}>Their notifications</Text>
                  {as.view.got.length ? (
                    as.view.got.map((g) => (
                      <View key={g.id} style={[s.notif, { backgroundColor: t.cell, borderColor: t.hair }]}>
                        <Text style={[s.label, { color: t.fg, fontWeight: "700" }]}>{g.title}</Text>
                        <Text style={[s.line, { color: t.fg }]}>{g.body ?? ""}</Text>
                        <Text style={[s.label, { color: t.fg3 }]}>
                          {new Date(g.at).toLocaleString("en-IN", {
                            timeStyle: "short",
                            dateStyle: "medium",
                          })}
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
            </>
          )}
        </ScrollView>
        {switcher}
      </View>
    );

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
              onPress={() => play(p.user_id)}
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
        {problem ? (
          <View style={[s.card, { backgroundColor: t.cell, borderColor: t.danger }]}>
            <Text style={[s.line, { color: t.danger, fontWeight: "700" }]}>That didn't work</Text>
            <Text style={[s.label, { color: t.fg }]}>{problem}</Text>
          </View>
        ) : null}
        {/* What happens next, and a way to get there. */}
        {view ? (
          turn ? (
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
                  onPress={() => play(turn.user_id)}
                  style={[s.btn, { backgroundColor: t.accent }]}
                >
                  <Text style={[s.btnText, { color: t.onAccent }]}>Play as {turn.name} ›</Text>
                </Pressable>
              </View>
            </View>
          ) : !mine.length && flow ? (
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
                  : "Tap Start to set it off with made-up details. Then play each person: the screen becomes their app, with only what they'd see, and you answer as them."}
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
          ) : !mine.length ? (
            <View style={[s.card, { backgroundColor: t.accentSoft, borderColor: t.hair }]}>
              <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>Your move</Text>
              <Text style={[s.label, { color: t.fg2 }]}>
                Add or change a record in one of the lists below, or play someone above and use their app: the
                workflows take it from there, and you'll see whose turn it is next.
              </Text>
            </View>
          ) : null
        ) : null}

        {view ? (
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
            <Text style={[s.h2, { color: t.fg }]}>
              {used && !allLists ? "The lists this flow uses" : "The lists in this copy"}
            </Text>
            <View style={s.row}>
              {(used && !allLists ? lists.filter((c) => used.has(c.id)) : lists).map((c) => {
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
            {used && lists.length > used.size ? (
              <Pressable accessibilityRole="button" onPress={() => setAllLists((a) => !a)} hitSlop={8}>
                <Text style={[s.label, { color: t.accent, fontWeight: "700" }]}>
                  {allLists ? "Show only this flow's lists" : `Show all ${lists.length} lists in the copy`}
                </Text>
              </Pressable>
            ) : null}
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
      {switcher}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  playRoot: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  barSmall: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, opacity: 0.85 },
  barName: { fontSize: 18, fontWeight: "800" },
  barBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  playBody: { padding: 16, gap: 14 },
  person: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
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
  notif: { padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
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
