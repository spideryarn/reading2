# Code review: quick search, lower floors (261004k)

Up: [the plan](261004k-quick-search-lower-floors-so-more-shows-up.md)

You are reviewing one commit, `c345e9aa6`, in this worktree. Read `git show c345e9aa6`.

## What it does

Greg, 2026-10-04: "for the Quick search, perhaps a more permissive threshold, so that more shows
up". The commit lowers two constants in `src/quick-search.ts`: `QUICK_FLOOR` 0.7 to 0.65 and
`QUICK_FALLBACK_FLOOR` 0.5 to 0.4. The rule (`hitsFrom`) is unchanged.

## The conclusion to check, not only the code

The claim is that these two numbers are the most permissive ones whose precision can be defended,
and that the write-up states the cost honestly. Please check the conclusion against the evidence,
and say if you would have picked different numbers from the same data.

- Plan: `docs/plans/261004k-quick-search-lower-floors-so-more-shows-up.md`
- Investigation: `docs/investigations/261004d-quick-search-lower-floors-precision-by-score-band.md`
- Scripts and text-free results: `evals/results/quick-search-lower-floors-2026-10-04/`. The scripts
  are `.mjs.txt`; to run them copy to a gitignored `data/qeval/` as `.mjs` (they read
  `evals/results/...` relative to the repo root and write to `data/qeval/`, or to `$QOUT`; copy
  the `judged3*.json` and `pool3-key.json` files there too). They make no model call. `pool3`
  needs nothing but the fixtures.
- The earlier evals whose scores are replayed: `evals/results/quick-search-recall-2026-10-03/` and
  `evals/results/quick-search-category-words-2026-10-03/`, with investigations 261003c and 261003f.

Things I would most like checked:

1. **Recompute the headline numbers** from the saved files: the band table (86 / 62 / 38 / 27 / 13
   on working searches), the fallback bands, passages per search before and after, 107 of 111
   against 99, the 6 of 111 that got shorter, the agreement figures (70 of 86, 0 of 97 decoys).
2. **Is the replay faithful to `hitsFrom`?** Inclusive floors, best first, cap 20, cap 8, fallback
   only when the list is empty. Ties.
3. **Is the verdict join right?** `replay-floors.mjs` joins earlier labels and the new judge's by a
   key; a variant ("Results") shares its base query's verdicts ("results"), and a request ("what
   were the results?") is judged as its base. Is any passage counted right or wrong on the wrong
   query's verdict? Is a judged pair ever silently treated as unjudged or the reverse?
4. **Is the pool blind and complete?** `pool3.mjs`: could a judge infer the score from the order or
   the selection? Is anything a candidate rule could show on a fixture left unjudged (the tables
   claim zero unjudged on fixtures for the chosen rule)?
5. **Is anything overstated?** In particular "0.65 is the last band where a passage is more likely
   right than wrong, on all three kinds of query" (bare is 55% at 0.65 to 0.7 and 61% at 0.6 to
   0.65), and the claim that the cliff "moved, it did not grow".
6. **Docs**: `docs/project/search.md` § Quick search, the comments on the two constants, the test
   names. Any stale 0.7 or 0.5 left anywhere in `src/`, `tests/` or `docs/project/` that now
   describes the wrong number.

## What you may change

You may fix what you find inside this stage: the constants' comments, the tests, the three docs,
the scripts. Do not change the two numbers or the rule; if you think they are wrong, say so and
why, and I will decide. Report anything wider. Do not run `git commit`, `git push`, `git stash`,
`git reset`, `git checkout` or `npm run deploy`. Do not attribute any sentence to Greg that is not
already quoted in the files with his name and a date.

Run `npx vitest run tests/quick-search.test.ts tests/doc-links.test.ts` and `npm run typecheck`
after any change.

## What to write back

Findings as P0 to P3, each with the file and line, what is wrong, and what you did or recommend.
Then one line: land, or not, and why.
