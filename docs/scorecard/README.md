# Model scorecard

How well the real models handle real requests, what they cost and how long they take (decision 2026-10-12 "A model scorecard decides…"). The requests and how each is graded: `apps/worker/scorecard/cases.ts`.

**Run it:** GitHub → Actions → **Scorecard** → Run workflow. Leave `paid_gateway` empty for the everyday (free) model only; put the paid gateway's id (`paid`) to score setups too, once AI credit is loaded. The run's summary page shows the table; copy it here as `YYYY-MM-DD.md`.

Runs so far: [2026-10-12](2026-10-12.md) (everyday, GLM 4.7 Flash: 18/20, median 12 s).
