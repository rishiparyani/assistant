// One iOS modal at a time (owner, 2026-10-28: "New, then Space… didn't open anything and it's
// hung now"): iOS can't show a modal while another is still going away, and React Native then
// believes the new one is up, so nothing opens after it. Sheets and the chat say when they start
// going and when they're gone; anything opening a modal waits for them here. Elsewhere it runs
// at once.
import { Platform } from "react-native";

let leaving = 0;
const waiting: (() => void)[] = [];
/** Past this a modal counts as gone even if iOS never said so: nothing waits forever. */
const AT_MOST_MS = 1500;

/**
 * A modal started going away (iOS). Call what it returns once it's gone; calling it again does
 * nothing, and it calls itself after a moment in case iOS never says.
 */
export function modalLeaving(): () => void {
  if (Platform.OS !== "ios") return () => {};
  leaving++;
  let done = false;
  const gone = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    leaving = Math.max(0, leaving - 1);
    if (!leaving) for (const f of waiting.splice(0)) f();
  };
  const timer = setTimeout(gone, AT_MOST_MS);
  return gone;
}

/**
 * Runs `f` once no modal is going away. On iOS a tick later, so a sheet closed by the same tap
 * (its `open` turned false in this render) has said it's leaving first.
 */
export function afterModals(f: () => void) {
  if (Platform.OS !== "ios") return f();
  setTimeout(() => (leaving ? waiting.push(f) : f()), 0);
}
