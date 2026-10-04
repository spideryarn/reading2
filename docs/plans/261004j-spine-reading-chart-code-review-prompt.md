# Code review: the spine's reading-time chart, fainter and rarely full

Repo: this worktree, branch worktree-spine-reading-fainter-and-compressive. TypeScript, React, Vite.

You may fix what you find **inside this stage's files** (listed below) and must report anything wider for me to decide. Do not commit, do not run git commands that change anything, do not touch files outside the list. Do not run the full test suite; `npx vitest run tests/reading-time.test.ts tests/spine-reading.test.ts tests/use-reading-time.test.tsx tests/doc-links.test.ts` is the focused set. Do not attribute any sentence to a named person unless it is already quoted under that name in the plan; never write a new dated quote.

## The candidate

Commit f549161cd, on top of origin/dev. `git show f549161cd` is the scoped diff. The files:

- src/web/reading-time.ts (`readReach`, `READ_REACH_FROM`, `READ_REACH_FULL`, `REACH_STEPS`)
- src/web/styles/spine.css (two opacities and a comment)
- src/web/useReadingTime.ts (one comment word)
- tests/reading-time.test.ts, tests/spine-reading.test.ts, tests/use-reading-time.test.tsx
- docs/project/reading-time.md
- docs/plans/261004j-spine-reading-chart-fainter-and-rarely-full.md (the plan; it was not plan-reviewed, by the brief)

## What it is meant to do

The owner's request is quoted in the plan: the cyan reading-time chart on the spine should be slightly fainter, and "a bit logarithmic" so that it is rarer for it to fill the whole width of the rail.

The width scale was already a logarithm, from 4 sixteenths at 0.35 of a block's reading time to 16 at 2.8. It is now the same shape over seven doublings: 16 at 0.35 × 128 = 44.8 times the reading time. The gutter's `readLevel` is unchanged. The invariant `floor(readReach / 4) === readLevel` is given up on purpose; the two now agree only on zero versus non-zero.

Opacities: area 0.22 → 0.18, edge 0.8 → 0.65.

## Evidence

- The three reading test files: 101 pass. Six tests were red against the old function and opacities before the change.
- The constant was chosen from the owner's real reading rows, read from production read-only: 1,220 rows, 595 drawn. Quarter-doublings above 0.35 (k = floor(4·log2(ratio/0.35))) and their counts:
  `0:25 1:29 2:21 3:31 4:26 5:31 6:41 7:37 8:26 9:28 10:17 11:28 12:18 13:19 14:22 15:15 16:26 17:18 18:19 19:22 20:10 21:17 22:10 23:12 24:10 25:8 26:7 27:6 28:6 29:1 30:5 32:2 33:1 35:1`
  Old scale: full width is k ≥ 12. New scale: full width is k ≥ 28.
- Running both functions over the same rows gave: before, 255/595 (42.9%) at 16; after, 16/595 (2.7%) at 16 and 32/595 (5.4%) at 15 or 16; widths 4…16 after: `58 65 81 75 52 46 45 49 38 32 22 16 16`.
- `npm run typecheck` reports three errors, all in src/backfill-registry-facts.ts, which this commit does not touch.
- Not yet done: the browser check.

## What I want from you

An independent pass first. Then:

1. Is `readReach` right for every input: NaN, negatives, zero words, huge values, the doubles either side of 0.35 and of 44.8? Is `REACH_STEPS` strictly increasing in floating point, and is its last entry exactly `READ_REACH_FULL`? Can `readReach` ever return non-zero when `readLevel` is 0, or zero when it is not?
2. **Check my conclusion, not only my code.** Recompute the before and after shares from the histogram above. Does "42.9% → 2.7%" follow? Is seven doublings a defensible choice for "only the top few percent of passages reach near full width", or is the data saying something else that I have explained away (for instance, that the tail is mostly very short blocks whose expected time is floored at one second)?
3. Who else reads `reach` or assumed the old invariant? Search for `readReach`, `ReadReach`, `reach`, "sixteenth", "quarter", "2.8" in src/web, tests and docs/project. Is any comment, help text or doc now false?
4. Do the tests pin the behaviour or restate the implementation? Name a mutation they would miss.
5. Is the scale's definition really in one place?

Severity: P0 data loss/security; P1 user-visible wrong behaviour or a contract violated; P2 design/maintainability risk; P3 prose. Give every finding an ID F1, F2, … and say whether it is established or reasoned, and whether you fixed it. End with one line: VERDICT: land as is | land after fixes | do not land.
