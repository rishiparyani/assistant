# Setup: accounts, secrets, deploys, limits

What exists outside the repo, where each secret lives, and how code gets deployed. Read this before touching deploys, secrets or CI. The repo is **public**: also read [security.md](security.md#public-repository).

## How deploys work

Agents (Claude Code, Codex) never deploy from their own session and never hold the Cloudflare token.

1. Agent pushes code to GitHub.
2. GitHub Actions runs the workflow in `.github/workflows/` (added in T01).
3. The workflow deploys to Cloudflare using the repository secrets below.

| Push to | Deploys to | Database |
| --- | --- | --- |
| `main` | **prod** Worker | prod D1 (real data) |
| any other branch in this repo | **dev** Worker | dev D1 (fake data only) |
| pull request from a fork | **nothing**; tests only, no secrets | none |

Rollback: redeploy an earlier commit from the Actions tab, or `wrangler rollback`.

## Where secrets live

Never in the repo, never in chat, never in logs.

| Secret | Where | Used for | Needed from |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub → Settings → Secrets and variables → Actions | Deploys. Custom token: Account → Workers Scripts: Edit, D1: Edit, Account Settings: Read (add R2: Edit in T12). | T00 |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | Deploys | T00 |
| `BETTER_AUTH_SECRET` | Worker secret (set by the deploy workflow from a GitHub secret of the same name) | Signing sessions/tokens. Random 32+ bytes; separate values for dev and prod. | T00 |
| Email service API key (e.g. Resend) | Worker secret via GitHub secret | Magic-link emails | T03 |
| VAPID keys (web push) | Worker secret via GitHub secret | Push notifications | T11 |
| Google OAuth client ID/secret | Worker secret via GitHub secret | Only if Google sign-in is added (see decisions) | optional |
| Local values | `apps/worker/.dev.vars` (git-ignored); template in `.dev.vars.example` with placeholders only | `wrangler dev` | T01 |

Not secret, fine to commit: D1 database names and IDs, Worker names, the public app URL. They can't be used without the API token.

## What the owner does by hand (agents can't)

Done by the repo owner in the browser; agents should give step-by-step instructions when these are needed.

1. **Cloudflare account** (free) at dash.cloudflare.com. Account ID: Workers & Pages page, right sidebar.
2. **Cloudflare API token**: profile icon → My Profile → API Tokens → Create Token → Custom token, permissions as in the table above, Account Resources = own account. Shown once.
3. **GitHub repository secrets**: Settings → Secrets and variables → Actions → New repository secret.
4. **GitHub safety settings** (public repo): Settings → Code security → enable **Secret scanning** and **Push protection**; enable **Dependabot alerts**. Settings → Actions → General → "Fork pull request workflows": require approval for all outside contributors.
5. **Default branch → `main`**: Settings → General → Default branch, once `main` exists (T01). Currently the default is an old `claude/…` working branch because it was pushed first.
6. **Branch protection on `main`** (T01): require CI to pass before merge.
7. **Claude custom connector** (end of T00, and T10): Claude settings → Connectors → add custom connector with the app's `/mcp` URL.
8. **Later**: domain (DNS on Cloudflare), email service account, enable R2 (asks for a payment method even on the free tier), Siri Shortcuts on the iPhone.

Status of each is tracked in `tasks/STATUS.md` under "Owner setup".

## Free-tier limits

**GitHub Actions:** public repo = unlimited minutes. If the repo is made private: 2,000 min/month on the free plan (a CI + deploy run is ~2–3 min; nightly backup ~1 min). Over the limit, with the default $0 spending limit, workflows stop until the next month; nothing is charged and the live app keeps running.

**Cloudflare Workers + D1 free plan** (per day, reset 00:00 UTC = 05:30 IST): 100,000 Worker requests; 10 ms CPU per request; D1 5 million rows read, 100,000 rows written; 5 GB total D1 storage. Over the limit on the free plan, requests fail until reset; nothing is charged. Upgrade path: Workers Paid, $5/month. Keep usage low: index every filtered column, never scan whole tables, no polling from clients.

Check current numbers in Cloudflare's and GitHub's docs before relying on them; they change.
