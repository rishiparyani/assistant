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
// The generated native projects (ios/Pods alone is hundreds of thousands of files) are never
// JS sources: keep them out of Metro's file map.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList]
  ).filter(Boolean),
  new RegExp(`${path.join(projectRoot, "ios").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/.*`),
  new RegExp(`${path.join(projectRoot, "android").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/.*`),
];
// One-shot bundles on CI (GitHub's Mac runners ship Watchman, which has failed there with the
// whole repo as the watch root): crawl the files with Node instead.
if (process.env.CI) config.resolver.useWatchman = false;

module.exports = config;
