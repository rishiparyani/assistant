// The assistant's words drawn like Claude's and ChatGPT's (decision 2026-10-15 "Feel: the
// ChatGPT bar"; 2026-10-23 "Each box says what it is"): the little Markdown a model writes as
// native text, never the asterisks. Headings step down in size with room above them, lists
// hang their bullets, a quote is an example message to try (tap puts it in the box), inline
// code is a small chip, a rule is a hairline. Nothing here is a link or a script.
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type TextStyle } from "react-native";
import { blocksOf, exampleOf, spansOf, type ExampleAct } from "../markdown.ts";
export type { ExampleAct } from "../markdown.ts";
import { Tap } from "./press.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.ts";

function Inline({ line, style }: { line: string; style: StyleProp<TextStyle> }) {
  const { t } = useTheme();
  return (
    <Text style={style}>
      {spansOf(line).map((sp, i) => (
        <Text
          key={i}
          style={[
            style,
            sp.bold ? { fontWeight: "700" } : null,
            sp.italic ? { fontStyle: "italic" } : null,
            sp.code ? [s.code, { backgroundColor: t.fill, color: t.fg }] : null,
          ]}
        >
          {sp.text}
        </Text>
      ))}
    </Text>
  );
}

/** Marked-up text as native paragraphs, headings, lists and quotes, in the given text style. */
export function Markdown({
  text,
  style,
  onTry,
  onAct,
}: {
  text: string;
  style: StyleProp<TextStyle>;
  /** A quoted example message was tapped: put it in the box (the chat passes this). */
  onTry?: (text: string) => void;
  /**
   * A pill that acts (owner, 2026-10-24: a tap does the thing, no model call): "show" returns
   * what to draw under the pill (a live card), "add" opens a form and returns true. Null or
   * false: nothing by that name here, so the words go to the box as a plain pill would.
   */
  onAct?: (act: ExampleAct, words: string) => ReactNode | boolean | null;
}) {
  const { t } = useTheme();
  const blocks = blocksOf(text);
  // What a "show" pill opened under itself, by its place in the text; a second tap closes it.
  const [shown, setShown] = useState<Record<string, ReactNode>>({});
  // Plain text (no marks, one paragraph) draws as one Text, as before.
  if (blocks.length === 1 && blocks[0]!.kind === "p" && !/[*`_#>]/.test(text))
    return <Text style={style}>{text}</Text>;
  return (
    <View style={s.blocks}>
      {blocks.map((b, i) => {
        if (b.kind === "h")
          return (
            <Inline key={i} line={b.text} style={[style, b.level === 3 ? s.h3 : s.h2, i > 0 && s.hGap]} />
          );
        if (b.kind === "hr") return <View key={i} style={[s.rule, { backgroundColor: t.sep }]} />;
        if (b.kind === "q")
          return (
            <View key={i} style={s.quotes}>
              {b.lines.map((line, n) => {
                const ex = exampleOf(line);
                if (!onTry)
                  return (
                    <View key={n} style={[s.quote, { borderLeftColor: t.fill2 }]}>
                      <Inline line={ex.words} style={[style, { color: t.fg2 }]} />
                    </View>
                  );
                const at = `${i}:${n}`;
                const open = shown[at];
                const tag =
                  ex.act?.kind === "show" ? (open ? "Hide" : "Show") : ex.act?.kind === "add" ? "Add" : null;
                const press = () => {
                  if (ex.act && onAct) {
                    if (ex.act.kind === "show" && open) {
                      setShown((m) => ({ ...m, [at]: null }));
                      return;
                    }
                    const got = onAct(ex.act, ex.words);
                    if (got === true) return;
                    if (got) {
                      setShown((m) => ({ ...m, [at]: got }));
                      return;
                    }
                  }
                  onTry(ex.words);
                };
                return (
                  <View key={n} style={s.quotes}>
                    <Tap
                      accessibilityRole="button"
                      accessibilityLabel={`${tag ?? "Try"}: ${ex.words}`}
                      accessibilityHint={
                        ex.act?.kind === "show"
                          ? "Shows it here"
                          : ex.act?.kind === "add"
                            ? "Opens the add form, filled in"
                            : "Puts it in the message box"
                      }
                      onPress={press}
                      haptic="selection"
                      style={[s.try, { backgroundColor: t.fill, borderColor: t.hair }]}
                    >
                      <Text style={[s.tryMark, { color: t.accent }]}>{ex.act ? "▸" : "›"}</Text>
                      <Inline line={ex.words} style={[style, s.tryText, { color: t.fg }]} />
                      {tag ? <Text style={[s.tryTag, { color: t.accent }]}>{tag}</Text> : null}
                    </Tap>
                    {open ? <View style={s.under}>{open}</View> : null}
                  </View>
                );
              })}
            </View>
          );
        if (b.kind === "p") return <Inline key={i} line={b.lines.join("\n")} style={style} />;
        return (
          <View key={i} style={s.list}>
            {b.items.map((item, n) => (
              <View key={n} style={s.item}>
                <Text style={[style, s.bullet, { color: b.ordered ? t.fg2 : t.fg3 }]}>
                  {b.ordered ? `${n + 1}.` : "•"}
                </Text>
                <View style={s.itemText}>
                  <Inline line={item} style={style} />
                </View>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  blocks: { gap: 10 },
  h2: { fontSize: 18, lineHeight: 24, fontWeight: "800", letterSpacing: -0.3 },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: "800", letterSpacing: -0.2 },
  // Room above a heading, so each section reads as its own.
  hGap: { marginTop: 8 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  list: { gap: 5 },
  item: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  bullet: { width: 18, textAlign: "right", fontVariant: ["tabular-nums"] },
  itemText: { flex: 1 },
  quotes: { gap: 6 },
  quote: { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 2 },
  // An example message to try: a quiet pill the width of its words.
  try: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tryMark: { fontSize: 15, fontWeight: "800", lineHeight: 22 },
  tryTag: { fontSize: 12, fontWeight: "800", lineHeight: 22, letterSpacing: 0.3, marginLeft: 4 },
  under: { marginTop: 2 },
  tryText: { fontSize: 15, lineHeight: 22, flexShrink: 1 },
  code: { fontFamily: "Menlo", borderRadius: 4, paddingHorizontal: 3 },
});
