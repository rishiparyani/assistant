// A note in the chat that carries a link (a share's join link, owner 2026-10-25: "This link
// is not copyable or anything"): the words, then the link on its own with Copy and Share, so
// it can be sent on in one tap. Any other note stays a line of small text.
import { useState } from "react";
import { Platform, Share, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Tap, Text } from "@assistant/cards/native";
import { radius, useTheme } from "../theme.ts";

const LINK = /https?:\/\/[^\s"'<>]+[^\s"'<>.,;:!?)]/g;

/** The links in a note, and its words without them. */
export function splitLinks(text: string): { words: string; links: string[] } {
  const links = [...text.matchAll(LINK)].map((m) => m[0]);
  const words = text
    .replace(LINK, "")
    .replace(/\s*The join link:\s*/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { words, links };
}

export function LinkNote({ text, style }: { text: string; style: object }) {
  const { t } = useTheme();
  const { words, links } = splitLinks(text);
  const [copied, setCopied] = useState<string | null>(null);
  if (!links.length)
    return (
      <Text selectable style={style}>
        {text}
      </Text>
    );
  const copy = (url: string) => {
    void Clipboard.setStringAsync(url).then(() => {
      setCopied(url);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 2000);
    });
  };
  // The phone's share sheet (WhatsApp, Messages…); where there is none, the link is copied.
  const share = (url: string) => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && !("share" in navigator))
      return copy(url);
    Share.share(Platform.OS === "ios" ? { url } : { message: url }).catch(() => copy(url));
  };
  return (
    <View style={{ gap: 8 }}>
      {words ? (
        <Text selectable style={style}>
          {words}
        </Text>
      ) : null}
      {links.map((url) => (
        <View key={url} style={[s.card, { backgroundColor: t.cell, borderColor: t.hair }]}>
          <Text style={[s.label, { color: t.fg2 }]}>{/\/join#/.test(url) ? "Join link" : "Link"}</Text>
          <Text selectable numberOfLines={2} style={[s.url, { color: t.fg }]}>
            {url}
          </Text>
          <View style={s.row}>
            <Tap
              accessibilityRole="button"
              accessibilityLabel="Copy the link"
              onPress={() => copy(url)}
              style={[s.btn, { backgroundColor: t.fill }]}
            >
              <Text style={[s.btnText, { color: t.fg }]}>{copied === url ? "Copied" : "Copy"}</Text>
            </Tap>
            <Tap
              accessibilityRole="button"
              accessibilityLabel="Share the link"
              onPress={() => share(url)}
              style={[s.btn, { backgroundColor: t.accent }]}
            >
              <Text style={[s.btnText, { color: t.onAccent }]}>Share</Text>
            </Tap>
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 6,
    marginHorizontal: 8,
  },
  label: { fontSize: 12, fontWeight: "700" },
  url: { fontSize: 14, lineHeight: 19 },
  row: { flexDirection: "row", gap: 8, marginTop: 2 },
  btn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 15, fontWeight: "700" },
});
