// Topics in a chat (decision 2026-10-31 "Topics"; owner: "for one gig we can have one dashboard,
// for another gig we can have another"): chips under the chat's tabs, General first, then the open
// topics by newest activity, and "+ Topic". A topic shown gets a thin strip to close it (folded
// away, still searchable); closed ones open from "Closed" to read or reopen. Any chat can have
// them, a chat for two too.
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { GroupView, TopicView } from "@assistant/shared";
import { Tap, Text, TextInput } from "@assistant/cards/native";
import { isOffline } from "@/api";
import { closeTopic, startTopic } from "@/chats";
import { Sheet } from "@/components/Sheet";
import { radius, useTheme } from "@/theme";

export function TopicBar({
  chat,
  topic,
  myId,
  onPick,
  onChanged,
}: {
  chat: GroupView;
  /** The topic shown (none: General). */
  topic: string | undefined;
  myId: string | null;
  onPick: (topic: string | undefined) => void;
  /** The server's chat after a change (it comes back showing the topic it's about). */
  onChanged: (view: GroupView) => void;
}) {
  const { t } = useTheme();
  const [making, setMaking] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = chat.topics.filter((x) => !x.closed);
  const closed = chat.topics.filter((x) => x.closed);
  const shown = topic ? chat.topics.find((x) => x.id === topic) : undefined;
  const me = chat.members.find((m) => m.user_id === myId);
  const canClose = (x: TopicView) => chat.direct || x.created_by === myId || me?.role === "owner";
  const fail = (e: unknown) =>
    setError(isOffline(e) ? "That needs a connection." : e instanceof Error ? e.message : String(e));

  // online-only: the chat's object makes the topic (it checks the name isn't taken).
  const make = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const v = await startTopic(chat.id, name);
      setName("");
      setMaking(false);
      onChanged(v);
      onPick(v.topic ?? undefined);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  // online-only: closing or reopening is checked by the chat's object (starter or admin).
  const setClosed = async (x: TopicView, closedNow: boolean) => {
    setBusy(true);
    setError("");
    try {
      const v = await closeTopic(chat.id, x.id, closedNow);
      onChanged(v);
      onPick(closedNow ? undefined : x.id);
      setClosedOpen(false);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const chip = (key: string, label: string, on: boolean, press: () => void, a11y?: string) => (
    <Tap
      key={key}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ selected: on }}
      onPress={press}
      style={[s.chip, { backgroundColor: on ? t.accent : t.fill }]}
    >
      <Text style={[s.chipText, { color: on ? t.onAccent : t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Tap>
  );

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
        accessibilityLabel="Topics"
      >
        {chip("general", "General", !topic, () => onPick(undefined))}
        {open.map((x) =>
          chip(
            x.id,
            x.unread && topic !== x.id ? `${x.name} · ${x.unread}` : x.name,
            topic === x.id,
            () => onPick(x.id),
            `Topic: ${x.name}${x.unread && topic !== x.id ? `, ${x.unread} new` : ""}`,
          ),
        )}
        {chip("new", "+ Topic", false, () => setMaking(true), "Start a topic")}
        {closed.length
          ? chip("closed", `Closed · ${closed.length}`, false, () => setClosedOpen(true), "Closed topics")
          : null}
      </ScrollView>
      {shown ? (
        <View style={[s.strip, { borderBottomColor: t.hair }]}>
          <Text style={[s.stripText, { color: t.fg2 }]} numberOfLines={1}>
            {shown.closed ? `“${shown.name}” is closed` : `Topic · ${shown.name}`}
          </Text>
          {canClose(shown) ? (
            <Tap
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void setClosed(shown, !shown.closed)}
              style={s.stripBtn}
            >
              <Text style={[s.stripBtnText, { color: t.accent }]}>
                {shown.closed ? "Reopen" : "Close topic"}
              </Text>
            </Tap>
          ) : null}
        </View>
      ) : null}
      {error && !making && !closedOpen ? <Text style={[s.error, { color: t.danger }]}>{error}</Text> : null}

      <Sheet
        open={making}
        onClose={() => {
          setMaking(false);
          setError("");
        }}
        keyboard
        accessibilityLabel="Start a topic"
      >
        <Text style={[s.title, { color: t.fg }]}>Start a topic</Text>
        <Text style={[s.small, { color: t.fg2 }]}>
          Its own messages inside this chat, for one plan or event. Close it when it's done.
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Goa trip, 14 Nov"
          placeholderTextColor={t.fg3}
          maxLength={60}
          autoFocus
          onSubmitEditing={() => void make()}
          accessibilityLabel="Topic name"
          style={[s.input, { color: t.fg, backgroundColor: t.cell, borderColor: t.hair }]}
        />
        {error ? <Text style={[s.error, { color: t.danger }]}>{error}</Text> : null}
        <Tap
          accessibilityRole="button"
          disabled={!name.trim() || busy}
          onPress={() => void make()}
          style={[s.primary, { backgroundColor: t.accent, opacity: name.trim() && !busy ? 1 : 0.5 }]}
        >
          <Text style={[s.primaryText, { color: t.onAccent }]}>{busy ? "Starting…" : "Start"}</Text>
        </Tap>
      </Sheet>

      <Sheet open={closedOpen} onClose={() => setClosedOpen(false)} accessibilityLabel="Closed topics">
        <Text style={[s.title, { color: t.fg }]}>Closed topics</Text>
        {closed.map((x) => (
          <View key={x.id} style={[s.closedRow, { backgroundColor: t.cell }]}>
            <Tap
              accessibilityRole="button"
              accessibilityLabel={`Read ${x.name}`}
              onPress={() => {
                setClosedOpen(false);
                onPick(x.id);
              }}
              style={s.grow}
            >
              <Text style={[s.closedName, { color: t.fg }]} numberOfLines={1}>
                {x.name}
              </Text>
              <Text style={[s.small, { color: t.fg2 }]}>
                {x.messages === 1 ? "1 message" : `${x.messages} messages`}
              </Text>
            </Tap>
            {canClose(x) ? (
              <Tap
                accessibilityRole="button"
                accessibilityLabel={`Reopen ${x.name}`}
                disabled={busy}
                onPress={() => void setClosed(x, false)}
                style={[s.reopen, { backgroundColor: t.accentSoft }]}
              >
                <Text style={[s.stripBtnText, { color: t.accent }]}>Reopen</Text>
              </Tap>
            ) : null}
          </View>
        ))}
        {error ? <Text style={[s.error, { color: t.danger }]}>{error}</Text> : null}
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  row: { gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
  chip: {
    minHeight: 44,
    maxWidth: 200,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { fontSize: 14, fontWeight: "700" },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stripText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: "600" },
  stripBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  stripBtnText: { fontSize: 14, fontWeight: "800" },
  error: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 4 },
  title: { fontSize: 20, fontWeight: "800" },
  small: { fontSize: 13, lineHeight: 18 },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, fontSize: 16 },
  primary: { minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 16, fontWeight: "800" },
  closedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 56,
  },
  grow: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" },
  closedName: { fontSize: 15, fontWeight: "700" },
  reopen: { minHeight: 44, borderRadius: radius.pill, paddingHorizontal: 14, justifyContent: "center" },
});
