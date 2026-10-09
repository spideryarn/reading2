You are reviewing the built change for plan 261009a in this working tree (Spideryarn). You may edit
files to FIX what you find, inside this change's scope; report anything wider instead of fixing it.
Do not commit, do not run anything that spends money on a model (no live API calls), do not touch any
database or `.env*`.

Read first: docs/plans/261009a-latest-model-versions-haiku-5-5-and-an-opus-digest-spike.md (with its
§ Plan review), your own plan review docs/plans/261009a-latest-models-plan-review-sol.md, and the
write-up docs/investigations/261009a-haiku-5-5-and-an-opus-digest-for-cheaper-models.md.

The change is `git diff HEAD` plus the untracked files (`git status --short`). In short:
- src/models.ts: capable tier Sonnet 5 → Sonnet 5.5 (`CAPABLE_MODEL`, `CAPABLE_MODEL_OPENROUTER`);
  Sonnet 5's spellings added to `generationKey`'s capable generation; quick tier, help chat and PDF
  reader GPT-5.6 Luna → GPT-6 Luna; new `PINNED_MODEL` holding `simple-check` on GPT-5.6 Luna,
  applied in `resolveModel`; the PDF figure locator deliberately NOT moved (comment says why).
- src/article-prompt.ts: `cacheFloorFor(model)` — 512 for Opus 5.5 and Sonnet 5.5, 1,024 otherwise.
- src/ai-call.ts: `quiz-verdict` now sends reasoning effort `none` (GPT-6 Luna spent its 8-token
  ceiling thinking). Test in tests/ai-call.test.ts.
- src/model-names.ts, src/pricing.ts, src/pdf-read.ts, src/web/PrivacyPage.tsx: inventory, price
  row, size table, reader-facing model list.
- tests updated where they pinned old ids or the old floor.
- docs/project/*.md current-state statements; setup-dev.md § Which model everything uses gained the
  "always the latest version of each family" rule (Greg's request) and the table.
- evals/digest/ (new spike harness, lineups, tally), evals/help-chat/run.ts and
  evals/title-tidy/run.ts (new arms/flags), results under evals/results/.
- tools/overseer and tools/fleet were deliberately NOT moved (your plan-review finding 1).

Check, and fix where in scope:
1. Correctness of the model moves: anything still resolving to an old id that should not, or a new id
   reaching a place keyed on the old one (price tables, display names, per-model tables, provider
   pins, tests that would pass for the wrong reason). Is `PINNED_MODEL` consulted everywhere a
   task's model is decided or reported (e.g. /api/models, `modelsInUse`, any code that maps a tier
   straight to an id, `TASK_TIER`-based inventories)? Does `generationKey` keep every stored Sonnet 5
   artefact fresh and every stored hash identical?
2. `cacheFloorFor` and its callers (labels' `prefixIsCacheable`, Simple's stagger, structure expand,
   anything else that calls `underCacheFloor` or used the old constants directly).
3. quiz-verdict: is `none` sent on the wire for it now, through the real request path; any other
   quick-tier job with a tiny ceiling and provider-default reasoning that GPT-6 Luna would starve
   the same way?
4. The write-up's numbers against their sources: evals/results/digest-2026-10-09/judging/tally.md,
   costs.md, evals/results/latest-models-smoke-2026-10-09.md,
   evals/results/fidelity-guard-luna6-new-alarms-2026-10-09.md, the help-chat and title-tidy results.
   Flag any number or claim the sources do not support, and any conclusion stated more strongly than
   three articles and two judges allow. Fix the wording if so.
5. The eval code in evals/digest/: anything that would make a rerun silently wrong (blinding leaks,
   key mismatches in tally.ts, budget reservation).
6. Anything else wrong.

Then run `npm run typecheck` and the test files you touched or that cover what you touched
(`npx vitest run <files>`); report results. Finish with a numbered list of findings — each with
severity, file:line, what you changed (or why you left it) — and a one-line verdict.
