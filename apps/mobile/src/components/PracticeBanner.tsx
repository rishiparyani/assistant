// Rehearsing (docs/design/from-scratch.md §2 point 9; decision 2026-11-01 "Rehearsing is being
// each person"): while the app is someone's, a strip across the top says who, with Switch
// (anyone in the copy, and yourself) and End (the copy is thrown away, then its story shows,
// behind the scenes). When the flow reaches someone else, a banner slides in as a notification
// would; tapping it makes the app theirs. Nothing else about the app is different.
// online-only: who is in the copy, and what reached them, is read from it.
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tap, Text, type } from "@assistant/cards/native";
import type { PracticePerson, PracticeView } from "@assistant/shared";
import { isOffline, request } from "../api.ts";
import { homeChanged } from "../home.ts";
import {
  enterPractice,
  leavePractice,
  setPracticeEnded,
  usePracticeMode,
  type PracticeAs,
} from "../practice-mode.ts";
import { useSession } from "../session.tsx";
import { useTheme } from "../theme.ts";
import { Sheet } from "./Sheet.tsx";

/** Switches the whole app to this person: the session reads again as them. */
export async function playAs(next: PracticeAs, refresh: () => Promise<void>) {
  enterPractice(next);
  await refresh();
}

/** What each kind of person is, in a few words (a stand-in is made up for an empty role). */
export const personNote = (p: Pick<PracticePerson, "role">) =>
  p.role === "standin"
    ? "Stand-in: nobody has this role yet"
    : p.role === "shared"
      ? "Sees only what's shared with them"
      : "In the space";

/** "Asha" from "Asha Rao (stand-in)". */
export const firstName = (name: string) => name.replace(/ \(stand-in\)$/, "").split(" ")[0] ?? name;

type Line = PracticeView["log"][number];
/** One line of the story, in words: "Asha was asked: Let Dev in?". */
export function storyLine(l: Line, self: string) {
  const you = l.user_id === self;
  const verb =
    l.kind === "answer"
      ? "answered"
      : l.kind === "question"
        ? you
          ? "were asked"
          : "was asked"
        : you
          ? "were told"
          : "was told";
  const what = l.kind === "answer" ? `“${l.body ?? ""}” to ${l.title}` : (l.body ?? l.title);
  return `${you ? "You" : l.name} ${verb}: ${what}`;
}

/** A banner for the next person: what reached them, and a tap to be them. */
interface Notice {
  id: string;
  user_id: string;
  name: string;
  kind: "message" | "question";
  title: string;
  body: string | null;
}

export function PracticeBanner() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh } = useSession();
  const mode = usePracticeMode();
  const [sheet, setSheet] = useState<"switch" | "end" | null>(null);
  const [people, setPeople] = useState<PracticeView["people"] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [barHeight, setBarHeight] = useState(0);
  // What the copy's log already held: only what comes after shows as a banner.
  const seen = useRef<{ space: string; ids: Set<string> } | null>(null);
  const base = mode ? `/api/spaces/${encodeURIComponent(mode.space)}/practice` : "";
  const read = () =>
    request<PracticeView>("GET", base, undefined, undefined, { practice: null }).then((v) => {
      setPeople(v.people);
      return v;
    });

  // While rehearsing: look at the copy every few seconds for what reached someone else.
  useEffect(() => {
    if (!mode) return;
    let gone = false;
    const look = () =>
      read()
        .then((v) => {
          if (gone) return;
          // The first look counts as known only what was there when rehearsing began (the
          // log's newest line then, `since`), so a question asked before this look still shows
          // (Codex on PR 225). Without a start line (rehearsing begun elsewhere), all of it.
          const known =
            seen.current?.space === mode.space
              ? seen.current.ids
              : mode.since === undefined
                ? new Set(v.log.map((l) => l.id))
                : new Set(
                    mode.since === null
                      ? []
                      : v.log
                          .slice(
                            Math.max(
                              0,
                              v.log.findIndex((l) => l.id === mode.since),
                            ),
                          )
                          .map((l) => l.id),
                  );
          seen.current = { space: mode.space, ids: new Set(v.log.map((l) => l.id)) };
          // Newest first: the newest new line for someone other than the one played now.
          const next = v.log.find(
            (l): l is Line & { kind: "message" | "question" } =>
              !known.has(l.id) && l.kind !== "answer" && l.user_id !== mode.as,
          );
          if (next) setNotice(next);
        })
        .catch(() => undefined);
    void look();
    const every = setInterval(() => void look(), 3000);
    return () => {
      gone = true;
      clearInterval(every);
    };
  }, [mode?.space, mode?.as]);
  useEffect(() => {
    if (sheet !== "switch" || !mode) return;
    setNote("");
    read().catch((e) =>
      setNote(isOffline(e) ? "Switching needs a connection." : e instanceof Error ? e.message : String(e)),
    );
  }, [sheet, mode?.space]);
  if (!mode) return null;
  const self = mode.as === mode.self;

  /** Becomes this person: their app, on their Inbox when something waits on them. */
  const become = async (id: string, name: string, inbox = false) => {
    setBusy(true);
    try {
      await playAs({ ...mode, as: id, name }, refresh);
      setSheet(null);
      setNotice(null);
      router.replace(inbox ? "/updates" : "/");
    } finally {
      setBusy(false);
    }
  };
  // End: what happened is kept to tell, then the copy is thrown away and the app is yours again.
  const end = async () => {
    setBusy(true);
    setNote("");
    try {
      const v = await read().catch(() => null);
      const log = v?.log ?? [];
      const at = mode.since ? log.findIndex((l) => l.id === mode.since) : -1;
      const run = at < 0 ? log : log.slice(0, at);
      await request("DELETE", base, undefined, undefined, { practice: null });
      setPracticeEnded({
        of: mode.of,
        workflow: mode.workflow ?? null,
        flow: mode.flow ?? null,
        lines: [...run].reverse().map((l) => storyLine(l, mode.self)),
      });
      leavePractice();
      setSheet(null);
      setNotice(null);
      await refresh();
      homeChanged();
      router.replace({ pathname: "/practice", params: { ended: "1" } });
    } catch (e) {
      setNote(isOffline(e) ? "Ending needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const everyone = [
    { user_id: mode.self, name: "Yourself", waiting: 0, about: "As yourself" },
    ...(people ?? []).map((p) => ({
      user_id: p.user_id,
      name: p.name,
      waiting: p.waiting,
      about: p.waiting ? `${p.waiting} waiting on them` : personNote(p),
    })),
  ];
  return (
    <>
      <View
        onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
        style={[s.bar, { backgroundColor: t.accent, paddingTop: insets.top + 6 }]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: t.onAccent, opacity: 0.85 }]}>REHEARSING AS</Text>
          <Text style={[s.name, { color: t.onAccent }]} numberOfLines={1}>
            {self ? "Yourself" : mode.name}
          </Text>
        </View>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Switch who you play"
          onPress={() => setSheet("switch")}
          style={[s.btn, { borderColor: t.onAccent }]}
        >
          <Text style={[s.btnText, { color: t.onAccent }]}>Switch</Text>
        </Tap>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="End rehearsing"
          disabled={busy}
          onPress={() => setSheet("end")}
          style={[s.btn, { borderColor: t.onAccent }]}
        >
          <Text style={[s.btnText, { color: t.onAccent }]}>End</Text>
        </Tap>
      </View>
      {notice ? (
        <View style={[s.noticeWrap, { top: barHeight + 8 }]} pointerEvents="box-none">
          <View style={[s.notice, { backgroundColor: t.cell, shadowColor: t.fg }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`For ${notice.name}: ${notice.body ?? notice.title}. Be ${firstName(notice.name)}`}
              disabled={busy}
              onPress={() => void become(notice.user_id, notice.name, notice.kind === "question")}
              style={s.noticeBody}
            >
              <Text style={[type.caption, { color: t.fg2, fontWeight: "800" }]} numberOfLines={1}>
                FOR {notice.name.toUpperCase()}
              </Text>
              <Text style={[s.noticeTitle, { color: t.fg }]} numberOfLines={1}>
                {notice.title}
              </Text>
              {notice.body ? (
                <Text style={[s.noticeText, { color: t.fg }]} numberOfLines={3}>
                  {notice.body}
                </Text>
              ) : null}
              <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>
                Tap to be {firstName(notice.name)}
              </Text>
            </Pressable>
            <Tap
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              onPress={() => setNotice(null)}
              style={s.dismiss}
            >
              <Text style={{ color: t.fg2, fontSize: 20 }}>×</Text>
            </Tap>
          </View>
        </View>
      ) : null}
      <Sheet open={sheet === "switch"} onClose={() => setSheet(null)} accessibilityLabel="Be someone else">
        <Text style={[s.h2, { color: t.fg }]}>Be someone else</Text>
        <Text style={[type.caption, { color: t.fg2 }]}>
          The app becomes theirs: what they see and can do, nothing more. Nothing here reaches anyone.
        </Text>
        {note ? <Text style={[type.caption, { color: t.danger }]}>{note}</Text> : null}
        {everyone.map((p) => {
          const on = mode.as === p.user_id;
          return (
            <Pressable
              key={p.user_id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.waiting ? `${p.name}, ${p.waiting} waiting` : p.name}
              disabled={busy}
              onPress={() => void become(p.user_id, p.name, p.waiting > 0)}
              style={[s.person, { backgroundColor: on ? t.accentSoft : t.cell, borderColor: t.hair }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.personName, { color: t.fg }]} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
                  {p.about}
                </Text>
              </View>
              {p.waiting ? (
                <View style={[s.badge, { backgroundColor: t.accent }]}>
                  <Text style={[s.badgeText, { color: t.onAccent }]}>{p.waiting}</Text>
                </View>
              ) : null}
              {on ? <Text style={[type.caption, { color: t.fg2 }]}>Now</Text> : null}
            </Pressable>
          );
        })}
        {!people && !note ? <Text style={[type.caption, { color: t.fg2 }]}>Loading…</Text> : null}
      </Sheet>
      <Sheet open={sheet === "end"} onClose={() => setSheet(null)} accessibilityLabel="End rehearsing">
        <Text style={[s.h2, { color: t.fg }]}>End now?</Text>
        <Text style={[type.caption, { color: t.fg2 }]}>
          Everything made while rehearsing is thrown away. Nothing reached anyone. You'll see what happened,
          step by step.
        </Text>
        {note ? <Text style={[type.caption, { color: t.danger }]}>{note}</Text> : null}
        <Tap
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void end()}
          style={[s.wide, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[s.wideText, { color: t.onAccent }]}>
            {busy ? "Ending…" : "End and throw it away"}
          </Text>
        </Tap>
        <Tap
          accessibilityRole="button"
          onPress={() => setSheet(null)}
          style={[s.wide, { backgroundColor: t.fill }]}
        >
          <Text style={[s.wideText, { color: t.fg }]}>Keep going</Text>
        </Tap>
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  name: { fontSize: 16, fontWeight: "800" },
  btn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 15, fontWeight: "700" },
  h2: { fontSize: 18, fontWeight: "800" },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  personName: { fontSize: 15, fontWeight: "700" },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 12, fontWeight: "800" },
  noticeWrap: { position: "absolute", left: 10, right: 10, zIndex: 50, alignItems: "center" },
  notice: {
    width: "100%",
    maxWidth: 520,
    flexDirection: "row",
    borderRadius: 22,
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  noticeBody: { flex: 1, minWidth: 0, padding: 14, gap: 2 },
  noticeTitle: { fontSize: 15, fontWeight: "800" },
  noticeText: { fontSize: 14, lineHeight: 19 },
  dismiss: { width: 44, alignItems: "center", justifyContent: "center" },
  wide: { minHeight: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  wideText: { fontSize: 16, fontWeight: "700" },
});
