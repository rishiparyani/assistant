// The card's menu (hold a card): ask about it, change its size, hand it to the chat to share,
// make a form or send on a schedule ("chat makes, screens use"), or take it off the home.
import { StyleSheet, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import { Text } from "@assistant/cards/native";
import { Tap } from "@assistant/cards/native";
import type { CardSize } from "@assistant/cards";
import { sizesFor, type HomeCard } from "../home.ts";
import { radius, useTheme } from "../theme.ts";

const SIZE_NAMES: Record<CardSize, string> = { xs: "Tiny", s: "Small", bar: "Strip", m: "Medium", l: "Tall" };

export interface MenuActions {
  ask: (card: HomeCard, prompt?: string) => void;
  resize: (card: HomeCard, size: CardSize) => void;
  unpin: (card: HomeCard) => void;
}

export function CardMenu({
  card,
  onClose,
  actions,
}: {
  card: HomeCard | null;
  onClose: () => void;
  actions: MenuActions;
}) {
  const { t, colour } = useTheme();
  if (!card) return null;
  const c = colour(card.colour);
  const sizes = sizesFor(card.spec);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  // A process card or something shared with me isn't a pinned view: nothing to resize, share
  // or take off.
  const rows: { label: string; onPress: () => void; danger?: boolean }[] =
    card.waiting || card.shared || card.memory
      ? [{ label: "Ask about this", onPress: run(() => actions.ask(card)) }]
      : [
          { label: "Ask about this", onPress: run(() => actions.ask(card)) },
          { label: "Share…", onPress: run(() => actions.ask(card, "Share this with ")) },
          {
            label: "Make a form from this…",
            onPress: run(() => actions.ask(card, "Make a form for this that asks for ")),
          },
          { label: "Send on a schedule…", onPress: run(() => actions.ask(card, "Send me this every ")) },
          { label: "Take off the home", onPress: run(() => actions.unpin(card)), danger: true },
        ];
  return (
    <Sheet open onClose={onClose} accessibilityLabel={`${card.spec.title} card`}>
      <View style={s.head}>
        <View style={[s.dot, { backgroundColor: c }]} />
        <Text style={[s.title, { color: t.fg }]} numberOfLines={1}>
          {card.spec.title}
        </Text>
      </View>
      {sizes.length > 1 && card.view ? (
        <View style={[s.sizes, { backgroundColor: t.fill }]}>
          {sizes.map((size) => {
            const on = size === card.spec.size;
            return (
              <Tap
                key={size}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${SIZE_NAMES[size]} card`}
                onPress={run(() => actions.resize(card, size))}
                haptic="selection"
                style={[s.size, on && [s.sizeOn, { backgroundColor: t.cell, shadowColor: t.shadow }]]}
              >
                <Text style={[s.sizeText, { color: on ? t.fg : t.fg2 }]}>{SIZE_NAMES[size]}</Text>
              </Tap>
            );
          })}
        </View>
      ) : null}
      <View style={[s.list, { backgroundColor: t.cell, borderColor: t.hair }]}>
        {rows.map((r, i) => (
          <Tap
            key={r.label}
            accessibilityRole="button"
            onPress={r.onPress}
            scale={1}
            dim={0.4}
            style={[s.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep }]}
          >
            <Text style={[s.rowText, { color: r.danger ? t.danger : t.fg }]}>{r.label}</Text>
          </Tap>
        ))}
      </View>
      <Tap
        accessibilityRole="button"
        onPress={onClose}
        scale={0.985}
        style={[s.cancel, { backgroundColor: t.cell, borderColor: t.hair }]}
      >
        <Text style={[s.rowText, { color: t.accent, fontWeight: "700" }]}>Cancel</Text>
      </Tap>
    </Sheet>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, minHeight: 28 },
  dot: { width: 10, height: 10, borderRadius: 3 },
  title: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  sizes: { flexDirection: "row", borderRadius: 12, padding: 3, gap: 3 },
  size: { flex: 1, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sizeOn: { shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  sizeText: { fontSize: 14, fontWeight: "600" },
  list: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16 },
  rowText: { fontSize: 16 },
  cancel: {
    minHeight: 48,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
