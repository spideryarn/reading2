# Code review: a line at the top of a chunk is not lost at the seam

You are reviewing code built from a plan you already reviewed (your plan review, verdict RETHINK,
is docs/plans/261022h-a-line-at-the-top-of-a-chunk-is-not-lost-at-the-seam-plan-review-sol.md; the
plan was rewritten after it). Repo: Spideryarn (TypeScript, ESM). You may edit files inside this
change: fix what you find, and report anything wider for me to decide.

Read:
- docs/plans/261022h-a-line-at-the-top-of-a-chunk-is-not-lost-at-the-seam.md (the plan, as built)
- the diff: `git diff HEAD -- src/ docs/project/content-extraction.md`, plus the new file
  tests/pdf-seam-head.test.ts
- src/pdf-score.ts — `check`, `scorePage`, `headOf`, `seamHead`, `SEAM_HEAD`, `alignedMask`,
  `coveredMask`, `spansOf`, `PageScore`
- src/pdf-read.ts — `checkChunk`, `checkEmitted` (phase 2), `withoutRepeats`, the check-retry loop
  in `runPdfExtract`, `reaches`
- src/pdf.ts — `ENDS_A_SENTENCE` (moved here from pdf-read.ts), `baselineFor`

Evidence (scratch, uncommitted, in data/fbrg5kk6-prod-read/): `measure.mts` scores every seam of a
saved full read as `checkChunk` does; `all-{rovelli,kuhn,harder,muchharder,easy}.json` are those
reads (production model). `npx tsx data/fbrg5kk6-prod-read/measure.mts
data/fbrg5kk6-prod-read/rovelli.pdf data/fbrg5kk6-prod-read/all-rovelli.json 43` reproduces the
production shape (page 43's first record removed) and should fire on 43 only. Do not run anything
that calls a model.

Gates: `npx vitest run tests/pdf-seam-head.test.ts`, `npx vitest run tests/pdf` (the PDF suites),
`npm run typecheck`, `npx vitest run tests/doc-links.test.ts`. The full suite was green before
your review.

Questions:
1. Is `headOf` right: the first index the in-order alignment covers, on the whole chunk's
   `overall` score? Inputs where the head is miscounted (furniture, a running head pass 0 kept,
   alignment that skips the head because a later identical phrase aligned instead)?
2. `seamHead`'s conditions: `checkable[0] !== first` (first page blank or scan), the last
   non-blank baseline line of the context page, `ENDS_A_SENTENCE` on it. False fires or misses
   the tests do not cover?
3. Does moving `ENDS_A_SENTENCE` change `reaches` in any way?
4. Does adding `head` to `PageScore` break any consumer (serialised scores, the per-page table,
   `shared`'s Omit, quality notes)?
5. Phase 2: does the new failure text reach `checkEmitted`'s quality note sensibly?
6. The tests: does each one fail for the right reason without the rule?

Write findings as a numbered list, each with severity (high / medium / low), the input that breaks
it, and what you changed (or would change). End with a one-line verdict: SHIP, SHIP WITH THE FIXES
MADE, or DO NOT SHIP.
