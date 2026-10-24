// What the assistant remembers (home-first.md §2 point 16: memory is visible). Every item
// says where it came from and can be forgotten; a forget asks once more on the row itself.
// online-only: memory lives in the person's chat object on the server.
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Text } from "@assistant/cards/native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Memory } from "@assistant/shared";
import { isOffline, request } from "@/api";
import { CHAT_FAB_ROOM, ChatFab } from "@/components/ChatFab";
import { homeChanged } from "@/home";
import { radius, useTheme } from "@/theme";

export default function MemoryPage() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Memory[] | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    request<Memory[]>("GET", "/api/memories")
      .then(setItems)
      .catch((e: unknown) => {
        setItems([]);
        setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
      });
  }, []);

  const forget = async (m: Memory) => {
    setBusy(m.id);
    try {
      await request("DELETE", `/api/memories/${encodeURIComponent(m.id)}`);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== m.id));
      // The memory card on the home under this page shows it too.
      homeChanged();
      setNote("");
    } catch (e) {
      setNote(isOffline(e) ? "Forgetting needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setAsking(null);
    }
  };

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <Text style={[s.title, { color: t.fg }]}>What it remembers</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <Text style={[s.lead, { color: t.fg2 }]}>
        Things you asked the assistant to keep, like your rates or how you file things. Every chat uses them.
      </Text>
      <FlatList
        data={items ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + CHAT_FAB_ROOM, gap: 10 }}
        ListFooterComponent={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Connections"
            onPress={() => router.push("/connections")}
            style={[s.item, { backgroundColor: t.cell, borderColor: t.hair, marginTop: 14 }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.text, { color: t.fg, fontWeight: "700" }]}>Connections</Text>
              <Text style={[s.source, { color: t.fg2 }]}>
                Accounts the assistant can use for you, like Google Calendar
              </Text>
            </View>
            <Text style={{ color: t.accent, fontSize: 22 }}>›</Text>
          </Pressable>
        }
        ListEmptyComponent={
          <Text style={[s.empty, { color: t.fg2 }]}>
            {items === null
              ? "Loading…"
              : note ||
                "Nothing kept yet. Say “remember …” in the chat (“remember my rate is ₹8,000 a show”)."}
          </Text>
        }
        renderItem={({ item: m }) => (
          <View style={[s.item, { backgroundColor: t.cell, borderColor: t.hair }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.text, { color: t.fg }]}>{m.text}</Text>
              <Text style={[s.source, { color: t.fg3 }]}>{m.source}</Text>
            </View>
            {asking === m.id ? (
              <View style={s.confirm}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Yes, forget: ${m.text}`}
                  disabled={busy !== null}
                  onPress={() => void forget(m)}
                  style={[s.btn, { backgroundColor: t.danger, opacity: busy ? 0.6 : 1 }]}
                >
                  <Text style={[s.btnText, { color: t.onAccent }]}>Forget</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Keep it"
                  onPress={() => setAsking(null)}
                  style={[s.btn, { backgroundColor: t.fill }]}
                >
                  <Text style={[s.btnText, { color: t.fg }]}>Keep</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Forget: ${m.text}`}
                onPress={() => setAsking(m.id)}
                style={[s.btn, { backgroundColor: t.fill }]}
              >
                <Text style={[s.btnText, { color: t.accent }]}>Forget…</Text>
              </Pressable>
            )}
          </View>
        )}
      />
      {note && items?.length ? <Text style={[s.empty, { color: t.danger }]}>{note}</Text> : null}
      <ChatFab about={{ kind: "screen", title: "What it remembers" }} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  lead: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { fontSize: 15, lineHeight: 21 },
  source: { fontSize: 12 },
  confirm: { flexDirection: "row", gap: 6 },
  btn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 14, fontWeight: "700" },
  empty: { fontSize: 14, lineHeight: 20, textAlign: "center", paddingVertical: 24 },
});
