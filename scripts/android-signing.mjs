// Signs the Android release build with the owner's key (.github/workflows/android.yml): the
// project `expo prebuild` makes signs releases with the debug key, so this adds a release
// signing config that reads the key from Gradle project properties (GIGSPREE_STORE_FILE and
// the others, given by the workflow as ORG_GRADLE_PROJECT_* variables from secrets, never
// written anywhere) and points the release build type at it. Usage: node scripts/android-signing.mjs android/app/build.gradle
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/android-signing.mjs <app/build.gradle>");
let gradle = readFileSync(file, "utf8");

const release = `
        release {
            storeFile file(GIGSPREE_STORE_FILE)
            storePassword GIGSPREE_STORE_PASSWORD
            keyAlias GIGSPREE_KEY_ALIAS
            keyPassword GIGSPREE_KEY_PASSWORD
        }`;
if (!/signingConfigs \{/.test(gradle)) throw new Error(`${file}: no signingConfigs block`);
gradle = gradle.replace(/signingConfigs \{/, (m) => m + release);

// Only the release build type's line, not the debug one's.
const before = gradle;
gradle = gradle.replace(
  /(release \{[^}]*?)signingConfig signingConfigs\.debug/,
  "$1signingConfig signingConfigs.release",
);
if (gradle === before)
  throw new Error(`${file}: the release build type doesn't sign with the debug key as expected`);
writeFileSync(file, gradle);
console.log("Release builds sign with the owner's key.");
