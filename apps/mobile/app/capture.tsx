// Capture (home-first.md §2 point 12): text from Siri ("Add to Gigspree"), a shortcut or a
// share goes into the Inbox; the assistant says where it probably belongs. Online it answers
// at once; offline the capture waits in the outbox and syncs later.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isOffline, request } from "@/api";
import { send } from "@/outbox";
import { radius, useTheme } from "@/theme";

type Captured = { record: { id: string; title: string }; guess: string | null };

export default function Capture() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { text: given } = useLocalSearchParams<{ text?: string }>();
  const text = (given ?? "").trim();
  const [state, setState] = useState<"saving" | "saved" | "waiting" | "failed">("saving");
  const [guess, setGuess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!text) return;
    let gone = false;
    request<Captured>("POST", "/api/inbox", { text, source: "siri" })
      .then((r) => {
        if (gone) return;
        setGuess(typeof r.guess === "string" ? r.guess : "");
        setState("saved");
      })
      .catch((e: unknown) => {
        if (gone) return;
        if (isOffline(e)) {
          // Kept on the device and sent when the connection is back (in order, once).
          send({
            kind: "core.capture",
            method: "POST",
            path: "/api/inbox",
            body: { text, source: "siri" },
            label: `Capture “${text}”`,
          });
          setState("waiting");
        } else {
          setError(e instanceof Error ? e.message : String(e));
          setState("failed");
        }
      });
    return () => {
      gone = true;
    };
  }, [text]);

  const done = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <Text style={[s.title, { color: t.fg }]}>Inbox</Text>
        <Pressable accessibilityRole="button" onPress={done} hitSlop={10}>
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <View style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
        <Text style={[s.text, { color: t.fg }]}>{text || "Nothing to add."}</Text>
        <Text style={[s.sub, { color: state === "failed" ? t.danger : t.fg2 }]}>
          {state === "saving"
            ? "Saving to your Inbox…"
            : state === "saved"
              ? "In your Inbox."
              : state === "waiting"
                ? "Offline: kept here, it goes to your Inbox when you're back online."
                : `Couldn't save it: ${error}`}
        </Text>
        {guess ? <Text style={[s.guess, { color: t.fg }]}>{guess}</Text> : null}
      </View>
      {text ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.replace({ pathname: "/chat", params: { ask: `About what I just added: ${text}. ` } })
          }
          style={[s.btn, { backgroundColor: t.fill }]}
        >
          <Text style={[s.btnText, { color: t.accent }]}>Ask the chat about it</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  card: { padding: 16, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, gap: 8 },
  text: { fontSize: 17, fontWeight: "600", lineHeight: 23 },
  sub: { fontSize: 14, lineHeight: 20 },
  guess: { fontSize: 15, lineHeight: 21 },
  btn: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  btnText: { fontSize: 15, fontWeight: "700" },
});
