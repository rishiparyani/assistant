# Journeys

A robot browser uses the built site the way a person does, at phone size, against the local
test server with made-up accounts (decision 2026-10-31 "Journeys guard every change"). CI runs
them on every pull request (the `journeys` job); a failing journey blocks the change.

Run them locally:

```
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # once
pnpm build && pnpm db:migrate
cd apps/worker && pnpm exec wrangler dev --local -c ../web/dist/assistant_dev/wrangler.json \
  --port 8787 --local-upstream localhost:8787 --persist-to .wrangler/state &
pnpm --filter @assistant/e2e e2e
```

Rules:

- Made-up people and data only, made through the API in each journey (`journeys/helpers.ts`);
  names carry the run's id so the journeys can run again on the same server.
- Every journey checks the page never crashed and never scrolls sideways at phone width.
- Every bug the owner reports becomes a journey (or a step in one) before it is fixed.
- A change that alters a screen on purpose updates its journey in the same pull request.
