# Fix check (not a review): two P1 fixes from round 2 of 261003i

Discovery is closed. This checks ONLY whether two specific fixes are correct, because they were
written after the last reviewed snapshot. Do not report anything outside them.

The diff: `git diff b28a241c4 fd3e9635f -- src/web/useComments.ts` with its tests in
tests/use-comments-create-waits-for-the-opening-read.test.ts. The findings are C1 and C2 in
docs/plans/261003i-comment-box-code-review-2-sol.md.

- C1: concurrent same-id creates coalesce; a later create attempt clears a retired tombstone.
  Is the fix right? Can clearing the tombstone resurrect a comment the reader deliberately deleted
  (a real delete of a stored row, followed by an unrelated late create response for the same id)?
  Does coalescing return the right value to both callers?
- C2: a delete racing an in-flight POST whose response was lost repeats the identical POST to
  prove ownership, then DELETEs; a 409 is preserved. Is the repeat bounded (no loop on persistent
  network failure)? What does the reader see if the repeat also fails? Could it delete another
  owner's or another draft's row?

For each: CORRECT, or WRONG with file:line and the fix made (narrow, red-first). Run
`npx vitest run tests/use-comments-create-waits-for-the-opening-read.test.ts
tests/block-bookmark.test.ts tests/recolour-write-order.test.tsx` and
`node --import tsx scripts/typecheck.ts`. Do not commit. End with: both correct / fixed / still open.
