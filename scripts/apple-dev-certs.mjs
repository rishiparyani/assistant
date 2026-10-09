// Revokes the Apple Development certificates our TestFlight job made on earlier runs
// (each Mac runner is fresh, so Xcode makes a new one per build and Apple caps how many an
// account may have). Only certificates named "Created via API" of type Development are
// touched; Distribution certificates and anything made in Xcode by a person are left alone.
// Uses the App Store Connect API key the job already has. Prints counts only, never keys.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (the .p8 contents).
import { createPrivateKey, sign } from "node:crypto";

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env;
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_P8) {
  console.log("App Store Connect key not set: nothing to clean up.");
  process.exit(0);
}

try {
  await cleanUp();
} catch (e) {
  // Never fail the build over housekeeping (the workflow step is also non-fatal).
  console.log(`Skipped certificate cleanup: ${e instanceof Error ? e.name : "error"}.`);
}

async function cleanUp() {
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
    `${API}/certificates?filter[certificateType]=DEVELOPMENT,IOS_DEVELOPMENT&limit=200&fields[certificates]=name,certificateType,expirationDate`,
    { headers: auth },
  );
  if (!res.ok) {
    // Don't fail the build over housekeeping; the archive step reports a real problem.
    console.log(`Couldn't list certificates (HTTP ${res.status}); skipping cleanup.`);
    return;
  }
  const { data } = await res.json();
  const ours = data.filter((c) => c.attributes?.name === "Created via API");
  let revoked = 0;
  for (const c of ours) {
    const del = await fetch(`${API}/certificates/${encodeURIComponent(c.id)}`, {
      method: "DELETE",
      headers: auth,
    });
    if (del.ok || del.status === 404) revoked++;
  }
  console.log(`Development certificates made by earlier builds: ${ours.length}; revoked ${revoked}.`);
}
