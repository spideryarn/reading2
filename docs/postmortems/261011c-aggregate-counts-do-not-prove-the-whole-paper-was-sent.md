# Aggregate counts do not prove the whole paper was sent

Code review of [261011w](../plans/261011w-does-the-cited-work-say-that-at-the-citing-sentence.md)
found that `read_cited_work` could tell chat it had been shown *all* of a paper when code had selected
only one of its chunks. Nothing reached a reader: the feature was still an uncommitted change in this
worktree.

## What happened

The first provenance predicate was:

```ts
evidence.sentWords >= evidence.words
```

Those are aggregate measurements. They do not identify which chunks were sent, and rounding,
overlap or inconsistent upstream metadata can make the totals equal while an evidence unit remains
absent. The same result then ended with a second instruction saying chat had seen only part of the
paper, so one tool message could make both claims.

No commit introduced the defect: it was in the uncommitted implementation presented for review on
2026-10-11. A red-first test used two canonical chunks, selected one, and equal `sentWords` and
`words`; the old code said *all*, proving the test distinguished structure from the counter.

## The class: aggregate counts do not prove the whole paper was sent

A total can prove how much was counted, not which evidence units crossed a boundary. Using the total
as a coverage predicate borrows a measure of quantity to answer a structural question. The sibling
is [one measure borrows another measure's coverage](261006c-one-measure-borrows-another-measures-coverage.md):
in both cases, a plausible number stood in for evidence that every required part had been observed.

## Why nothing went red

The original tests covered a partial read whose word counts were visibly different. That fixture
made the quantity predicate and the structural predicate agree, so it could not tell which one the
code used. No full-paper fixture checked both the positive claim and the absence of the partial-read
warning.

## What would have caught it, ranked by ease against value

1. **Cross the counter with contradictory structure.** Done in
   [`read-cited-work.test.ts`](../../tests/read-cited-work.test.ts): equal totals with an omitted
   chunk must still report selected passages, while selecting every chunk earns *all*.
2. **Derive coverage from identifiers at the boundary.** Done: `sentTheWholePaper` checks that every
   canonical chunk id occurs in `selected`; the word count is used only to report quantity.
3. **Require exact byte or word reconstruction of `sentText`.** Rejected. The output deliberately
   adds headings and an opening, so reconstruction would duplicate `paper-evidence`'s formatter and
   create a second, brittle source of truth without improving the coverage decision.

## The fix that is right for the long term

Coverage is now structural: every canonical chunk must be selected, and an empty chunk list cannot
earn the complete claim. Complete and partial reads have separate closing instructions, so a result
cannot say both. Counters remain useful provenance, but never authorization for the word *all*.

On a future review I would ask which identities crossed the boundary before accepting an aggregate
as proof of completeness. Equality of totals is not identity of contents.

Up: [Postmortems](../project/postmortems.md)
