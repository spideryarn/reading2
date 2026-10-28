# Code review: 261028c stage 1, the `explanations` step

You are reviewing **code**, with write access. The candidate is the last commit on this worktree's branch: `git show HEAD --stat`, `git diff HEAD~1 HEAD`. The plan it implements is `docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md` (§ Idea 2, § Stages item 1); your own earlier review of the plan is `docs/plans/261028c-plan-review-sol.md`.

The closest existing step, and the one this copies, is `src/faq.ts` (plus its pipeline wiring, store column, route and tests). Compare against it.

## What to look for

1. Correctness of `src/explanations.ts`: the quote checks (`findQuote` spaced, `findOnlyQuote` for the once-only rule, the stored quote is the block's own characters), the drop counting, the cap applied after every other rule, the three empty outcomes, the stamp fields and freshness (`isStale`, `isOutdated`, profile hash), the prompt (profile only in the user message, after the cached article; no block-id enum).
2. The seams: migration and step-name CHECK, `article_revisions` column, carry-forward to new revisions, export, reset, freshness deciders, `GET /api/explanations/:slug` (owner-only, `orNullWhenNotMadeYet`, `withProfileChanged`), the job path, the cost category and model routing (`TASK_TIER`, `TASK_WIRE`, `JOB_DISPOSITION`, `ChatJob` exclusion). Is anything missed that FAQ has? Anything that leaks it to a visitor or to the public read?
3. Deliberate choices, to check rather than undo: it is NOT in `AUTO_MODE_STEPS` and NOT in `METADATA_RERUN_STEPS` (comment in `src/rerun-steps.ts` says why). The user message carries no tree skeleton.
4. Tests: do they fail when the rule they name is broken? Anything important untested?

Model calls cannot be made (the API key is over its limit until 1 November), so do not try to run the live step. The local database may not have this migration applied; tests that build their own database from the tree's migrations are the ones to trust.

## How to work

Fix what you find inside this stage's files, keeping the surrounding style, and run `npx vitest run tests/explanations.test.ts` and `npm run typecheck` after your edits. Do not commit, push or deploy; do not touch production, `.env.local`, systemd or `infra/`. Report anything wider than this stage for me to decide.

## Answer

Findings with IDs (CR-1, …), severity P0–P3, file:line, what is wrong, and what you changed (or why you did not). Then a list of files you edited and the test commands you ran with their results. End with a one-line verdict.
