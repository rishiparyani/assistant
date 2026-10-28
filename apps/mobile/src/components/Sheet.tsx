// The one bottom sheet (decision 2026-10-15 "Feel: the ChatGPT bar"; 2026-10-23 "Sheets the
// iOS way"): every sheet and menu in the app comes up on a spring over a scrim and behaves
// like an iOS sheet: a short one sits at its own height; a tall one opens at half the screen
// and a pull up anywhere on it takes it to nearly full; a pull down past the half mark, or a
// tap outside, or Back on Android, closes it; scrolling the content and moving the sheet are
// one gesture (the sheet moves once the content is at its top). Built on @gorhom/bottom-sheet
// for the gesture hand-off, the stops and the keyboard; hosted in React Native's Modal so it
// sits over everything, including a pushed or modal screen; the look (radius, tones, handle)
// is ours.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, StyleSheet, useWindowDimensions } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic, radius, useTheme } from "@/theme";
import { useKeyboardRoom } from "@/keyboard";
import { afterModals, modalLeaving } from "@/modals";

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

/** The half-screen stop a tall sheet opens at. */
const HALF = 0.5;

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
  const ref = useRef<BottomSheet>(null);
  // Mounted while open, and for the slide-out after (the sheet says when it's off screen).
  const [shown, setShown] = useState(open);
  const closing = useRef(false);
  // iOS: after it slides out the modal stays (hidden) until iOS says it's gone, and others wait
  // for that (`@/modals`): one modal at a time.
  const [leaving, setLeaving] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const startLeaving = () => {
    if (release.current || Platform.OS !== "ios") return;
    release.current = modalLeaving();
  };
  const gone = () => {
    setLeaving(false);
    release.current?.();
    release.current = null;
  };
  const openNow = useRef(open);
  openNow.current = open;
  // Taken off the screen before it was gone (the screen went away): others mustn't wait for it.
  useEffect(
    () => () => {
      release.current?.();
      release.current = null;
    },
    [],
  );
  // `onShow` runs once per opening, not again when the sheet moves between its stops (a load
  // that also resets what the person picked would lose it on a resize).
  const showed = useRef(false);
  // The keyboard's height on the iPhone (0 elsewhere): a sheet with a text box rises by it.
  // The library's own keyboard handling only knows inputs it registers itself, which ours
  // (the cards' TextInput) aren't, so the lift is done here as before.
  const room = useKeyboardRoom();
  const lift = keyboard ? room : 0;
  // What it showed when open stays in it as it slides out: a sheet whose content goes with the
  // thing it shows (a card closed to null) emptied at once and dropped as a bare strip (owner,
  // 2026-10-19: "closing some cards is not that smooth").
  const last = useRef(children);
  if (open) last.current = children;
  // Taller than half the screen: two stops (half, then as tall as it gets); else one, its own.
  const [tall, setTall] = useState<boolean | null>(null);
  const maxPx = typeof maxHeight === "number" ? maxHeight : (screenH * parseFloat(maxHeight)) / 100;
  const bottomPad = (lift ? 12 : insets.bottom + 16) + (padding - 16);
  const chrome = (grab ? 24 : 0) + padding + bottomPad;

  useEffect(() => {
    if (open) {
      // Once any other modal has gone (and only if it's still meant to be open by then).
      afterModals(() => {
        if (!openNow.current) return;
        closing.current = false;
        showed.current = false;
        setTall(null);
        setShown(true);
      });
    } else if (shown && !closing.current) {
      closing.current = true;
      startLeaving();
      ref.current?.close();
    }
  }, [open, shown]);

  const halfPoint = useMemo(() => [`${HALF * 100}%`], []);
  // While the sheet is between its stops (a drag, an animation) the content takes no taps: a
  // pull that starts on a row must never end as that row's tap (the website doesn't cancel the
  // press the way the phone does once the drag takes over).
  const index = useSharedValue(0);
  const guard = useAnimatedStyle(() => ({
    pointerEvents: Math.abs(index.value - Math.round(index.value)) > 0.001 ? "none" : "auto",
  }));
  const bg = tone === "ink" ? t.ink : tone === "cell" ? t.cell : t.page;
  const handle = tone === "ink" ? t.onInk : t.fill2;

  if (!shown && !leaving) return null;
  return (
    <Modal
      visible={shown}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onDismiss={gone}
      statusBarTranslucent
    >
      {shown ? (
        <GestureHandlerRootView style={s.fill}>
          <BottomSheet
            ref={ref}
            index={0}
            // Measured content adds its own stop; until it's known, half is assumed, so a short
            // sheet's first frame is its own height and a tall one's is half.
            snapPoints={tall === false ? undefined : halfPoint}
            enableDynamicSizing
            maxDynamicContentSize={Math.max(160, maxPx - lift)}
            bottomInset={lift}
            enablePanDownToClose
            // On the website a drag that starts on a row would end as that row's tap (the phone
            // cancels the press once the drag takes over; the browser doesn't), so there the
            // sheet moves from its handle only; the content still scrolls.
            enableContentPanningGesture={Platform.OS !== "web"}
            animatedIndex={index}
            onClose={() => {
              // Off screen: by a pull down, a tap outside, or `open` going false. On iOS the
              // hidden modal waits for iOS to say it's gone (onDismiss).
              startLeaving();
              if (Platform.OS === "ios") setLeaving(true);
              setShown(false);
              if (!closing.current) {
                closing.current = true;
                haptic("selection");
                onClose();
              }
            }}
            onChange={(index) => {
              if (index >= 0 && !showed.current) {
                showed.current = true;
                onShow?.();
              }
            }}
            backdropComponent={Backdrop}
            handleComponent={grab ? undefined : null}
            handleIndicatorStyle={[s.grab, { backgroundColor: handle }]}
            handleStyle={s.handle}
            backgroundStyle={[s.panel, { backgroundColor: bg, shadowColor: t.shadow }]}
            style={s.sheet}
            android_keyboardInputMode="adjustResize"
          >
            <BottomSheetScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                padding,
                paddingTop: grab ? Math.max(padding - 8, 4) : padding,
                paddingBottom: bottomPad,
              }}
              onLayout={(e) => {
                if (tall === null) setTall(e.nativeEvent.layout.height + chrome > screenH * HALF);
              }}
              accessibilityViewIsModal
              accessibilityLabel={accessibilityLabel}
            >
              <Animated.View style={[guard, { gap }]}>{open ? children : last.current}</Animated.View>
            </BottomSheetScrollView>
          </BottomSheet>
        </GestureHandlerRootView>
      ) : null}
    </Modal>
  );
}

/** The scrim: fades with the sheet; a tap on it closes. */
function Backdrop(props: BottomSheetBackdropProps) {
  const { t } = useTheme();
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={0.6}
      pressBehavior="close"
      style={[props.style, { backgroundColor: t.shadow }]}
    />
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { width: "100%", maxWidth: 640, alignSelf: "center" },
  panel: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    ...(Platform.OS === "ios"
      ? { shadowOpacity: 1, shadowRadius: 24, shadowOffset: { width: 0, height: -4 } }
      : Platform.OS === "android"
        ? { elevation: 12 }
        : null),
  },
  // The handle's touch area spans the sheet's top, so the drag is easy to find (and the whole
  // sheet drags anyway).
  handle: { paddingTop: 8, paddingBottom: 6 },
  grab: { width: 40, height: 5, borderRadius: 3, opacity: 0.9 },
});
