# Code review, round 2 (narrow): the P1 fixes made in round 1 of 261004f

Round 1 (docs/plans/261004f-apply-on-select-code-review-sol.md) made fixes F1–F5. **F1 and F2 are
P1 fixes written by a reviewer and reviewed by nobody.** This round checks only those two.
Discovery is closed: report nothing outside them.

The diff: `git diff eff2e764c HEAD -- src/web/useComments.ts src/web/CommentDialog.tsx src/web/reader/Reader.tsx src/web/useCopy.ts`.

- F1 (useComments: every pagehide replay promise is retained and awaited before a delete). Can a
  retained promise never settle (a keepalive fetch on a page that was frozen and restored) and so
  block a delete, or every later write for that id, forever? Is the registry bounded and cleared?
  Does awaiting it change the ordering guarantees from 261003i (B2, B3, C1, C2 in
  docs/plans/261003i-comment-box-code-review*.md)?
- F2 (Copy, don't highlight: the outcome is checked against parent-owned state and claimed once).
  Trace: press Copy → box closed by click-off before the clipboard answers; → box reopened and row
  recoloured or typed into before it answers; → two presses; → clipboard refuses; → the row was
  already deleted by Remove highlight. In each, is exactly the right thing deleted or kept, and is
  anything left pending in Reader state after the article changes?

For each: CORRECT, or WRONG with file:line and a narrow red-first fix. Run
`npx vitest run tests/selecting-applies-the-highlight.test.tsx
tests/use-comments-create-waits-for-the-opening-read.test.ts tests/block-bookmark.test.ts
tests/recolour-write-order.test.tsx` and `node --import tsx scripts/typecheck.ts`. Do not commit.
End with: both correct / fixed / still open.
