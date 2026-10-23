// The assistant's words drawn like Claude's and ChatGPT's (decision 2026-10-15 "Feel: the
// ChatGPT bar"; 2026-10-23 "Each box says what it is"): the little Markdown a model writes as
// native text, never the asterisks. Headings step down in size with room above them, lists
// hang their bullets, a quote is an example message to try (tap puts it in the box), inline
// code is a small chip, a rule is a hairline. Nothing here is a link or a script.
import { StyleSheet, View, type StyleProp, type TextStyle } from "react-native";
import { blocksOf, spansOf } from "../markdown.ts";
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

/** A quote's text without the quote marks around it: the message as it would be sent. */
function unquote(text: string): string {
  return text
    .trim()
    .replace(/^[“"']+/, "")
    .replace(/[”"'.]+$/, "")
    .trim();
}

/** Marked-up text as native paragraphs, headings, lists and quotes, in the given text style. */
export function Markdown({
  text,
  style,
  onTry,
}: {
  text: string;
  style: StyleProp<TextStyle>;
  /** A quoted example message was tapped: put it in the box (the chat passes this). */
  onTry?: (text: string) => void;
}) {
  const { t } = useTheme();
  const blocks = blocksOf(text);
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
              {b.lines.map((line, n) =>
                onTry ? (
                  <Tap
                    key={n}
                    accessibilityRole="button"
                    accessibilityLabel={`Try: ${unquote(line)}`}
                    accessibilityHint="Puts it in the message box"
                    onPress={() => onTry(unquote(line))}
                    haptic="selection"
                    style={[s.try, { backgroundColor: t.fill, borderColor: t.hair }]}
                  >
                    <Text style={[s.tryMark, { color: t.accent }]}>›</Text>
                    <Inline line={unquote(line)} style={[style, s.tryText, { color: t.fg }]} />
                  </Tap>
                ) : (
                  <View key={n} style={[s.quote, { borderLeftColor: t.fill2 }]}>
                    <Inline line={line} style={[style, { color: t.fg2 }]} />
                  </View>
                ),
              )}
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
  tryText: { fontSize: 15, lineHeight: 22, flexShrink: 1 },
  code: { fontFamily: "Menlo", borderRadius: 4, paddingHorizontal: 3 },
});
