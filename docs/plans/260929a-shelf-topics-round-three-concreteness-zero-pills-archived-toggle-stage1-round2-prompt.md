# Stage 1, round 2: a narrowly scoped check of one fix (260929a)

Reviewer-fixer, **scoped to one change only** — discovery on the rest of the stage is closed.

Your round-1 finding S1-1 (docs/plans/260929a-...-stage1-review-sol.md) was that SUBTLEX-US could not be shipped. The fix is commit 39915055 (`git show 39915055`): SUBTLEX removed; the vague-word rule now uses the Glasgow Norms alone (src/shelf-terms/data/glasgow-norms.ts, src/shelf-terms/choose.ts `passesVagueTest`/`isVague`/`familiarityMin`), ATTRIBUTION.md rewritten, tests updated.

## Please check only
1. Is S1-1 closed: no SUBTLEX-derived data or code path remains anywhere in the tree (grep), and ATTRIBUTION.md is accurate and sufficient for CC BY 4.0?
2. Does the new rule do what the plan's § Measurements (Stage 1) now says, with the lemma order you fixed in round 1 still intact? Any wrong result from "unrated means ordinary"?
3. Run `npx vitest run tests/shelf-terms-choose.test.ts`.
Fix narrowly, red first, if needed; do not commit. Output: findings with IDs S1-R2-1…, severity, evidence, what changed; test tail; one-line verdict on whether S1-1 is closed.
