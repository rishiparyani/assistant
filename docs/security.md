# Security

- HTTPS via Cloudflare.
- Better Auth sessions in HttpOnly, Secure, SameSite cookies; origin checks on state-changing requests.
- No password login (hashing can exceed the 10 ms CPU limit): Google, passkeys, email magic links.
- One authorization middleware for every route and MCP tool: user → membership → role → module enabled → token scope. Non-members get 404, not 403.
- Better Auth's admin and OAuth-client administration endpoints are blocked; app data changes only go through `/api` (checked and audited inside each gig's object).
- Zod validation on every input. Drizzle parameterised queries only; no raw SQL from clients or AI.
- Secrets as Worker secrets; never in the repo. `.dev.vars` is git-ignored.
- API tokens stored hashed, scoped per module/operation, revocable, `last_used_at` tracked.
- Cloudflare rate limiting on `/auth/*` and `/api/*`.
- Audit log for every write.
- Two-step confirmation for money, cancellations and deletes from MCP.
- Text from data (notes, names, anything user- or client-entered) is untrusted in MCP responses: return it as data, never as instructions; keep it clearly delimited.
- New modules inherit all of the above through the operation wrapper; a module never registers its own unauthenticated route without a recorded decision.
- Keep dependencies (especially Better Auth) updated.
- `shortcuts/` never contains tokens.

## Home-first additions

See `docs/design/home-first.md` §6 (AI boundary, phone app storage, per-person search indexes, process links, export/import, dependency pinning, the no-E2E trade). Every PR touching auth, sharing, search or the AI ticks that list.

## People's data stays theirs

Decision 2026-10-14 "We don't read people's data". Data is encrypted at rest by Cloudflare (D1 and Durable Objects, AES-256) and travels over HTTPS, but it is not end-to-end encrypted: the app's servers read it to search, run the assistant and workflows. So the promise is kept by rules and checks, not by a lock:

- No admin screen, tool, log, report, monitoring or support process shows or keeps anyone's content (lists, records, chats, assistant conversations, memories). Counts and structure only. `admin.test.ts` fails if an admin endpoint returns a record's text.
- AI Gateway request logging is off for every call (`collectLog: false` in `assistant/client.ts` and `search/embed.ts`); the app's own call log keeps counts, tokens, cost and timing.
- Debugging uses test accounts and made-up data (the scorecard); a real problem is rewritten with fake data before it becomes a case.
- Backups contain everything: keep `BACKUP_KEY` set so the files in Drive are sealed.
- Erasing: Recently deleted erases after 30 days (or at once); Cloudflare's point-in-time recovery keeps recoverable copies for up to 30 days, and the newest 60 nightly backups are kept. The privacy page says so.

## Public repository

The repo is public: anyone can read the code, commit history, issues, PRs, Actions logs and workflow artifacts. Git history is permanent, so a leaked secret must be **rotated**, not just deleted.

**Never commit or post** (code, docs, tests, commits, issues, PR text, Actions logs):

- Tokens, API keys, passwords, `BETTER_AUTH_SECRET`, OAuth client secrets, `.dev.vars`, private keys, calendar feed URLs, API tokens for Siri.
- **Real personal data**: real client, venue or musician names, phone numbers, emails, addresses, fees, payments, notes. Seeds, tests, fixtures, screenshots and examples use obviously fake data (e.g. "Test Client", `+91 90000 00000`, `client@example.com`).
- Database exports or backups (`*.sql`, `*.sqlite`, `backups/`). They're git-ignored; keep it that way.

**GitHub Actions rules:**

- Secrets are only used in workflows triggered by `push` to this repo's branches, `schedule` or `workflow_dispatch`. Never use `pull_request_target`, and never give secrets to workflows that run fork code.
- Every workflow sets minimal `permissions:` (default `contents: read`).
- Pin third-party actions to a full commit SHA, not a tag.
- Never `echo` secrets or print data rows; don't use `set -x` in steps that touch secrets.
- **Backups never go to Actions artifacts or logs** (both are public). Nightly export goes straight from the Worker to a private folder in the owner's Google Drive.
- Prod deploys use a GitHub Environment (`production`) limited to the `main` branch.

**App-level:** the prod app URL being public is fine; everything behind it needs auth. The `.ics` feed URL is a secret (tokenised) and must be revocable.

**If a secret leaks:** revoke/rotate it at the source (Cloudflare, email provider, etc.) immediately, update the GitHub/Worker secret, then clean up. Record what happened in `tasks/STATUS.md`.
