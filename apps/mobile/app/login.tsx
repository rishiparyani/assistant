// Sign in. Google through the system sheet (on in the phone builds); email/password exists only
// on a local test server, so the simulator tests can sign in.
import { useEffect, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { Text, TextInput } from "@assistant/cards/native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, request } from "@/api";
import { signInWithEmail, signInWithGoogle } from "@/auth";
import { API_URL } from "@/config";
import { homeAfterSwitch, useSession } from "@/session";
import { radius, useTheme } from "@/theme";

const logoLight = require("../assets/logo-light.png");
const logoDark = require("../assets/logo-dark.png");
const GOOGLE_IN_APP = process.env.EXPO_PUBLIC_GOOGLE_IN_APP === "1";
const LOCAL = API_URL.startsWith("http://localhost");
// On the website the server is the page's own origin: its sign-in page (Google, passkeys)
// works and comes back here (home-first.md §7 step 7).
const ON_SITE = Platform.OS === "web" && !LOCAL;

export default function Login() {
  const { t, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const { refresh, cancelAdd } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Where to go once signed in: the screen a deep link asked for (paths inside the app only).
  // `add`: signing in to another account while one is open (You › Add another account).
  const { next: asked, add } = useLocalSearchParams<{ next?: string; add?: string }>();
  const adding = add === "1";
  const next = asked && asked.startsWith("/") && !asked.startsWith("//") ? asked : "/";
  // Adding ends here however it ends (another account, the same one again, or nothing): the
  // outbox held for it is let go (a new account's copy lets it go too; again is harmless).
  useEffect(() => (adding ? () => cancelAdd() : undefined), [adding, cancelAdd]);
  const finish = async () => {
    await refresh();
    if (adding) cancelAdd();
    if (adding) homeAfterSwitch();
    else router.replace(next as Href);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      // Signed in, but the account doesn't open: say so, instead of a screen that stays put.
      try {
        await request("GET", "/api/me", undefined, undefined, { account: null });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401)
          throw new Error(
            "Signed in, but the app couldn't open your account. Try again; if it keeps happening, tell the app team.",
            { cause: e },
          );
        throw e;
      }
      await finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      style={[
        s.root,
        { backgroundColor: t.page, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <Image
        source={dark ? logoDark : logoLight}
        style={{ width: 56, height: 56 }}
        accessibilityIgnoresInvertColors
      />
      <Text style={[s.h1, { color: t.fg }]}>{adding ? "Add another account" : "Gigspree"}</Text>
      <Text style={[s.p, { color: t.fg2 }]}>
        {adding
          ? "Sign in with the other account. You stay signed in to this one too, and switch from You."
          : "Your lists, people and money, kept and done for you. Sign in to open your home."}
      </Text>

      <View style={{ gap: 10, marginTop: 24 }}>
        {ON_SITE ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              window.location.assign(
                `${API_URL}/login?${adding ? "add=1&" : ""}next=${encodeURIComponent(next)}`,
              );
            }}
            style={[s.btn, { backgroundColor: t.accent }]}
          >
            <Text style={[s.btnText, { color: t.onAccent }]}>Sign in</Text>
          </Pressable>
        ) : GOOGLE_IN_APP ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => run(signInWithGoogle)}
            style={[s.btn, { backgroundColor: t.accent }]}
          >
            <Text style={[s.btnText, { color: t.onAccent }]}>
              {busy ? "Opening Google…" : "Continue with Google"}
            </Text>
          </Pressable>
        ) : (
          <Text style={[s.p, { color: t.fg2 }]}>
            Sign in on gigspree.in first; the app's own sign-in is coming next.
          </Text>
        )}
        {LOCAL ? (
          <View style={{ gap: 8 }}>
            <TextInput
              accessibilityLabel="Email"
              placeholder="Email (test server)"
              placeholderTextColor={t.fg3}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              style={[s.input, { backgroundColor: t.cell, color: t.fg, borderColor: t.hair }]}
            />
            <TextInput
              accessibilityLabel="Password"
              placeholder="Password"
              placeholderTextColor={t.fg3}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={[s.input, { backgroundColor: t.cell, color: t.fg, borderColor: t.hair }]}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => run(() => signInWithEmail(email, password))}
              style={[s.btn, { backgroundColor: t.fill }]}
            >
              <Text style={[s.btnText, { color: t.fg }]}>Sign in (test)</Text>
            </Pressable>
          </View>
        ) : null}
        {error ? <Text style={{ color: t.danger, fontSize: 13 }}>{error}</Text> : null}
        {adding ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              cancelAdd();
              if (router.canGoBack()) router.back();
              else router.replace("/");
            }}
            style={[s.btn, { backgroundColor: t.fill }]}
          >
            <Text style={[s.btnText, { color: t.fg }]}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, gap: 8 },
  h1: { fontSize: 32, fontWeight: "800", letterSpacing: -1.4, marginTop: 8 },
  p: { fontSize: 15, lineHeight: 21 },
  btn: { height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 16, fontWeight: "700" },
  input: {
    height: 48,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 16,
  },
});
