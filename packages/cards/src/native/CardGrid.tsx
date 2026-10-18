// The cards of one page, laid out by the app (docs/design/home-first.md §2.3): the model never
// positions anything. Hold a card for its menu; on the person's pages, hold and move to arrange:
// the card lifts and follows the finger, the others slide to make room, the order is saved on
// drop. The grid places every card itself (rows of half- or full-width cards), so a card's
// element never moves while a finger is on it.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { HomeCard } from "./model.ts";
import { radius, useTheme } from "./theme.ts";

export type Rect = { x: number; y: number; w: number; h: number };
export const CARD_GAP = 10;
/** One cell is 156 tall; xs and bar are half of it (two of them stack in a cell's height). */
const CELL = 156;
const HALF = (CELL - CARD_GAP) / 2;
export const cardHeight = (card: HomeCard) =>
  card.spec.size === "l"
    ? CELL * 2 + CARD_GAP
    : card.spec.size === "xs" || card.spec.size === "bar"
      ? HALF
      : CELL;
/** A phone page has 2 columns; a laptop 4 (home-first.md §3 grid). XS and S take one; the rest two. */
export const columnsFor = (width: number) => (width >= 860 ? 4 : 2);
export const cardWidth = (card: HomeCard, width: number, cols = columnsFor(width)) => {
  const unit = Math.floor((width - CARD_GAP * (cols - 1)) / cols);
  const narrow = card.spec.size === "s" || card.spec.size === "xs";
  return narrow || cols === 1 ? unit : cols === 2 ? width : unit * 2 + CARD_GAP;
};

const HOLD_MS = 380;
const MOVE_PX = 6;
const SPRING = { damping: 18, stiffness: 220, mass: 0.6 };
const SETTLE = { damping: 20, stiffness: 260, mass: 0.7 };

/**
 * A card that takes the whole width (a phone's M and L): nothing sits beside it, so it can be
 * exactly as tall as what it shows (owner, 2026-10-18: a table with empty space under it, a
 * list cut off) instead of a whole number of cells.
 */
export const isNatural = (card: HomeCard, width: number) =>
  (card.spec.size === "m" || card.spec.size === "l") && cardWidth(card, width) >= width;

/** How many half-cell rows a card takes: xs and bar one, s and m two, l four. */
const halves = (card: HomeCard) =>
  card.spec.size === "l" ? 4 : card.spec.size === "xs" || card.spec.size === "bar" ? 1 : 2;

/**
 * Where each card goes, in order: the first place (top first, then left) where it fits on a
 * grid of columns × half-cell rows. Two half-height cards stack in one cell, so a tiny card
 * next to a small one leaves no hole.
 */
export function layoutCards(
  cards: HomeCard[],
  width: number,
  /** Measured heights of the full-width cards (until measured, their size's height). */
  measured: Record<string, number> = {},
): { rects: Map<string, Rect>; height: number } {
  const rects = new Map<string, Rect>();
  const cols = columnsFor(width);
  const unit = Math.floor((width - CARD_GAP * (cols - 1)) / cols);
  let taken: boolean[][] = [];
  const free = (r: number, c: number) => !taken[r]?.[c];
  let bottom = 0;
  // Where the cells start: under the last full-width card (the cells after it never go above it).
  let origin = 0;
  for (const card of cards) {
    if (isNatural(card, width)) {
      const y = bottom ? bottom + CARD_GAP : 0;
      const h = Math.max(HALF, Math.ceil(measured[card.id] ?? cardHeight(card)));
      rects.set(card.id, { x: 0, y, w: width, h });
      bottom = y + h;
      origin = bottom + CARD_GAP;
      taken = [];
      continue;
    }
    const w = cardWidth(card, width);
    const span = Math.min(cols, Math.round((w + CARD_GAP) / (unit + CARD_GAP)));
    const rows = halves(card);
    let placed = false;
    for (let r = 0; !placed; r++) {
      for (let c = 0; c + span <= cols && !placed; c++) {
        let fits = true;
        for (let dr = 0; dr < rows && fits; dr++)
          for (let dc = 0; dc < span && fits; dc++) fits = free(r + dr, c + dc);
        if (!fits) continue;
        for (let dr = 0; dr < rows; dr++)
          for (let dc = 0; dc < span; dc++) (taken[r + dr] ??= [])[c + dc] = true;
        const y = origin + r * (HALF + CARD_GAP);
        const h = cardHeight(card);
        rects.set(card.id, { x: c * (unit + CARD_GAP), y, w, h });
        bottom = Math.max(bottom, y + h);
        placed = true;
      }
    }
  }
  return { rects, height: bottom };
}

export function CardGrid({
  cards,
  width,
  arrangeable,
  renderCard,
  onHold,
  onReorder,
  onDrop,
}: {
  cards: HomeCard[];
  width: number;
  /** The person's page: hold and move arranges. The Now page only shows the menu. */
  arrangeable: boolean;
  /**
   * `canOpen` is false right after a hold, so letting go of a lifted card never opens it.
   * `natural`: draw it as tall as its content (the grid measures it and makes room).
   */
  renderCard: (card: HomeCard, canOpen: () => boolean, natural: boolean) => ReactNode;
  onHold: (card: HomeCard) => void;
  onReorder?: (from: number, to: number) => void;
  onDrop?: () => void;
}) {
  const { t } = useTheme();
  // The full-width cards' own heights, as drawn.
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const measure = useCallback((id: string, h: number) => {
    setMeasured((m) => (Math.abs((m[id] ?? 0) - h) < 1 ? m : { ...m, [id]: h }));
  }, []);
  const { rects, height } = useMemo(() => layoutCards(cards, width, measured), [cards, width, measured]);
  // Elements keep the order they first appeared in; only their places change.
  const stable = useRef<string[]>([]);
  const ids = new Set(cards.map((c) => c.id));
  stable.current = [
    ...stable.current.filter((id) => ids.has(id)),
    ...cards.filter((c) => !stable.current.includes(c.id)).map((c) => c.id),
  ];
  const byId = new Map(cards.map((c) => [c.id, c]));

  // When a card was last held: a tap that ends a hold is not a tap (the web's touch system
  // would otherwise still count it as one).
  const heldAt = useRef(0);
  const canOpen = useCallback(() => Date.now() - heldAt.current > 800, []);
  const held = useCallback(
    (card: HomeCard) => {
      heldAt.current = Date.now();
      onHold(card);
    },
    [onHold],
  );

  const [dragging, setDragging] = useState<{ card: HomeCard; start: Rect } | null>(null);
  // The gesture callbacks read these through refs: a running gesture keeps its first closures.
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const rectsRef = useRef(rects);
  rectsRef.current = rects;
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);

  const lift = useCallback(
    (card: HomeCard) => {
      const start = rectsRef.current.get(card.id);
      if (!start) return;
      heldAt.current = Date.now();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      tx.value = 0;
      ty.value = 0;
      scale.value = withSpring(1.05, SPRING);
      draggingRef.current = { card, start };
      setDragging({ card, start });
    },
    [tx, ty, scale],
  );

  // Where the finger is now decides which place the card takes; the others move aside.
  const hover = useCallback(
    (card: HomeCard, start: Rect, dx: number, dy: number) => {
      const cx = start.x + start.w / 2 + dx;
      const cy = start.y + start.h / 2 + dy;
      const list = cardsRef.current;
      const from = list.findIndex((c) => c.id === card.id);
      const to = list.findIndex((c) => {
        const r = rectsRef.current.get(c.id);
        return r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
      });
      if (from >= 0 && to >= 0 && to !== from) {
        void Haptics.selectionAsync().catch(() => undefined);
        onReorder?.(from, to);
      }
    },
    [onReorder],
  );

  const settle = useCallback(
    (card: HomeCard, start: Rect) => {
      // Into its place (wherever that is now), then the real card shows again.
      const r = rectsRef.current.get(card.id) ?? start;
      const done = () => {
        draggingRef.current = null;
        setDragging(null);
        onDrop?.();
      };
      scale.value = withTiming(1, { duration: 120 });
      tx.value = withSpring(r.x - start.x, SETTLE);
      ty.value = withSpring(r.y - start.y, SETTLE, (finished) => {
        if (finished) runOnJS(done)();
      });
    },
    [tx, ty, scale, onDrop],
  );

  const move = useCallback(
    (dx: number, dy: number) => {
      tx.value = dx;
      ty.value = dy;
      const d = draggingRef.current;
      if (d) hover(d.card, d.start, dx, dy);
    },
    [tx, ty, hover],
  );
  const release = useCallback(
    (moved: boolean) => {
      const d = draggingRef.current;
      if (!d) return;
      heldAt.current = Date.now();
      if (moved) settle(d.card, d.start);
      else {
        draggingRef.current = null;
        setDragging(null);
        onHold(d.card);
      }
    },
    [settle, onHold],
  );
  // The system took the touch away (a call, a parent gesture): the card goes back into its
  // place (the order it reached so far stays), and no menu opens.
  const cancel = useCallback(() => {
    const d = draggingRef.current;
    if (!d) return;
    heldAt.current = Date.now();
    settle(d.card, d.start);
  }, [settle]);

  const overlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <View style={[s.grid, { width, height }]}>
      {stable.current.map((id) => {
        const card = byId.get(id);
        const rect = rects.get(id);
        if (!card || !rect) return null;
        return (
          <Slot
            key={id}
            order={stable.current.indexOf(id)}
            card={card}
            rect={rect}
            hidden={dragging?.card.id === id}
            arrangeable={arrangeable}
            onHold={held}
            lift={lift}
            move={move}
            release={release}
            cancel={cancel}
            placeholderColour={t.fg3}
            onMeasure={isNatural(card, width) ? measure : undefined}
          >
            {renderCard(card, canOpen, isNatural(card, width))}
          </Slot>
        );
      })}
      {dragging ? (
        <Animated.View
          pointerEvents="none"
          style={[
            s.overlay,
            {
              left: dragging.start.x,
              top: dragging.start.y,
              width: dragging.start.w,
              height: dragging.start.h,
              shadowColor: t.shadow,
            },
            overlayStyle,
          ]}
        >
          {renderCard(dragging.card, () => false, isNatural(dragging.card, width))}
        </Animated.View>
      ) : null}
    </View>
  );
}

function Slot({
  order,
  card,
  rect,
  hidden,
  arrangeable,
  onHold,
  lift,
  move,
  release,
  cancel,
  placeholderColour,
  onMeasure,
  children,
}: {
  /** Its place among the cards when it first shows (how long it waits to rise in). */
  order: number;
  card: HomeCard;
  rect: Rect;
  hidden: boolean;
  arrangeable: boolean;
  onHold: (card: HomeCard) => void;
  lift: (card: HomeCard) => void;
  move: (dx: number, dy: number) => void;
  release: (moved: boolean) => void;
  cancel: () => void;
  placeholderColour: string;
  /** A full-width card: report how tall it draws itself. */
  onMeasure?: (id: string, height: number) => void;
  children: ReactNode;
}) {
  // The place slides when the order changes (not on first show).
  const left = useSharedValue(rect.x);
  const top = useSharedValue(rect.y);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      left.value = rect.x;
      top.value = rect.y;
    } else {
      left.value = withSpring(rect.x, SETTLE);
      top.value = withSpring(rect.y, SETTLE);
    }
  }, [rect.x, rect.y, left, top]);
  // A card rises in the first time it shows, the next one a moment later (the motion demo).
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withDelay(Math.min(order, 8) * 60, withSpring(1, { damping: 18, stiffness: 170 }));
    // Only on first show: later order changes slide instead (above).
  }, []);
  const place = useAnimatedStyle(() => ({
    left: left.value,
    top: top.value,
    opacity: Math.min(1, shown.value * 1.4),
    transform: [{ translateY: (1 - shown.value) * 20 }],
  }));

  const moved = useSharedValue(false);
  // Hold: the card lifts. Let go without moving: its menu. Move: it follows the finger.
  const pan = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .enabled(arrangeable)
    .onStart(() => {
      moved.value = false;
      runOnJS(lift)(card);
    })
    .onUpdate((e) => {
      if (!moved.value && Math.hypot(e.translationX, e.translationY) > MOVE_PX) moved.value = true;
      if (moved.value) runOnJS(move)(e.translationX, e.translationY);
    })
    .onEnd(() => {
      runOnJS(release)(moved.value);
    })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(cancel)();
    });
  const hold = Gesture.LongPress()
    .minDuration(HOLD_MS)
    .enabled(!arrangeable)
    .onStart(() => {
      runOnJS(onHold)(card);
    });
  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, hold)}>
      <Animated.View style={[s.slot, { width: rect.w, height: rect.h }, place]}>
        {hidden ? (
          <View style={[StyleSheet.absoluteFill, s.placeholder, { borderColor: placeholderColour }]} />
        ) : null}
        {/* Lifted: the card under the finger takes no tap, so letting go never opens it. */}
        <View
          style={[onMeasure ? null : s.fill, hidden && { opacity: 0 }]}
          pointerEvents={hidden ? "none" : "auto"}
          onLayout={onMeasure ? (e) => onMeasure(card.id, e.nativeEvent.layout.height) : undefined}
        >
          {children}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  grid: { position: "relative" },
  slot: { position: "absolute" },
  fill: { flex: 1 },
  placeholder: { borderRadius: radius.card, borderWidth: 1.5, borderStyle: "dashed", opacity: 0.6 },
  overlay: {
    position: "absolute",
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
});
