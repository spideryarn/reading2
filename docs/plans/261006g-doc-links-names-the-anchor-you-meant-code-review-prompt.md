Code review of a small, finished change. You may fix what you find inside its scope; report
anything wider instead of fixing it.

Scope — uncommitted in this worktree, see `git diff HEAD` and these untracked files:
- tests/doc-links.test.ts (modified): `slug` doc comment, new `suggestAnchor` and
  `describeBrokenAnchor`, the "point at anchors that exist" message, and the new test
  "says which anchor a broken link probably meant".
- docs/reusable/write-planning-doc.md (modified): one bullet under References.
- docs/plans/261006g-doc-links-names-the-anchor-you-meant.md (untracked): the plan, with your plan
  review's four findings and what was done about each.
- docs/plans/261006g-doc-links-names-the-anchor-you-meant-review-sol.md (untracked): your plan review.

Run it yourself: `npx vitest run tests/doc-links.test.ts` needs nothing outside the tree. My last
run: 17 passed. `npm run typecheck` has one error, in tests/feedback-dialog-has-its-reader.test.tsx
(unused `writtenAsB`), which is another session's file and out of scope.

Rules for any edit you make:
- Stay inside the files above.
- Do not quote or attribute anything to Greg that is not already in the repo.
- Do not change `slug()`'s behaviour.

Check:
1. Is `suggestAnchor` correct, and do the tests pin what matters? Would any plausible mutation pass?
2. Is the failure message accurate and readable as one line among many?
3. Is the new bullet in write-planning-doc.md accurate and in keeping with the file?
4. Does the plan doc say anything the code does not do?

Severity: P0 must not land; P1 fix before landing; P2 worth doing; P3 note. An ID on every finding
(C1, C2, …), what you changed if anything, and a one-line verdict at the end.
