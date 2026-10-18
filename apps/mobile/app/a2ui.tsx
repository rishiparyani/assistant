// The new cards, tried out (decision 2026-10-18 "Try A2UI"): worked cards written in A2UI and
// drawn by the app's own player, with made-up data. Their figures, filters and charts are
// worked out by the card itself (functions in the catalogue), so a slider, a filter or a tick
// changes everything that depends on it. "Build again" sends the card a piece at a time, the
// way an agent's answer arrives. Nothing here reads or writes the person's data.
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core";
import { A2uiSurface, A2UI_PARTS, Tap, Text, type, useTheme } from "@assistant/cards/native";
import { DEMOS, cardMessages, makeCatalog } from "@assistant/cards/a2ui";

const SURFACE = "trial";

export default function A2uiTrial() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [which, setWhich] = useState(0);
  const [surface, setSurface] = useState<SurfaceModel | null>(null);
  const [run, setRun] = useState(0);
  const stop = useRef<() => void>(() => undefined);

  useEffect(() => {
    const processor = new MessageProcessor([makeCatalog()]);
    // The first show is the finished card; "Build again" sends it a piece at a time.
    const all = cardMessages(DEMOS[which]!, SURFACE, run > 0);
    let at = 0;
    let shown = false;
    const step = () => {
      processor.processMessages(all[at++] as never);
      const s = processor.model.surfacesMap.get(SURFACE);
      if (s && !shown) {
        shown = true;
        setSurface(s);
      }
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    if (run === 0) while (at < all.length) step();
    else timer = setInterval(() => (at < all.length ? step() : clearInterval(timer)), 120);
    stop.current = () => timer && clearInterval(timer);
    return () => stop.current();
  }, [which, run]);

  const show = (i: number, again: boolean) => {
    stop.current();
    setSurface(null);
    setWhich(i);
    setRun((n) => (again ? n + 1 : 0));
  };

  return (
    <View style={[s.root, { backgroundColor: t.canvas, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <Text style={[type.title, { color: t.fg }]}>New cards</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={10}
          style={s.done}
        >
          <Text style={[type.label, { color: t.accent }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[type.small, { color: t.fg2 }]}>
          Cards the assistant will be able to make: tabs, figures, charts, sliders, filters and forms that
          work together. Made-up data; nothing is saved.
        </Text>
        <View style={s.pick}>
          {DEMOS.map((d, i) => (
            <Tap
              key={d.title}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === which }}
              onPress={() => show(i, false)}
              haptic="selection"
              style={[s.pickItem, { backgroundColor: i === which ? t.fg : t.fill }]}
            >
              <Text style={[type.label, { fontSize: 14, color: i === which ? t.canvas : t.fg }]}>
                {d.title}
              </Text>
            </Tap>
          ))}
        </View>
        <View key={`${which}:${run}`}>
          {surface ? <A2uiSurface surface={surface} parts={A2UI_PARTS} /> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => show(which, true)}
          style={[s.again, { backgroundColor: t.fill }]}
        >
          <Text style={[type.label, { color: t.accent }]}>Build again, piece by piece</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  done: { minHeight: 44, justifyContent: "center" },
  body: { padding: 16, gap: 16 },
  pick: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pickItem: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: "center" },
  again: { minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
