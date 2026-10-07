# Cancellation checked before asynchronous preparation finishes

Review of `f81555bc7`, before shipping, reproduced two cancellation races. No production
incident was observed. A local Stop before the last step's work could end `done`; a Stop
while storing a provider-cancelled Illustrated set could replace the last good painting.
Both become publication regressions under the new last-step retention rule.

## The class: asynchronous cancellation check/use races

`runStep` checked the starting progress write's cancellation flag, then awaited `beginStep`
without checking its local signal again. Stop during the preflight was also missed when
that progress write failed. These admission holes predate `f81555bc7`; that commit turns
their final product from discarded to published. The two offline regressions initially
reported `Expected: cancelled; Received: done`.

Illustrated's new check read `run.cancelled` and the signal before awaiting image storage.
A provider timeout sets the first with the signal still live; Stop during storage then
passed a partial set through to publication. The new test initially resolved with one
stored image and a second undrawn plate instead of rejecting. A second check after storage
alone leaves the same race during the runner's ledger drain and preview settlement.

## Why the original tests passed

The Stop tests press the button inside `run`, after admission. The Illustrated test fires
the signal during drawing, before its new check. Neither presses Stop during a later await.
The original three offline suites passed all 46 tests over these holes.

## The fix that belongs at the boundary

Check the signal before and after `beginStep`, before any work begins. Keep Illustrated's
partial-run condition in `StepProduct.discardOnAbort`, and check it in `runStep` after
ledger/preview settlement, immediately before its synchronous commit decision. Move the
direct step's check after image storage so already-paid bytes remain stored as blobs,
as before; its original early throw skipped those writes (the regression observed zero
storage calls instead of one). Provider cancellation without an aborted
signal retains the existing partial-result behavior; fully drawn products retain normally.

## Countermeasures, ranked by effort against value

1. **Abort during each relevant await** — done in offline tests for preflight, marker opening,
   storage, and runner settlement. Each new safety assertion was observed red before its fix.
2. **Verify the store outcome** — a Postgres regression checks the opening race leaves a failed
   draft and cleared job pointer. Written in the review sandbox, which had no network; run
   afterwards against local Postgres, where it passes, and goes red (it runs `metadata`) without
   the check after `beginStep`.
3. **A generic cancellation state machine** — rejected for this change. An admission check and
   one optional product condition express the two lifetimes without changing all steps.

The remaining remote-Stop behavior when consecutive progress reads fail predates this change:
the local signal cannot help another server. This review reports that wider issue rather
than changing its storage protocol.

Up: [Postmortems](../project/postmortems.md)
