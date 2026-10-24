// The rehearsal's banner (docs/design/from-scratch.md §2 point 9, §3 "Rehearse"): while the app
// is someone's, a bar across the top says so, with Switch (anyone in the copy, and yourself) and
// Done (back to yourself and the real space). Nothing else about the app is different.
// online-only: who is in the copy is read from it.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tap, Text, type } from "@assistant/cards/native";
import type { PracticeView } from "@assistant/shared";
import { isOffline, request } from "../api.ts";
import { enterPractice, leavePractice, usePracticeMode, type PracticeAs } from "../practice-mode.ts";
import { useSession } from "../session.tsx";
import { useTheme } from "../theme.ts";
import { Sheet } from "./Sheet.tsx";

/** Switches the whole app to this person: the session reads again as them, on Today. */
export async function playAs(next: PracticeAs, refresh: () => Promise<void>) {
  enterPractice(next);
  await refresh();
}

export function PracticeBanner() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh } = useSession();
  const mode = usePracticeMode();
  const [switching, setSwitching] = useState(false);
  const [people, setPeople] = useState<PracticeView["people"] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!switching || !mode) return;
    setNote("");
    request<PracticeView>(
      "GET",
      `/api/spaces/${encodeURIComponent(mode.space)}/practice`,
      undefined,
      undefined,
      {
        practice: null,
      },
    )
      .then((v) => setPeople(v.people))
      .catch((e) =>
        setNote(isOffline(e) ? "Switching needs a connection." : e instanceof Error ? e.message : String(e)),
      );
  }, [switching, mode]);
  if (!mode) return null;
  const self = mode.as === mode.self;
  const go = async (next: PracticeAs | null) => {
    setBusy(true);
    try {
      if (next) await playAs(next, refresh);
      else {
        leavePractice();
        await refresh();
      }
      setSwitching(false);
      router.replace("/");
    } finally {
      setBusy(false);
    }
  };
  const first = (name: string) => name.replace(/ \(stand-in\)$/, "").split(" ")[0] ?? name;
  return (
    <>
      <View style={[s.bar, { backgroundColor: t.accent, paddingTop: insets.top + 6 }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: t.onAccent, opacity: 0.85 }]}>PRACTISING AS</Text>
          <Text style={[s.name, { color: t.onAccent }]} numberOfLines={1}>
            {self ? "yourself" : mode.name}
          </Text>
        </View>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Switch who you play"
          onPress={() => setSwitching(true)}
          style={[s.btn, { borderColor: t.onAccent }]}
        >
          <Text style={[s.btnText, { color: t.onAccent }]}>Switch</Text>
        </Tap>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Done practising"
          disabled={busy}
          onPress={() => void go(null)}
          style={[s.btn, { borderColor: t.onAccent }]}
        >
          <Text style={[s.btnText, { color: t.onAccent }]}>Done</Text>
        </Tap>
      </View>
      <Sheet open={switching} onClose={() => setSwitching(false)} accessibilityLabel="Play as">
        <Text style={[s.h2, { color: t.fg }]}>Play as</Text>
        <Text style={[type.caption, { color: t.fg2 }]}>
          The app becomes theirs: what they see and can do, nothing more. Nothing here reaches anyone.
        </Text>
        {note ? <Text style={[type.caption, { color: t.danger }]}>{note}</Text> : null}
        {[
          { user_id: mode.self, name: "Yourself", waiting: 0 },
          ...(people ?? []).map((p) => ({ user_id: p.user_id, name: p.name, waiting: p.waiting })),
        ].map((p) => {
          const on = mode.as === p.user_id;
          return (
            <Pressable
              key={p.user_id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.waiting ? `${p.name}, ${p.waiting} waiting` : p.name}
              disabled={busy}
              onPress={() =>
                void go({ space: mode.space, of: mode.of, as: p.user_id, name: p.name, self: mode.self })
              }
              style={[s.person, { backgroundColor: on ? t.accentSoft : t.cell, borderColor: t.hair }]}
            >
              <Text style={[s.personName, { color: t.fg }]} numberOfLines={1}>
                {p.name}
              </Text>
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
        <Text style={[type.caption, { color: t.fg3 }]}>
          {self ? "" : `Done takes you back to yourself; ${first(mode.name)} keeps nothing of this.`}
        </Text>
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
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 14, fontWeight: "700" },
  h2: { fontSize: 18, fontWeight: "800" },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  personName: { flex: 1, fontSize: 15, fontWeight: "700" },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 12, fontWeight: "800" },
});
