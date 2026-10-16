// Text in the app's typeface (decision 2026-10-13 "A warmer home": Manrope, as in the mock-up
// the owner chose). React Native picks a custom font by its face name, not by weight, so this
// maps each weight to its face; the app loads the faces at start (apps/mobile/app/_layout.tsx)
// and turns this on once they're in. Until then, and when a style names its own font, it's
// the system font, so nothing ever shows blank.
import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import {
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";

const FACES: Record<string, string> = {
  "400": "Manrope_400Regular",
  normal: "Manrope_400Regular",
  "500": "Manrope_500Medium",
  "600": "Manrope_600SemiBold",
  "700": "Manrope_700Bold",
  bold: "Manrope_700Bold",
  "800": "Manrope_800ExtraBold",
  "900": "Manrope_800ExtraBold",
};

let ready = false;
/** The faces are loaded: every Text from now on draws in them. */
export function setAppFont(loaded: boolean) {
  ready = loaded;
}

/** The face for a style's weight (what the app's Text and TextInput apply). */
export function faceOf(style: TextProps["style"]): TextStyle | null {
  if (!ready) return null;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (flat.fontFamily) return null;
  // The face carries the weight; "normal" stops the system from thickening it again.
  return { fontFamily: FACES[String(flat.fontWeight ?? "400")] ?? FACES["400"], fontWeight: "normal" };
}

export const Text = forwardRef<RNText, TextProps>(function Text(props, ref) {
  const face = faceOf(props.style);
  return <RNText ref={ref} {...props} style={face ? [props.style, face] : props.style} />;
});

/**
 * A text box in the app's typeface that keeps its own text (owner, 2026-10-16: iPhone
 * dictation wrote the sentence twice). A "controlled" box (the app setting `value` back on
 * every change) fights the keyboard while dictation is still adding words, so the words land
 * twice. This one is given `value` like any box, but only changes the app makes on its own
 * reach it: emptied after sending (cleared in place, the keyboard stays) or filled in (the
 * box starts again with that text, focused if it was). What the person types or dictates,
 * and the app's echo of it (even reshaped, like "a, b" kept as a list), never comes back.
 */
export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { value, defaultValue, onChangeText, autoFocus, ...props },
  ref,
) {
  const face = faceOf(props.style);
  const inner = useRef<RNTextInput | null>(null);
  const [boot, setBoot] = useState({ key: 0, text: value ?? defaultValue ?? "", focus: !!autoFocus });
  // What the box shows now, and whether a change came from it (this turn), not from the app.
  const shown = useRef(boot.text);
  const fromBox = useRef(false);
  useLayoutEffect(() => {
    if (value === undefined || value === shown.current) return;
    if (fromBox.current) return;
    shown.current = value;
    if (value === "" && inner.current) inner.current.clear();
    else setBoot((b) => ({ key: b.key + 1, text: value, focus: inner.current?.isFocused() ?? false }));
  }, [value]);
  return (
    <RNTextInput
      key={boot.key}
      ref={(r) => {
        inner.current = r;
        if (typeof ref === "function") ref(r);
        else if (ref) ref.current = r;
      }}
      {...props}
      defaultValue={boot.text}
      autoFocus={boot.focus}
      onChangeText={(t) => {
        shown.current = t;
        fromBox.current = true;
        // The app's answer to this change renders before a timer runs; after that, a new
        // `value` is the app's own again.
        setTimeout(() => {
          fromBox.current = false;
        }, 0);
        onChangeText?.(t);
      }}
      style={face ? [props.style, face] : props.style}
    />
  );
});
