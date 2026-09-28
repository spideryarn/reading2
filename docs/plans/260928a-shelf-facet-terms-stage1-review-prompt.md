# Stage 1 code review prompt: shelf filter terms (260928a)

You are the reviewer-fixer for Stage 1 of docs/plans/260928a-shelf-facet-terms.md.

**Candidate (committed)**: commit 3725b94c on top of db0ecc01. `git show 3725b94c --stat` lists every changed path:
- src/shelf-terms/extract.ts, src/shelf-terms/choose.ts (start here)
- tests/shelf-terms-extract.test.ts, tests/shelf-terms-choose.test.ts
- docs/plans/260928a-shelf-facet-terms.md (§ Step 1, § Step 2, and the "Landed" note under Stage 1)

This does not limit scope: read src/block-policy.ts (`isEmbeddable`), src/types.ts (`Block`), and anything else you need. The plan's earlier review is docs/plans/260928a-shelf-facet-terms-plan-review-sol.md (findings F1–F14; F3, F4, F7, F9, F12 bear on this stage).

## What the stage is for

Pure functions, no I/O: per article, candidate phrases with three counts (`count` literal, `bodyCount` prose-only for membership, `score` weighted for ranking), an English check, back-matter skip, `textHash`; per shelf, ~30 overlapping topics by greedy coverage within a df band, exact-duplicate works, redundancy skips, and a total order so shuffled input gives the same output. Nothing reads the database yet (stage 2), nothing renders (stage 3).

## Please

1. An independent pass for correctness: does the code do what the plan says, and does what it says make sense? Wrong results a reader would see later (a topic whose article list disagrees with its membership rule; counts that are weighted when they should be literal; a non-deterministic order; a back-matter skip that eats real content or misses a bibliography; the English check misfiring on English prose with many proper nouns or code; Unicode — curly apostrophes, accented letters, hyphenation — splitting or merging keys wrongly).
2. Run the two test files yourself: `npx vitest run tests/shelf-terms-extract.test.ts tests/shelf-terms-choose.test.ts`. They need nothing outside the tree.
3. **Fix what is inside this stage**, narrowly, red first (a failing test, then the fix), in these four source/test files. **Report, do not fix**, anything wider. Do not commit; leave your changes in the working tree.

## My own suspicions (lower priority — spend most of the run above)

- `stemForOverlap` strips only -ness/-ity/-al; is it too crude or too eager for real vocabulary?
- The quality formula and the greedy discount: can a single very long article dominate?
- `idf` counts a work if the phrase is anywhere in its stored top-200 candidates, not only where it is a member — is that the right denominator?

## Output

Findings with stable IDs S1-1, S1-2, … each with severity (P0 data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability risk; P3 prose), established or reasoned, evidence (file:line), and what you changed for it (or why you only report it). Then the test command's final lines after your changes. Then a one-line verdict.
