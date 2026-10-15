// Press feedback (decision 2026-10-15 "Feel: the ChatGPT bar"): everything tappable shrinks a
// touch and dims the moment a finger lands, on the UI thread, and springs back on release.
// One primitive, so every button, chip, row and card answers the same way. A haptic tick is
// opt-in (`haptic`), for the taps that change something. Reduce Motion stops the shrink.
import { forwardRef, useCallback } from "react";
import {
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { motion } from "./theme.ts";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type Haptic = "selection" | "light" | "medium";

/** A haptic tick, where the platform has one; silent elsewhere (the web, simulators). */
export function haptic(kind: Haptic = "selection") {
  const go =
    kind === "selection"
      ? Haptics.selectionAsync()
      : Haptics.impactAsync(
          kind === "light" ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
        );
  void go.catch(() => undefined);
}

export interface TapProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** How far it shrinks when pressed (1 = not at all); the token by default. */
  scale?: number;
  /** How much it dims when pressed (0 = not at all). */
  dim?: number;
  /** A haptic tick on press. */
  haptic?: Haptic;
}

/** A Pressable with the app's press feedback. Use it wherever a Pressable would go. */
export const Tap = forwardRef<View, TapProps>(function Tap(
  {
    style,
    scale = motion.pressScale,
    dim = 0.12,
    haptic: tick,
    onPressIn,
    onPressOut,
    onPress,
    disabled,
    ...rest
  },
  ref,
) {
  const down = useSharedValue(0);
  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - scale) * down.value }],
    opacity: 1 - dim * down.value,
  }));
  const pressIn = useCallback(
    (e: GestureResponderEvent) => {
      down.value = withSpring(1, motion.spring.press);
      onPressIn?.(e);
    },
    [down, onPressIn],
  );
  const pressOut = useCallback(
    (e: GestureResponderEvent) => {
      down.value = withSpring(0, motion.spring.press);
      onPressOut?.(e);
    },
    [down, onPressOut],
  );
  const press = useCallback(
    (e: GestureResponderEvent) => {
      if (tick) haptic(tick);
      onPress?.(e);
    },
    [tick, onPress],
  );
  return (
    <AnimatedPressable
      ref={ref}
      {...rest}
      disabled={disabled}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={press}
      style={[style, disabled ? { opacity: 0.5 } : null, anim]}
    />
  );
});
