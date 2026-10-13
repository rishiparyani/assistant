// Text in the app's typeface (decision 2026-10-13 "A warmer home": Manrope, as in the mock-up
// the owner chose). React Native picks a custom font by its face name, not by weight, so this
// maps each weight to its face; the app loads the faces at start (apps/mobile/app/_layout.tsx)
// and turns this on once they're in. Until then, and when a style names its own font, it's
// the system font, so nothing ever shows blank.
import { forwardRef } from "react";
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

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(props, ref) {
  const face = faceOf(props.style);
  return <RNTextInput ref={ref} {...props} style={face ? [props.style, face] : props.style} />;
});
