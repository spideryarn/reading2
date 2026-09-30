# Code review: PDF transcription glitches (260930e)

You are reviewing, and fixing, the code built from `docs/plans/260930e-pdf-transcription-glitches.md`.
Repo: the current directory (TypeScript + ESM, vitest). Read the plan first, then the review of it:
`docs/plans/260930e-pdf-transcription-glitches-plan-review-sol.md` and how each finding was handled
(§ "The plan review, and what was done with it" in the plan).

The diff: `git diff origin/dev -- src/pdf-read.ts src/pdf-authors.ts evals/pdf/titles.mts tests/pdf-continuations.test.ts tests/pdf-seam-hyphens.test.ts tests/pdf-authors.test.ts tests/pdf-frontmatter-wiring.test.ts docs/project/content-extraction.md`
(`git diff origin/dev` on its own includes other people's merged work; use the pathspec.)

What changed:

1. `continuationTargets` in `src/pdf-read.ts` — one join rule for `renderHtml` and `mendSeamHyphens`,
   which used to keep a copy each. It bridges page furniture at a page turn and figures/tables back
   to the prose they interrupted, with `reaches` and `visiblyUnfinished` as the guards.
2. `verifyAuthors` in `src/pdf-authors.ts` — a new verdict arm, names without a list, when every name
   verifies and an affiliation does not; `runPdfExtract` builds the byline from those names.

Evidence: the plan's § "What the measurement found": 80 new joins over 28 real record sets, none
un-joined, each read by a subagent. The measurement script is not in the repo (it read production
data); its logic is: compute the old rule's targets and `continuationTargets` over each record list
and list every index where they differ.

Please:

- **Hunt for wrong output**: record sequences where `renderHtml` now produces a wrong join, loses a
  record's text, duplicates it, mis-nests `<ul>`, or mis-numbers a figure ordinal (`figureMarker`),
  and where `mendSeamHyphens` now moves a word into a paragraph the reader sees as separate. Check
  `reaches` for off-by-one page logic, and `ENDS_A_SENTENCE` for inputs it misreads.
- Check `verifyAuthors`' new arm cannot store a name that fails, cannot skip the "nobody skipped"
  check, and that every caller of `AuthorsVerdict` handles the new arm.
- Check the tests would fail if the behaviour they name were removed.
- **Fix what you find inside this scope**, with a test that was red first; report anything wider
  for me to decide. Run `npx vitest run tests/pdf-continuations.test.ts tests/pdf-seam-hyphens.test.ts
  tests/pdf-authors.test.ts tests/pdf-frontmatter-wiring.test.ts tests/pdf-read.test.ts` and
  `npm run typecheck` after any change.

Write findings as a numbered list: severity (P0/P1/P2), file:line, the concrete failing input, and
what you changed (or why you did not). End with a one-line verdict.
