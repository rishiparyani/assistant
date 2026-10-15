# Scorecard 2026-10-15: the small frontier models, side by side

The comparison the owner asked for (decision 2026-10-15 "Try the small frontier models"): each maker's smallest current model at the everyday level, the same prompt, tools, cases and scoring, three runs of every case (core 20 × 3 = 60, hard 34 × 3 = 102). Level 2 not run (no AI credit yet). The free model and Cerebras from their earlier runs for scale.

| Everyday model                            | Core      | Hard       | Hinglish  | Median | Slowest | Cost a message¹      | Thinking |
| ----------------------------------------- | --------- | ---------- | --------- | ------ | ------- | -------------------- | -------- |
| GLM 4.7 Flash (free; 2026-10-14, one run) | 18/20     | 12/34²     | 5/11²     | 2.9 s  | 21.9 s  | free allowance       | off      |
| GPT-OSS 120B at Cerebras (one run each)   | 15/20     | 30/34      | 7/9       | 1.2 s  | 4.5 s   | ≈ ₹1.10 (trial)      | low      |
| **Claude Haiku 5.5**                      | **57/60** | **98/102** | **33/33** | 3.4 s  | 9.3 s   | ≈ ₹0.15              | low      |
| GPT-5.4 mini                              | 57/60     | 94/102     | 27/33     | 2.4 s  | 7.9 s   | ≈ ₹0.22              | none³    |
| GPT-5.4 nano                              | 50/60     | 94/102     | 28/33     | 2.7 s  | 8.2 s   | ≈ ₹0.08              | none³    |
| Gemini 3.1 Flash-Lite (free tier)⁴        | 45/60     | 64/102     | 21/33     | 5.6 s  | 38.4 s  | ≈ ₹0.15 (paid rates) | low      |

¹ A message is 2 to 3 model calls; costs at the makers' list prices with their cache rates, from the runs' own token counts. Haiku's two runs were priced before the cache fix (₹5.38 and ₹9.13 a run printed; about ₹3.5 and ₹6 at the cache rates); nano ₹2.20 and ₹4.06 a run; mini ₹5.94 and ₹9.10.
² GLM's hard run hit the free allowance halfway; those are not the model's misses.
³ On `/v1/chat/completions` OpenAI refuses function tools together with any `reasoning_effort` but `none` (a 400 naming `reasoning_effort`), so both GPT models answered without thinking first. Their Responses API would allow it; not tried.
⁴ Gemini ran on the free tier (no billing on the project yet), which rate-limits at about ten calls a minute: even paced, some calls were refused and count as misses, and one case took 38 s waiting. Its numbers are a floor, not a measure; and the free tier can't be used for real people's messages (Google may train on them).

## What each got wrong (three runs each)

- **Haiku:** `handover-card` 0/3 (made the card itself), `open-reminders` 0/3 (a tool bug since fixed: "Done = false" found nothing), `tick-two` 2/3. Every Hinglish and every date case right. (`docs/scorecard/2026-10-15-haiku.md`.)
- **GPT-5.4 mini:** `remind-parso` 0/3 ("parso subah" became tomorrow), `delete-hinglish` 1/3 and `expense-2k`, `expense-to-person`, `convo-and-another` 2/3 (asked a question instead of showing the confirm card), `handover-card` 0/3 (made the card itself). Everything else 3/3, including the other date cases.
- **GPT-5.4 nano:** the same `remind-parso` 0/3, plus `start-list` 0/3, `three-at-once` 1/3, and six money or delete cases at 2/3 where it asked "which category? paid with?" instead of showing the card. `handover-card` 0/3.
- **Gemini Flash-Lite:** on the free tier the misses mix the model's and the rate limit's: only 7 of the 34 hard cases were right all three times, and most of the rest are 1/3 or 2/3 with "the model was busy" as the first miss. Its own slips where it did answer: `note` 0/3 (wrote a different title), `expense-no-amount` (made up ₹0 once), `move-event-day` (kept the day once), `convo-correction` (10:00, not the corrected time, once), `handover-card` 0/3. Re-run on a billed project before reading anything into it.

## Reading it

- **Haiku and mini are a tier apart from nano and Flash-Lite on the hard cases**, and from the open models. Haiku is the only one that never missed a Hinglish or date case; mini missed "parso" every time, like Cerebras did.
- **Speed:** the GPT models are the fastest of the four at about 2.5 s a case with thinking off; Haiku 3.4 s with thinking on; Flash-Lite slow and uneven on the free tier.
- **Cost:** nano is the cheapest by far (about ₹0.08 a message), Haiku and Flash-Lite about ₹0.15, mini about ₹0.22. All of them are far inside the ₹2,000 cap for a band and a family: a thousand messages a month is ₹80 to ₹220.
- **`handover-card` is 0/3 on every model.** Five models in a row making the query card themselves instead of handing over says the case expects the wrong thing; it should be re-written or dropped before the next comparison.
- **Not yet tried:** the GPT models with thinking on (Responses API), Gemini on a billed project, and any of them at the setups level (the next round: `suite=setups` with `setup_model=…`, decision below).

**For the owner to pick:** right answers first, Haiku; speed first, mini (two misses more on the hard cases, every date case but "parso"); cost first, nano (ten misses more on the hard cases, mostly asking instead of showing the card). GLM stays the free fallback whichever is chosen, and Cerebras stays for owners and admins unless replaced.
