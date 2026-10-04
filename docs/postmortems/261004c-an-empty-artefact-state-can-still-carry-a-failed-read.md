# An empty artefact state can still carry a failed read

Caught during review of sweep cluster 5 stage 1, 2026-10-04: after Sketch or Illustrated answered
404, a later failed revalidation left its panel saying nobody had made a picture, with no failure
sentence or retry. No production incident was established; the evidence is the review reproduction.

## The class: a preserved status is mistaken for an absence of failure

Both hooks deliberately preserve their previous status when revalidation fails:
`was === "loading" ? "error" : was`. The guard protects a loaded picture, but also preserves
`none`. Both empty views decided whether to draw an error from `status === "error"`, although
`error` is an independent fact. A 404 followed by a failed read therefore holds both `none` and an
error; the view drew only the former.

The shape was introduced with Sketch in `3897bc9cf` (*Sketch becomes a fourth chip, and the first
step that does not write its own file*) and Illustrated in `8d619a060` (*Illustrated stage 4: the
fifth chip, and a picture a reader can finally see*). Both original hooks and views have the
preservation guard and the status-only rendering gate. Stage 1's `64e947f0e` added retry markup and
fixed the loaded-picture branch, but retained this empty-state omission.

## Why the matrix stayed green

[The candidate matrix](../../tests/read-error-matrix.test.tsx) covers a failed opening read and a
failed revalidation over a loaded picture. Its 404 retry rows prove a missing artefact is an ordinary
answer and that a pending press is honoured. None combined an ordinary 404 with a subsequent failed
read. The membership check finds missing modes, but does not establish their state transitions.

The two added rows, *also offers the failed read again after an earlier 404*, were red before the
repair: expected the `COULD_NOT_REACH` alert, received `undefined`. Both became green after the
views checked `view.error` instead of requiring status `error`. The combined targeted run with the
four malformed-success rows went from six failures to six passes.

## What would have caught it, ranked by ease against value

1. **One transition test per affected picture view** — open on 404, trigger a new read with changed
   blocks, fail it, then retry successfully with one GET and no POST. This is cheap and covers the
   state the status-only gate omitted, through the real hooks and views. Added and seen red, then
   green with the repair.
2. **Draw failures from the error fact in every reachable view branch** — a small rendering edit;
   preserve the old status and any loaded artefact. This generalises to other independently stored
   status and error pairs.
3. **A generic artefact-read hook or a new state machine** — rejected for this repair. The modes own
   their parsing and missing-result policy; a shared abstraction would broaden the work and would
   still need the same transition test.

## The fix that is right for the long term

Keep the existing preservation guard and render the independent failure fact in the empty view too.
Changing every failed revalidation to status `error` would revive the loaded-picture disappearance
that the guard prevents. This repair belongs to stage 1's promised failure sentence and retry, even
though its introducing commits predate the candidate. It does not change paid generation policy.

Up: [Postmortems](../project/postmortems.md).
