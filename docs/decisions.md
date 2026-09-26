# Decisions

Newest at the bottom. Format: date, decision, reason. Don't edit old entries; add a new one that supersedes.

## 2026-09-26: Cloudflare D1 for all data
Chosen over Neon, Supabase, Firestore and Azure. D1 bills per rows read/written with no idle compute charge, so frequent tiny requests (Siri, MCP) stay free. Consequence: index every filtered column; avoid full-table scans.

## 2026-09-26: Better Auth over Firebase Auth
Runs inside the Worker, stores its tables in D1 (one source of truth), and can act as the OAuth provider for MCP connectors. No password login because hashing can exceed the free plan's 10 ms CPU limit. Organization plugin as workspaces, to be verified in T00.

## 2026-09-26: Shared database with `workspace_id`
One database, `workspace_id` on every tenant row, one scoped data layer, ULIDs. A later move to one database per band becomes a data migration, not a rewrite.

## 2026-09-26: Fixed API operations, no raw SQL for AI
AI assistants get the same fixed operations as every other client. Safer (validation, authorization, audit) and keeps logic in one place.

## 2026-09-26: MCP instead of an in-app AI assistant
AI access is via MCP from the user's existing assistants (Claude, ChatGPT, Le Chat). No model costs, no chat UI to build; the app stays the source of truth.

## 2026-09-26: Google Drive for large media, R2 for small files
The user has 5 TB of Drive. Large media (videos, recordings, backing tracks) lives there as pasted links in Phase 1, integration later. R2 holds backups and small app-critical files.

## 2026-09-26: Core + modules, Gigs as the first module
The focus is gig management, but the assistant should be able to help with other tasks later. So the backend is a small core (auth, workspaces, authorization, operation registry, idempotency, confirm tokens, audit, API tokens, notifications) with feature modules on top. Gigs is module one; Phase 2 music/setlists is module two.
Reason: adding a kind of task should mean adding a module, not changing core or clients. Each action is defined once as an operation and exposed as REST (web, Siri) and MCP automatically.
Guardrails against over-engineering: no plugin loading at runtime (modules are compiled in and listed in one file); one database and migration sequence; shared concepts (contacts, reminders, attachments) are promoted to core only when a second module needs them.
Repo named `assistant` rather than `gig-assistant` for the same reason; the product can still be called "Gig Assistant" while gigs is its only module.

## 2026-09-26: Track each band member's share and payout in Phase 1
Decided by the user. Gigs get a lineup (`gig_lineup`: musician + `share_paise`) and band-to-musician payouts (`payouts`, append-only with reversals like client payments). Musicians are a roster per band (`musicians`), optionally linked to a user account, so deps and players who never sign in still work. Amounts owed and band net are derived. Shares need not add up to the fee (kitty allowed, reported as unallocated). Members see only their own share by default; owners see all.
Reason: the point of the app is knowing who owes whom; in a band that includes what the band owes its players.

## 2026-09-26: No further modules planned yet
The user will decide what else the assistant helps with as needs come up. The core + modules structure stays so that's cheap; nothing is built speculatively for unknown modules. Ideas stay in [roadmap.md](roadmap.md).

## 2026-09-26: Deploy only through GitHub Actions
Push to `main` deploys prod; push to other branches deploys dev. Agent sessions never deploy and never hold the Cloudflare token; it lives only in GitHub Actions secrets.
Reason: the agent environment can't reach the Cloudflare API anyway; keeping the token out of agent sessions is safer; every deploy is logged and can be rolled back; deploys keep working without an agent. See [setup.md](setup.md).

## 2026-09-26: Public repository
The repo is public (unlimited free Actions minutes). Consequences: no secrets or real personal data in the repo, issues, PRs or Actions logs/artifacts; hardened workflows; secret scanning and push protection enabled. Rules in [security.md](security.md#public-repository). Can be made private later; the free Actions allowance (2,000 min/month) still fits.

## 2026-09-26: Google sign-in first, passkeys and magic links later
Decided by the owner. T00 uses Google sign-in (as in the original brief). Passkeys and email magic links are added in T03; Google stays. Google OAuth app starts in Testing mode (test users only); publish it before inviting band members (basic scopes need no Google verification).
Reason: familiar one-tap login for the owner and bandmates; other methods cover people without Google and account recovery.

## 2026-09-26: Deploy workflow generates BETTER_AUTH_SECRET
Instead of the owner creating it by hand, the deploy workflow sets it on each Worker the first time (random, never printed or stored in GitHub). One fewer manual step, and each environment gets its own value automatically.

## 2026-09-26: T00 approach (findings pending the deployed test)
- MCP OAuth uses `@better-auth/oauth-provider` (Better Auth 1.7; the older `mcp` plugin no longer ships). It needs the `jwt` plugin; access tokens are JWTs with the MCP URL as audience, verified in-process against Better Auth's JWKS (no self-fetch).
- D1 binding passed straight to Better Auth as `database`; schema SQL generated from the auth options with `getMigrations().compileMigrations()` and applied with `wrangler d1 migrations`.
- The spike's MCP server is a ~80-line stateless JSON-RPC handler, not the MCP SDK. Revisit for T10 (SDK vs hand-rolled over the operation registry).
- Dependencies added for the spike only: `better-auth`, `@better-auth/oauth-provider`, `hono`, `wrangler`, `vitest`, `typescript`.
Deployed results (2026-09-26): Google sign-in works on the Worker with sessions in D1; the owner created a `band` workspace; the Claude custom connector completed OAuth (dynamic registration, login, consent) and `whoami` returned the owner's name, email and workspace. Second member tested in-process only (vitest). CPU time: 41 requests used 11 ms of CPU in total (~0.3 ms average; no request can have exceeded 11 ms), including sign-in, JWT key creation and the full OAuth flow. Well within the free plan's 10 ms per request.
Conclusion: the stack in the brief works; no change of plan needed.

## Open

None.
