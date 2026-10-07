# Seventh sweep: pipeline tidy (C8)

Status as of 2026-10-07: all four items built, one commit each, reviewed by GPT Sol, its fixes
applied and landed on `dev`. See [Review status](#review-status) for what the review changed and
the two wider gaps it left.

**The four commits name this file `261007d`**, which is what it was called until `dev` was merged
in and another plan turned out to hold that letter. It is `261007e`.

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

**One cost:** the sweep previously made one batched query and now asks once per ended `labels`
job. The query count is bounded by its initial running-job candidate set, normally limited by
configured concurrency. That configuration accepts any positive integer; there is no small fixed
bound. Each query can also read queued candidates, whose count is not capped by concurrency.

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

**At build time, not covered by any test:** the `not(cancelling)` clause. A cancelling job is `running`
(`jobs_cancelling_is_running`), and no fixture has two running jobs on one article. The clause
moved with the query, unchanged. The code review added a direct predicate test with the same
running row as a positive control after its flag is cleared. It has since been run and seen red:
[Review status](#review-status).

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
| 4 | writes the new artefacts over the carried ones, and finishes the step | **twins**: `store-pg-session` *writes, completes, publishes, finishes and clears the pointer* covers one arc; `pg-session-real-step` *writes both its artefacts, finishes the step and publishes* covers two carried artefacts overwritten |
| 5 | is accepted with no parts while it is marked unconverted | **obsolete**: the exemption is deleted |
| 6 | is refused with no parts once it is no longer marked unconverted | **ported in code review**: `store-pg-session` *refuses a product with no parts without closing its begun step* (run and seen red, [Review status](#review-status)). The originally named twins checked the guard and an abandoned run separately; neither asserted that this refusal retains its begun run |
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

## Item 3: PQO6, two tests seen red, and the missing one

Two postmortems record a regression test as written and never run. Both pass today. Each was
mutated back to the original bug on 2026-10-07, watched red, and restored; the suites then passed
(370 of 370 over the four files).

**[261005i](../postmortems/261005i-cancellation-checked-before-an-await-does-not-authorize-the-next-attempt.md),
the six cancellation cases in `tests/ai-call-transport-retry.test.ts`.** Baseline 260 of 260.

| mutation in `src/ai-call.ts` | red |
|---|---|
| `if (n > 1) options?.signal?.throwIfAborted();` deleted from `asTransportAttempts` | 4 of 260: *opens no attempt when the signal aborts as the backoff finishes* for `openRouterJson`, `openRouterImage`, `openRouterTranscription`, `openRouterDecisions` → `expected undefined to be DOMException{ … 'TimeoutError: …' }` |
| `if (attempt > 1) options.signal.throwIfAborted();` deleted from `acceptedStream` | 2 of 260: the same case for `openRouterStream`, and *opens no retry if the activity callback aborts after the wait* → `expected 2 to be 1` |

Four and two are the six. The Sol cross-review had already shown this in a scratch copy, and says
the transport plan's own gates recorded it earlier, so the postmortem's "not been observed red or
green" was stale before this sweep.

**[261005p](../postmortems/261005p-a-successor-completion-rule-must-not-undo-the-producer-on-resume.md),
the constrained-resume case in `tests/open-before-structure-queue.test.ts`.** Baseline 8 of 8,
against Postgres. This is the one nobody had seen red.

| mutation in `src/pipeline.ts` | red |
|---|---|
| `structureIsNotAStandIn` put back to rejecting every awaiting tree (`return false` in place of the `headingsFirst` and never-published test) | *a handed-back import finishes without rebuilding its stand-in* → `Error: job … did not finish in 120 advances`; and the unit case in `structure-step-headings-first.test.ts`, *keeps a marked unpublished import's stand-in when its claim resumes* → `expected false to be true` |

Both postmortems now carry a dated note under the paragraph that said the test had not run. The
paragraph itself is unchanged.

**The missing test was written.** The Messages loop's check after its backoff
(`options.signal?.throwIfAborted()` in `finalMessage`,
[`src/messages-stream.ts`](../../src/messages-stream.ts)) had none. The seam already existed: the
scripted `fetch` and the row reader in
[`tests/messages-stream.test.ts`](../../tests/messages-stream.test.ts), and the timer trick the
OpenRouter cases use. No paid call and no change to `src/`. The new case, *a Stop as the backoff
finishes leaves one row, and opens no attempt 2*, lets the wait resolve and aborts before its
continuation runs.

| mutation in `src/messages-stream.ts` | red |
|---|---|
| the `throwIfAborted()` after the wait deleted | as first written: `expected [ [ 1, 'error', { …(3) } ], …(1) ] to deeply equal [ [ 1, 'error', { …(3) } ] ]`, a second row for an attempt opened after the Stop. As rewritten in review: `expected 2 to be 1` on `call.attempts()` |

The original case wrapped the first timer of a backoff's length (375 to 625 ms), asserting it
saw one. The code review showed that a different backoff duration makes that fixture fail against
correct code. It now wraps the real `waitOrStop`, aborting after it resolves and before its
caller continues, and checks opened attempts as well as sends and rows. The root cause and
mutation evidence are in
[the postmortem](../postmortems/261007e-a-timer-duration-is-not-the-boundary-it-belongs-to.md).

## Item 4: Summary's stamp, written down

Docs only; no behaviour changed. `src/pipeline.ts` § `STEPS.simple.stamp` expects the prompt
version and model of the summary already stored, where every other step's stamp expects the
current ones (checked: `simple` is the only stamp in `STEPS` that reads `store.stampFor`). Its
comment says so and says why:

> **The prompt version and model expected are the stored summary's own, when one is stored.** So
> an unforced run never rewrites a summary because the prompt or model has moved on since; it
> still rewrites when the article moved, and a forced run never asks. Without this every bump of
> `SIMPLE_PROMPT_VERSION` made each stored summary eligible for a rewrite by any unforced job that
> names `simple`, and the add page's *Generate the main modes* queues one (GPT Sol's review of
> plan 261004f stage 2, S1). *Outdated* is asked elsewhere, against the current version:
> src/store/pg.ts, the owner's GET and Metadata's row.

[summaries.md](../project/summaries.md) already stated the behaviour (the bullet *An unforced job
never rewrites a stored summary for the prompt's or model's age*) and already quotes Greg's
write-once rule of 2026-10-04. What it did not say is that this is the one step that differs from
the rest, on purpose. That paragraph is added under the bullet, with the two questions the code
keeps apart: *outdated* (shown, against the current version) and *may an unforced job rewrite it*
(the stamp, against the stored version). It attributes the stamp to the code's own comment, and
Greg's rule to the quote that was already there.

`architecture.md § Conventions` is unchanged. What it says about stamps is still true, and it is
an entry point whose wording is a rule.

**What the docs got wrong (item 3).** The Opus read said neither test had been seen red; the Sol review
corrected that for the transport cases and was right. The Opus read's file for the Messages check
(`src/messages-stream.ts`) was right; the brief for this cluster named `src/messages.ts` and
`src/ai-call.ts`, where it is not.

## Review status

GPT Sol reviewed the built code on 2026-10-07
([prompt](261007e-seventh-sweep-pipeline-tidy-one-successor-rule-and-the-dead-filesystem-session-code-review-prompt.md),
[answer](261007e-seventh-sweep-pipeline-tidy-one-successor-rule-and-the-dead-filesystem-session-code-review-sol.md)).
**Verdict: "ship with these fixes applied."** It made the fixes itself and had no database, so
its Postgres cases arrived unrun. They were then run outside the sandbox, and each was shown to
fail against the wrong implementation it exists to catch. Source was restored from a scratch copy
and compared byte for byte after each mutation.

| | finding | what happened |
|---|---|---|
| **C1** | Deleted case 6 checked that refusing a step with no `parts` leaves the begun run open. Its named twins checked the refusal and an abandoned run separately, so a session that closed the run while refusing would have passed | **Fixed.** New Postgres case in `tests/store-pg-session.test.ts`, plus a runtime guard over every step and a compile-time guard in `tests/check-product.test.ts` |
| **C2** | The Messages boundary test picked out the backoff's timer by its length. A changed backoff made it fail against correct code | **Fixed.** It wraps the real `waitOrStop` and asserts opened attempts, sends and ledger rows. [Postmortem](../postmortems/261007e-a-timer-duration-is-not-the-boundary-it-belongs-to.md) |
| **C3** | Three clauses of the successor rule had no case: `not(cancelling)`, the live trigger's `unfinished === "labels"`, and its error-only condition | **Fixed.** Three Postgres cases in `tests/publication-enqueues-the-labels-successor.test.ts`. No change to `src/` beyond a comment |
| **C4** | Comments and docs that claimed more than the code does: every stamp has a model (`assets` has none), Sketch has two callers, the null checkpoint store has two, the helper only sees jobs that have not started, the transport cases had never been seen red, the sweep's query count is "a handful" | **Fixed**, each checked against the code. One link Sol wrote had a doubled hyphen in its anchor and was corrected |

### The Postgres cases, run

All four passed as written (`tests/store-pg-session.test.ts` and
`tests/publication-enqueues-the-labels-successor.test.ts`, 46 of 46 together).

| case | wrong implementation | red |
|---|---|---|
| *refuses a product with no parts without closing its begun step* | `commit` ends the step's run row before refusing absent parts | that case alone, 1 of 18 → `the step is not done: expected 'error' to be 'running'` |
| *a cancelling labels job is not a promise of more labels* | `not(jobs.cancelling)` removed from `anotherJobCarriesLabelsIn` | that case alone, 1 of 28 → `a cancelling job promised work it may abandon: expected true to be false` |
| *a live structure error leaves pending labels alone* | the live trigger's `unfinished === "labels"` widened to any unfinished step | that case alone, 1 of 28 → `expected 'failed' to be 'pending'` |
| *a live labels cancelled leaves pending labels alone* | the live trigger's `ending.status === "error"` removed | that case alone, 1 of 28 → `expected 'failed' to be 'pending'` |

C2 was run again too: with the `throwIfAborted()` after the wait removed from
`src/messages-stream.ts`, *a Stop as the backoff finishes leaves one row, and opens no attempt 2*
fails alone, 1 of 86, with `expected 2 to be 1`.

### The deletion a comment argued against

The docstring on `LEGACY_UNCONVERTED_STEPS` said deleting the list *"would be the wrong
tidy-up"*, and this work deleted it ([item 2](#item-2-pqo3-the-filesystem-session)). The review
was asked to judge that deletion specifically. Sol's judgement: it stands. Its searches found no
remaining executable use of the deleted machinery, string-built references included, it raised no
finding against the deletion, and its verdict was to ship. Under C1 it added the two guards at
the end of this list. The argument that the comment defended the refusal and not the list is the
builder's, in item 2. Four things now hold the rule the list held:

- the type `ConvertedProduct`, which is the return type of every step's `run` and requires `parts`;
- `checkProduct`, which refuses a product with no `parts` unconditionally, with no opt-out
  parameter;
- a runtime guard: `check-product` *refuses a product with no parts for every step* walks `STEPS`;
- a compile-time guard: `check-product` *requires parts in every step's run return type*, a
  `@ts-expect-error` that stops compiling if `run` may return a product without `parts`.

### Left

Two wider gaps Sol named and did not change. Neither was introduced here.

- **A Stop can leave the labels `pending` with nobody coming.** The successor rule says "another
  job is still going to make them, so do not mark them failed". Stop does not take the article's
  lock, so a reader can stop that queued successor while the failing job is settling, or just
  after. The failing job has already decided not to mark, the successor is now cancelled, and the
  article goes on saying its labels are arriving. Closing it means changing what Stop does, which
  is out of scope here and is a question already with the owner.
- **A successor queued against an older base revision is counted as still carrying the work.**
  The rule looks at the job's status and step list, not at which revision it was queued for. A
  successor from before the article was republished cannot finish the current revision's labels,
  but it still stops the current revision being marked `failed`.
