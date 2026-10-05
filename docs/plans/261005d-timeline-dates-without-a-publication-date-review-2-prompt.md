# Second pass: the fetch-year guard (plan 261005d)

Your first review of this change is
`docs/plans/261005d-timeline-dates-without-a-publication-date-review-sol.md`. Its one unresolved
P1 was that a single historical date assigns its year to every year-less date in the piece.

Since then, in this worktree (uncommitted):

- `buildTimeline` in `src/timeline.ts` assumes the piece's stated year only when it is the year
  of `Meta.fetchedAt` or the one before; no fetch time, no assumption. `generateTimeline` passes
  `articleMeta?.fetchedAt`.
- A test in `tests/timeline.test.ts` ("does not assume a stated year that is not the year we
  fetched the piece, or the one before"), which I saw fail with the guard broken.
- `DATE_REJECTED_WHY.noYearFrame` in `src/messages.ts` now carries the sentence you wrote inline
  in the panel, and the panel reads it from there again.
- The plan's § Measured has the numbers behind the guard (13 of 16), and § The review records
  your findings.

This pass is read-only: do not edit anything. Check:

1. Does the guard answer your P1, and is what remains (a current piece with one full date from
   last year) a reason not to ship, given it is labelled as an assumption in three places?
2. Is the guard's code right: `dayFrame(opts.fetchedAt)` on a full ISO timestamp, the `NaN`
   path when there is no fetch time, the year-before case?
3. Is anything in the plan or in `docs/project/timeline.md` now untrue of the code?

End with `VERDICT: ship` or `VERDICT: do not ship`, then findings as P0 / P1 / P2.
