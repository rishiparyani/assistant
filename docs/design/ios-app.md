# The iPhone app

Owner, 2026-09-29: bought the Apple Developer Program. "You start." The plan agreed in chat: Capacitor (the web app in a native shell) plus native Swift for what only an app can do, delivered through TestFlight.

## How it's built

- **`apps/ios`** holds a Capacitor 8 project (`capacitor.config.ts`, Xcode project in `ios/`, Swift Package Manager, no CocoaPods). Bundle ID `in.gigspree.assistant`.
- **It shows the live web app** (`server.url`: prod for TestFlight, `localhost` for simulator tests). Same origin as the website, so sign-in cookies, passkeys, live updates and the offline service worker work unchanged, and screen changes reach the app as soon as the web deploys (no new build). Native parts (Siri, widgets, speech, on-device AI) are Swift in the same project and need a build.
- **Offline:** WebKit runs service workers in an app only for "app-bound domains", so `Info.plist` lists our domains (`WKAppBoundDomains`) and the config sets `limitsNavigationsToAppBoundDomains`. Links to other sites open outside the app. `www/index.html` is shown only if the server can't be reached before the app was ever saved on the phone.
- **Sign-in:** Google refuses its sign-in inside apps' web views, so the app signs in with a **passkey**. Passkeys need Apple to see that our site lists the app: the Worker serves `/.well-known/apple-app-site-association` (once `APPLE_TEAM_ID` is set) and the app has the `webcredentials:` associated domains. Someone without a passkey signs in on the website with Google and adds one in Settings. Google inside the app (through a system sign-in sheet and a one-time handoff) is a later step: it's a security change and waits for the owner's OK.
- **App mode in the web app:** `core/native.ts` `inApp()` (Capacitor adds `window.Capacitor`). Used for the login page (passkey first, no Google) and the notifications text (web push doesn't exist in app web views; native push comes later). Future app-only layout tweaks use the same switch.

## Testing and delivery

`.github/workflows/ios.yml`, on GitHub's Mac runners (free for this public repo):

- **Simulator (every PR touching the app or web):** builds a debug app, starts a local Worker with fake data (`apps/ios/test/seed.mjs`), and screenshots login, Home, Gigs, a gig, its lists and guests, and Settings on a large and a small iPhone in light and dark. Screenshots are an artifact (fake data only). Debug builds accept `-testCookie`/`-testPath` launch arguments for this, only against `localhost` and compiled out of release builds.
- **TestFlight (push to `main`, or run by hand on main):** archives a release build pointing at prod, signs it automatically with the App Store Connect API key (`-allowProvisioningUpdates`), and uploads it (`ExportOptions.plist`: internal testing only). Build number = 1000 + the workflow's run number. Skipped until the Apple secrets exist. The owner's phone updates itself (TestFlight → Automatic Updates).

## Stages

1. **Now:** the shell, passkey sign-in, simulator screenshots, TestFlight pipeline.
2. Native push (APNs) with notification actions; a shared on-device database so Swift parts (Siri, widgets) can read and queue changes offline; App Intents (Next gig, Earnings, Mark paid…), Action Button, "Next gig" widget.
3. On-device speech and AI (needs a new decision: `AGENTS.md` currently allows AI only via MCP).
4. After a couple of weeks of use: keep the web screens, or move them to React Native.

## Owner steps (once)

See `docs/setup.md` → "iPhone app (Apple)".
