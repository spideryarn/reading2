# Code review: the reading-time estimate knows how hard the piece is

You are reviewing code built from a plan you reviewed earlier today. **You may fix what you find**
inside this work's own files; report anything wider for me to decide. Do not commit. Do not run
git commands that change state.

Read, in this order:

1. `docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md`
   — the plan, revised after your plan review
   (`docs/plans/261005j-reading-time-difficulty-plan-review-sol.md`).
2. `docs/plans/261005j-reading-time-difficulty-code-review.diff` — everything this work changed
   against `dev` (generated metadata and the eval's results file left out).
3. `docs/investigations/261005b-reading-time-difficulty-multiplier-coefficients-and-where-the-rating-comes-from.md`
   and `evals/results/reading-time-difficulty-2026-10-05.json` — the evidence and the paid run.
4. `CLAUDE.md` for the house rules.

## This is the second start of this review

The first was killed by the box's memory guard about fifty minutes in, before it wrote a verdict.
What it had changed is kept and is in the diff: `sampleForRating` now reserves the final run and
samples inside an oversized paragraph, with two new tests, and the prompt version went to
`reading-difficulty/2`. Those tests pass, and the paid check was run again on that sampler
(`evals/results/reading-time-difficulty-2026-10-05.json`; the first run is
`…-prompt-1.json`). Check that change like the rest; you need not redo it. Since then the tree has
merged `dev` twice and the migration was regenerated as
`drizzle/20261005184207_reading_difficulty.sql`. `tests/reading-difficulty-pg.test.ts` has now
run, in its private database, and passes.

## What has and has not been checked

- `npm run typecheck`: clean.
- Run and green: `tests/reading-difficulty.test.ts` (seen red before the module existed),
  `tests/reading-difficulty-blocks-step.test.ts` (seen red before the wiring),
  `tests/reading-minutes-difficulty.test.ts`, `tests/read-time-card.test.tsx`,
  `tests/library.test.ts`, `tests/block-policy.test.ts` (these four were NOT seen red when
  written; I mutated `difficultyMultiplier` to always return 1 afterwards and 11 tests across them
  failed), and 24 registry, DTO, pipeline and doc suites.
- **Not run at all: every Postgres test that needs the new columns** —
  `tests/reading-difficulty-pg.test.ts`, the new cases in `tests/store-artefacts-pg.test.ts`,
  `tests/store-revision-policy.test.ts`, `tests/store-revision-columns.test.ts`,
  `tests/db-schema-drift.test.ts`, the export tests. The migration
  `drizzle/20261005181654_reading_difficulty.sql` cannot be applied to the shared local database
  yet: another session's unlanded migration is in its ledger and `db:migrate` refuses. **Do not try
  to apply it, and do not run DDL by hand.** So read the storage code with more care than the
  rest: it has only ever been type-checked.
- The paid run made 48 real calls through the module and the gateway route; all returned a rating.

## What I want from you

1. **The storage path, by reading.** `src/store/artifacts.ts`, `artifact-storage.ts`,
   `artifacts-pg.ts` (the new `readingDifficulty` site, `readReadingDifficulty`, the refusal of a
   part-made rating), `pg-revisions.ts` (`carry`), `pg.ts` (the read policy, the projections,
   `metaFrom`, the shelf's scalars and its recompute fallback), `public-reader.ts`,
   `public/dto.ts`, `export.ts`. Is there a path where: a rating is shown beside blocks it was not
   made from; a `meta` write clears it; a draft that re-splits its blocks keeps the old one after
   an unrated run; a revision with no blocks (a minimal paper) claims to have run `blocks`; the
   owner's article and the shelf entry disagree on the minutes; the public reader leaks the model
   or the time? One decision to look at hard: null columns read back as `{ rated: false }` when the
   revision has blocks and as absent when it has none, so that every existing article's `blocks`
   step still counts as done. Is that right, and does anything else infer "done" differently?
2. **The wiring**, `src/pipeline.ts` § `ratedReadingDifficulty` and the `blocks` step. It catches
   everything but the step's own cancellation. Is `ctx.signal.aborted` the right test (compare
   `src/reading-difficulty.ts` § `abortOf`)? Does any existing test now reach the real gateway
   through `STEPS.blocks.run` (a fixture of 150 words or more with no stub)? `vitest.config.ts`
   blocks provider hosts, and this wrapper would swallow that refusal. If so, say which tests, and
   whether a default stub in the test setup is the right fix.
3. **The call**, `src/reading-difficulty.ts`: the sample (budget, the cut of an over-long
   paragraph, the last run reaching the end), the parse, what is logged, the prompt against
   `docs/project/prompting-guide.md`.
4. **The numbers**, `src/reading-time.ts`: the tables match the plan; the multiplier goes in before
   rounding and the one-minute floor; `readingRange` and `readingMinutes` cannot disagree.
5. **The card**, `src/web/ReadTimeCard.tsx`: does every sentence say something true for a rated
   piece, an unrated piece, a piece whose adjustment rounds away, and a piece under a minute? Is
   anything a reader should not see on it (a model id, a cost)?
6. **The docs and the investigation**: any claim the code or the results file does not support. In
   particular check the investigation's § 4 table and its "read by a person" bullets against
   `evals/results/reading-time-difficulty-2026-10-05.json`, and its statement that the first table
   double-counted Carver's slowdown.
7. **Do not add a quotation from Greg anywhere, and do not change the wording inside an existing
   blockquote.** If a doc needs his words, say so in your report and leave it to me.

You may run `npx vitest run <one file>` for files that need no new columns, and
`node --import tsx scripts/typecheck.ts` if the tsx CLI socket is blocked in your sandbox. The box
is short of memory; if vitest refuses to start, say so and carry on by reading.

Report: a verdict; numbered findings, most serious first, each with file and line; for each, what
you changed or why you left it; and a list of every file you edited. Say plainly what you could not
check.
