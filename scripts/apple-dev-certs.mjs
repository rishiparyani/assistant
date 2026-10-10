// Each fresh GitHub Mac runner makes a new Apple Development certificate when it signs the
// TestFlight build, and Apple caps how many an account may have. This revokes the one this
// build made, and nothing else:
//   node scripts/apple-dev-certs.mjs before <file>   notes the Development certificates that exist
//   node scripts/apple-dev-certs.mjs after <file>    revokes ones that weren't there before and
//                                                    are named "Created via API"
// Certificates made by people, by other tools before this build, and all Distribution
// certificates are left alone. Uses the App Store Connect key the job already has. Prints
// counts only, never keys. Never fails the build.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (the .p8 contents).
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env;
const [mode, file] = process.argv.slice(2);
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_P8) {
  console.log("App Store Connect key not set: nothing to do.");
  process.exit(0);
}
if (!["before", "after"].includes(mode) || !file) {
  console.log("Usage: apple-dev-certs.mjs before|after <file>");
  process.exit(0);
}

try {
  await run();
} catch (e) {
  // Never fail the build over housekeeping (the workflow steps are also non-fatal).
  console.log(`Skipped certificate cleanup: ${e instanceof Error ? e.name : "error"}.`);
}

async function run() {
  const b64url = (buf) => Buffer.from(buf).toString("base64url");
  function token() {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }),
    );
    const key = createPrivateKey(ASC_KEY_P8);
    const sig = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
    return `${header}.${payload}.${b64url(sig)}`;
  }

  const API = "https://api.appstoreconnect.apple.com/v1";
  const auth = { authorization: `Bearer ${token()}` };
  const res = await fetch(
    `${API}/certificates?filter[certificateType]=DEVELOPMENT,IOS_DEVELOPMENT&limit=200&fields[certificates]=name,displayName,certificateType`,
    { headers: auth },
  );
  if (!res.ok) {
    console.log(`Couldn't list certificates (HTTP ${res.status}); skipping.`);
    return;
  }
  const { data } = await res.json();

  if (mode === "before") {
    writeFileSync(file, JSON.stringify(data.map((c) => c.id)));
    console.log(`Development certificates before the build: ${data.length}.`);
    return;
  }

  // Without the list from before the build we can't tell which one is ours: leave them all.
  if (!existsSync(file)) {
    console.log("No list from before the build; nothing revoked.");
    return;
  }
  const before = new Set(JSON.parse(readFileSync(file, "utf8")));
  // The portal shows "Created via API"; the API may put it in name or displayName.
  const byApi = (c) =>
    [c.attributes?.name, c.attributes?.displayName].some((n) => /created via api/i.test(n ?? ""));
  const ours = data.filter((c) => !before.has(c.id) && byApi(c));
  let revoked = 0;
  for (const c of ours) {
    const del = await fetch(`${API}/certificates/${encodeURIComponent(c.id)}`, {
      method: "DELETE",
      headers: auth,
    });
    if (del.ok || del.status === 404) revoked++;
  }
  console.log(
    `Development certificates: ${data.length}; made by this build: ${ours.length}; revoked ${revoked}.`,
  );
}
