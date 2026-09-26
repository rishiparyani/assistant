# Status

_Updated: 2026-09-26_

## Last done

- Repo setup from the project brief (no application code): `AGENTS.md` (+ `CLAUDE.md` symlink), `docs/`, `tasks/`, folder structure, root configs.
- Architecture made flexible: a small core plus feature modules, with Gigs as module one (see `docs/modules.md` and the decision in `docs/decisions.md`).
- Original brief archived in `docs/archive/gig-assistant-brief.md`.

## Next

**T00 Spike**: Better Auth on Workers + D1 (Google sign-in, organization plugin as workspaces) and a minimal MCP endpoint connected to Claude via OAuth. See `tasks/backlog.md`.

## Open decisions

- **Member shares** (blocks T02): track each band member's share and payout in Phase 1, or only the band's total fee?
- **Other modules**: which other tasks should the assistant help with after gigs? Ideas in `docs/roadmap.md`. Doesn't block Phase 1.

## In progress

Nothing.

## Gotchas

- `CLAUDE.md` is a symlink; on Windows without symlink support replace it with a file containing `@AGENTS.md`.
- Root `package.json` scripts are placeholders until T01.
