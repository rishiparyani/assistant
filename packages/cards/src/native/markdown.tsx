// The assistant's words drawn like ChatGPT draws them (decision 2026-10-15 "Feel: the ChatGPT
// bar"): the little Markdown a model writes (bold, italics, code, bullet and numbered lists,
// a heading line) as native text, never the asterisks. Nothing here is a link or a script.
import { StyleSheet, View, type StyleProp, type TextStyle } from "react-native";
import { blocksOf, spansOf } from "../markdown.ts";
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

/** Marked-up text as native paragraphs, headings and lists, in the given text style. */
export function Markdown({ text, style }: { text: string; style: StyleProp<TextStyle> }) {
  const { t } = useTheme();
  const blocks = blocksOf(text);
  // Plain text (no marks, one paragraph) draws as one Text, as before.
  if (blocks.length === 1 && blocks[0]!.kind === "p" && !/[*`_#]/.test(text))
    return <Text style={style}>{text}</Text>;
  return (
    <View style={s.blocks}>
      {blocks.map((b, i) => {
        if (b.kind === "h") return <Inline key={i} line={b.text} style={[style, s.heading]} />;
        if (b.kind === "p") return <Inline key={i} line={b.lines.join("\n")} style={style} />;
        return (
          <View key={i} style={s.list}>
            {b.items.map((item, n) => (
              <View key={n} style={s.item}>
                <Text style={[style, s.bullet, { color: t.fg2 }]}>{b.ordered ? `${n + 1}.` : "•"}</Text>
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
  blocks: { gap: 8 },
  heading: { fontWeight: "800" },
  list: { gap: 3 },
  item: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bullet: { width: 16, textAlign: "right", fontVariant: ["tabular-nums"] },
  itemText: { flex: 1 },
  code: { fontFamily: "Menlo", borderRadius: 4, paddingHorizontal: 3 },
});
