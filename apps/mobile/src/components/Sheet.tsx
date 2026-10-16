// The one bottom sheet (decision 2026-10-15 "Feel: the ChatGPT bar"): every sheet and menu in
// the app comes up on a spring, the scrim fades in behind it, a drag down on its handle closes
// it (so does a tap outside, or Back on Android), and it keeps clear of the keyboard. Built on
// React Native's Modal so it sits over everything, including a pushed screen; the motion is
// Reanimated on the UI thread (Reduce Motion turns it into a plain appearance).
import { useEffect, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic, motion, radius, useTheme } from "@/theme";
import { useKeyboardRoom } from "@/keyboard";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** The panel's ground: the page tint (default), a white cell, or the dark ink (the assistant). */
  tone?: "page" | "cell" | "ink";
  /** Show the grab handle (default yes). */
  grab?: boolean;
  /** The panel keeps above the keyboard (sheets with a text box). */
  keyboard?: boolean;
  /** Inner padding (default 16). */
  padding?: number;
  /** Gap between the children (default 12). */
  gap?: number;
  /** At most this much of the screen (default 88%). */
  maxHeight?: number | `${number}%`;
  /** Runs once the sheet is on screen (a load). */
  onShow?: () => void;
  accessibilityLabel?: string;
}

const CLOSE_DRAG = 90;
const CLOSE_SPEED = 900;

export function Sheet({
  open,
  onClose,
  children,
  tone = "page",
  grab = true,
  keyboard = false,
  padding = 16,
  gap = 12,
  maxHeight = "88%",
  onShow,
  accessibilityLabel,
}: SheetProps) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const room = useKeyboardRoom();
  // Mounted while open, and for the slide-out after.
  const [shown, setShown] = useState(open);
  const y = useSharedValue(screenH);
  const scrim = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setShown(true);
      y.value = withSpring(0, motion.spring.sheet);
      scrim.value = withTiming(1, { duration: motion.fade });
    } else if (shown) {
      scrim.value = withTiming(0, { duration: motion.fade });
      y.value = withTiming(screenH, { duration: motion.enter }, (done) => {
        if (done) runOnJS(setShown)(false);
      });
    }
  }, [open, shown, y, scrim, screenH]);

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetY(-12)
    .onUpdate((e) => {
      // Follows the finger down; only a little way up, with resistance.
      y.value = e.translationY > 0 ? e.translationY : e.translationY / 6;
    })
    .onEnd((e) => {
      if (e.translationY > CLOSE_DRAG || e.velocityY > CLOSE_SPEED) {
        runOnJS(haptic)("selection");
        runOnJS(onClose)();
      } else y.value = withSpring(0, motion.spring.sheet);
    });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const bg = tone === "ink" ? t.ink : tone === "cell" ? t.cell : t.page;
  const bottomRoom = keyboard ? room : 0;

  if (!shown) return null;
  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      onShow={onShow}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={s.fill}>
        <View style={[s.fill, { paddingBottom: bottomRoom }]}>
          <Animated.View style={[s.scrimBox, scrimStyle]} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={[s.fill, { backgroundColor: t.shadow, opacity: 0.6 }]}
            />
          </Animated.View>
          <Animated.View
            accessibilityViewIsModal
            accessibilityLabel={accessibilityLabel}
            style={[
              s.panel,
              {
                backgroundColor: bg,
                maxHeight,
                padding,
                gap,
                paddingBottom: (bottomRoom ? 12 : insets.bottom + 16) + (padding - 16),
                shadowColor: t.shadow,
              },
              panelStyle,
            ]}
          >
            {grab ? (
              <GestureDetector gesture={pan}>
                <View style={s.grabHit} accessible accessibilityLabel="Drag down to close">
                  <View style={[s.grab, { backgroundColor: tone === "ink" ? t.onInk : t.fill2 }]} />
                </View>
              </GestureDetector>
            ) : null}
            {children}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  scrimBox: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  panel: {
    marginTop: "auto",
    alignSelf: "center",
    width: "100%",
    maxWidth: 640,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    ...(Platform.OS === "ios"
      ? { shadowOpacity: 1, shadowRadius: 24, shadowOffset: { width: 0, height: -4 } }
      : Platform.OS === "android"
        ? { elevation: 12 }
        : null),
  },
  // The handle's touch area spans the sheet's top, 24 points tall, so the drag is easy to find.
  grabHit: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 4,
    marginTop: -6,
    marginBottom: -4,
  },
  grab: { width: 40, height: 5, borderRadius: 3, opacity: 0.9 },
});
