// The app's config: app.json, plus what only the build knows. Expo writes the build number
// into Info.plist as a literal, so the TestFlight workflow passes it here (BUILD_NUMBER);
// without it the number stays at app.json's.
// EXPO_PUBLIC_BASE_URL (/app) is where the website serves the web target from (home-first.md
// §7 step 7); the simulator and local checks build it for the root.
module.exports = ({ config }) => ({
  ...config,
  ios: { ...config.ios, buildNumber: process.env.BUILD_NUMBER || config.ios?.buildNumber || "1" },
  experiments: {
    ...config.experiments,
    ...(process.env.EXPO_PUBLIC_BASE_URL ? { baseUrl: process.env.EXPO_PUBLIC_BASE_URL } : {}),
  },
});
