// Connections (decision 2026-10-12 "Connectors start with Google Calendar"): the outside
// accounts the assistant may use for me. Connecting opens Google's own consent page in the
// browser; the app keeps the access sealed in my own storage; Disconnect forgets it.
// online-only: connecting and disconnecting happen on the server and at Google.
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@assistant/cards/native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isOffline, request } from "@/api";
import { ChatFab } from "@/components/ChatFab";
import { radius, useTheme } from "@/theme";

type Connector = {
  kind: string;
  label: string;
  about: string;
  connected: boolean;
  account: string | null;
  connected_at: string | null;
  available: boolean;
};

export default function Connections() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Connector[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  const fail = (e: unknown) =>
    setNote(isOffline(e) ? "This needs a connection." : e instanceof Error ? e.message : String(e));
  const load = useCallback(async () => {
    try {
      setItems(await request<Connector[]>("GET", "/api/connectors"));
      setNote("");
    } catch (e) {
      setItems((prev) => prev ?? []);
      fail(e);
    }
  }, []);
  useEffect(() => {
    void load();
    // Back from Google's page in the browser: read again.
    const sub = AppState.addEventListener("change", (s) => s === "active" && void load());
    return () => sub.remove();
  }, [load]);

  const connect = async (c: Connector) => {
    setBusy(c.kind);
    try {
      const { url } = await request<{ url: string }>("POST", `/api/connectors/${c.kind}/connect`, {});
      if (Platform.OS === "web") window.location.assign(url);
      else {
        await WebBrowser.openBrowserAsync(url);
        await load();
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async (c: Connector) => {
    setBusy(c.kind);
    try {
      setItems(await request<Connector[]>("DELETE", `/api/connectors/${c.kind}`));
      setNote("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
      setAsking(null);
    }
  };

  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 8 }]}>
      <View style={s.head}>
        <Text style={[s.title, { color: t.fg }]}>Connections</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={10}
        >
          <Text style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </Pressable>
      </View>
      <Text style={[s.lead, { color: t.fg2 }]}>
        Accounts the assistant can use for you. It reads them when you ask; anything it adds waits for your
        tap.
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 10 }}>
        {items === null ? <Text style={[s.empty, { color: t.fg2 }]}>Loading…</Text> : null}
        {(items ?? []).map((c) => (
          <View key={c.kind} style={[s.item, { backgroundColor: t.cell, borderColor: t.hair }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[s.name, { color: t.fg }]}>{c.label}</Text>
              <Text style={[s.small, { color: t.fg2 }]}>
                {c.connected ? `Connected${c.account ? ` as ${c.account}` : ""}` : c.about}
              </Text>
            </View>
            {c.connected ? (
              asking === c.kind ? (
                <View style={s.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Yes, disconnect ${c.label}`}
                    disabled={busy !== null}
                    onPress={() => void disconnect(c)}
                    style={[s.btn, { backgroundColor: t.danger, opacity: busy ? 0.6 : 1 }]}
                  >
                    <Text style={[s.btnText, { color: t.onAccent }]}>Disconnect</Text>
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
                  accessibilityLabel={`Disconnect ${c.label}`}
                  onPress={() => setAsking(c.kind)}
                  style={[s.btn, { backgroundColor: t.fill }]}
                >
                  <Text style={[s.btnText, { color: t.accent }]}>Disconnect…</Text>
                </Pressable>
              )
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Connect ${c.label}`}
                disabled={busy !== null || !c.available}
                onPress={() => void connect(c)}
                style={[s.btn, { backgroundColor: t.accent, opacity: busy || !c.available ? 0.6 : 1 }]}
              >
                <Text style={[s.btnText, { color: t.onAccent }]}>
                  {busy === c.kind ? "Opening…" : "Connect"}
                </Text>
              </Pressable>
            )}
          </View>
        ))}
        {note ? <Text style={[s.empty, { color: t.danger }]}>{note}</Text> : null}
      </ScrollView>
      <ChatFab about={{ kind: "screen", title: "Connections" }} />
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
  name: { fontSize: 16, fontWeight: "700" },
  small: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: 6 },
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
