// Room for the keyboard under a screen or sheet that reaches the bottom of the screen: the
// keyboard's height, taken from where its top edge is on the screen. Not measured from the view
// itself: inside an iPhone sheet a view's position comes back relative to the sheet, which left
// the message box half under the keyboard. A keyboard already up when the view appears (a box
// that focuses itself, like the chat opened from Help) counts too. Used as bottom padding.
import { useEffect, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";
import { useAnimatedKeyboard, useSharedValue, type SharedValue } from "react-native-reanimated";

const roomFor = (screenY: number) => Math.max(0, Math.round(Dimensions.get("screen").height - screenY));

export function useKeyboardRoom() {
  const [room, setRoom] = useState(() =>
    Platform.OS === "ios" ? roomFor(Keyboard.metrics()?.screenY ?? Dimensions.get("screen").height) : 0,
  );
  useEffect(() => {
    // Android resizes the window for the keyboard itself; the web has no keyboard events.
    if (Platform.OS !== "ios") return;
    const now = Keyboard.metrics();
    if (now) setRoom(roomFor(now.screenY));
    const subs = [
      Keyboard.addListener("keyboardWillShow", (e) => setRoom(roomFor(e.endCoordinates.screenY))),
      // Also after it settles (a keyboard that came up while this view was still appearing).
      Keyboard.addListener("keyboardDidShow", (e) => setRoom(roomFor(e.endCoordinates.screenY))),
      Keyboard.addListener("keyboardWillChangeFrame", (e) => setRoom(roomFor(e.endCoordinates.screenY))),
      Keyboard.addListener("keyboardWillHide", () => setRoom(0)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return room;
}

/**
 * The keyboard's height as it moves, frame by frame (iPhone), so something resting on it rises
 * with it instead of jumping to where the keyboard will end up (owner, 2026-10-17: "the search
 * bar should come up simultaneously with the keyboard"). Elsewhere 0: Android resizes the window
 * itself (the hook there would change how the window handles the keyboard), and the web has none.
 */
export const useKeyboardHeight: () => SharedValue<number> =
  Platform.OS === "ios" ? () => useAnimatedKeyboard().height : () => useSharedValue(0);
