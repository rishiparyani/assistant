// Puts the app's Swift pieces (native/ios) into the Xcode project that `expo prebuild` makes
// (docs/design/home-first.md §7 step 8). The project is generated on the runner and never
// committed, so the sources live here and this plugin adds them on every prebuild: copied
// into the app's folder and linked into the app target's sources. No dependency: it uses
// the config-plugins Expo already ships.
/* eslint-disable @typescript-eslint/no-require-imports -- Expo loads a config plugin with require */
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");

const SOURCES = ["AppIntents.swift"];

const withAppIntents = (config) => {
  config = withDangerousMod(config, [
    "ios",
    (c) => {
      const project = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);
      const target = path.join(c.modRequest.platformProjectRoot, project);
      for (const f of SOURCES)
        fs.copyFileSync(path.join(c.modRequest.projectRoot, "native", "ios", f), path.join(target, f));
      return c;
    },
  ]);
  return withXcodeProject(config, (c) => {
    const project = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);
    for (const f of SOURCES) {
      const filepath = `${project}/${f}`;
      if (!c.modResults.hasFile(filepath))
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
          filepath,
          groupName: project,
          project: c.modResults,
        });
    }
    return c;
  });
};

module.exports = withAppIntents;
