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

## Item 2: PQO3, the filesystem session

**What was deleted.** From [`src/store/session.ts`](../../src/store/session.ts): `fsStoreSession`,
`JobSettles`, and `readsOf` (the six-method facade, whose only caller was `fsStoreSession`; the
live session builds its own with `readsPgArtifacts`). From
[`src/pipeline.ts`](../../src/pipeline.ts): `LEGACY_UNCONVERTED_STEPS`, `LegacyUnconvertedStep`,
`UNCONVERTED_STEPS`, and the conditional return type on `PipelineStep.run`, which is now
`ConvertedProduct` for every step. From `src/store/pg-session.ts`: `NOTHING_UNCONVERTED`.
`checkProduct` lost its third parameter and refuses a product with no `parts` unconditionally.
`tests/store-session.test.ts` (626 lines) is gone, and its entry in the closed migration record
(`tests/store-migration-registry.ts`), which may name only files that exist.

**`JobStore.finish` and `JobStore.releaseStep` are left exactly as they were (U7).** They are the
public terminal methods with no caller in `src/`; nine test files use them as fixtures, and moving
those through a session is its own piece of work, tied to PQO5.

**A comment said not to do part of this, and it is answered rather than overridden.** The
docstring on `LEGACY_UNCONVERTED_STEPS` read *"Deleting it would be the wrong tidy-up … An empty
list is the strongest the rule has ever been; an absent one is no rule at all."* That argument was
for the refusal, and the refusal stayed: it is unconditional in the type and in `checkProduct`.
What went is the way to opt out of it, whose last reader was `fsStoreSession`. The reasoning is
kept on `ConvertedProduct`.

**The simpler option passed over:** deleting only `fsStoreSession` and its test, leaving the empty
list and the conditional type. It leaves a parameter with one possible value and a type that is
conditional on `never`.

### The greps, before deleting

Over `src scripts tools evals tests package.json`, 2026-10-07, on `origin/dev` at `434e03141`:

| pattern | hits outside the definition and the old test |
|---|---|
| `fsStoreSession` | 0 calls. 17 comments: 5 in `src/`, 12 in `tests/` |
| `fs[-_ ]?store[-_ ]?session`, `fsStore`, and `"fs" +` / `` `fs${ `` string builds (case-insensitive) | 0 |
| `store-session.test` | a comment in `tests/store-pg-session.test.ts` and the registry entry |
| `JobSettles` | 0 uses. 3 comments |
| `UNCONVERTED`, `LegacyUnconvertedStep` | `src/store/pg-session.ts` (the empty set it passed) and `tests/stage2c-raw-bytes.test.ts` (five uses, all passing the empty set or asserting it empty) |
| `readsOf` from `session.ts` | 0. The `readsOf` in `src/sharing-steps.ts` is a different function |

`tools/` does not exist. `npm run typecheck` is clean and `npm run knip` reports nothing in any
file this touched.

### The old test's 18 cases

| # | case | verdict |
|---|---|---|
| 1 | refuses a step that returned one of the two artefacts it declares | **twin**: `stage2c-raw-bytes` *refuses an extract product missing extractedHtml, by name* |
| 2 | refuses over an artefact carried from a previous run, and leaves it alone | **twin**: `store-pg-session` *refuses a missing part that the carried artefact would have hidden* |
| 3 | refuses an empty parts object | **twin**: the same case (it passes `parts: {}`), and `stage2c-raw-bytes` *refuses a fetch product with no raw manifest* |
| 4 | writes the new artefacts over the carried ones, and finishes the step | **twin**: `store-pg-session` *writes, completes, publishes, finishes and clears the pointer* |
| 5 | is accepted with no parts while it is marked unconverted | **obsolete**: the exemption is deleted |
| 6 | is refused with no parts once it is no longer marked unconverted | **twin**: `stage2c-raw-bytes` *refuses an extract product with no parts whatsoever*; the marker half is `store-pg-session` *re-runs a step that was begun and never committed* |
| 7 | lists only real steps on the exemption | **obsolete**: the list is deleted |
| 8 | `assertProduced` refuses an unconverted step whose artefacts are not there | **obsolete**: only an exempt step could reach the postcondition with no parts |
| 9 | `assertProduced`, as a function: half of what a step declares is missing | **ported**: `check-product` *refuses a step with half of what it declares readable* |
| 10 | refuses a part inherited from a prototype | **ported**: `check-product`, same name |
| 11 | refuses an artefact the step does not declare | **ported**: `check-product`, same name |
| 12 | refuses a step that declares nothing | **ported**: `check-product`, same name |
| 13 | the run phase is six read methods, and not the store behind them | **ported**: `store-pg-session` case 15, against the real session |
| 14 | the six still answer, about the real store | **twin**: `store-pg-session` case 2 reads the carried arc through `session.reads`; case 15 does too |
| 15 | releases the claim once the step is committed | **twin**: `store-pg-session` *waits for the article row before it writes anything* (`settlement.kind` is `released`) |
| 16 | reports the ending when a Stop turns the release into a cancellation | **twin**: `store-pg-session` *reports the cancellation a release resolved into, and disposes of the draft* |
| 17 | leaves the job alone when the product is refused | **twin**: `store-pg-session` case 2 (the job is still `running` and holds its draft) |
| 18 | ends the job on its own, for the endings that have no product | **twin**: `store-pg-session` *publishes the work an earlier request released, when every step skips*, and every `settleJob` case in `publication-enqueues-the-labels-successor` |

Thirteen had a twin or are obsolete; five were ported. Cases 10 to 12 are the three the Sol review
named. Cases 9 and 13 are two it did not.

### The ported cases, each watched red

| mutation | red |
|---|---|
| `!Object.hasOwn(parts, kind) \|\|` dropped from `checkProduct` | case 10 → `expected [Function] to throw an error` |
| the `extra.length > 0` throw disabled | case 11 → same |
| the `produces.length === 0` throw disabled | case 12 → same |
| `assertProduced` made never to ask the store | case 9 → `promise resolved "undefined" instead of rejecting` |
| the session's `reads` built from `pgArtifactsIn` (the whole store) | case 13 → `expected [ 'beginStep', 'finishStep', …(7) ] to deeply equal [ 'has', 'hasEarlierBlocks', …(4) ]` |
| the no-`parts` refusal disabled (the branch this item changed) | `stage2c-raw-bytes` *refuses an extract product with no parts whatsoever* |

**What the docs got wrong.**

- [ingest-queue.md](../project/ingest-queue.md) said the filesystem session *"went with the flag"*
  on 2026-09-05. The branch that chose it did; the session lasted another month. Corrected.
- [database.md](../project/database.md) described the exemption list as *"empty, and kept rather
  than deleted"*. Corrected to what is there now.
- The Opus read's count, *one real caller*, was right. Its list of what goes with it omitted
  `readsOf` and the registry entry.
- Comments that described `fsStoreSession` in the present tense, in `session.ts`, `pg-session.ts`,
  `pg-jobs.ts`, `jobs.ts`, `structure.ts`, `sketch.ts`, `checkpoints.ts`, `artifacts-pg.ts` and four
  test files, now say when it went. Comments that already described it as history are untouched.
