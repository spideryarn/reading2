Reviewed and fixed one defect; no commit made.

Validation:

- Requested Vitest suites: 169/169 passed.
- `npm run typecheck` was blocked by the sandbox’s `tsx` socket (`EPERM`). The equivalent `node --import tsx scripts/typecheck.ts` passed all 4,076 files.
- A 20,000-item comma list completed in 144 ms with correct final offsets.
- Mixed separators, Unicode preceding text, ordering, exact quotes, narrative endings, and multi-year items behaved correctly.

1. **Medium — fixed: comma continuations bypassed reference-entry suppression.** An unmarked entry such as `OECD (2020). … (Smith 2019, Jones 2018).` returned two false citations because both continuation items increased `found.size`; the pre-change code returned none. I added the failing regression case at [citation-author-year.test.ts](/var/tmp/spideryarn-worktrees/fbd5e2jk-citations-and-figure/tests/citation-author-year.test.ts:93), then changed [citation-author-year.ts](/var/tmp/spideryarn-worktrees/fbd5e2jk-citations-and-figure/src/citation-author-year.ts:144) to count only independently matched citation shapes for `ENTRY_LINE`, while retaining each continuation as a returned hit.

**Verdict:** Correct after the reference-entry fix; no remaining correctness findings or wider decisions.