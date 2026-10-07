# Activation targets read from delayed URLs can outlive their presses

Review of [261003l](../plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md)
confirmed a pre-existing Diagram charging bug through the real App, Reader and Dock. No real
model call was made: the test network counted the job request. Reader impact outside this
reproduction is unknown. The review reported it as F8 and left it unfixed, because it explicitly
excluded wider fixes requiring more than one line. **It was fixed the same day**, 2026-10-03 —
see the follow-up section below.

## The class: activation targets selected from stale serialized state

nuqs moves the rendered picture before it flushes the URL. Dock derives its Diagram press target
from `diagramInSearch(location.search)`, so for that interval the target describes the previous
picture. A Sketch token created while Force is mounted has no hook to claim it; Back mounts
Sketch, claims the token and starts a paid job.

The underlying stale-URL arming entered in `037de8f7eb` (2026-09-06, “Opening a mode starts it
generating”). `27b369d494` added the command-bar path reproduced here. Candidate `655cd40a1`
fixes this shape for Summary, but leaves Diagram's existing path intact. A separate subagent
traced both introduction points.

## Evidence

Using the real-reader harness in
[`every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx):

1. Open `?mode=diagram` with no Sketch stored; allow its GET to settle. No job is posted.
2. Press Force; check that the selected chip is Force while the URL still omits `diagram`.
3. Immediately take the Diagram command row with Enter.
4. The expected-null Sketch token assertion fails: its nonce is `1`.
5. Let the URL flush, then Back to Sketch. The queue receives exactly `steps: ["sketch"]`,
   with no Sketch press.

The temporary reproducer was removed from the passing stage suite after both measurements.
It did not mutate Diagram's implementation. The failed assertion and the observed job are
separate checks: a token alone would establish the hazard, not the charging consequence.

## Why the tests agreed

The existing mode sweeps wait for each address to settle before the next press. They verify
correct targets at settled addresses and never enter the interval in which serialized state and
rendered state differ. The new Summary test does enter that interval; removing Reader's Summary
prop makes it fail with an unclaimed `simple` token. That confirms its sensitivity, but its target
is Summary, so it cannot establish Diagram's safety.

## The correct follow-up and what would catch the class

Pass Reader's parsed `subNav.diagram` into Dock, as it already passes Summary's parsed view.
Use the URL fallback only on pages whose mode controls navigate without arming. This takes
several edits and was not a repair made by the review.

**Done the same day, 2026-10-03.** `Reader.tsx` passes `<Dock diagram={subNav.diagram}>`, and
`Dock.tsx` takes `diagramProp ?? diagramInSearch(search)` (§ Props `diagram`). The two agree at a
settled address: `diagramParam` and `diagramInSearch` degrade from the same constants in
`params.ts`, and the experimental switch hides chips without changing the parsed kind.

1. The before-flush sequence above is now a regression in
   [`every-mode-draws-its-surface.test.tsx`](../../tests/every-mode-draws-its-surface.test.tsx)
   (“a Diagram command immediately after Force…”), asserting both no pending token and no Sketch
   job on Back. It was red on the unfixed code with an unclaimed `sketch` token.
2. Require arming controls to use the state selecting the consumer, rather than a separately
   serialized snapshot. Enforcing that prop on interactive Dock callers would strengthen it.
3. Rejected: waiting for the URL to flush before allowing another press. It complicates the UI
   and hides the disagreement instead of giving producer and consumer the same state.
