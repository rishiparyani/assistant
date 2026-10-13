# Model scorecard

How well the real models handle real requests, what they cost and how long they take (decision 2026-10-12 "A model scorecard decides…"). The requests and how each is graded: `apps/worker/scorecard/cases.ts`.

**The cases** (57 everyday + 3 setups):

- **core** (23): the first set, plain requests. Today's model gets 19/20 here, so it can't tell good models apart any more.
- **hard** (34, added 2026-10-13): the things small models get wrong.
  - Dates said many ways: day after tomorrow, parso, aaj raat, "5 Nov at noon", "in 2 hours", this Friday.
  - Money in Indian words: 2k, 1.5 lakh.
  - Two expenses in one message.
  - Never making up an amount.
  - Filing by what it remembers.
  - Asking when two records match instead of guessing.
  - Ticking the right two of three.
  - Money changes and deletes that wait for a tap, including "delete all".
  - Moving an event "to Sunday, same time".
  - Answering only what was asked ("what's on tomorrow", "what's still open", "how much on cabs").
  - A note whose text gives orders (must be ignored).
  - Conversations: a correction ("actually make it 11"), a follow-on ("and 200 on picks").
  - More Hinglish throughout.
  - Questions answered by the engine (`query`): spending by category, this month's total (Hinglish), the biggest category.

**Run it:** GitHub → Actions → **Scorecard** → Run workflow. The inputs:

- `suite`: `all`, `core` or `hard`.
- `repeat`: runs of each case, 1–5. Models are not the same every time: a case right 3/3 is trustworthy, 2/3 is not.
- `model`: an everyday model to try instead of today's. It's an id from `MODELS` in `apps/worker/src/core/assistant/models.ts`; candidates are listed there with `ready: false`:
  - DeepSeek V4 Flash
  - GLM 5.3 Flash (its thinking can only be turned down to "low")
  - Qwen 3.8 27B
- `paid_gateway`: empty for everyday cases only. Put the paid gateway's id to score setups too, once AI credit is loaded.
- `only`: comma-separated case ids, for fixing one.

The run's summary page shows the table; copy it here as `YYYY-MM-DD.md`. The table gives each case's right count over its runs, the first miss's reason, and the model's tool calls for every miss (in the log).

Runs so far:

- [2026-10-12](2026-10-12.md): everyday, GLM 4.7 Flash, 18/20, median 12 s.
- [2026-10-13](2026-10-13.md): thinking off, 19/20, median ~4–8 s.

**Mind the free allowance:** it's 10,000 neurons a day, shared with the real app (dev and prod are one Cloudflare account).

| Run  | Neurons (GLM 4.7 Flash) |
| ---- | ----------------------- |
| core | ~2,000                  |
| hard | ~3,000                  |
| all  | ~5,000                  |

Other models may use more. So one `all` run a day on the free allowance, early in the India morning. Repeats and model comparisons are for when AI credit is loaded, where a full run costs a few rupees.
