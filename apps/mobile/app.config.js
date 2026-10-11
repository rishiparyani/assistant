// The app's config: app.json, plus what only the build knows. Expo writes the build number
// into Info.plist as a literal, so the TestFlight workflow passes it here (BUILD_NUMBER);
// without it the number stays at app.json's.
module.exports = ({ config }) => ({
  ...config,
  ios: { ...config.ios, buildNumber: process.env.BUILD_NUMBER || config.ios?.buildNumber || "1" },
});
