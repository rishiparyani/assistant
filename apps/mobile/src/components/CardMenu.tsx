// The card's menu (hold a card): ask about it, change its size, hand it to the chat to share,
// make a form or send on a schedule ("chat makes, screens use"), or take it off the home.
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CardSize } from "@assistant/cards";
import { sizesFor, type HomeCard } from "../home.ts";
import { radius, useTheme } from "../theme.ts";

const SIZE_NAMES: Record<CardSize, string> = { s: "Small", m: "Medium", l: "Tall" };

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
  const insets = useSafeAreaInsets();
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
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.backdrop} />
      <View style={[s.sheet, { backgroundColor: t.page, paddingBottom: insets.bottom + 12 }]}>
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
                <Pressable
                  key={size}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${SIZE_NAMES[size]} card`}
                  onPress={run(() => actions.resize(card, size))}
                  style={[s.size, on && [s.sizeOn, { backgroundColor: t.cell, shadowColor: t.shadow }]]}
                >
                  <Text style={[s.sizeText, { color: on ? t.fg : t.fg2 }]}>{SIZE_NAMES[size]}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={[s.list, { backgroundColor: t.cell, borderColor: t.hair }]}>
          {rows.map((r, i) => (
            <Pressable
              key={r.label}
              accessibilityRole="button"
              onPress={r.onPress}
              style={({ pressed }) => [
                s.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
                pressed && { backgroundColor: t.fill },
              ]}
            >
              <Text style={[s.rowText, { color: r.danger ? t.danger : t.fg }]}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [
            s.cancel,
            { backgroundColor: t.cell, borderColor: t.hair, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[s.rowText, { color: t.accent, fontWeight: "700" }]}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 16,
    gap: 12,
  },
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
