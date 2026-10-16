// "Thinking": three dots that rise and fall in turn while the assistant answers (decision
// 2026-10-15 "Feel: the ChatGPT bar"). On the UI thread; still under Reduce Motion.
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "./theme.ts";

function Dot({ at, colour }: { at: number; colour: string }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(
      at * 140,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 260 }),
        ),
        -1,
      ),
    );
  }, [at, v]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * v.value,
    transform: [{ translateY: -3 * v.value }],
  }));
  return <Animated.View style={[s.dot, { backgroundColor: colour }, style]} />;
}

export function ThinkingDots({ colour }: { colour?: string }) {
  const { t } = useTheme();
  const c = colour ?? t.fg2;
  return (
    <View style={s.row} accessibilityLabel="Thinking" accessibilityRole="progressbar">
      <Dot at={0} colour={c} />
      <Dot at={1} colour={c} />
      <Dot at={2} colour={c} />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5, height: 20, paddingHorizontal: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
