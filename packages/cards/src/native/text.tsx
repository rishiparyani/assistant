// Text in the app's typeface (decision 2026-10-13 "A warmer home": Manrope, as in the mock-up
// the owner chose). React Native picks a custom font by its face name, not by weight, so this
// maps each weight to its face; the app loads the faces at start (apps/mobile/app/_layout.tsx)
// and turns this on once they're in. Until then, and when a style names its own font, it's
// the system font, so nothing ever shows blank.
import { forwardRef, useId, useLayoutEffect, useRef, useState } from "react";
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  View,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";
import { useTheme } from "./theme.ts";

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
export const TextInput = forwardRef<
  RNTextInput,
  TextInputProps & {
    /**
     * A "Done" bar over the iPhone keyboard that closes it (owner, 2026-10-19: "When the
     * keyboard is open, how to close it?"): the iPhone keyboard has no key for that, and the
     * number pad has no return key at all. On by default for one-line boxes; the chat and the
     * home's bar (they send) leave it out.
     */
    doneBar?: boolean;
    /**
     * Grows with what's written, a line at a time, up to this many points tall, then scrolls
     * inside (owner, 2026-11-01: "I can see only one at a time… make it behave more like
     * Claude"). Measured by an unseen copy of the text in the same type and width, so it works
     * the same on the iPhone, Android and the web (the iPhone's own sizing kept one line).
     */
    grow?: number;
  }
>(function TextInput({ value, defaultValue, onChangeText, autoFocus, doneBar, grow, ...props }, ref) {
  const face = faceOf(props.style);
  const { t } = useTheme();
  const barId = `done-${useId()}`;
  const withBar = Platform.OS === "ios" && (doneBar ?? !props.multiline);
  const inner = useRef<RNTextInput | null>(null);
  const [boot, setBoot] = useState({ key: 0, text: value ?? defaultValue ?? "", focus: !!autoFocus });
  // What the box shows now, and whether a change came from it (this turn), not from the app.
  const shown = useRef(boot.text);
  const fromBox = useRef(false);
  // A growing box: the words it holds now, and how tall they are in its type and width.
  const [words, setWords] = useState(boot.text);
  const [tall, setTall] = useState(0);
  useLayoutEffect(() => {
    if (value === undefined || value === shown.current) return;
    if (fromBox.current) return;
    shown.current = value;
    if (grow) setWords(value);
    if (value === "" && inner.current) inner.current.clear();
    else setBoot((b) => ({ key: b.key + 1, text: value, focus: inner.current?.isFocused() ?? false }));
  }, [value]);
  const box = (
    <RNTextInput
      key={boot.key}
      inputAccessoryViewID={withBar ? barId : props.inputAccessoryViewID}
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
        if (grow) setWords(t);
        onChangeText?.(t);
      }}
      style={grow ? [innerOf(props.style), face, sized(props.style, tall, grow)] : [props.style, face]}
    />
  );
  const field = grow ? (
    <View style={outerOf(props.style)}>
      {/* The unseen copy: same type, padding and width, any height. A last empty line counts. */}
      <RNText
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        onLayout={(e) => setTall(e.nativeEvent.layout.height)}
        style={[mirrorOf(props.style), face, s.mirror]}
      >
        {words.endsWith("\n") || !words ? `${words} ` : words}
      </RNText>
      {box}
    </View>
  ) : (
    box
  );
  if (!withBar) return field;
  return (
    <>
      {field}
      {/* No strip of its own (owner, 2026-10-28: "can we make it a little smoother and blend"):
          a small floating pill over whatever is behind, above the keyboard's own glass. */}
      <InputAccessoryView nativeID={barId} backgroundColor="transparent">
        <View style={s.bar} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the keyboard"
            onPress={() => Keyboard.dismiss()}
            hitSlop={8}
            style={({ pressed }) => [
              s.done,
              {
                backgroundColor: t.glass,
                borderColor: t.hair,
                shadowColor: t.shadow,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <RNText style={[s.doneText, { color: t.accent }, faceOf(s.doneText)]}>Done</RNText>
          </Pressable>
        </View>
      </InputAccessoryView>
    </>
  );
});

const LAYOUT = ["flex", "flexGrow", "flexShrink", "flexBasis", "alignSelf"] as const;
const OUTSIDE = [
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginHorizontal",
  "marginVertical",
];

/** A growing box's place in its row or column (the box itself goes inside it). */
function outerOf(style: TextInputProps["style"]) {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { minWidth: 0 };
  for (const k of [...LAYOUT, ...OUTSIDE]) if (flat[k] !== undefined) out[k] = flat[k];
  return out;
}
/** A growing box's own look: its place goes to the wrapper (`outerOf`). */
function innerOf(style: TextInputProps["style"]) {
  const flat = { ...((StyleSheet.flatten(style) ?? {}) as Record<string, unknown>) };
  for (const k of [...LAYOUT, ...OUTSIDE]) delete flat[k];
  // No focus ring on the web: inlined, a width of 0 alone still drew the browser's own ring.
  if (flat.outlineWidth === 0) flat.outlineStyle = "none";
  return flat as TextStyle;
}
/** The copy's look: the box's type and padding, without its size or place. */
function mirrorOf(style: TextInputProps["style"]) {
  const flat = { ...((StyleSheet.flatten(style) ?? {}) as Record<string, unknown>) };
  for (const k of [...LAYOUT, ...OUTSIDE, "height", "minHeight", "maxHeight", "width", "outlineWidth"])
    delete flat[k];
  return flat as TextStyle;
}
/** The box's height: what the words need, from its least to `max` (then it scrolls). */
function sized(style: TextInputProps["style"], tall: number, max: number) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const least = typeof flat.minHeight === "number" ? flat.minHeight : 0;
  return {
    // Before the copy is measured (its first frame) the box keeps its own size.
    ...(tall > 0 ? { height: Math.max(least, Math.min(max, Math.ceil(tall))) } : null),
    maxHeight: max,
    // Its own height, not squeezed by the wrapper (the web's flex: 0 shrank it to one line).
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
  } as TextStyle;
}

const s = StyleSheet.create({
  mirror: { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 },
  bar: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 12, paddingBottom: 6 },
  done: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  doneText: { fontSize: 16, fontWeight: "700" },
});
