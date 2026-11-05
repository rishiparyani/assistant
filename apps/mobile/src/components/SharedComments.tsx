// A shared card's comments (design §11), opened in the app (Codex on PR 230: moving shared things
// here from the website lost them): the space's people and whoever it's shared with talk about
// the record here. Text people type is shown as text.
// online-only: comments are checked by the space that holds the record; reading and writing
// them needs a connection.
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Tap, Text, TextInput, type } from "@assistant/cards/native";
import { formatDateTimeIST, ulid, type CommentView } from "@assistant/shared";
import { isOffline, request } from "../api.ts";
import { radius, useTheme } from "../theme.ts";

const enc = encodeURIComponent;

export function SharedComments({ shareId, recordId }: { shareId: string; recordId: string }) {
  const { t } = useTheme();
  const base = `/api/cards/${enc(shareId)}`;
  const [list, setList] = useState<CommentView[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // The comment whose Delete was tapped once (a second tap deletes).
  const [sure, setSure] = useState<string | null>(null);

  const fail = (e: unknown) =>
    setNote(isOffline(e) ? "That needs a connection." : e instanceof Error ? e.message : String(e));
  const load = useCallback(async () => {
    try {
      setList(await request<CommentView[]>("GET", `${base}/records/${enc(recordId)}/comments`));
    } catch (e) {
      fail(e);
    }
  }, [base, recordId]);
  useEffect(() => {
    setList(null);
    void load();
  }, [load]);

  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      // One id per comment typed: a retry of the same send is the same comment.
      await request("POST", `${base}/records/${enc(recordId)}/comments`, { id: ulid(), body: text });
      setBody("");
      setNote("");
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const drop = async (id: string) => {
    if (sure !== id) return setSure(id);
    setSure(null);
    try {
      await request("DELETE", `${base}/comments/${enc(id)}`);
      await load();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <View style={{ gap: 8 }} accessibilityLabel="Comments">
      <Text style={[s.h2, { color: t.fg }]}>Comments</Text>
      {list?.length ? (
        <View style={[s.box, { backgroundColor: t.cell, borderColor: t.hair }]}>
          {list.map((c) => (
            <View key={c.id} style={{ gap: 2 }}>
              <View style={s.head}>
                <Text style={[type.small, { color: t.fg, fontWeight: "700", flexShrink: 1 }]}>
                  {c.mine ? "You" : c.author.name}
                </Text>
                <Text style={[type.caption, { color: t.fg2, flex: 1 }]}>
                  {formatDateTimeIST(c.created_at)}
                </Text>
                {c.can_delete ? (
                  <Tap
                    accessibilityRole="button"
                    accessibilityLabel={sure === c.id ? "Delete this comment" : "Delete"}
                    onPress={() => void drop(c.id)}
                    style={s.del}
                  >
                    <Text style={[type.caption, { color: t.danger, fontWeight: "600" }]}>
                      {sure === c.id ? "Delete?" : "Delete"}
                    </Text>
                  </Tap>
                ) : null}
              </View>
              <Text style={[type.body, { color: t.fg }]}>{c.body}</Text>
            </View>
          ))}
        </View>
      ) : list ? (
        <Text style={[type.small, { color: t.fg2 }]}>No comments yet.</Text>
      ) : null}
      <View style={s.send}>
        <TextInput
          accessibilityLabel="Add a comment"
          placeholder="Add a comment"
          value={body}
          onChangeText={setBody}
          onSubmitEditing={() => void send()}
          editable={!busy}
          multiline
          style={[s.input, type.body, { color: t.fg, backgroundColor: t.cell, borderColor: t.hair }]}
        />
        <Tap
          accessibilityRole="button"
          disabled={busy || !body.trim()}
          onPress={() => void send()}
          style={[s.btn, { backgroundColor: t.accent, opacity: busy || !body.trim() ? 0.5 : 1 }]}
        >
          <Text style={{ color: t.onAccent, fontSize: 15, fontWeight: "700" }}>
            {busy ? "Sending…" : "Send"}
          </Text>
        </Tap>
      </View>
      {note ? <Text style={[type.caption, { color: t.danger }]}>{note}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  h2: { fontSize: 15, fontWeight: "700", marginTop: 4 },
  box: { padding: 14, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  del: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  send: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  btn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
