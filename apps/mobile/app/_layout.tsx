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
          <Stack.Screen
            name="chat"
            options={{ presentation: "formSheet", sheetAllowedDetents: [0.92], sheetGrabberVisible: true }}
          />
        </Stack>
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
