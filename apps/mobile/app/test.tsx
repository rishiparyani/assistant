// Test sign-in for the simulator screenshots (CI only). The workflow launches the app with
// `-testEmail … -testPassword … -testPath /chat` (launch arguments, read from NSUserDefaults by
// `useTestLaunch` on the home) after seeding the local test server, or opens
// gigspree://test?email=…&password=…&path=/; this signs in with the seed's email/password (which
// exists only on localhost) and goes to the path. Against any other server the route does
// nothing but go home, so it can't be used to sign anyone in.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { signInWithEmail } from "@/auth";
import { LOCAL } from "@/test-launch";
import { API_URL } from "@/config";
import { useSession } from "@/session";
import { useTheme } from "@/theme";

export default function TestSignIn() {
  const { t } = useTheme();
  const router = useRouter();
  const { refresh } = useSession();
  const { email, password, path } = useLocalSearchParams<{
    email?: string;
    password?: string;
    path?: string;
  }>();
  const [error, setError] = useState("");
  const allowed = LOCAL.test(API_URL) && !!email && !!password;
  // Once for the link that opened this screen.
  const started = useRef(false);

  useEffect(() => {
    if (!allowed || started.current) return;
    started.current = true;
    let gone = false;
    (async () => {
      try {
        await signInWithEmail(email!, password!);
        await refresh();
        if (gone) return;
        // Home first, then the asked-for screen on top of it (the chat is a sheet over the home).
        router.replace("/");
        if (path && path.startsWith("/") && path !== "/") router.push(path as Href);
      } catch (e) {
        if (!gone) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      gone = true;
    };
  }, [allowed, email, password, path, refresh, router]);

  if (!allowed) return <Redirect href="/" />;
  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.canvas, gap: 12 }}
    >
      {error ? <Text style={{ color: t.danger }}>{error}</Text> : <ActivityIndicator color={t.accent} />}
    </View>
  );
}
