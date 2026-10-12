import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SessionProvider } from "@/session";
import { useTheme } from "@/theme";

export default function Layout() {
  const { t, dark } = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.canvas }}>
      <SessionProvider>
        <StatusBar style={dark ? "light" : "dark"} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.canvas } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" options={{ presentation: "fullScreenModal", animation: "fade" }} />
          {/* A page sheet (UIKit's own), not a form sheet with custom detents: the form sheet
              laid its content out wrong once the keyboard had been up (bubbles under the
              header, under the message box). */}
          <Stack.Screen name="chat" options={{ presentation: "modal" }} />
          <Stack.Screen name="memory" options={{ presentation: "modal" }} />
        </Stack>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
