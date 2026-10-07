# A successor completion rule must not undo the producer on resume

Caught in the 261005j code review, before this review's fixes were committed. No reader incident
was established. An import opening on a stand-in outline rebuilt that outline whenever a claim
resumed. The successor needed that rejection to build the real structure; the original import did
not. The root cause was **a completion predicate that omitted the work's lifecycle**.

## What the checks missed

Introduced by `ff4f19726c8b542790a99db521fd5ed25a736160`, *Open before Structure: a first import
publishes on the headings tree, and the open page takes the real one live*. Its
[`structureIsNotAStandIn`](../../src/pipeline.ts) rejected every awaiting tree. That correctly
prevented the successor from skipping copied, finished artefacts, but also rejected the original
marked import's own finished work before publication.

The queue test acknowledged the repeated work and resumed with a longer claim to finish. It
therefore proved eventual completion only after changing the condition responsible for looping.
The class is **applying a successor's completion rule to its producer on resume**: the same output
can finish one job while remaining insufficient for another.

Production ordinarily has a 740-second claim window and an assets budget of 185 seconds
([`LEASE_MS`, `DEADLINE_MARGIN_MS`, `STEP_BUDGET_MS`](../../src/jobs.ts)). Rebuilding the local
stand-in normally leaves room for assets. This is hardening against repeated work and constrained
claims, not evidence of ordinary production livelock. Session opening and preflight IO have no hard
latency bound; repeated overhead consuming over 555 seconds could still prevent assets starting.

## The fix and its evidence

Retain a completed awaiting tree only when the step is marked `headingsFirst` and no blocks have
ever been published. Presence and interrupted-run checks still run first. Published successors,
including ones carrying the mark, still replace the stand-in. This is the long-term fix as well as
the review patch: completion reflects which work was requested, without introducing a second
resume mechanism.

In [`structure-step-headings-first.test.ts`](../../tests/structure-step-headings-first.test.ts),
the new unpublished-resume case failed with `expected false to be true` before the fix; the final
focused run passed **15/15**. Its published control remains false. The amended
[`open-before-structure-queue.test.ts`](../../tests/open-before-structure-queue.test.ts) requires
completion under the same repeated four-second claims, with structure running once. That database
test could not run in this sandbox: `connect EPERM 127.0.0.1:54362`, with Docker unavailable.
Its red-then-green evidence remains unearned.

> **Note, 2026-10-07.** The paragraph above is what was true when this was written. The database
> test has since been run against Postgres, red and green. With `structureIsNotAStandIn` put back
> to rejecting every awaiting tree, *a handed-back import finishes without rebuilding its stand-in*
> fails with `job … did not finish in 120 advances`, and the unit case fails as it did then. All 8
> pass with the fix back.
> [The plan](../plans/261007e-seventh-sweep-pipeline-tidy-one-successor-rule-and-the-dead-filesystem-session.md#item-3-pqo6-two-tests-seen-red-and-the-missing-one) has the runs.

## Countermeasures, ranked by ease against value

1. **Test both producer resume and successor replacement against the same intermediate output.**
   Implemented in the focused unit cases; cheap and directly exposes the missing lifecycle.
2. **Keep the constrained window unchanged until the resumed job finishes.** Implemented in the
   queue assertion, awaiting execution where Postgres is accessible. Changing the window mid-test
   hides the progress property it is meant to verify.
3. **A new scheduler or per-job completion framework** — rejected. Existing step marks and
   publication history already distinguish the work; a second mechanism would add coordination
   without addressing a missing predicate input.

The same review also corrected the detail claiming the outline came from headings: the bounded
builder makes windows for headingless articles too. That was source-category mistaken for content
provenance, caught by a real headingless step test failing before the neutral wording was applied.

Up: [Postmortems](../project/postmortems.md)
