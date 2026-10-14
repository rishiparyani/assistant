// Who's in a chat, and who its admins are (decision 2026-10-14 "A home for each chat", the
// mock-up's chat settings): admins can make others admins, or members again; a chat keeps one.
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { GroupView } from "@assistant/shared";
import { Text } from "@assistant/cards/native";
import { isOffline, request } from "../api.ts";
import { useTheme } from "../theme.ts";

export function PeopleSheet({
  chat,
  myId,
  open,
  onClose,
  onChanged,
}: {
  chat: GroupView;
  myId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const admin = chat.members.some((m) => m.user_id === myId && m.role === "owner");

  // online-only: who's an admin is decided by the chat on the server.
  const setRole = async (userId: string, role: "admin" | "member") => {
    setBusy(userId);
    setNote("");
    try {
      await request(
        "POST",
        `/api/groups/${encodeURIComponent(chat.id)}/members/${encodeURIComponent(userId)}/role`,
        { role },
      );
      onChanged();
    } catch (e) {
      setNote(isOffline(e) ? "That needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[s.scrim, { backgroundColor: t.shadow }]}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View style={[s.sheet, { backgroundColor: t.page, paddingBottom: insets.bottom + 16 }]}>
        <View style={[s.grab, { backgroundColor: t.fill2 }]} />
        <View style={s.headRow}>
          <Text style={[s.title, { color: t.fg }]}>{chat.name}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
          </Pressable>
        </View>
        <Text style={[s.label, { color: t.fg2 }]}>PEOPLE</Text>
        <ScrollView style={{ maxHeight: 420 }}>
          <View style={[s.list, { backgroundColor: t.cell }]}>
            {chat.members.map((m, i) => {
              const isAdmin = m.role === "owner";
              return (
                <View
                  key={m.user_id}
                  style={[
                    s.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
                  ]}
                >
                  <Text style={[s.name, { color: t.fg }]} numberOfLines={1}>
                    {m.user_id === myId ? "You" : m.name}
                  </Text>
                  {isAdmin ? (
                    <Text style={[s.badge, { backgroundColor: t.accentSoft, color: t.accent }]}>Admin</Text>
                  ) : null}
                  {admin && !chat.direct ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={isAdmin ? `Make ${m.name} a member` : `Make ${m.name} an admin`}
                      disabled={busy !== null}
                      onPress={() => void setRole(m.user_id, isAdmin ? "member" : "admin")}
                      style={[s.btn, { backgroundColor: t.fill, opacity: busy === m.user_id ? 0.5 : 1 }]}
                    >
                      <Text style={[s.btnText, { color: t.fg }]}>
                        {isAdmin ? "Make member" : "Make admin"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
        {note ? <Text style={[s.small, { color: t.danger }]}>{note}</Text> : null}
        <Text style={[s.small, { color: t.fg2 }]}>
          {chat.direct
            ? "A chat for two has no admins: you both arrange its home."
            : "Admins set up the chat’s home and its workflows, add people and make others admins. Everyone chats, answers, ticks and adds."}
        </Text>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, opacity: 0.6 },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, gap: 12 },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4, flexShrink: 1 },
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, paddingLeft: 4 },
  list: { borderRadius: 20, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56 },
  name: { flex: 1, fontSize: 16, fontWeight: "700" },
  badge: {
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
  },
  btn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: "center" },
  btnText: { fontSize: 13, fontWeight: "800" },
  small: { fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
});
