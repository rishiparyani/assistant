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

## Open

None.
