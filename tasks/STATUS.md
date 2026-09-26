# Status

_Updated: 2026-09-26_

## Last done

- Repo setup from the project brief (no application code): `AGENTS.md` (+ `CLAUDE.md` symlink), `docs/`, `tasks/`, folder structure, root configs.
- Architecture made flexible: a small core plus feature modules, with Gigs as module one (see `docs/modules.md` and the decision in `docs/decisions.md`).
- Decisions recorded: per-member shares and payouts in Phase 1 (T02/T05 updated); no further modules planned yet.
- Original brief archived in `docs/archive/gig-assistant-brief.md`.

## Next

**T00 Spike**: Better Auth on Workers + D1 (Google sign-in, organization plugin as workspaces) and a minimal MCP endpoint connected to Claude via OAuth. See `tasks/backlog.md`.

## Open decisions

None. Resolved 2026-09-26:

- Member shares: tracked per member (roster, lineup with shares, payouts). See `docs/data-model.md`.
- Other modules: none planned; add as needs come up.

## In progress

Nothing.

## Gotchas

- `CLAUDE.md` is a symlink; on Windows without symlink support replace it with a file containing `@AGENTS.md`.
- Root `package.json` scripts are placeholders until T01.
