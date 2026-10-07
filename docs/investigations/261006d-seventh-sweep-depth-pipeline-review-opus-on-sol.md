# Seventh sweep, depth: pipeline and import queue — Opus reviews GPT Sol's read (2026-10-06)

Cross-family review under
[the cross-review brief](261006d-seventh-sweep-depth-prompt-cross-review.md) of
[Sol's investigation](261006d-seventh-sweep-depth-pipeline-and-import-queue-sol.md) (THEIRS),
compared with [Opus's](261006d-seventh-sweep-depth-pipeline-and-import-queue-opus.md) (YOURS).
Tree: `bf78e90c7`. No tracked file was changed.

Sol had no database. This review did, so its three Tier 0s and Opus's PQO1 were run against real
Postgres. **All four reproduce.**

## How the probes were run

A new test file lands in the `unit` lane (poisoned `DATABASE_URL`) unless
`tests/store-migration-registry.ts` § `TEST_LANES` lists it, and that file is tracked. The way round
that needs no tracked edit: an **untracked** `vitest.probe.config.ts` with one project that reuses
the private lane's own `globalSetup` (`tests/setup/private-db-global.ts`) and setup files
(`no-provider-calls.ts`, `private-db.ts`) and includes `tests/zz-probe-*.test.ts`:

```sh
npx vitest run --config vitest.probe.config.ts tests/zz-probe-walk.test.ts \
  --reporter=verbose --disable-console-intercept
```

Each run minted and dropped its own database (`[private lane] spideryarn_test_… dropped`). The two
probe files were the first 510 lines of `tests/jobs-walk.test.ts` and the first 606 of
`tests/publication-enqueues-the-labels-successor.test.ts` (their fixtures, unchanged) plus the cases
below. Config and both probes are deleted; `git status` shows only the sweep's own untracked docs.
No model call, no write outside the minted database.

Every probe drives production's `advanceJobWith` / `claimSession` / `pgJobStore`; only the step
bodies are fakes (as in `jobs-walk`), and for PQ1 one read is made to throw once.

## Sol's findings

### PQ1 — a freshness-read failure abandons a live claim: **reproduced. R. Tier 0, P1.**

Traced: `src/jobs.ts` § `runStep`, `(await stepIsDone(registry[step.name], ctx, session.reads))` is
in the `if` above the `try`; `walkClaim`'s outer `catch` rethrows anything that is not
`StaleAttemptError` / `DraftGoneError`; `finally` only `standDown()`s.

Probe: `session.reads.interrupted` throws once, everything else real.

```
PROBE PQ1 {"escaped":"transient freshness read","stepsRun":[],"rowStatus":"running",
  "rowStep":"pending","hasAttempt":true,"draftPointerHeld":true,"leaseSecondsLeft":760,
  "secondAdvance":{"busy":true,"done":false,"status":"running"},
  "jobBehindOnSameArticle":{"busy":true,"done":false,"status":"queued"}}
PROBE PQ1-control {"escaped":null,"stepsRun":[],"rowStatus":"error","draftPointerHeld":false,
  "done":true,"failureKind":null}
```

So the durable half Sol could only argue is real: the row is `running` with 760 s of lease, its own
next advance answers `busy`, and a second job on the same article waits behind it. The control is
the protected sibling (a failing **power** read): it ends `error`, pointer cleared, retryable.

**The fix, separately.** Capturing the read and rethrowing inside the `try`, as `powerRead` and
`structureRead` do, is the smallest change and duplicates nothing. Two things to know before
building it:

- It changes the recovery, not only its speed. Today the wedge ends in `settleExpired`, which
  *requeues with the draft kept* while budget is left. After the fix the job ends `error` at once
  and the draft is failed, exactly as for a failed power read. That is consistent and I would build
  it, but the test should pin "draft failed, pointer cleared, `failureKind` not `blocked`".
- **It closes one of four exits of this class.** `await note()` is also outside the `try` in
  `runStep` twice (the skip branch and the "step starting" write) and once in `walkClaim` after a
  kept step. A `noteProgress` that fails for any reason but a stale fence escapes by the same route.
  C, not reproduced. The by-construction version is the outer `catch`: end through
  `endAsStorageFailure` instead of `throw err`. That needs a fourth `StorageFailureDoor` and its
  sentence, so it is a follow-up, not part of the Tier 0.

No new refusal. **Safe to build.**

### PQ2 — lock contention answers 200 with no job: **reproduced through the real route. R. Tier 0, P2 (value overstated).**

Traced: `src/store/pg-jobs.ts` § `claim`, `if (lockUnavailable(err)) return { kind: "busy", … }`
before any classification; `src/jobs.ts` § `advanceJobWith`, `case "busy"`,
`(await store.get(id, owner)) as Job`. `refusalFor`'s own comment describes this exact defect for
the two branches that were fixed. It is the only such cast in the file
(`grep -n ") as Job\b" src/jobs.ts` → 1).

Probe: a second `pg` connection holds `select 1 from spideryarn.queue_state where id = 1 for
update`; the job id was minted and never inserted.

```
PROBE PQ2-direct {"rowExists":false,"returnedNull":false,
  "wire":"{\"ran\":null,\"busy\":true,\"done\":false}","jobIsUndefined":true}
PROBE PQ2-route-locked {"status":200,"body":"{\"ran\":null,\"busy\":true,\"done\":false}"}
PROBE PQ2-route-unlocked {"status":404,"body":"{\"error\":\"No such job\"}"}
```

**Impact is smaller than "the client fails".** `src/web/jobEngine.ts` § `step` calls
`terminalOf(advanced.job)` inside its `try`; the `TypeError` is caught, `noteAdvanceFailure` counts
one driver failure, the loop waits and asks again, and the next answer (lock free) is the 404 that
stops it. The job is not in the list, so nothing renders the count. One wasted request per
contended advance of a vanished job. No reader-visible effect: P2.

**The fix** (`const job = await store.get(id, owner); if (!job) return null;`) is the smallest, and
Sol is right not to classify inside the transaction, which Postgres has already aborted. **Safe to
build**; it is three lines. The test can use the probe's shape: hold the row lock on a second
connection, advance a minted id, expect 404.

### PQ3 — a live Labels failure ignores another job carrying the work: **reproduced. R. Tier 0 by the brief's definition, but P2: no visible effect.**

Traced: `src/store/pg-session.ts` § `settleIn`,
`unfinished === "labels" && ending.status === "error" ? await markNavLabelsFailedIn(…)`, with no
look at other jobs; `src/store/pg-jobs.ts` § `settleExpired`, `stillCarryingLabels`, which skips
the mark when another active, non-cancelling job on the article has a `labels` step.

Probe: publish a `pending` revision (which queues successor B, `["labels"]`); older job A
`["structure","labels"]` claims first and its `labels` step fails, once live and once by lease
expiry with budget 0.

```
PROBE PQ3-live   {"jobAEndedAs":"error","baseStillCurrent":true,"baseNavLabelStatus":"failed",
  "successorB":{"status":"queued","cancelling":false,"steps":["labels"]}}
PROBE PQ3-expiry {"jobAEndedAs":"error","baseStillCurrent":true,"baseNavLabelStatus":"pending",
  "successorB":{"status":"queued","cancelling":false,"steps":["labels"]}}
```

Same question, two durable answers. Sol's reachable shape is this one (A older than the
publication), not only a forced run.

Sol's impact limit holds: the only client reader is `paragraphLabelsReady`
(`src/web/nav-labels.ts`), which is `ready` or not, and B's own publication overwrites the state.
Value 1 to 2.

**The fix.** Applying the existing check in the live path is right. Build it as one
transaction-local helper called from both paths rather than a second copy, since a second copy is
how this drifted; it must exclude the settling job by id (in the live path A is still `running`
when the mark is decided, unlike the sweep, where it is already terminal). Keep
`unfinished === "labels"` as the live trigger; do not merge it with membership. Lock order: the
live path takes the article lock inside `markNavLabelsFailedIn` after `failRevisionIn`; the helper
only reads `jobs`, so no new lock. **Safe to build**, low priority.

### PQ4 — queue-contract comments describe the deleted design: **confirmed. C. Tier 1.**

Checked each: `src/store/jobs.ts` line 2 "a contract with two adapters", "still files", an expired
lease "does **not** mean another claimant may take the job over" (contradicted by `settleExpired`'s
requeue); `releaseStep` "Fenced on all three of id, attempt and `status = 'running'`" and
`noteProgress` "Same three-condition fence", while `src/store/job-fence.ts` § `liveAttempt` has four
conditions (`leaseIsLive`); `src/jobs.ts` "Run **exactly one** not-yet-done step", "one step per
HTTP request". `src/store/jobs-fs.ts` does not exist. Wording only. **Safe to build**; it edits
comments in source files, not rule docs.

### Sol's sibling tables

Spot-checked, not re-derived: 23 steps; the state/transition table matches Opus's and the code I
traced. One row is wrong by omission: "Cancellation: … Local Stop aborts it; remote Stop is observed
at claim boundaries" presents as one rule what is two outcomes for a step that finishes anyway
(PQO1 below).

## Opus's findings (same zone), checked the same way

### PQO1 — a step that returns after an abort has three endings: **reproduced. R (was C). Tier 0, P1.**

Four runs of one single-step job whose step ignores its signal and returns its product:

```
PROBE PQO1-control     {"how":"none","signalAbortedWhenStepReturned":false,"jobStatus":"done",
  "draftRevisionStatus":"published","published":true}
PROBE PQO1-remote-stop {"how":"remote","signalAbortedWhenStepReturned":false,"jobStatus":"done",
  "draftRevisionStatus":"published","published":true}
PROBE PQO1-local-stop  {"how":"local","signalAbortedWhenStepReturned":true,"jobStatus":"cancelled",
  "jobError":"Cancelled","stepStatus":"done","draftRevisionStatus":"failed","published":false}
PROBE PQO1-deadline    {"how":"deadline","signalAbortedWhenStepReturned":true,"jobStatus":"error",
  "jobError":"This stopped part-way through, … The steps that finished are kept, so trying again
  picks up where it left off rather than starting over. [jb-gone]","requeues":0,
  "stepStatus":"done","draftRevisionStatus":"failed","published":false}
```

("remote" is `pgJobStore.requestCancel` with no local abort; "local" is `cancelJob`; "deadline" is
`leaseMs: DEADLINE_MARGIN_MS + 100` and a step that sleeps 400 ms.)

All three rows of Opus's table are real. Two additions:

- The deadline row is reachable in production through the step Opus names. `STEP_BUDGET_MS.assets`
  is 185 s, but the step is `collectAssets` (180 s cap) then `recoverPdfFigures`
  (`PDF_FIGURES_BUDGET_MS` 180 s), and `collectPdfFigures` answers an abort with `return`, not a
  throw. A PDF import whose assets step starts with 185 to 360 s of deadline left can hit it. So
  PQO4's "assets ≤185 s is not a bound" is what arms PQO1.
- In that row the card's sentence says the finished steps are kept, the step shows `done`, and the
  draft is `failed` in the same transaction. The comment in `runStep` ("the work is real and paid
  for … the Retry that follows a cancel would buy the same model call twice") is describing a
  protection the `end` transition does not give.

**The fix.** Split it:

- *Deadline row: safe to build.* Smallest change: after `run` returns, if the signal's reason is
  `DeadlineReached`, do not commit; leave through the existing "cancelled and `overran()`" branch
  to `pauseForDeadline`. The step re-runs in the next window, which is what `assets` needs (Opus's
  warning about the all-`network` manifest stands, and this honours it). It spends
  `REQUEUE_BUDGET`; `budget-spent` still ends `INTERRUPTED` as now.
- *Stop rows: needs the owner.* Aligning local with remote publishes an `assets` manifest whose
  unfetched images are stamped current; aligning remote with local reverses a behaviour `finishIn`
  calls deliberate.

### PQO2 — `job.title` has one writer: **confirmed. C. Tier 1.**

`runStep`: `if (step.name === "extract") job.title = product.detail`; `noteProgress` sets `steps`
only; `pauseForDeadline` has no title; `STEPS.metadata` returns `detail: meta.title`;
`MINIMAL_STEPS = ["fetch","metadata"]`. The minimal-paper case is the certain one. Fix is small and
reader-visible only as a title replacing a slug. **Safe to build.**

### PQO3 — `fsStoreSession` and two store methods only tests reach: **confirmed, deletion claim slightly overstated. C. Tier 1.**

Greps re-run: `fsStoreSession(` is called at `tests/store-session.test.ts:220` only (the other four
hits are the definition and comments); `store.finish(` / `store.releaseStep(` on the job store: 0
in `src`; `pgJobStore.(finish|releaseStep)(` in 9 test files. Overstated part:
`tests/store-session.test.ts` is also where several `checkProduct` edges live (a part inherited
from a prototype, an undeclared artefact, a step that declares nothing). Check each has a twin in
`tests/store-pg-session.test.ts` and port the ones that do not before deleting. **Safe to build**
with that step; part (b) waits on PQO5, as Opus says.

### PQO4 — fourteen stale comments: **confirmed on the ten rows I checked. C. Tier 1.**

Same finding as PQ4, wider. **Safe to build.** The two "≤" budgets are more than wording: see PQO1.

### PQO5 — "a terminal job holds no draft pointer" kept by hand: **confirmed. C. Tier 2.**

`grep -n "draftRevisionId: null\|draftRevisionId: sql\|set({ draftRevisionId" src/store/*.ts` →
`pg-jobs.ts` ×2, `pg-session.ts` ×1 (plus `pg-revisions.ts` § `fenceJob`'s `.set({ draftRevisionId })`).
All four probes above ended with `pointerHeld:false`, so the rule holds on the paths exercised. The
CHECK is a refusal today's writers can reach mid-transaction (Opus says so); it also has to be
checked against existing rows before it lands. **Needs a characterisation test first; not this
sweep's Tier 0.**

### PQO6 — two tests never seen red: **confirmed. R (green only).**

Re-run here: `tests/open-before-structure-queue.test.ts` 8 passed. Sol independently ran
`tests/ai-call-transport-retry.test.ts`: 260 passed.

## Agreements

| Sol | Opus | |
|---|---|---|
| PQ4 | PQO4 | Same class, overlapping rows (`store/jobs.ts` header, "exactly one step", "one step per HTTP request"). Sol alone: the fence comments omit the lease. Opus alone: ten more rows and the two budgets. Merge into one item. |
| state/transition table | writer table | Agree: the database refuses no transition; three CHECKs on shape. |

Nothing else was reached by both. The Tier 0s are disjoint: Sol found three failure exits, Opus one
success-path exit.

## Disagreements

- **What Stop does mid-step.** Sol's common rules give one account; Opus's PQO1 gives three. The
  probes settle it for Opus.
- **"A killed computation leaves no partially committed product" (Sol).** True of the published
  article. PQO1 shows a finished product committed into a draft failed in the same statement, which
  Sol's row does not cover.
- Opus read `advanceJobWith` in full and did not flag the `as Job` cast (PQ2); Opus did not read
  `jobEngine.ts`, Sol did. Sol read the Stop paths and did not find PQO1. Neither is a
  contradiction; each is a miss.

## Missed by both

- **P1, C: `note()` outside `runStep`'s `try`** (three call sites, above under PQ1). Same class and
  same wedge as PQ1.
- **P2, R: the `INTERRUPTED` sentence promises kept steps on a path that discards them** (PQO1's
  deadline probe). It goes away with the deadline-row fix.
- **P3, C: `STEP_BUDGET_MS.assets` (185 s) is below the step's real ceiling (about 360 s)**, so the
  walk's "enough deadline left" test admits a step that can outlive it. Either bound the step or
  raise the number; Opus lists it as a comment, it is a number.

## Build order

| # | Item | Tier | Files | Owner? |
|---|---|---|---|---|
| 1 | PQ1: capture the freshness read, fail inside the `try`; test in `step-failure-seam` | 0 | `src/jobs.ts` (`runStep`), `tests/step-failure-seam.test.ts` | no |
| 2 | PQO1 deadline row: a step that returns after `DeadlineReached` pauses instead of ending | 0 | `src/jobs.ts` (`runStep`, `transitionAfter`), `tests/jobs-walk.test.ts` or `step-failure-seam` | no |
| 3 | PQ2: nullable read in the `busy` branch | 0 | `src/jobs.ts` (`advanceJobWith`), `tests/second-job-queues.test.ts` | no |
| 4 | PQ3: one surviving-Labels-job helper, both callers | 0 (P2) | `src/store/pg-jobs.ts`, `src/store/pg-session.ts`, `tests/publication-enqueues-the-labels-successor.test.ts` | no |
| 5 | PQO2: title from whichever step made `meta`, carried by `noteProgress` | 1 | `src/jobs.ts`, `src/store/pg-jobs.ts`, `src/store/jobs.ts` | no |
| 6 | PQ4 + PQO4: the comments, and the two budgets | 1 | `src/jobs.ts`, `src/store/jobs.ts`, `src/store/pg-jobs.ts`, `src/pipeline.ts`, maybe `tests/jobs-lease-budget.test.ts` | no |
| 7 | PQO3 (a): delete `fsStoreSession` and the unconverted-step scaffolding, porting orphaned `checkProduct` cases | 1 | `src/store/session.ts`, `src/pipeline.ts`, `src/store/pg-session.ts`, `tests/store-session.test.ts`, `tests/store-pg-session.test.ts` | no |
| 8 | PQO1 Stop rows | 0 | `src/jobs.ts`, `src/store/pg-jobs.ts` | **yes** |
| 9 | PQO5 CHECK; PQO3 (b) | 2 | `src/db/schema.ts`, a migration, `src/store/pg-jobs.ts` | hold |

**Overlaps.** Items 1, 2, 3, 5, 6 and 8 all edit `src/jobs.ts`; 1 and 2 edit the same function. Run
1, 2, 3 and 5 as **one worktree, in that order**, then 6 in the same tree last so it does not
conflict with them. Item 4 (`pg-jobs.ts` § `settleExpired`, `pg-session.ts`) is disjoint from that
cluster except for item 5's `noteProgress` line in `pg-jobs.ts` and item 6's comments there: a
second worktree, merged before 6. Item 7 is disjoint from all but 6's `pipeline.ts` comment: a
third.
