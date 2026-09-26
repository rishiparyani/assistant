# Status

_Updated: 2026-09-26_

## Last done

- Repo setup from the project brief (no application code): `AGENTS.md` (+ `CLAUDE.md` symlink), `docs/`, `tasks/`, folder structure, root configs.
- Architecture made flexible: a small core plus feature modules, with Gigs as module one (see `docs/modules.md` and the decision in `docs/decisions.md`).
- Decisions recorded: per-member shares and payouts in Phase 1 (T02/T05 updated); no further modules planned yet.
- Added `docs/setup.md` (deploys via GitHub Actions, where secrets live, owner's manual steps, free-tier limits) and public-repo safety rules in `AGENTS.md` and `docs/security.md`.
- **T00 spike built** in `spikes/t00/` (see its README) with deploy workflow `.github/workflows/spike-t00.yml`. Verified here: typecheck, 3 vitest tests (workspace with `kind`, invite + accept second member, stranger denied, full MCP OAuth flow with JWT verification), and the same flow against `wrangler dev` with local D1.
- Original brief archived in `docs/archive/gig-assistant-brief.md`.

## Next

**T00: finish on the deployed Worker.** Code is done and tested locally; remaining ACs need the deployed spike:
1. ~~First Actions run of `spike-t00.yml`~~ succeeded 2026-09-26 (D1 created, migrations, deploy, secrets, smoke test; secrets masked in logs).
2. Owner: Google sign-in at https://assistant-spike.rishiparyani.workers.dev and create a workspace.
3. Owner: add the Claude custom connector (`…/mcp`), connect, run `whoami`.
4. Read CPU time per request from the Cloudflare dashboard.
5. Record results in `docs/decisions.md` (T00 findings entry) and tick the ACs; then T01.

## Open decisions

None. Resolved 2026-09-26:

- Login: Google sign-in now; passkeys and magic links added in T03.

- Member shares: tracked per member (roster, lineup with shares, payouts). See `docs/data-model.md`.
- Other modules: none planned; add as needs come up.

## Owner setup

Steps the owner does by hand (instructions in `docs/setup.md`). Update this list when the owner reports progress.

- [x] Cloudflare account created (workers.dev subdomain: `rishiparyani.workers.dev`)
- [x] GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` added (owner reported 2026-09-26; first deploy will verify)
- [x] Google OAuth client created; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` added as GitHub secrets (owner reported 2026-09-26)
- [ ] GitHub secret scanning, push protection, Dependabot alerts enabled; fork PR workflows require approval
- [ ] `main` created (T01) and set as default branch; branch protection on `main`
- [ ] Claude custom connector added (end of T00)

## In progress

T00: waiting on the first deploy and the owner's manual tests (see Next).

## Gotchas

- `CLAUDE.md` is a symlink; on Windows without symlink support replace it with a file containing `@AGENTS.md`.
- Root `package.json` scripts are placeholders until T01.
- **The repo is public.** No secrets or real personal data anywhere; see `docs/security.md#public-repository`.
- The GitHub default branch is currently `claude/gig-assistant-flexibility-7x8ws8` (it was pushed first). There's no `main` yet; create it in T01.
- Better Auth docs site (better-auth.com) is blocked from agent sessions; read the types in `node_modules/@better-auth/*/dist/*.d.mts` instead.
- `@better-auth/oauth-provider`: `/auth/oauth2/consent` returns `{ url }` (not `redirect_uri`). Access tokens are JWTs only when the client sends `resource`; the spike falls back to `/oauth2/userinfo` for opaque tokens.
- Better Auth tables use camelCase columns and random string IDs (not ULIDs). Decide in T02/T03: `advanced.database.generateId` for ULIDs; keep Better Auth's column names for its own tables.
- Agent sessions can't reach `api.cloudflare.com` (network policy), and shouldn't: deploys go through GitHub Actions only.
