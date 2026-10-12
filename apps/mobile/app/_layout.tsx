import { useEffect } from "react";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SessionProvider, useSession } from "@/session";
import { useTheme } from "@/theme";

/**
 * Every screen needs a signed-in person (sign-in and the test route aside): a deep link like
 * /app/chat opened while signed out goes to sign-in, which comes back to it.
 */
function SessionGate() {
  const { me, loaded } = useSession();
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!loaded || me || path === "/login" || path === "/test") return;
    router.replace({ pathname: "/login", params: path && path !== "/" ? { next: path } : {} });
  }, [loaded, me, path, router]);
  return null;
}

export default function Layout() {
  const { t, dark } = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.canvas }}>
      <SessionProvider>
        <StatusBar style={dark ? "light" : "dark"} />
        <SessionGate />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.canvas } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" options={{ presentation: "fullScreenModal", animation: "fade" }} />
          {/* A page sheet (UIKit's own), not a form sheet with custom detents: the form sheet
              laid its content out wrong once the keyboard had been up (bubbles under the
              header, under the message box). */}
          <Stack.Screen name="chat" options={{ presentation: "modal" }} />
          <Stack.Screen name="memory" options={{ presentation: "modal" }} />
          <Stack.Screen name="capture" options={{ presentation: "modal" }} />
        </Stack>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
