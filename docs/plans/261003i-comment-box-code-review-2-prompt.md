# Code review, round 2 (narrow): the fixes made in round 1 of 261003i

Round 1 of this review (docs/plans/261003i-comment-box-code-review-sol.md) made fixes B1–B4.
**Those fixes are unreviewed code written by a reviewer, not by the original author**, in the most
delicate file of the change. This round checks only them. Discovery is closed: do not look for new
issues elsewhere.

The diff: `git diff 67604b379 b28a241c4 -- src/web/useComments.ts src/web/AnnotateDialog.tsx src/web/lib/api.ts`
and the tests that came with it.

- B2 (create is the first link in the comment's write queue) and B3 (delete cancels a held create;
  re-deletes after an in-flight create; queued patches observe the tombstone): trace each
  interleaving of create / edit / recolour / place / delete for one comment id, with the opening
  read unsettled, settling to success, settling to failure, and the hook unmounting or the slug
  changing mid-way. Is any promise left unresolved (a caller awaiting `create` forever)? Can a
  cancelled held create leave an optimistic row, a tombstone that never clears, or a queue entry
  that blocks a later comment with the same id? Does the gutter bookmark (`makeBlockBookmarker`,
  which awaits create's result to open the box) behave when its create is cancelled by a delete?
- B1 (pageshow reconciles the frozen snapshot through ordinary create and closes the box): what if
  the keepalive POST did land (the create is a same-id idempotent repeat: is it?), did not land,
  or is still in flight when the page is restored? Can it produce a 409 the reader sees, or a
  duplicate row in the tab?
- The existing recolour/edit/place ordering guarantees (tests/recolour-write-order.test.tsx) and
  the tombstone behaviour documented in comments.md § Deliberate limits must be unchanged.

Fix narrowly and red-first if something is wrong. Run
`npx vitest run tests/use-comments-create-waits-for-the-opening-read.test.ts
tests/recolour-write-order.test.tsx tests/use-comments-load-state.test.ts
tests/opening-read-gates-writes.test.tsx tests/annotate-dialog-keeps-a-draft.test.tsx
tests/block-bookmark.test.ts` and typecheck via `node --import tsx scripts/typecheck.ts`.
Do not commit. IDs C1, C2, …; P0–P3; file:line; fixed or not; the test.
Verdict: land / land after fixes (made) / do not land.
