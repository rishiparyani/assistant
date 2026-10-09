# scripts

Operational scripts: nightly D1 export to R2 (T12), restore procedure, seed data for local dev.

- `apple-dev-certs.mjs`: run by the TestFlight job; revokes the Apple Development certificates earlier CI builds made (named "Created via API"), so Apple's certificate limit isn't reached. Prints counts only.
