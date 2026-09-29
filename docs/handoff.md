# Handoff between agents

Claude Code, Codex and others should be interchangeable at any task boundary, and ideally mid-task.

## Starting a session

1. Read `AGENTS.md` (note: the repo is **public**; see its safety section and `docs/setup.md` for deploys and secrets).
2. Read `tasks/STATUS.md`: current task, what's half-finished, gotchas.
3. Read the current task in `tasks/backlog.md` and its acceptance criteria.
4. `git log --oneline -20` and `git status` to see recent work.
5. Run `pnpm install && pnpm typecheck && pnpm test` to confirm a clean starting point (once T01 exists).

## Ending a session (even mid-task)

1. Check the diff for secrets or real personal data before committing (public repo).
2. Commit work in progress on a branch; don't leave uncommitted changes.
3. Update `tasks/STATUS.md`:
   - **Last done:** what was finished, with task ID.
   - **In progress:** what's half-done, where, what's left.
   - **Next:** the next concrete step.
   - **Gotchas:** anything surprising (tooling, Cloudflare limits, library quirks).
4. Record new decisions in `docs/decisions.md`.
5. If acceptance criteria changed, update `tasks/backlog.md`.

## Enforced, not remembered

Agents don't remember between sessions, so the repo enforces the handoff: the **Handoff** check (`.github/workflows/handoff.yml`) fails a PR that changes app code (`apps/`, `packages/`, `scripts/`, `shortcuts/`) without changing `tasks/STATUS.md`. A line containing only `[skip-status]` in the PR description lets a change through with a warning (a mention inside a sentence doesn't count), for when status truly didn't change. The PR template (`.github/pull_request_template.md`) carries the rest of the checklist. The check proves STATUS was touched, not that it's accurate: keep it true.

## Symlinks on Windows

`CLAUDE.md` is a symlink to `AGENTS.md`. On Windows clones without symlink support, replace it locally with a file containing just `@AGENTS.md`.
