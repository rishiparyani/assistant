// Rehearsing (decisions 2026-10-16 "Rehearse a workflow" and "Rehearse as each person",
// 2026-11-01 "Rehearsing is being each person"): a practice copy of a space whose workflows run
// for real, played person by person. Opened on a flow it asks who to start as, and the whole app
// becomes theirs (src/practice-mode.ts; the strip and the banners in PracticeBanner): you do the
// real thing on their screens, a banner brings in whoever the flow reaches next, and End throws
// the copy away and shows what happened, step by step (`?ended=1`, below). Nothing reaches
// anyone; the real space is never touched. Opened without a flow it is the copy's dashboard.
// online-only: a rehearsal lives in its practice copy's object.
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { FlowDiagram, Text } from "@assistant/cards/native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CollectionView, PracticePerson, PracticeView, WorkflowDetail } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { COMPOSER_ROOM, Composer } from "@/components/Composer";
import { personNote, playAs } from "@/components/PracticeBanner";
import { practiceEnded } from "@/practice-mode";
import { useLive } from "@/live-socket";
import { homeChanged } from "@/home";
import { useSession } from "@/session";
import { colourFor, radius, useTheme } from "@/theme";

const enc = encodeURIComponent;
const ME = "";

export default function Practice() {
  const { ended } = useLocalSearchParams<{ ended?: string }>();
  return ended ? <Ended /> : <Rehearse />;
}

/** After End: what happened, step by step, and what to do next. */
function Ended() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const story = practiceEnded();
  const [realOn, setRealOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!story?.workflow) return;
    request<WorkflowDetail>("GET", `/api/workflows/${enc(story.workflow)}?space=${enc(story.of)}`)
      .then((d) => setRealOn(d.workflow.enabled))
      .catch(() => setRealOn(null));
  }, [story]);
  const act = async (key: string, go: () => Promise<void>) => {
    setBusy(key);
    setNote("");
    try {
      await go();
    } catch (e) {
      setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  // Opened again later (a reload): the story was only kept until then.
  if (!story) return <Redirect href="/" />;
  const turnOn = () =>
    story?.workflow &&
    void act("on", async () => {
      await request("PUT", `/api/workflows/${enc(story.workflow!)}/enabled`, {
        enabled: true,
        space: story.of,
      });
      setRealOn(true);
    });
  const again = () =>
    story &&
    void act("again", async () => {
      const made = await request<{ id: string }>("POST", `/api/spaces/${enc(story.of)}/practice`, {});
      router.replace({
        pathname: "/practice",
        params: { space: made.id, ...(story.workflow ? { workflow: story.workflow } : {}) },
      });
    });
  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <Text style={[s.eyebrow, { color: t.fg2 }]} numberOfLines={1}>
          {story?.flow ? story.flow.toUpperCase() : "ENDED"}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.replace("/")} hitSlop={10}>
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 14 }}>
        <Text style={[s.big, { color: t.fg }]}>Here's what happened</Text>
        <Text style={[s.line, { color: t.fg2 }]}>
          Everything made while rehearsing was thrown away. Nothing reached anyone.
        </Text>
        <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair, gap: 12 }]}>
          <Text style={[s.eyebrow, { color: t.fg2 }]}>BEHIND THE SCENES</Text>
          {story?.lines.length ? (
            story.lines.map((l, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <View style={[s.step, { backgroundColor: t.accentSoft }]}>
                  <Text style={[s.stepText, { color: t.accent }]}>{i + 1}</Text>
                </View>
                <Text style={[s.line, { color: t.fg, flex: 1 }]}>{l}</Text>
              </View>
            ))
          ) : (
            <Text style={[s.line, { color: t.fg2 }]}>Nobody was asked or told anything this time.</Text>
          )}
        </View>
        {story?.workflow && realOn === false ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={turnOn}
            style={[s.bigBtn, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={[s.bigBtnText, { color: t.onAccent }]}>
              {busy === "on" ? "Turning on…" : "Turn the flow on"}
            </Text>
          </Pressable>
        ) : story?.workflow && realOn ? (
          <Text style={[s.line, { color: t.fg, fontWeight: "700" }]}>The flow is on.</Text>
        ) : null}
        {story ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={again}
            style={[s.bigBtn, { backgroundColor: t.fill, opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={[s.bigBtnText, { color: t.fg }]}>
              {busy === "again" ? "Setting up…" : "Rehearse again"}
            </Text>
          </Pressable>
        ) : null}
        <Text style={[s.label, { color: t.fg2 }]}>
          Not quite right? Ask the chat to change the flow, then rehearse it again.
        </Text>
        {note ? <Text style={[s.label, { color: t.danger }]}>{note}</Text> : null}
      </ScrollView>
    </View>
  );
}

function Rehearse() {
  const { t, colour } = useTheme();
  const { me, refresh } = useSession();
  const myId = me?.user.id ?? null;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // The workflow being rehearsed (from its screen): its steps and a Start button lead the way.
  const { space, workflow } = useLocalSearchParams<{ space?: string; workflow?: string }>();
  const [flow, setFlow] = useState<WorkflowDetail | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [view, setView] = useState<PracticeView | null>(null);
  const [lists, setLists] = useState<CollectionView[]>([]);
  const [note, setNote] = useState("");
  // What went wrong with the last thing tapped: kept until the next tap (the screen reads again
  // every few seconds, which cleared it before anyone saw it; owner, 2026-10-19: "it is showing
  // starting, but nothing happens after that").
  const [problem, setProblem] = useState("");
  const [allLists, setAllLists] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  // Opened on a flow: who to start as (the whole app becomes theirs). "Behind the scenes" is
  // the copy's dashboard instead.
  const guided = !!workflow;
  const [behind, setBehind] = useState(false);
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
      if (workflow) {
        setFlow(
          await request<WorkflowDetail>("GET", `/api/workflows/${enc(workflow)}?space=${enc(space)}`).catch(
            () => null,
          ),
        );
      }
      setNote("");
    } catch (e) {
      setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
    }
  }, [space, base, workflow]);
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
  /** Plays a person: the whole app becomes theirs, on Today (the one practising stays "You"). */
  const play = (id: string) => {
    if (id === ME || !space || !view || !myId) return;
    const name = view.people.find((p) => p.user_id === id)?.name ?? id;
    setProblem("");
    void playAs({ space, of: view.of, as: id, name, self: myId }, refresh).then(() => router.replace("/"));
  };
  /** Starts rehearsing the flow as this person (yourself too): the whole app becomes theirs. */
  // First the copy runs only this flow (the others are turned off there; Codex on PR 225), with
  // nothing added: the person sets it off themselves.
  const begin = (id: string, name: string) => {
    if (!space || !view || !myId) return;
    setBusy("begin");
    setProblem("");
    void (async () => {
      if (workflow) await request("POST", `${base}/run`, { workflow_id: workflow, start: false });
      await playAs(
        {
          space,
          of: view.of,
          as: id,
          name,
          self: myId,
          workflow: workflow ?? null,
          flow: flow?.workflow.name ?? null,
          since: view.log[0]?.id ?? null,
        },
        refresh,
      );
      router.replace("/");
    })()
      .catch((e: unknown) =>
        setProblem(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setBusy(null));
  };

  const end = async () => {
    if (!space) return;
    if (!ending) return setEnding(true);
    setBusy("end");
    try {
      await request("DELETE", base);
      homeChanged();
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (e) {
      setNote(isOffline(e) ? "Ending needs a connection." : e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const people = view?.people ?? [];
  const who = ME;
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
  // In a walkthrough, once this person has nothing left to do, one card says so and goes on.
  const waitingOn = (p: PracticePerson) =>
    view?.waiting.find((w) => w.on.some((o) => o.user_id === p.user_id && o.answer === null)) ?? null;
  /** "was asked", "were told", "said": what a log line says about its person. */
  const verb = (l: PracticeView["log"][number]) =>
    l.kind === "answer"
      ? "said"
      : l.kind === "question"
        ? l.user_id === myId
          ? "were asked"
          : "was asked"
        : l.user_id === myId
          ? "were told"
          : "was told";
  const fab = (
    <Composer
      about={{
        kind: "screen",
        title: guided ? "Behind the scenes" : "Practice run",
      }}
      params={space ? { space } : {}}
    />
  );

  const leave = (
    <Pressable
      accessibilityRole="button"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      hitSlop={10}
    >
      <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
    </Pressable>
  );
  const endBtn = view ? (
    <Pressable
      accessibilityRole="button"
      disabled={busy !== null}
      onPress={() => void end()}
      style={[s.btn, { backgroundColor: ending ? t.danger : t.fill, opacity: busy ? 0.6 : 1 }]}
    >
      <Text style={[s.btnText, { color: ending ? t.onAccent : t.danger }]}>
        {ending ? "Tap again to erase this practice run" : "End the practice run"}
      </Text>
    </Pressable>
  ) : null;
  if (guided && !behind)
    return (
      <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
        <View style={s.head}>
          <Text style={[s.eyebrow, { color: t.fg2 }]}>REHEARSE</Text>
          {leave}
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 14 }}>
          {problem ? (
            <View style={[s.card, { backgroundColor: t.cell, borderColor: t.danger }]}>
              <Text style={[s.line, { color: t.danger, fontWeight: "700" }]}>That didn't work</Text>
              <Text style={[s.label, { color: t.fg }]}>{problem}</Text>
            </View>
          ) : null}
          {!view || !flow ? (
            <Text style={[s.label, { color: t.fg2 }]}>{note || "Setting up the practice copy…"}</Text>
          ) : (
            <>
              <Text style={[s.big, { color: t.fg }]}>{flow.workflow.name}</Text>
              <Text style={[s.line, { color: t.fg2 }]}>
                Pick who to start as. The app becomes theirs: do what they would, and when the flow reaches
                someone else, a banner lets you be them. Nothing reaches anyone.
              </Text>
              <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair, gap: 4 }]}>
                <Text style={[s.h2, { color: t.fg, marginTop: 0 }]}>Rehearse as…</Text>
                {[
                  { user_id: myId ?? "", name: "Yourself", note: "As yourself" },
                  ...people.map((p) => ({ user_id: p.user_id, name: p.name, note: personNote(p) })),
                ].map((p) => (
                  <Pressable
                    key={p.user_id || "me"}
                    accessibilityRole="button"
                    accessibilityLabel={`Rehearse as ${p.name}`}
                    disabled={busy !== null}
                    onPress={() => begin(p.user_id, p.name)}
                    style={[s.person, { backgroundColor: t.cell, borderColor: t.hair }]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.line, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={[s.label, { color: t.fg2 }]} numberOfLines={1}>
                        {p.note}
                      </Text>
                    </View>
                    <Text style={{ color: t.fg3, fontSize: 20 }}>›</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable accessibilityRole="button" onPress={() => setBehind(true)} hitSlop={8}>
                <Text style={[s.label, { color: t.accent, fontWeight: "700" }]}>Behind the scenes ›</Text>
              </Pressable>
            </>
          )}
          {note && view ? <Text style={[s.label, { color: t.danger }]}>{note}</Text> : null}
        </ScrollView>
      </View>
    );

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
            {guided ? "Behind the scenes" : "Practice run"}
          </Text>
          <Text style={[s.label, { color: t.fg2 }]} numberOfLines={1}>
            {view ? `${view.name} · nothing here reaches anyone` : note || "Loading…"}
          </Text>
        </View>
        {guided ? (
          <Pressable accessibilityRole="button" onPress={() => setBehind(false)} hitSlop={10}>
            <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>‹ Rehearse</Text>
          </Pressable>
        ) : (
          leave
        )}
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
              style={[s.role, { backgroundColor: on ? t.accent : t.fill }]}
            >
              <Text style={[s.roleText, { color: on ? t.onAccent : t.fg }]}>{p.name}</Text>
              {p.waiting ? (
                <View style={[s.badge, { backgroundColor: t.accent }]}>
                  <Text style={[s.badgeText, { color: t.onAccent }]}>{p.waiting}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + COMPOSER_ROOM, gap: 14 }}>
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
              <FlowDiagram workflow={flow.workflow} />
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
                      {` ${verb(l)}: `}
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

        {view ? <View style={s.row}>{endBtn}</View> : null}
        {note && view ? <Text style={[s.label, { color: t.danger }]}>{note}</Text> : null}
      </ScrollView>
      {fab}
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
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  big: { fontSize: 24, lineHeight: 30, fontWeight: "800", letterSpacing: -0.5 },
  bigBtn: {
    minHeight: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  bigBtnText: { fontSize: 17, fontWeight: "800" },
  narr: { padding: 12, borderRadius: 14 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 15, fontWeight: "700" },
  step: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 13, fontWeight: "800" },
});
