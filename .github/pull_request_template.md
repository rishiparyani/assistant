## What changed

<!-- In plain words: what the owner will notice. -->

## Checks

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (exit codes, not grep)
- [ ] New screens checked at 390 / 820 / 1280 px, light and dark

## Handoff (any agent must be able to continue from the repo)

- [ ] `tasks/STATUS.md` updated: Last done, Next, Gotchas (the Handoff check enforces this; `[skip-status]` only if status really didn't change)
- [ ] New decisions recorded in `docs/decisions.md`
- [ ] Steps the owner must do (accounts, secrets, settings) are listed in STATUS
- [ ] No secrets or real personal data in the diff (public repo)
- [ ] Security changes (new ways to reach data: tokens, OAuth, push, sharing) wait for the owner's explicit OK
