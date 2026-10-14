// Room for the keyboard under a screen or sheet: how far the keyboard reaches up over this
// view's bottom edge, measured when the keyboard comes up (not when the view first laid out,
// which inside a sheet still sliding in gives the wrong place). Used as bottom padding.
import { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, type View } from "react-native";

export function useKeyboardRoom() {
  const ref = useRef<View>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    // Android resizes the window for the keyboard itself; the web has no keyboard events.
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (e) => {
      const top = e.endCoordinates.screenY;
      const view = ref.current;
      if (!view) return setRoom(e.endCoordinates.height);
      view.measureInWindow((_x, y, _w, h) => setRoom(Math.max(0, Math.round(y + h - top))));
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setRoom(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return { ref, room };
}
