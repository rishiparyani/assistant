// Chat about this (decision 2026-10-14): a group chat with a record's people, the record pinned
// on the chat's home. The people on it come ticked; money stays hidden unless switched on. The
// record stays the owner's: the chat sees it live through a share, never a copy.
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ulid, type GroupView, type RecordChatPlan, type RecordView } from "@assistant/shared";
import { Text } from "@assistant/cards/native";
import { isOffline, request } from "../api.ts";
import { radius, useTheme } from "../theme.ts";

export function ChatAboutSheet({
  record,
  onClose,
  onStarted,
}: {
  record: RecordView | null;
  onClose: () => void;
  /** The chat was made (or found): open it. */
  onStarted: (chatId: string) => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [plan, setPlan] = useState<RecordChatPlan | null>(null);
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // One chat id per open sheet, so a retried tap makes one chat.
  const [chatId, setChatId] = useState(ulid);

  // online-only: who's on the record and what it could show are read from the server.
  useEffect(() => {
    if (!record) return;
    setPlan(null);
    setNote("");
    setChatId(ulid());
    // A slow answer for a record closed since must not fill in this one's people and fields.
    let current = true;
    request<RecordChatPlan>("GET", `/api/records/${encodeURIComponent(record.id)}/chat`)
      .then((p) => {
        if (!current) return;
        setPlan(p);
        setPeople(new Set(p.people.filter((x) => x.suggested).map((x) => x.user_id)));
        setShown(new Set(p.fields.filter((f) => !f.hidden).map((f) => f.id)));
      })
      .catch((e: unknown) => {
        if (current)
          setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
      });
    return () => {
      current = false;
    };
  }, [record]);

  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  // online-only: the chat and its share are made on the server.
  const start = async () => {
    if (!record || !plan || plan.record.id !== record.id) return;
    setBusy(true);
    setNote("");
    try {
      const g = await request<GroupView>("POST", `/api/records/${encodeURIComponent(record.id)}/chat`, {
        chat_id: chatId,
        people: [...people],
        hide_fields: plan.fields.filter((f) => !shown.has(f.id)).map((f) => f.id),
      });
      onStarted(g.id);
    } catch (e) {
      setNote(
        isOffline(e) ? "Starting a chat needs a connection." : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!record} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[s.scrim, { backgroundColor: t.shadow }]}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View style={[s.sheet, { backgroundColor: t.page, paddingBottom: insets.bottom + 16 }]}>
        <View style={[s.grab, { backgroundColor: t.fill2 }]} />
        <View style={s.headRow}>
          <Text style={[s.title, { color: t.fg }]} numberOfLines={2}>
            Chat about “{record?.title}”
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={s.close}>
            <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Cancel</Text>
          </Pressable>
        </View>
        <Text style={[s.small, { color: t.fg2 }]}>
          A group chat with its card on the chat’s home. It stays yours: the chat sees it live, and changes
          you make show there.
        </Text>
        {!plan && !note ? <ActivityIndicator color={t.fg3} style={{ marginVertical: 24 }} /> : null}
        {plan ? (
          <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 12 }}>
            <Text style={[s.label, { color: t.fg2 }]}>WHO’S IN IT</Text>
            {plan.people.length ? (
              <View style={[s.list, { backgroundColor: t.cell }]}>
                {plan.people.map((p, i) => {
                  const on = people.has(p.user_id);
                  return (
                    <Pressable
                      key={p.user_id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      onPress={() => setPeople((x) => flip(x, p.user_id))}
                      style={[
                        s.row,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
                      ]}
                    >
                      <View
                        style={[
                          s.box,
                          {
                            borderColor: on ? t.accent : t.fill2,
                            backgroundColor: on ? t.accent : "transparent",
                          },
                        ]}
                      >
                        {on ? (
                          <Text style={{ color: t.onAccent, fontSize: 13, fontWeight: "800" }}>✓</Text>
                        ) : null}
                      </View>
                      <Text style={[s.name, { color: t.fg }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      {p.suggested ? (
                        <Text style={[s.badge, { backgroundColor: t.accentSoft, color: t.accent }]}>
                          On this
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={[s.small, { color: t.fg2 }]}>
                You can chat with people once you’ve shared something with them, or they with you.
              </Text>
            )}
            {plan.fields.length ? (
              <>
                <Text style={[s.label, { color: t.fg2 }]}>WHAT THE CHAT SEES</Text>
                <View style={[s.list, { backgroundColor: t.cell }]}>
                  {plan.fields.map((f, i) => (
                    <View
                      key={f.id}
                      style={[
                        s.row,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.sep },
                      ]}
                    >
                      <Text style={[s.name, { color: t.fg }]} numberOfLines={1}>
                        {f.name}
                        {f.type === "money" ? (
                          <Text style={{ color: t.fg3, fontWeight: "600" }}> · money</Text>
                        ) : null}
                      </Text>
                      <Switch
                        accessibilityLabel={`Show ${f.name}`}
                        value={shown.has(f.id)}
                        onValueChange={() => setShown((x) => flip(x, f.id))}
                        trackColor={{ true: t.accent, false: t.fill2 }}
                      />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
        ) : null}
        {note ? <Text style={[s.small, { color: t.danger }]}>{note}</Text> : null}
        {plan ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy || !people.size}
            onPress={() => void start()}
            style={[s.primary, { backgroundColor: t.accent, opacity: busy || !people.size ? 0.5 : 1 }]}
          >
            <Text style={[s.primaryText, { color: t.onAccent }]}>
              {people.size
                ? `Start chat with ${people.size} ${people.size === 1 ? "person" : "people"}`
                : "Pick someone"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, opacity: 0.6 },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, gap: 12 },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3 },
  headRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4, flexShrink: 1 },
  close: { minHeight: 44, justifyContent: "center" },
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, paddingLeft: 4 },
  list: { borderRadius: radius.card, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { flex: 1, fontSize: 16, fontWeight: "600" },
  badge: {
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
  },
  small: { fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
  primary: {
    minHeight: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryText: { fontSize: 16, fontWeight: "800" },
});
