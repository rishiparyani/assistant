// The tick box on list rows (decision 2026-10-13 "A warmer home", as in the mock-up): a soft
// rounded square, filled in the accent with a white check when done. Ticking it pops: the box
// springs a little bigger and fills, the check grows in (the motion demo the owner approved).
// With Reduce Motion on, Reanimated skips the motion and it simply changes.
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "./theme.ts";

export function Tick({ done }: { done: boolean }) {
  const { t } = useTheme();
  const on = useSharedValue(done ? 1 : 0);
  const pop = useSharedValue(1);
  useEffect(() => {
    on.value = withTiming(done ? 1 : 0, { duration: 180 });
    if (done) pop.value = withSequence(withTiming(1.16, { duration: 110 }), withSpring(1, { damping: 9 }));
  }, [done, on, pop]);
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [t.cell, t.accent]),
    borderColor: interpolateColor(on.value, [0, 1], [t.fill2, t.accent]),
    transform: [{ scale: pop.value }],
  }));
  const check = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scale: 0.4 + on.value * 0.6 }] }));
  return (
    <Animated.View style={[s.box, box]}>
      <Animated.Text style={[s.check, { color: t.onAccent }, check]}>✓</Animated.Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  check: { fontSize: 14, fontWeight: "800", lineHeight: 16 },
});
