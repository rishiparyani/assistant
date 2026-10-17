// The first-run tour (decision 2026-10-13 "Guide people, no presets"): a short walk over the
// home, each step lighting up the real thing it talks about (the chat bar, a card, the pages,
// search, help) with the rest dimmed. Shown once per person on this device; Help → "Take the
// tour again" brings it back. Skippable at every step. Nothing here changes any data.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "@assistant/cards/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { kv } from "@/storage";
import { useTheme } from "@/theme";

export type TourTarget = "chat" | "cards" | "pages" | "search" | "help";
type Rect = { x: number; y: number; w: number; h: number };
export interface TourStep {
  target: TourTarget | null;
  title: string;
  text: string;
}

const seenKey = (userId: string) => `tour:${userId}`;
/** Seen (or turned off for the simulator screenshots, which sign in through /test). */
export const tourSeen = (userId: string) => kv.get(seenKey(userId)) === "done" || kv.get("tour:off") === "1";
export const markTourSeen = (userId: string) => kv.set(seenKey(userId), "done");
export const resetTour = (userId: string) => {
  kv.remove(seenKey(userId));
  kv.remove("tour:off");
};
/** The test sign-in turns the tour off unless the screenshot is of the tour itself. */
export const setTourOff = (off: boolean) => (off ? kv.set("tour:off", "1") : kv.remove("tour:off"));

/** The steps for what this home has (no cards yet, one page, no assistant…). */
export function tourSteps(o: { assistant: boolean; cards: boolean; pages: boolean }): TourStep[] {
  const steps: TourStep[] = [
    {
      target: null,
      title: "Welcome to Gigspree",
      text: o.assistant
        ? "Your home builds itself from what you tell it: lists, cards, reminders. Here's a quick look around (under a minute)."
        : "This is where things people share with you show up. Here's a quick look around.",
    },
  ];
  if (o.assistant)
    steps.push({
      target: "chat",
      title: "Talk to it here",
      text: "Tell it about your week, add an expense, ask a question. Lists and cards appear as you go. With nothing typed, the button opens your chat and its past conversations.",
    });
  if (o.cards)
    steps.push({
      target: "cards",
      title: "These are cards",
      text: "Tap to open, or tick and switch things right on them. Hold one to resize it, move it to another page or take it off. The library (the grid button at the top) has every card to add back.",
    });
  if (o.pages)
    steps.push({
      target: "pages",
      title: "More pages",
      text: "Swipe sideways for your other pages. They are all yours: new cards land on the last one.",
    });
  steps.push({
    target: "search",
    title: "Find anything",
    text: "Type in the bar: your lists, cards and records appear as you type, with or without a connection. Press send to ask instead.",
  });
  steps.push({
    target: "help",
    title: "Help is here",
    text: "Take this tour again, see ideas for cards, or ask how to do something.",
  });
  if (o.assistant)
    steps.push({
      target: null,
      title: "Ask for any change",
      text: "“Make this card bigger”, “highlight the fee”, “remind me every Monday”. You say it, it's made, and anything that matters waits for your tap.",
    });
  return steps;
}

/** How far the dim layer reaches past the lit part: past any screen's edges. */
const SPAN = 3000;
/** Round buttons stay round, cards keep the card's corners. */
const radiusOf = (r: Rect) => Math.min(r.h / 2, r.w / 2, 24);

/** Where each target is on screen, measured when its step shows. */
export type TourRefs = Partial<Record<TourTarget, RefObject<View | null>>>;

export function Tour({
  steps,
  refs,
  onDone,
  onStart,
}: {
  steps: TourStep[];
  refs: TourRefs;
  onDone: () => void;
  /** The last step's button: start (e.g. "Tell me about your week"), when there is one. */
  onStart?: { label: string; go: () => void };
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // The step and its lit part change together: the next target is measured first, so the
  // bubble opens next to it instead of in the middle and then moving (owner, 2026-10-17).
  const [at, setAt] = useState<{ i: number; hole: Rect | null }>({ i: 0, hole: null });
  const { i, hole } = at;
  const step = steps[i]!;
  const last = i === steps.length - 1;
  const root = useRef<View>(null);

  // Where a step's target is, in this overlay's own coordinates (the overlay covers the home).
  const measure = useCallback(
    (n: number) =>
      new Promise<Rect | null>((done) => {
        const want = steps[n]?.target;
        const target = want ? refs[want]?.current : null;
        if (!target || !root.current) return done(null);
        root.current.measureInWindow((ox, oy) => {
          target.measureInWindow((x, y, w, h) => {
            if (!w || !h) return done(null);
            const pad = 6;
            // A tall target (the cards) is lit to the first screenful only.
            const hh = Math.min(h, height * 0.42);
            done({ x: x - ox - pad, y: y - oy - pad, w: w + pad * 2, h: hh + pad * 2 });
          });
        });
      }),
    [steps, refs, height],
  );
  // Only the latest request lands: a measurement still on its way when Next is pressed (or
  // from a resize) can't take the tour back a step.
  const latest = useRef(0);
  const go = useCallback(
    (n: number) => {
      const mine = ++latest.current;
      void measure(n).then((r) => {
        if (mine === latest.current) setAt({ i: n, hole: r });
      });
    },
    [measure],
  );
  // Again when the screen turns or resizes (the target moved).
  const shown = useRef(0);
  shown.current = i;
  useEffect(() => {
    const id = setTimeout(() => go(shown.current), 60);
    return () => clearTimeout(id);
  }, [go, width]);

  const next = () => (last ? onDone() : go(i + 1));
  const dim = "rgba(8,9,14,0.62)";
  // The bubble sits under the lit part when it's in the top half, else above it.
  const below = hole ? hole.y + hole.h / 2 < height / 2 : false;
  const bubbleTop = hole ? (below ? hole.y + hole.h + 12 : undefined) : undefined;
  const bubbleBottom = hole && !below ? height - hole.y + 12 : undefined;

  return (
    <View ref={root} style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      {hole ? (
        <>
          {/* One dim layer with a rounded hole: a view whose very wide border is the dim
              colour and whose inside is the lit part (no masking library needed). */}
          <View
            pointerEvents="none"
            style={[
              s.dim,
              {
                left: hole.x - SPAN,
                top: hole.y - SPAN,
                width: hole.w + SPAN * 2,
                height: hole.h + SPAN * 2,
                borderWidth: SPAN,
                borderColor: dim,
                borderRadius: radiusOf(hole) + SPAN,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              s.ring,
              {
                top: hole.y,
                left: hole.x,
                width: hole.w,
                height: hole.h,
                borderColor: t.accent,
                borderRadius: radiusOf(hole),
              },
            ]}
          />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: dim }]} />
      )}
      <View
        style={[
          s.bubble,
          { backgroundColor: t.cell, borderColor: t.hair, maxWidth: Math.min(width - 32, 420) },
          hole
            ? {
                position: "absolute",
                left: 16,
                right: 16,
                alignSelf: "center",
                top: bubbleTop,
                bottom: bubbleBottom,
              }
            : { position: "absolute", left: 16, right: 16, top: insets.top + height * 0.28 },
        ]}
        accessibilityLiveRegion="polite"
      >
        <Text style={[s.count, { color: t.accent }]}>
          {i + 1} of {steps.length}
        </Text>
        <Text style={[s.title, { color: t.fg }]}>{step.title}</Text>
        <Text style={[s.text, { color: t.fg2 }]}>{step.text}</Text>
        <View style={s.buttons}>
          {!last ? (
            <Pressable accessibilityRole="button" onPress={onDone} hitSlop={10} style={s.skip}>
              <Text style={[s.skipText, { color: t.fg2 }]}>Skip</Text>
            </Pressable>
          ) : null}
          {last && onStart ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onDone();
                onStart.go();
              }}
              style={[s.btn, { backgroundColor: t.accent }]}
            >
              <Text style={[s.btnText, { color: t.onAccent }]}>{onStart.label}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={next}
            style={[s.btn, { backgroundColor: last && onStart ? t.fill : t.accent }]}
          >
            <Text style={[s.btnText, { color: last && onStart ? t.fg : t.onAccent }]}>
              {last ? "Done" : i === 0 ? "Show me" : "Next"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  dim: { position: "absolute" },
  ring: { position: "absolute", borderWidth: 2, borderRadius: 20 },
  bubble: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  count: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  title: { fontSize: 19, fontWeight: "800", letterSpacing: -0.4 },
  text: { fontSize: 15, lineHeight: 21 },
  buttons: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 8 },
  skip: { paddingHorizontal: 8, height: 44, justifyContent: "center", marginRight: "auto" },
  skipText: { fontSize: 15, fontWeight: "600" },
  btn: { paddingHorizontal: 18, height: 44, borderRadius: 22, justifyContent: "center" },
  btnText: { fontSize: 15, fontWeight: "700" },
});
