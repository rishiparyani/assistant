// Small pieces the chat screens share: a person's initials on a circle in their colour, and
// when a message was sent in words.
import { StyleSheet, View } from "react-native";
import { Text } from "@assistant/cards/native";
import { colourFor, tint, useTheme } from "../theme.ts";

/** Initials on a soft circle in the name's colour. */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const { dark, colour } = useTheme();
  const c = colour(colourFor(name));
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <View
      style={[
        s.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tint(c, dark ? 0.28 : 0.16) },
      ]}
    >
      <Text style={{ color: c, fontWeight: "800", fontSize: Math.round(size * 0.36) }}>
        {initials || "?"}
      </Text>
    </View>
  );
}

/** "4:12 pm" today, "Yesterday", "Mon" this week, else "12 Oct" (India time). */
export function when(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const ist = (ms: number) => new Date(ms + 330 * 60_000);
  const d = ist(t);
  const now = ist(Date.now());
  const day = (x: Date) => x.toISOString().slice(0, 10);
  if (day(d) === day(now)) {
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  }
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * 86_400_000)
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]!;
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

const s = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center" },
});
