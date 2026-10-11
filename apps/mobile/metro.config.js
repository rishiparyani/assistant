// Metro in a pnpm workspace: watch the whole repo (for @assistant/shared) and resolve packages
// from this app and the root, so symlinked workspace packages bundle.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;
// One-shot bundles on CI (GitHub's Mac runners ship Watchman, which has failed there with the
// whole repo as the watch root): crawl the files with Node instead.
if (process.env.CI) config.resolver.useWatchman = false;

module.exports = config;
