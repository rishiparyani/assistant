// Placeholder cards while the real ones load (decision 2026-10-16 "Chats like Claude", the
// home's first frame): soft blocks that breathe, never a blank page or a spinner.
import { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { radius, useTheme } from "./theme.ts";

/** A few card-shaped blocks, breathing, in the given heights. */
export function Skeleton({
  heights = [132, 96, 96],
  style,
}: {
  heights?: number[];
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTheme();
  const breath = useSharedValue(0.55);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [breath]);
  const anim = useAnimatedStyle(() => ({ opacity: breath.value }));
  return (
    <Animated.View style={[s.col, anim, style]} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {heights.map((h, i) => (
        <View key={i} style={[s.block, { height: h, backgroundColor: t.cell, borderColor: t.hair }]}>
          <View style={[s.line, { width: "42%", backgroundColor: t.fill }]} />
          <View style={[s.line, { width: "68%", backgroundColor: t.fill }]} />
        </View>
      ))}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  col: { gap: 12 },
  block: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  line: { height: 12, borderRadius: 6 },
});
