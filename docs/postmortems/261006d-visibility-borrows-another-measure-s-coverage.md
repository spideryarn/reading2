# Visibility borrows another measure's coverage

Stage 2 review of [261006d](../plans/261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md)
found known unclassified-stop counts hidden by the page and terminal, and terminal days omitted or
called quiet despite evidence. This was found during review before deployment; no reader incident
was established.

## What happened

Commit `9b36535f4c7d3daf41ede6e564a4e0e202e3bdb1` added the independently known count
`stopsNotClassified`, but [`nothingMeasured`](../../src/cost-cube.ts) ignored it:

```ts
c.retries === null && c.gaveUp === null && c.diedPartWay === null && c.stopsClassified === 0
```

A task with two unnumbered unclassified stops therefore disappeared into a line saying *not
measured*. The cause was unknown; the count was known. HTML retained that task whenever its section
opened, so the surfaces disagreed.

The section gates inherited from `3950ac5a51` still required numbered attempts or a recorded cause.
Stage 2 made those gates incompatible with the new stop evidence: an isolated unnumbered stop could
have known figures and no breakdown. The terminal's compact day classification had two further
holes: classified ordinary stops alongside unclassified stops made the stall figure zero, allowing
a quiet-day claim; an unnumbered classified ordinary-stop day belonged to neither shown, quiet nor
unmeasured days.

## The class: visibility borrows another measure's coverage

Adding an independently recorded figure changes what qualifies as evidence worth displaying.
Shared arithmetic alone does not keep renderings consistent when their visibility predicates still
depend on older measures. Missing knowledge about one property must not erase known evidence about
another. This is the rendering sibling of
[one measure borrowing another's coverage](261006c-one-measure-borrows-another-measures-coverage.md).

## Why nothing went red

Existing tests explicitly expected an unclassified-stop group to be `nothingMeasured` and a task's
two known unclassified stops to fold away. They enforced the mistaken policy. Mixed fixtures also
contained numbered attempts or causes, opening the section gate and concealing its insufficiency.

The review's red-first run recorded **17 failing tests across five files** in
`/tmp/261006d-stage2-behaviour-red.log`; that run also included the separate deadline wording
finding. The visibility failures included `expected true to be false` for the fold and empty page
and HTML rows where two stopped attempts were expected. The temporary log is local review evidence,
not a committed artefact. Final verification belongs to the review result.

## What would have caught it, ranked by ease against value

1. **Cross independent evidence with isolated, zero and mixed cases.** Added fold, page, JSON/HTML
   and terminal regressions for unnumbered classified and unclassified stops, missing phases, and
   unknown stops beside classified ordinary stops. These small fixtures expose hidden evidence.
2. **Make visibility consume the shared evidence predicate.** Applied to the three rendering gates
   and task folding. Compact day handling now retains unknown stops and unnumbered days with
   evidence, so compression cannot silently discard those cases.
3. **Persist additional coverage columns.** Rejected: the folds already hold sufficient evidence.
   More storage would leave the wrong rendering predicates possible.

## The fix that is right for the long term

Treat display eligibility separately from whether a particular figure's cause is measured. The
working-tree fix keeps any stopped attempt visible without converting unknown stall or timeout
counts to zero, and fixes the terminal's day selection. It reuses the existing shared predicate
rather than adding another rendering policy. This is the intended long-term fix as well as the
narrow review correction.

On the next review I would ask which known evidence each fold-away rule removes, even when the
main figure beside it remains unknown. A faithful summary does not justify losing the day or task
that supplied its number.

Up: [Postmortems](../project/postmortems.md)
