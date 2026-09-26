# Status

_Updated: 2026-09-26_

## Last done

- Repo setup from the project brief (no application code): `AGENTS.md` (+ `CLAUDE.md` symlink), `docs/`, `tasks/`, folder structure, root configs.
- Architecture made flexible: a small core plus feature modules, with Gigs as module one (see `docs/modules.md` and the decision in `docs/decisions.md`).
- Decisions recorded: per-member shares and payouts in Phase 1 (T02/T05 updated); no further modules planned yet.
- Added `docs/setup.md` (deploys via GitHub Actions, where secrets live, owner's manual steps, free-tier limits) and public-repo safety rules in `AGENTS.md` and `docs/security.md`.
- Original brief archived in `docs/archive/gig-assistant-brief.md`.

## Next

**Waiting on the owner** (see "Owner setup" below), then **T00 Spike**: Better Auth on Workers + D1 (Google sign-in, organization plugin as workspaces) and a minimal MCP endpoint connected to Claude via OAuth. See `tasks/backlog.md`.

## Open decisions

None. Resolved 2026-09-26:

- Login: Google sign-in now; passkeys and magic links added in T03.

- Member shares: tracked per member (roster, lineup with shares, payouts). See `docs/data-model.md`.
- Other modules: none planned; add as needs come up.

## Owner setup

Steps the owner does by hand (instructions in `docs/setup.md`). Update this list when the owner reports progress.

- [x] Cloudflare account created (workers.dev subdomain: `rishiparyani.workers.dev`)
- [x] GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` added (owner reported 2026-09-26; first deploy will verify)
- [ ] Google OAuth client created; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` added as GitHub secrets (instructions given 2026-09-26)
- [ ] GitHub secret scanning, push protection, Dependabot alerts enabled; fork PR workflows require approval
- [ ] `main` created (T01) and set as default branch; branch protection on `main`
- [ ] Claude custom connector added (end of T00)

## In progress

Nothing.

## Gotchas

- `CLAUDE.md` is a symlink; on Windows without symlink support replace it with a file containing `@AGENTS.md`.
- Root `package.json` scripts are placeholders until T01.
- **The repo is public.** No secrets or real personal data anywhere; see `docs/security.md#public-repository`.
- The GitHub default branch is currently `claude/gig-assistant-flexibility-7x8ws8` (it was pushed first). There's no `main` yet; create it in T01.
- Agent sessions can't reach `api.cloudflare.com` (network policy), and shouldn't: deploys go through GitHub Actions only.
