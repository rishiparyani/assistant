// The person's chats with the assistant (decision 2026-10-16 "Chats like Claude"): newest
// first, grouped by day, one tap to continue any of them. "Earlier conversations" is the
// first chat, everything from before chats were cut by conversation.
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { ChatSummary, SpaceView } from "@assistant/shared";
import { Sheet } from "@/components/Sheet";
import { Tap, Text, type as typo } from "@assistant/cards/native";
import { request, isOffline } from "@/api";
import { useTheme } from "@/theme";

const MAIN = "main";

export function ChatsSheet({
  open,
  current,
  onClose,
  onOpen,
  onNew,
}: {
  open: boolean;
  /** The chat on screen (marked in the list). */
  current: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { t } = useTheme();
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  // Space names, so a chat in a band's space says so (decision 2026-10-16 "Spaces").
  const [spaces, setSpaces] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    // online-only: the list of chats lives on the server (each chat's words stay there too).
    request<ChatSummary[]>("GET", "/api/chats")
      .then((list) => {
        setChats(list);
        setNote("");
      })
      .catch((e: unknown) => setNote(isOffline(e) ? "Your chats need a connection." : String(e)));
    request<SpaceView[]>("GET", "/api/spaces")
      .then((list) => setSpaces(Object.fromEntries(list.map((sp) => [sp.id, sp.name]))))
      .catch(() => {});
  }, [open]);
  const groups = groupByDay(chats ?? []);
  return (
    <Sheet open={open} onClose={onClose} gap={8} maxHeight="80%" accessibilityLabel="Chats">
      <View style={s.headRow}>
        <Text style={[s.title, { color: t.fg }]}>Chats</Text>
        <Tap
          accessibilityRole="button"
          accessibilityLabel="New chat"
          onPress={() => {
            onClose();
            onNew();
          }}
          haptic="selection"
          style={[s.newBtn, { backgroundColor: t.ink }]}
        >
          <Text style={[typo.label, { color: t.onInk, fontWeight: "700" }]}>New chat</Text>
        </Tap>
      </View>
      {note ? <Text style={[typo.caption, { color: t.fg2, paddingHorizontal: 4 }]}>{note}</Text> : null}
      {chats && !chats.some((c) => c.id !== MAIN) ? (
        <Text style={[typo.caption, { color: t.fg2, paddingHorizontal: 4 }]}>
          Each conversation is its own chat here; a new one starts after a couple of hours away.
        </Text>
      ) : null}
      <ScrollView style={s.scroll} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
        {groups.map((g) => (
          <View key={g.name} style={{ gap: 6 }}>
            <Text style={[typo.eyebrow, { color: t.fg2, paddingHorizontal: 4, paddingTop: 6 }]}>
              {g.name}
            </Text>
            {g.chats.map((c) => {
              const mine = c.id === current;
              return (
                <Tap
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={titleOf(c)}
                  accessibilityState={{ selected: mine }}
                  onPress={() => {
                    onClose();
                    if (!mine) onOpen(c.id);
                  }}
                  scale={0.985}
                  style={[s.row, { backgroundColor: t.cell, borderColor: mine ? t.accent : t.hair }]}
                >
                  <Text style={[typo.body, { color: t.fg, flex: 1 }]} numberOfLines={1}>
                    {titleOf(c)}
                  </Text>
                  {c.space_id && spaces[c.space_id] ? (
                    <View style={[s.tag, { backgroundColor: t.fill }]}>
                      <Text style={[typo.caption, { color: t.fg2 }]} numberOfLines={1}>
                        {spaces[c.space_id]}
                      </Text>
                    </View>
                  ) : null}
                  <Text style={[typo.caption, { color: t.fg2 }]}>{whenOf(c)}</Text>
                </Tap>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const titleOf = (c: ChatSummary) => (c.id === MAIN ? "Earlier conversations" : c.title);

function whenOf(c: ChatSummary): string {
  if (!c.updated_at) return "";
  const d = new Date(c.updated_at);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function groupByDay(chats: ChatSummary[]): { name: string; chats: ChatSummary[] }[] {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400_000);
  const day = (iso: string | null) => {
    if (!iso) return "Earlier";
    const d = new Date(iso);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return today.getTime() - d.getTime() < 7 * 86400_000 ? "This week" : "Earlier";
  };
  const order = ["Today", "Yesterday", "This week", "Earlier"];
  const by = new Map<string, ChatSummary[]>();
  for (const c of chats) {
    const k = day(c.updated_at);
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  return order.filter((k) => by.has(k)).map((k) => ({ name: k, chats: by.get(k)! }));
}

const s = StyleSheet.create({
  // Many chats: the list scrolls inside the sheet (up to 200 come back).
  scroll: { flexShrink: 1 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  newBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  tag: { maxWidth: 110, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
