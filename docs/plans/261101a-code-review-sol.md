The eval is not ready to support the open recommendation to Greg. The main blocker is incomplete Synesthesia ground truth.

1. **High — Synesthesia truth is incomplete.** The builder only collects bracketed footnotes before “See also”; it misses named or linked works such as *Speak, Memory* and does not classify *The Yellow Sound* or 14 *Further reading* entries as list-only. This makes the 667-work denominator and false-row claim provisional. I documented this in the [investigation](/var/tmp/spideryarn-worktrees/fbd5e2jk-citations-eval-haiku/docs/investigations/261101a-citations-recall-haiku-vs-sonnet-prompt-eval.md:25). Rebuilding requires the gitignored block dump/local Supabase, which this sandbox cannot access.

2. **High — Greg’s question overstates the evidence.** [q-ns76uq.md](/var/tmp/spideryarn-worktrees/fbd5e2jk-citations-eval-haiku/docs/user-feedback/questions/q-ns76uq.md:10) says Haiku beat Sonnet on all seven papers in all three runs. It beat it on five and tied on Clark/Chalmers and Vaswani; the third high-effort run omitted LeCun. Aggregate high-effort cost was about 6.1–7.2× cheaper, not 8×. “Nothing false,” the exhaustive 667 count, and “splitting was not needed” are also stronger than the evidence permits. I left the question untouched as instructed; it should be corrected or withdrawn before Greg decides.

3. **High — scorer evidence matching penalised correct rows. Fixed.** `surnameYear` ignored verified quotes, so rows anchored by `2020a`, `forthcoming`, or multiple years could silently miss. The matcher now reads metadata and anchored quotes. This changes stored results:

   - S0 LeCun: 16/96 → 17/97.
   - S0 Dropout: 94 → 97.
   - S0 Clark/Chalmers: 94 → 100.
   - S1 Dropout: 94 → 97.
   - S0 aggregate reader recall: 70% → 71%.

   The corrected logic is in [score.ts](/var/tmp/spideryarn-worktrees/fbd5e2jk-citations-eval-haiku/evals/citations-recall/score.ts:68), with regression tests in [citations-recall-score.test.ts](/var/tmp/spideryarn-worktrees/fbd5e2jk-citations-eval-haiku/tests/citations-recall-score.test.ts:18).

4. **Medium — three more silent scorer failures. Fixed.** PDF entries beginning `8)` were rejected despite production accepting that style; primary reference blocks repeated in `aliases` were counted as two owners; and valid JSON with an invalid bibliography shape crashed scoring instead of receiving zero recall. `fromEntry` now also accepts older years. Tests cover these cases.

5. **Medium — the runner differs from production in more than three declared ways.** Article text, schema, and PDF reference-list construction match production, but arms also vary effort and the user turn, while deliberately omitting production’s conditional cache breakpoint. I corrected the claims in [run.ts](/var/tmp/spideryarn-worktrees/fbd5e2jk-citations-eval-haiku/evals/citations-recall/run.ts:9) and the investigation.

6. **Medium — the `why` comparison is weaker than written.** Layfield is excluded, so the 24 pairs cover six non-PDF articles, not every article. The judging transcript was not saved, making the 10/6/8 preferences and error counts unreproducible. I also fixed `why-pairs.ts` to match complete lists globally; its previous one-work-at-a-time calls could falsely treat a compound reference block as unique.

7. **Low — the production cap change is safe.** Omitting `cap` still defaults to `MAX_CITATIONS`; production behavior is unchanged. I added an explicit eval-cap/default-production-cap regression test in [bibliography.test.ts](/var/tmp/spideryarn-worktrees/fbd5e2jk-citations-eval-haiku/tests/bibliography.test.ts:917).

Checks: 131 focused tests passed; full typechecking passed. Lint has one informational complexity warning in the eval runner. Full `npm test` and the complete free rescore were blocked because this sandbox cannot access Docker/local Supabase. No model or paid runner was called.