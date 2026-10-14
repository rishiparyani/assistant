// A chat's home (decision 2026-10-14 "A home for each chat", from the approved mock-up): the
// cards pinned in the chat's own space, which everyone in the chat sees and uses (ticks go
// through the outbox, like on my own home). Admins start it and arrange it, by asking their
// assistant (Gs); there's nothing to build on this screen (chat makes, screens use). Records
// pinned to the chat ("Chat about this") come first: each is its owner's record, seen through a
// share that follows the chat.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { GroupView, RecordView, StoredValue } from "@assistant/shared";
import { Card, Text, type HomeCard } from "@assistant/cards/native";
import { isOffline, request } from "../api.ts";
import { loadChatCards, loadSpaceCards, setValue, stillShown, tick } from "../home.ts";
import { useLive } from "../live-socket.ts";
import { outboxState } from "../outbox.ts";
import { radius, useTheme } from "../theme.ts";

export function ChatHome({
  chat,
  myId,
  onStarted,
  onAsk,
}: {
  chat: GroupView;
  myId: string | null;
  /** The home was started (read the chat again: it has a space now). */
  onStarted: () => void;
  /** Opens my assistant about this chat (where lists are made). */
  onAsk: (() => void) | null;
}) {
  const { t } = useTheme();
  // A chat for two has no admins: either person starts and arranges its home.
  const admin = chat.direct || chat.members.some((m) => m.user_id === myId && m.role === "owner");
  const [cards, setCards] = useState<HomeCard[] | null>(null);
  const [pinned, setPinned] = useState<HomeCard[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const space = chat.space_id;
  const pins = chat.cards;
  const pinKey = pins.map((c) => c.share_id).join(",");

  // online-only: the chat's home is read from its space each time (not kept on the device yet).
  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        pins.length ? loadChatCards(chat.id, pins) : Promise.resolve([]),
        space ? loadSpaceCards(space) : Promise.resolve(null),
      ]);
      setPinned(p);
      if (c) setCards(c);
      setNote("");
    } catch (e) {
      setCards((c) => c ?? []);
      setPinned((c) => c ?? []);
      setNote(
        isOffline(e) ? "The chat's home needs a connection." : e instanceof Error ? e.message : String(e),
      );
    }
    // pinKey stands for the pinned list (a new array each time the chat is read).
  }, [space, chat.id, pinKey]);
  useEffect(() => {
    void load();
  }, [load]);
  // Someone ticked or added something: read again (unless my own changes are still going).
  const later = useRef<ReturnType<typeof setTimeout>>(undefined);
  useLive((m) => {
    if (m.type !== "space_changed" && m.type !== "reconnected") return;
    clearTimeout(later.current);
    later.current = setTimeout(() => {
      if (!outboxState().waiting.length) void load();
    }, 400);
  });

  // online-only: starting the home makes a space on the server.
  const start = async () => {
    setBusy(true);
    try {
      await request("POST", `/api/groups/${encodeURIComponent(chat.id)}/home`, {});
      onStarted();
    } catch (e) {
      setNote(
        isOffline(e) ? "Starting a home needs a connection." : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  // online-only: taking a record off the chat turns its share off on the server.
  const unpin = async (shareId: string) => {
    setBusy(true);
    try {
      await request(
        "DELETE",
        `/api/groups/${encodeURIComponent(chat.id)}/cards/${encodeURIComponent(shareId)}`,
      );
      setPinned((p) => (p ?? []).filter((c) => c.shared?.share_id !== shareId));
      onStarted();
    } catch (e) {
      setNote(isOffline(e) ? "That needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const change = (card: HomeCard, fn: (r: RecordView) => RecordView | null, recordId: string) =>
    setCards((all) =>
      (all ?? []).map((c) =>
        c.id !== card.id
          ? c
          : {
              ...c,
              records: c.records.flatMap((r) => {
                if (r.id !== recordId) return [r];
                const next = fn(r);
                return next ? [next] : [];
              }),
            },
      ),
    );
  const onTick = (card: HomeCard) => (record: RecordView, value: boolean) =>
    change(card, (r) => tick(card, r, value), record.id);
  const onSet = (card: HomeCard) => (record: RecordView, field: string, value: StoredValue) =>
    change(
      card,
      (r) => {
        const next = setValue(card, r, field, value);
        return stillShown(card, next, myId) ? next : null;
      },
      record.id,
    );

  const startIntro = (
    <View style={[s.intro, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
      <Text style={[s.introTitle, { color: t.fg }]}>A home for this chat</Text>
      <Text style={[s.line, { color: t.fg2 }]}>
        Lists and cards everyone here can use: plans, a packing list, shared costs, who’s coming. Admins set
        it up by asking their assistant; everyone ticks and adds.
      </Text>
      {admin ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void start()}
          style={[s.primary, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={[s.primaryText, { color: t.onAccent }]}>Start this chat’s home</Text>
        </Pressable>
      ) : (
        <Text style={[s.line, { color: t.fg3 }]}>An admin of this chat can start it.</Text>
      )}
    </View>
  );

  if (!space && !pins.length)
    return (
      <View style={s.empty}>
        {startIntro}
        {note ? <Text style={[s.line, { color: t.danger }]}>{note}</Text> : null}
      </View>
    );

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {(space && cards === null) || (pins.length && pinned === null) ? (
        <ActivityIndicator color={t.fg3} style={{ marginTop: 40 }} />
      ) : null}
      {pinned?.map((card) => {
        const pin = pins.find((p) => p.share_id === card.shared?.share_id);
        const mine = pin?.owner_id === myId;
        return (
          <View key={card.id} style={s.pinned}>
            <Card card={card} />
            <View style={s.pinRow}>
              <Text style={[s.pinBy, { color: t.fg3 }]} numberOfLines={1}>
                {mine ? "Your record" : `${pin?.owner ?? "Someone"}’s record`} · pinned for everyone here
              </Text>
              {pin && (admin || mine) ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Take ${card.spec.title} off this chat`}
                  disabled={busy}
                  onPress={() => void unpin(pin.share_id)}
                  style={s.pinBtn}
                >
                  <Text style={[s.pinBtnText, { color: t.accent }]}>Take off</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
      {!space ? startIntro : null}
      {cards?.map((card) => (
        <Card key={card.id} card={card} onTick={onTick(card)} onSet={onSet(card)} />
      ))}
      {space && cards && !cards.length ? (
        <View style={[s.intro, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
          <Text style={[s.introTitle, { color: t.fg }]}>Nothing here yet</Text>
          <Text style={[s.line, { color: t.fg2 }]}>
            {admin
              ? "Ask your assistant, for example “start a reminders list for this chat”, and its card shows here for everyone."
              : "When an admin adds a list, its card shows here for everyone."}
          </Text>
          {admin && onAsk ? (
            <Pressable
              accessibilityRole="button"
              onPress={onAsk}
              style={[s.primary, { backgroundColor: t.accentSoft }]}
            >
              <Text style={[s.primaryText, { color: t.accent }]}>Ask your assistant</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {note ? <Text style={[s.line, { color: t.fg2, textAlign: "center" }]}>{note}</Text> : null}
      <Text style={[s.foot, { color: t.fg3 }]}>Everyone in the chat sees this home · admins arrange it</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  empty: { flex: 1, padding: 12 },
  intro: {
    borderRadius: radius.card,
    padding: 16,
    gap: 10,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  introTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  line: { fontSize: 14, lineHeight: 20 },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryText: { fontSize: 15, fontWeight: "800" },
  foot: { fontSize: 12, textAlign: "center", marginTop: 4 },
  pinned: { gap: 2 },
  pinRow: { flexDirection: "row", alignItems: "center", paddingLeft: 8, gap: 8 },
  pinBy: { flex: 1, fontSize: 12, fontWeight: "600" },
  pinBtn: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" },
  pinBtnText: { fontSize: 13, fontWeight: "800" },
});
