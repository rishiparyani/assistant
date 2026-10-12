// CI only: the simulator job's way into a signed-in screen (see app/test.tsx).
import { useEffect, useRef } from "react";
import { Platform, Settings } from "react-native";
import { useRouter, type Href } from "expo-router";
import { API_URL, LOCAL } from "./config.ts";

/**
 * On the home, once per launch: launch arguments from the simulator job (`simctl launch … -testEmail
 * x -testPassword y -testPath /chat`) land in NSUserDefaults; against the local test server they
 * open the test sign-in. (`simctl openurl` with the app's scheme asks "Open in Gigspree?" on recent
 * iOS, which nothing in the job can tap.)
 */
export function useTestLaunch() {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || Platform.OS !== "ios" || !LOCAL.test(API_URL)) return;
    done.current = true;
    const email = Settings.get("testEmail") as unknown;
    const password = Settings.get("testPassword") as unknown;
    const path = Settings.get("testPath") as unknown;
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) return;
    const q = new URLSearchParams({ email, password, path: typeof path === "string" ? path : "/" });
    router.replace(`/test?${q}` as Href);
  }, [router]);
}
