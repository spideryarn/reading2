# Seventh sweep, depth: the pipeline and the import queue  (Opus, read-only, 2026-10-06)

The Claude-family read of this zone for the [seventh sweep](../plans/261006m-seventh-codebase-sweep-depth-umbrella.md),
written without sight of GPT Sol's read of the same zone. Briefs:
[common](261006d-seventh-sweep-depth-prompt-common.md),
[zone](261006d-seventh-sweep-depth-prompt-pipeline.md). It extends
[the fifth sweep's read](261003b-fifth-sweep-data-and-pipeline.md), which did not read the queue's
walk or the store's transitions line by line. No tracked file was changed.

Evidence states: **R** reproduced by running something, **C** proved from the code, **H**
hypothesis.

## What I read  (files read in full / in part / skipped, and why chosen)

Chosen by what changed 2026-10-04..06 (`git diff --stat ef45231a0 HEAD` over the zone: 7,034 lines
added in 22 files) times what a mistake costs.

**In full**

- `src/jobs.ts` (4,778 lines): the walk, every ending, enqueue, retry, slug allocation.
- `src/store/pg-jobs.ts` (2,386): every statement that writes `jobs`.
- `src/store/jobs.ts` (889): the contract.
- `src/structure-slices.ts` (864, all new on 10-05/06), `src/another-window.ts`,
  `src/transport-retry.ts`.
- `src/store/pg-successor.ts` § `enqueueSuccessorIn`, `src/web/useJobs.ts`.

**In part**

- `src/store/pg-session.ts`: header and `settleIn`, `commit`, `settleJob` (lines 1–110, 290–810).
- `src/pipeline.ts`: `stepIsDone` and its helpers, `STEPS.fetch` … `assets`, every mode's `stamp`,
  and the code lines of the 10-04..06 diff (`fetchByAddress`, reading difficulty, the
  headings-first step).
- `src/structure.ts` § `generateStructure` down to the whole-document checkpoint read.
- `src/store/pg-revisions.ts`: the successor block of `publishRevisionIn`, `fenceJob`,
  `sweepAbandonedDrafts`.
- `src/collect-assets.ts` (how it treats the caller's signal), `src/store/session.ts`
  (`fsStoreSession`), `src/store/find-article.ts`, `src/web/AddArticle.tsx` § the card's title,
  `docs/project/ingest-queue.md` (two sections), postmortems 261005p and 261005i.

**Not read**: `src/ai-call.ts`, `src/messages.ts`, `src/messages-stream.ts`, `src/models.ts`,
`src/simple-summary.ts`, `src/fetch.ts`, `src/extract.ts`, the deepen / cascade / expand siblings
of structure, `src/blocks.ts`, `src/reading-difficulty.ts`, `src/heading-tree.ts`,
`src/paper-sources.ts`, `src/web/AddPage.tsx`, `src/web/jobEngine.ts` (grep only),
`src/job-state.ts`. By the same `--stat`, about 5,000 of the 8,300 lines changed in those three
days are in files I did not read, so my silence on them is not a null.

**Run**

- `npx vitest run tests/ai-call-transport-retry.test.ts`: 260 passed.
- `npx vitest run tests/open-before-structure-queue.test.ts`: 8 passed.

Both are tests a postmortem records as written and never run (PQO6).

## What the method could not see

- **PQO1 is not reproduced.** A new test file falls in the no-database lane unless it is added to
  the lane manifest (`tests/store-migration-registry.ts`), which is tracked. So it stays C.
- Nothing was measured in production: how often a step returns inside the 20 s between the
  claimant's deadline and the lease, or how often Stop lands on the claimant's own instance.
- Timing, provider behaviour and the browser were not exercised.
- Comments outnumber code in the three queue files. I read them, and where a comment and the code
  disagreed I believed the code; PQO4 is the list.

## Findings  (ranked by ease x value; Tier 0 first)

### PQO1 — A step that returns its product after an abort has three different endings

**Tier 0 · C · ease 4 · value 3 · risk low-medium.**

`src/jobs.ts` § `transitionAfter`, the branch `if (controller.signal.aborted)`. It runs when a
step returned normally although the claim's signal had fired. It answers an *ending* whatever is
left to do:

- our own deadline fired → `interruptedEnding(job)`: status `error`, `INTERRUPTED`;
- a reader's Stop reached this process → `cancelled`.

`session.commit` then writes the step's product and, in the same transaction, `settleIn` calls
`failRevisionIn` for any ending that is not `done` (`src/store/pg-session.ts`, the `else` arm
under "Cases 2, 3 and 5"). So the finished step's work is committed into a draft that is discarded
one statement later.

Three inputs, three answers, for "the step finished and something asked it to stop":

| What happened | Ending today | Draft |
|---|---|---|
| Stop pressed, request landed on **another** instance, last step finishes | `done`, published (`finishIn` clears the flag: "A Stop that arrives during the *last* step does not un-finish the job … deliberate") | published |
| Stop pressed, request landed on **the claimant's** instance (`cancelJob` § `aborts.get(id)?.abort()`), last step finishes anyway | `cancelled` | discarded |
| The claimant's deadline fired, the step finished within the 20 s margin | `error` / `INTERRUPTED`, Retry button | discarded |

Compare the two neighbours of the third row. A step that *obeys* the deadline goes through
`pauseForDeadline` and is requeued with its draft. A step that finishes *after the lease* is
refused by the fence and requeued by the sweep with its draft. Only the step that finishes in
between ends the job, and on a first import a Retry then mints every block id again
(`PauseOutcome` § `requeued` says what that costs).

**A step that reaches this branch exists**: `collectAssets` never throws on the caller's signal
(`src/collect-assets.ts` § `reasonFor`: "the *caller's* cancellation is not this … falls through
to `network`"), and `recoverPdfFigures` returns on `signal.aborted`. `assets` is the last step of
every import. So: Stop during `assets` gives row 1 or row 2 by which instance answered the cancel.

History: the branch was `cancelled` for both until GPT Sol's relabelling ("the deadline had a
branch on the failure path and none on the success path"). `pauseForDeadline` arrived on
2026-09-04 and was wired to the failure path only.

**Proposed fix (a separate claim).** Decide on what is left, not on the signal:

- deadline fired, step finished → take the same `pauseForDeadline` door the failed case takes
  (`walkClaim` already has it), not an ending;
- Stop, last step → one answer for both instances. Which one is the owner's (below).

Do **not** simply commit the product and release: `assets` returns a manifest in which every
unfetched image is `failed: "network"`, stamped current. Today that product is always discarded.
A fix that keeps it would publish it.

Needs first: a walk test with a step that ignores its signal, on a two-second lease
(`tests/claim-session-postgres.test.ts` has the harness), red on the third row.

### PQO2 — `job.title` has one writer, and three of the four ways a claim is put down lose it

**Tier 1 · C · ease 4 · value 2 · risk low.**

- `src/jobs.ts` § `runStep`: `if (step.name === "extract") job.title = product.detail`. In memory.
- It reaches the row only through `release`'s `fields` and `finish`'s `ending.title`.
  `noteProgress` writes `steps` alone; `pauseForDeadline` and `settleExpired`'s requeue take no
  title.
- On the next window `extract` is skipped (`stepIsDone`), so nothing sets it again and the final
  ending carries none.
- `src/web/AddArticle.tsx` § `JobCard`: `{job.title ?? job.slug}`.

Two reachable cases:

1. A job that runs `extract` and then pauses mid-step in the same window: *Start again* or a CLI
   import of a document long enough for slices (`NeedsAnotherWindow`). The card shows the slug to
   the end.
2. **A minimal paper never gets a title at all**: its job is `["fetch", "metadata"]`
   (`MINIMAL_STEPS`), and `metadata` returns `detail: meta.title` exactly as `extract` does, but
   the lift names `extract` only.

**Proposed fix (separate claim).** Let `noteProgress` carry the title when there is one, and lift
it from whichever step produced `meta`. Nothing existing duplicates it.

### PQO3 — A second session implementation and two store methods that only tests reach

**Tier 1 · C · ease 3 · value 3 · risk low.**

```sh
grep -rln "fsStoreSession(" src tests scripts evals    # 1 real caller: tests/store-session.test.ts:220
grep -rn "[sS]tore\.finish(\|[sS]tore\.releaseStep(" src scripts evals   # 0 job-store callers
```

- `src/store/session.ts` § `fsStoreSession` (about 60 lines) is "a session over the filesystem".
  Production has had one session since 2026-09-05 (`claimSession`). Its one caller is a 626-line
  test of a shape nothing runs.
- With it: `JobSettles`, `UNCONVERTED_STEPS`, `LEGACY_UNCONVERTED_STEPS` (an empty tuple),
  `LegacyUnconvertedStep` (`never`), the conditional return type on `PipelineStep.run`,
  `checkProduct`'s third parameter and `NOTHING_UNCONVERTED`.
- `JobStore.finish` and `JobStore.releaseStep` (`rawPgJobStore`, through `settlingIfTerminal`)
  have no caller in `src/`; `pg-jobs.ts` says so itself. Nine test files call
  `pgJobStore.finish(` or `pgJobStore.releaseStep(` (`grep -rlE` over `tests/`), most as a
  fixture. They end a job **without disposing of its draft**, which is the state PQO5 is about and
  one production cannot produce.

Neither sweep umbrella mentions any of these names (grep of both: no hits). The sixth sweep's S1
deleted what the filesystem store left behind and stopped short of this.

**Proposed fix (separate claims).** (a) Delete `fsStoreSession`, its test and the unconverted-step
machinery: the deletion test passes, nothing spreads to callers. (b) Leave the two store methods
until PQO5 is decided; a fixture that needs a terminal job can go through a session.

### PQO4 — Fourteen comments in the queue files describe a queue that is gone

**Tier 1 · C · ease 5 · value 2 · risk none.** Same class as the sixth sweep's S2, in files it
touched the same day (`3a8df257a`).

| Where (anchor) | Says | Is |
|---|---|---|
| `src/jobs.ts`, comment above `import { costStore, totalLedger }` | "The artefact store the **filesystem** session writes through … Stage 4 deletes the branch and this import" | the cost ledger; no branch |
| `src/jobs.ts` § `advanceJob` | "Run **exactly one** not-yet-done step" | walks the whole job |
| same, § "What this deliberately does not do" | a lapsed job "is failed … transactional-stage-runner … is not built" | requeued within `REQUEUE_BUDGET`; the file header says so |
| `src/jobs.ts`, banner "advancing" | "one step per HTTP request" | one claim per request |
| `src/jobs.ts` § `pump` | "concurrency 1 … `jobs_only_one_running`" | six, counted in a lock; index dropped 2026-08-30 |
| `src/jobs.ts` § `walkClaim`, the session note | "`PRODUCTION` … still picks the filesystem artefact store" | Postgres only |
| `src/jobs.ts` § `AdvanceParts` | "picks its session by `STORE`"; "selects Postgres or the filesystem" | no flag |
| `src/jobs.ts` § `transitionAfter`, release | "What it costs … is the scratch directory … a cold one re-runs" | nothing; the draft is kept |
| `src/jobs.ts` § `STEP_BUDGET_MS` header | "on Vercel the scratch directory … goes with the invocation" | no scratch |
| `src/jobs.ts` § `KEEP_FINISHED` | "the `_jobs` directory, the in-memory map" | rows |
| `src/store/jobs.ts` header | "a contract with two adapters"; "the artefacts are still files"; an expired lease "does **not** mean another claimant may take the job over" | one adapter; transactional; `settleExpired` requeues, three hundred lines down |
| `src/store/jobs.ts` § `noteProgress` | "A step is one HTTP request" | a walk is |
| `src/store/pg-jobs.ts` § `trimFinished` | "cited from the filesystem adapter (src/store/jobs-fs.ts)", "both adapters" | file deleted (5 mentions of `jobs-fs`/`sweepStopped` in this file) |
| `src/pipeline.ts`, above `assets` | "The only step with no model call" | `recoverPdfFigures` asks a model to locate figures (`figuresLocateCalls`) |

Two numbers in the lease arithmetic are also no longer bounds, though nothing breaks on them
because the walk hands back before `structure` anyway:

- "fetch ≤110s" (`LEASE_MS` note, pinned by `tests/jobs-lease-budget.test.ts`): since 261006i
  `fetchByAddress` can make an ordinary fetch and then a paper source's candidates, each its own
  three-attempt `fetchDocument`.
- "assets ≤185s": the step is `collectAssets` (180 s cap) **then** `recoverPdfFigures` (its own
  180 s cap, `PDF_FIGURES_BUDGET_MS`).

**Proposed fix.** Edit the comments; for the two numbers, say what bounds them or stop calling
them bounds.

### PQO5 — "A terminal job holds no draft pointer" is kept by hand in four statements

**Tier 2 · C · ease 2 · value 3 · risk medium.**

`sweepAbandonedDrafts` spares any revision a job row names (`abandonedDraftCondition`), so a
terminal job with a pointer is a draft nothing reclaims. The rule is restated in comments in four
files (`store/jobs.ts`, `pg-jobs.ts`, `pg-session.ts`, `jobs.ts`) and enforced in four statements:

```sh
grep -n "draftRevisionId: null\|draftRevisionId: sql\|set({ draftRevisionId" src/store/*.ts
# pg-jobs.ts settleExpired's settlement · pg-jobs.ts requestCancel · pg-revisions.ts fenceJob
# (publish and fail) · pg-session.ts discardAfterCancel
```

`finishIn` and `releaseStepIn`'s cancelled arm do not clear it and rely on their caller
(`settleIn`) having done so. The schema has `jobs_running_is_fenced` and
`jobs_cancelling_is_running` and nothing for this.

More generally, to the zone brief's question: **the database refuses no transition.** Every
transition is a `WHERE` in application code (`liveAttempt`, `status = 'queued'`). The three CHECKs
constrain the shape of a state, not the move between two. I found no writer that makes an illegal
move; the writers are in the table below.

**Proposed fix (separate claim).** A CHECK, `status in ('queued','running') or draft_revision_id
is null`. It cannot land as is: case 4 sets `cancelled` in `releaseStepIn` and clears the pointer
one statement later, and a CHECK is immediate. `releaseStepIn` would have to clear the pointer in
its own `case`. An additive migration plus one reordered statement; it wants a characterisation
test of case 4 first.

### PQO6 — Two tests their postmortems record as never run do pass; neither has been seen red

**Tier 1 · R (green only) · ease 5 · value 1.**

- Postmortem 261005i: the six cancellation cases in `tests/ai-call-transport-retry.test.ts` "have
  not been observed red or green". Run today: 260 of 260 pass.
- Postmortem 261005p: `tests/open-before-structure-queue.test.ts` "could not run in this sandbox …
  red-then-green evidence remains unearned". Run today: 8 of 8 pass.
- Still open from 261005i: the Messages loop's check (`src/messages-stream.ts` §
  `options.signal?.throwIfAborted()`) was added "with no test of its own".

Green without a red is half the evidence either postmortem asked for.

## Siblings compared

**How a claim is put down**

| Door | Statement | Draft | `requeues` | Steps written from | Title reaches the row |
|---|---|---|---|---|---|
| Between steps | `releaseStepIn` | kept | no | the claimant's copy | yes |
| Mid-step, deadline or step asked | `pauseForDeadline` | kept | +1 | the row (`settledSteps`) | **no** (PQO2) |
| Lease lapsed, budget left | `settleExpired` requeue | kept | +1 | the row | **no** |
| Lease lapsed, budget spent | `settleExpired` settlement | pointer cleared | no | the row | no |
| Stop on a queued or lapsed job | `requestCancel` | pointer cleared | no | the row | n/a |
| Step failed or stopped | `settleJob` → `finishIn` | failed | no | the claimant's copy | yes |
| Last step ran | `commit` → `finishIn` | published | no | the claimant's copy | yes |
| Step **finished after an abort** | `commit` → `finishIn` with an ending | **failed, with the finished product in it** (PQO1) | no | the claimant's copy | yes |

**Every writer of `jobs.status`**

| To | From | Writer | Refused by |
|---|---|---|---|
| `queued` | (insert) | `enqueueIn`; `enqueueSuccessorIn` | three partial unique indexes, re-read and classified |
| `queued` | `running` | `releaseStepIn`; `pauseForDeadline`; `settleExpired` requeue | `liveAttempt`; `lapsed` predicate |
| `running` | `queued` | `claimIn` | `status = 'queued' and not cancelling`, inside the `queue_state` lock |
| `done` / `error` / `cancelled` | `running` | `finishIn` | `liveAttempt` |
| `cancelled` | `running` + `cancelling` | `releaseStepIn` | `liveAttempt` |
| `error` / `cancelled` | `running`, lapsed | `settleExpired` settlement | `lapsed` predicate |
| `cancelled` | `queued`, or `running` lapsed | `requestCancel` | owner and `ACTIVE` |

Other writers of the row that leave the status alone: `noteProgress` (steps), `fenceJob` (the draft
pointer), `discardAfterCancel` (the pointer), `forget` (`dismissed_at`), and
`enqueueSuccessorIn`'s retime of a queued holder's `created_at`, which is the only statement that
moves a job's place in an article's line after it is queued. `scripts/eval-big-imports.ts` inserts
and deletes rows directly.

**Steps, where they differ**

| Thing | Most steps | The odd ones | Written reason? |
|---|---|---|---|
| Freshness | a `stamp`: input hash, prompt version, model | `fetch`, `metadata`, `extract`: presence only. `blocks`: `isDone` re-derives. `structure`: no stamp, `isDone` is "not a stand-in" | yes, each |
| Prompt bump makes it stale | yes | `simple`: expects **the stored** version and model, so never | yes, at `STEPS.simple.stamp`; the same argument is not made for or against the other modes (H: whether it applies) |
| Profile in the stamp | `ideas`, `sketch`, `skim` (and `illustrated` through the Sketch) | `quotes`, `glossary`, `quiz`, `simple` take a profile and leave it out, each with a reason; `tweets` takes one and says nothing | no, for `tweets` |
| Lifts a title onto the job | `extract` | `metadata` returns the same thing and is not lifted | no (PQO2) |
| Throws on the caller's abort | yes | `assets` returns a product | yes, for its own budget; not for what the queue then does (PQO1) |
| Can ask for another window | no | `structure`, slices path only | yes |
| Budget is a real bound | measured or a declared guess | `fetch` and `assets` say "≤" and are not (PQO4) | no |

**Retry loops** (`TRANSPORT_ATTEMPTS`): `messages-stream.ts` and `ai-call.ts` share
`transport-retry.ts`; `pdf-read.ts` and `embeddings.ts` keep their own, with the reason written in
`transport-retry.ts`. No drift found, on a grep-level read.

## For the owner

1. **Stop pressed during the last step of an import, and the step finishes anyway.** Today the
   reader gets the article if their Stop happened to be answered by a different server from the
   one doing the work, and loses it (job "cancelled", work thrown away) if it was the same one.
   The code's own note on `finishIn` argues for *keep the article*: "Calling that `cancelled`
   would be a lie about a thing the reader can see". Choosing *keep* means a Stop in the last
   seconds does nothing visible; choosing *discard* means a finished, charged-for import is thrown
   away. Either is one rule instead of two.
2. **Whether a prompt change should make stored mode output stale.** For Simple it was decided
   no (a stored summary keeps the version it was written under). For the other modes a newer
   prompt version makes the stored artefact "not current", so an unforced job naming that mode
   writes it again and spends a call. I did not establish how often such a job is queued without
   a reader asking. The question is only whether Simple's rule is the house rule or an exception.

## Considered and not proposed  (with the reason)

- **Removing the `JobStore` interface** (one implementation since 2026-09-05). It is where the
  contract is written down, and deleting it moves 800 lines of prose rather than removing a part.
- **A smaller `STEP_BUDGET_MS` for a `headingsFirst` structure step**, which needs no model call
  and still reserves 700 s, so a PDF's first import hands back once before an instant step. The
  cost is one extra claim, well under a second; a second number is worse than that.
- **Sharing the expected stamp between `pipeline.ts` and `pg.ts`** (fifth sweep D5): held there,
  no new drift found here.
- **A generic "optional call" helper from `runSlices`' `ask`**. One caller.
- **Splitting `jobs.ts` or thinning its comments.** Size alone, refused twice. PQO4 is the
  specific harm the comment mass does: fourteen false ones survived a false-comment pass.
- **A progress test before a requeue** ("requeue only if a checkpoint landed"). `REQUEUE_BUDGET`'s
  own note considers and declines it; nothing new.
- **`runSlices`**: I looked for a call left running when the function returns, a checkpoint that
  could answer a different question, a latch a refill could set, and a second chance that outlives
  its cap. Found none. `deps.canonical` and `checkpointKey` are called outside `ask`'s `try`, so a
  throw there would reject a pool worker while its peers are still out; both are pure, so this is
  a note and not a finding.
- **Open-before-structure**: I walked first import → stand-in → successor, a successor that fails,
  one that runs out of windows, a retry, a second paste while the first runs, and a mode pressed
  meanwhile. Each ends where `ingest-queue.md` § "A first import opens before its structure" says
  it does.

## One level up

The approach is sound, and the 10-04..06 work kept to it: one row per job, a claim that is a
token and a lease on one clock, transitions that are single fenced statements, artefacts and the
job's move in one transaction, and paid work banked under the article so a second window resumes.
The new pieces (slices, another window, the stand-in tree) each reuse an existing door rather than
adding one, which is why I found no second mechanism for one job in the code written this week.
What is left over is older: the one branch that predates the cooperative pause and was never
routed through it (PQO1), a filesystem-era session and its type scaffolding kept alive by a test
(PQO3), and a layer of comments still arguing with a queue that was deleted a month ago (PQO4).
The queue has no lever in the database for its own state machine beyond three CHECKs; that has
held because every writer is in two files, and PQO5 is the cheapest place to start if it ever
stops holding.
