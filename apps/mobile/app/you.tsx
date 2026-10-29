// You (docs/design/chats-home.md, "You"; step 7, the account switcher): who is signed in, the
// accounts on this device (stay signed in to several and switch with one tap, like Gmail), add
// another, and sign out of one or all. Each account keeps its own copy on the device, so a
// switch shows that account's things at once; what the one left had waiting goes when it's
// opened again. Opened from the face at the top of Chats.
// online-only: switching, adding and signing out are done by the server (the sign-in).
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tap, Text, type } from "@assistant/cards/native";
import { isOffline } from "@/api";
import type { DeviceAccount } from "@/auth";
import { closeChatPanel } from "@/chat-open";
import { Avatar } from "@/components/ChatBits";
import { API_URL, LOCAL } from "@/config";
import { homeAfterSwitch, useSession, type KnownAccount } from "@/session";
import { readAccountJson } from "@/storage";
import { outboxState } from "@/outbox";
import { radius, useTheme } from "@/theme";

const MAX = 5;
// On the website the sign-in is the site's own page (Google, passkeys), which comes back here.
const ON_SITE = Platform.OS === "web" && !LOCAL.test(API_URL);

/** How many changes another account left waiting on this device. */
const waitingIn = (id: string) =>
  readAccountJson<{ waiting: unknown[] }>(id, `gigspree:outbox:${id}`)?.waiting.length ?? 0;

export default function You() {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { me, listAccounts, knownAccounts, switchTo, signOutOf, signOut, prepareAdd } = useSession();
  const [accounts, setAccounts] = useState<DeviceAccount[] | null>(null);
  const [known] = useState<KnownAccount[]>(() => knownAccounts());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"one" | "all" | null>(null);
  const unsent = confirm === "one" ? outboxState().waiting.length : 0;

  const load = useCallback(async () => {
    try {
      setAccounts(await listAccounts());
      setNote("");
    } catch (e) {
      setNote(
        isOffline(e) ? "Switching accounts needs a connection." : e instanceof Error ? e.message : String(e),
      );
    }
  }, [listAccounts]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (what: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(what);
    setNote("");
    try {
      await fn();
    } catch (e) {
      setNote(isOffline(e) ? "That needs a connection." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const open = (a: DeviceAccount) =>
    run(a.id, async () => {
      closeChatPanel();
      await switchTo(a);
      homeAfterSwitch();
    });
  const add = () =>
    run("add", async () => {
      await prepareAdd();
      if (ON_SITE) window.location.assign(`${API_URL}/login?add=1&next=${encodeURIComponent("/you")}`);
      else router.push({ pathname: "/login", params: { add: "1" } } as Href);
    });
  const mine = accounts?.find((a) => a.id === me?.user.id);
  const others = accounts
    ? accounts.filter((a) => a.id !== me?.user.id)
    : known.filter((k) => k.id !== me?.user.id);

  if (!me) return null;
  return (
    <View style={[s.root, { backgroundColor: t.page, paddingTop: insets.top + 6 }]}>
      <ScrollView contentContainerStyle={[s.column, { paddingBottom: insets.bottom + 40 }]}>
        <View style={s.top}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            style={[s.round, { backgroundColor: t.cell, shadowColor: t.shadow }]}
          >
            <Text style={{ color: t.fg, fontSize: 22, fontWeight: "700", lineHeight: 24 }}>‹</Text>
          </Pressable>
        </View>
        <View style={s.me}>
          <Avatar name={me.user.name} size={64} />
          <Text style={[type.title, { color: t.fg }]}>{me.user.name}</Text>
          <Text style={[type.caption, { color: t.fg2 }]}>{me.user.email}</Text>
        </View>

        <Text style={[type.eyebrow, s.label, { color: t.fg2 }]}>ACCOUNTS ON THIS DEVICE</Text>
        <View style={[s.card, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
          <View style={s.row}>
            <Avatar name={me.user.name} size={36} />
            <View style={s.grow}>
              <Text style={[type.body, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
                {me.user.name}
              </Text>
              <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
                {me.user.email}
              </Text>
            </View>
            <Text style={[type.caption, { color: t.accent, fontWeight: "800" }]}>Open ✓</Text>
          </View>
          {others.map((a) => {
            const waiting = waitingIn(a.id);
            const live = accounts?.find((x) => x.id === a.id);
            return (
              <Tap
                key={a.id}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${a.name}`}
                disabled={!live || busy !== null}
                onPress={() => live && void open(live)}
                scale={0.985}
                style={[s.row, s.sep, { borderTopColor: t.sep, opacity: live ? 1 : 0.6 }]}
              >
                <Avatar name={a.name} size={36} />
                <View style={s.grow}>
                  <Text style={[type.body, { color: t.fg, fontWeight: "700" }]} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={[type.caption, { color: t.fg2 }]} numberOfLines={1}>
                    {a.email}
                    {waiting ? ` · ${waiting} waiting to send` : ""}
                  </Text>
                </View>
                <Text style={[type.caption, { color: t.fg2, fontWeight: "700" }]}>
                  {busy === a.id ? "Opening…" : "Switch ›"}
                </Text>
              </Tap>
            );
          })}
          {(accounts?.length ?? 1) < MAX ? (
            <Tap
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={() => void add()}
              scale={0.985}
              style={[s.row, s.sep, { borderTopColor: t.sep }]}
            >
              <View style={[s.plus, { backgroundColor: t.fill }]}>
                <Text style={{ color: t.fg, fontSize: 20, fontWeight: "700", lineHeight: 22 }}>+</Text>
              </View>
              <Text style={[type.body, { color: t.fg, fontWeight: "700", flex: 1 }]}>
                {busy === "add" ? "Getting ready…" : "Add another account"}
              </Text>
            </Tap>
          ) : (
            <Text style={[type.caption, { color: t.fg2, padding: 12 }]}>
              Five accounts is the most one device keeps. Sign out of one to add another.
            </Text>
          )}
        </View>
        <Text style={[s.hint, { color: t.fg3 }]}>
          Stay signed in to each and switch with one tap. Each account keeps its own things on this device.
        </Text>
        {note ? <Text style={[s.hint, { color: t.danger }]}>{note}</Text> : null}

        <Text style={[type.eyebrow, s.label, { color: t.fg2 }]}>MORE</Text>
        <View style={[s.card, { backgroundColor: t.cell, shadowColor: t.shadow }]}>
          {(
            [
              ["What the assistant remembers", "/memory"],
              ["Connections", "/connections"],
              ["Recently deleted", "/trash"],
            ] as const
          ).map(([label, path], i) => (
            <Tap
              key={path}
              accessibilityRole="button"
              onPress={() => router.push(path as Href)}
              scale={0.985}
              style={[s.row, i > 0 && s.sep, { borderTopColor: t.sep }]}
            >
              <Text style={[type.body, { color: t.fg, flex: 1 }]}>{label}</Text>
              <Text style={{ color: t.fg3, fontWeight: "700" }}>›</Text>
            </Tap>
          ))}
        </View>

        {confirm ? (
          <View style={[s.card, s.confirm, { backgroundColor: t.fill }]}>
            <Text style={[type.body, { color: t.fg, fontWeight: "600" }]}>
              {confirm === "all"
                ? "Sign out of every account on this device? What they keep here is removed."
                : `Sign out of ${me.user.name} on this device?${others.length ? " Another account opens." : ""}`}
              {unsent ? ` ${unsent === 1 ? "A change" : `${unsent} changes`} not sent yet will be lost.` : ""}
            </Text>
            <View style={s.buttons}>
              <Pressable
                accessibilityRole="button"
                disabled={busy !== null}
                onPress={() =>
                  void run("out", async () => {
                    closeChatPanel();
                    if (confirm === "all" || !mine) await signOut();
                    else await signOutOf(mine);
                    setConfirm(null);
                    homeAfterSwitch();
                  })
                }
                style={[s.btn, s.grow, { backgroundColor: t.danger, opacity: busy ? 0.6 : 1 }]}
              >
                <Text style={[s.btnText, { color: t.onAccent }]}>
                  {busy === "out" ? "Signing out…" : "Sign out"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirm(null)}
                style={[s.btn, { backgroundColor: t.cell }]}
              >
                <Text style={[s.btnText, { color: t.fg }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={s.buttons}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirm("one")}
              style={[s.btn, s.grow, { backgroundColor: t.cell }]}
            >
              <Text style={[s.btnText, { color: t.danger }]}>Sign out</Text>
            </Pressable>
            {others.length ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirm("all")}
                style={[s.btn, s.grow, { backgroundColor: t.cell }]}
              >
                <Text style={[s.btnText, { color: t.danger }]}>Sign out of all</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", paddingHorizontal: 16, gap: 10 },
  top: { paddingBottom: 4 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  me: { alignItems: "center", gap: 4, paddingVertical: 8 },
  label: { marginTop: 10, paddingHorizontal: 4 },
  card: {
    borderRadius: radius.card,
    overflow: "hidden",
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sep: { borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 0 },
  plus: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  confirm: { padding: 14, gap: 10, marginTop: 10 },
  buttons: { flexDirection: "row", gap: 10, marginTop: 10 },
  btn: {
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  btnText: { fontSize: 16, fontWeight: "700" },
});
