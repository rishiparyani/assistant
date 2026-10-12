// What an App Intent asked for (native/ios/AppIntents.swift): Siri or a shortcut ran one, the
// app came to the front, and the path to open waits in the app's defaults. Taken once, on the
// home, at launch and whenever the app comes back to the front.
import { useEffect } from "react";
import { AppState, Platform, Settings } from "react-native";
import { useRouter, type Href } from "expo-router";

const KEY = "pendingPath";

export function usePendingPath() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const take = () => {
      const path = Settings.get(KEY) as unknown;
      if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path === "/") return;
      Settings.set({ [KEY]: "" });
      router.push(path as Href);
    };
    take();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") take();
    });
    return () => sub.remove();
  }, [router]);
}
