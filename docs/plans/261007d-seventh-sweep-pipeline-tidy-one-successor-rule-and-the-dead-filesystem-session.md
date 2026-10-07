# Seventh sweep: pipeline tidy (C8)

Status as of 2026-10-07: item 1 built. Items 2 to 4 follow, one commit each. Not pushed: a GPT
review comes first.

## Goal

Cluster **C8** of the [seventh sweep](261006m-seventh-codebase-sweep-depth-umbrella.md), with what
[its review](261006m-seventh-codebase-sweep-depth-umbrella.md#what-the-review-changed) added (U6,
U7, U10, U18). Four items, in this order, each its own commit:

1. **PQ3.** One rule for "is anybody else still going to make this article's paragraph labels",
   asked by both endings that write `failed` onto a published revision.
2. **PQO3.** Delete the filesystem store session, which only a test still calls.
3. **PQO6.** Two regression tests that have never been seen red, and a boundary with no test.
4. **Summary's stamp**, written into [summaries.md](../project/summaries.md) as the deliberate
   exception it is.

The findings are in
[the Sol read](../investigations/261006d-seventh-sweep-depth-pipeline-and-import-queue-sol.md),
[the Opus read](../investigations/261006d-seventh-sweep-depth-pipeline-and-import-queue-opus.md)
and the two cross-reviews beside them. Where a review corrects a finding, the review wins.

## Out of scope

PQO5 (a CHECK on job transitions) and anything in `src/db/schema.ts` or `drizzle/`; the step
budgets; what Stop does; `src/routes.ts`; `src/web/`; any reader-facing sentence.

## Item 1: PQ3, one successor rule

**Reproduced** against Postgres before any change, in
[`tests/publication-enqueues-the-labels-successor.test.ts`](../../tests/publication-enqueues-the-labels-successor.test.ts),
case 15f. A `pending` revision is published, which queues successor B (`["labels"]`). An older
job A (`["structure", "labels"]`) claims first and fails live inside `labels`:

```
AssertionError: a live failure told the reader the labels failed while the job that makes them
was still queued: expected 'failed' to be 'pending'
```

The lease-expiry twin of that ordering (case 15e, there since 2026-09-07) leaves the base
`pending`. Same article, same position, two durable answers.

**What landed.** `anotherJobCarriesLabelsIn` in
[`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts), beside `finishIn`: another job counts when it
is not one the caller is ending, belongs to the same owner, is `queued` or `running` and not
`cancelling`, and has a `labels` step. `settleExpired` calls it where it had the query inline;
`settleIn` ([`src/store/pg-session.ts`](../../src/store/pg-session.ts)) calls it before
`markNavLabelsFailedIn`, naming its own job and the ambient owner. The live path's trigger is
unchanged: `unfinished === "labels"` and an `error` ending.

**The simpler option passed over:** the same query written a second time inside `settleIn`. It was
weighed, because the brief allowed it. The helper won on the deletion test: every clause is shared
(status, cancelling, owner, membership, exclusion) and the two callers differ only in *when* they
ask, which stays with each caller. A second copy is how this drifted the first time.

**One cost:** the sweep asked once for every article it was ending and now asks once per ended
`labels` job. That is a handful of rows on a path that runs when a lease lapses.

**The broken twin (U10) and its controls.** Mutations, each watched red on 2026-10-07 and restored:

| mutation | red |
|---|---|
| the settling job no longer excluded | case 8 (*a failed labels job marks the base revision `failed`*) and case 15g → `expected 'pending' to be 'failed'` |
| the owner clause dropped | case 15g alone → `a job that will not make this article's labels was counted as the one that will` |
| the `labels` membership test dropped | case 15g alone, same line |
| the sweep's call removed | case 15e alone |

Case 15g is new: another owner's `labels` job on a slug of the same name, and this owner's job
with no `labels` step, both queued, and the base is still marked `failed`.

**The retreat rule holds.** An ordinary single job with no successor is marked exactly as before:
case 8 is that job and is unchanged and green, and it is the case that goes red when the helper
counts the settling job.

**Not covered by any test:** the `not(cancelling)` clause. A cancelling job is `running`
(`jobs_cancelling_is_running`), and no fixture has two running jobs on one article. The clause
moved with the query, unchanged.

**What the docs got wrong.** Sol's finding was marked *C, not reproduced*; the Opus review
reproduced it, and so did this. Nothing in the finding was false.
[structure-step.md](../project/structure-step.md) now says both callers ask.
