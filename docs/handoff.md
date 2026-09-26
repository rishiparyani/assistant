# Handoff between agents

Claude Code, Codex and others should be interchangeable at any task boundary, and ideally mid-task.

## Starting a session

1. Read `AGENTS.md`.
2. Read `tasks/STATUS.md`: current task, what's half-finished, gotchas.
3. Read the current task in `tasks/backlog.md` and its acceptance criteria.
4. `git log --oneline -20` and `git status` to see recent work.
5. Run `pnpm install && pnpm typecheck && pnpm test` to confirm a clean starting point (once T01 exists).

## Ending a session (even mid-task)

1. Commit work in progress on a branch; don't leave uncommitted changes.
2. Update `tasks/STATUS.md`:
   - **Last done:** what was finished, with task ID.
   - **In progress:** what's half-done, where, what's left.
   - **Next:** the next concrete step.
   - **Gotchas:** anything surprising (tooling, Cloudflare limits, library quirks).
3. Record new decisions in `docs/decisions.md`.
4. If acceptance criteria changed, update `tasks/backlog.md`.

## Symlinks on Windows

`CLAUDE.md` is a symlink to `AGENTS.md`. On Windows clones without symlink support, replace it locally with a file containing just `@AGENTS.md`.
