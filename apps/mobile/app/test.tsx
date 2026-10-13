// Test sign-in for the simulator screenshots (CI only). The workflow launches the app with
// `-testEmail … -testPassword … -testPath /chat` (launch arguments, read from NSUserDefaults by
// `useTestLaunch` on the home) after seeding the local test server, or opens
// gigspree://test?email=…&password=…&path=/; this signs in with the seed's email/password (which
// exists only on localhost) and goes to the path. Against any other server the route does
// nothing but go home, so it can't be used to sign anyone in.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Text } from "@assistant/cards/native";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { signInWithEmail } from "@/auth";
import { API_URL, LOCAL } from "@/config";
import { useSession } from "@/session";
import { useTheme } from "@/theme";
import { setTourOff } from "@/components/Tour";

export default function TestSignIn() {
  const { t } = useTheme();
  const router = useRouter();
  const { refresh } = useSession();
  const { email, password, path, tour } = useLocalSearchParams<{
    email?: string;
    password?: string;
    path?: string;
    /** "1": show the first-run tour (its own screenshot); otherwise it stays out of the way. */
    tour?: string;
  }>();
  const [error, setError] = useState("");
  // Shown under the spinner, so a screenshot says how far it got.
  const [step, setStep] = useState("Signing in…");
  const allowed = LOCAL.test(API_URL) && !!email && !!password;
  // Once for the link that opened this screen. The latest refresh and router live in refs:
  // `refresh` changes identity when the session changes (right after this sign-in), and an
  // effect that re-ran on it cancelled its own navigation.
  const started = useRef(false);
  const latest = useRef({ refresh, router });
  latest.current = { refresh, router };

  useEffect(() => {
    if (!allowed || started.current) return;
    started.current = true;
    (async () => {
      try {
        setTourOff(tour !== "1");
        await signInWithEmail(email!, password!);
        setStep("Signed in, loading you…");
        await latest.current.refresh();
        setStep(`Going to ${path || "/"}…`);
        // Home first, then the asked-for screen on top of it (the chat is a sheet over the home).
        latest.current.router.replace("/");
        if (path && path.startsWith("/") && path !== "/") latest.current.router.push(path as Href);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [allowed, email, password, path]);

  if (!allowed) return <Redirect href="/" />;
  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.canvas, gap: 12 }}
    >
      {error ? <Text style={{ color: t.danger }}>{error}</Text> : <ActivityIndicator color={t.accent} />}
      <Text style={{ color: t.fg2, fontSize: 13 }}>{error ? "Test sign-in failed" : step}</Text>
    </View>
  );
}
