# Cross-family review: pipeline and import queue

Read-only review of the Opus investigation, compared with Sol. No tracked files changed.

**Survives:** PQO1’s deadline defect, PQO2’s title defects, PQO3’s deletion opportunity, PQO4’s stale comments, and PQO5’s invariant-hardening opportunity. PQO5’s proposed patch is incomplete. PQO6 understates existing test evidence.

Coordinator probes used the real `advanceJobWith`, with in-memory replacements for job-store persistence and sessions. Their **R** evidence covers coordinator behaviour; PostgreSQL settlement remains **C**. No database or browser test was run.

## PQO1 — Completed products after abort

**Confirmed, with qualifications. Tier 0; P1; R for coordinator decisions, C for draft disposition.**

The traced path is:

`runStep` → mark step done → `transitionAfter` → `session.commit` → `settleIn`.

An aborted local controller selects an error or cancellation before checking whether work remains. PostgreSQL `commit` writes the product and completion receipt; `settleIn` then calls `failRevisionIn` for that ending. Conversely, a remote Stop leaves the controller untouched, and the final-step `done` ending reaches publication. `finishIn` clears the cancellation flag without overriding that ending.

A signal-ignoring step reproduced:

```text
deadline:    status=error,     commits=["error"],     pauses=0
local Stop:  status=cancelled, commits=["cancelled"], pauses=0
remote Stop: status=done,      commits=["done"],      pauses=0
```

The Assets reachability claim is supported. `collectAssets` catches per-image failures, while `collectPdfFigures` races cancellation and returns a finalised result. A probe invoking real `collectAssets`, with an injected fetch that aborted and rejected, returned:

```text
entries=[{"status":"failed","reason":"network",...}]
```

Two corrections:

- Assets is last in `DEFAULT_INGEST_STEPS`, **not every import**: minimal imports end with Metadata.
- `recoverPdfFigures` does not immediately return on cancellation; it reads the manifest and source bytes before entering the cancellation-aware collector.

**Fix claim:** Reuse the existing deadline hand-back path, but discard the aborted step’s returned product. Throwing the deadline reason from the deadline branch of `transitionAfter`, inside `runStep`’s existing catcher, is smaller than adding another transition mechanism. An ordinary deadline reaches this deliberately; the existing pause path must retain its Stop, stale-claim and exhausted-budget handling.

**Safe without owner:** Deadline recovery, after a regression test. **Owner required:** Choosing the last-step Stop outcome. Keeping an aborted Assets result could publish an incomplete manifest as current.

## PQO2 — Lost job titles

**Confirmed; headline overstated. Tier 0, rather than Tier 1; P1; R/C.**

`runStep` assigns `job.title` only for Extract. Release and finish persist it; `noteProgress` writes only steps. Pause and expiry requeue preserve the existing row title but cannot recover an in-memory title never written there.

The claimed “three of four” is unsupported: of release, finish, pause and expiry, **two** omit the claimant’s newly acquired title.

Two coordinator probes reproduced the defects:

```text
after Extract, then pause: status=queued, title=null, extractDetail="Lost title"
after resume completes:   status=done,   title=null, extractDetail="Lost title"
Metadata completes:       status=done,   title=null, detail="Paper title"
```

The minimal path is real: `MINIMAL_STEPS` is `["fetch","metadata"]`; Metadata returns `parts.meta` and `detail: meta.title`. `JobCard` renders `job.title ?? job.slug`.

**Fix claim:** Persist a defined title through the existing progress write and lift Metadata’s title too. Prefer the actual returned metadata title over treating arbitrary `detail` text as a title. No new mechanism or refusal is needed. Preserve existing titles when no title is supplied.

**Safe without owner:** Yes.

## PQO3 — Filesystem session and terminal fixture methods

**Confirmed as dead production machinery. Tier 1; P3; C.**

Recount:

```sh
rg -n 'fsStoreSession\(' src tests scripts evals
# 5 textual matches: definition, 3 comments, 1 executable caller

rg -l 'pgJobStore\.(finish|releaseStep)\(' tests | wc -l
# 9

rg -n '\b(store|pgJobStore)\.(finish|releaseStep)\(' src scripts evals
# no matches
```

The sole executable caller is `tests/store-session.test.ts:220`; the file has **626 lines**. Production opens `pgStoreSession` through `claimSession`.

The public `finish` and `releaseStep` wrappers call their primitives through `settlingIfTerminal`. That wrapper settles quota reservations but does not dispose of draft revisions. The session supplies that missing disposition in production.

**Fix claim:** Delete `fsStoreSession`, `JobSettles`, the empty exemption machinery and associated branches. Replace the conditional return type with existing `ConvertedProduct`; make missing parts an unconditional runtime refusal. This preserves today’s production rule, because production already supplies an empty exemption set.

Deleting the **entire test file** needs more care: its prototype-inherited-part, undeclared-part and empty-declaration cases exercise live `checkProduct` guards. Preserve those as direct guard tests rather than deleting useful coverage with the obsolete adapter.

Leave the public terminal methods for a separately scoped fixture migration. Sending every existing fixture through publication is not automatically a small replacement.

**Safe without owner:** Yes, for the bounded deletion with guard coverage retained.

## PQO4 — Stale comments and budget claims

**Confirmed, with scope corrections. Tier 1; P3; C.**

The table identifies **14 comment groups across four files**, not fourteen individual comments confined to queue files.

The implementation contradicts the listed claims:

- `walkClaim` walks several steps per claim.
- `claimSession` uses Postgres unconditionally.
- `settleExpired` can requeue while retaining the draft.
- `claim` locks queue state and enforces the configured concurrency; the default is six.
- Assets passes `openRouterFigureLocator` through `recoverPdfFigures` to the located-figure model call.

Recount:

```sh
rg -n 'jobs-fs|sweepStopped' src/store/pg-jobs.ts | wc -l
# 5
```

Both budget objections survive:

- `fetchByAddress` can fetch an initial address, resolve its redirect as a paper source, then try source candidates. Each uncached candidate gets `fetchDocument`’s retry budget.
- Assets runs `collectAssets` and PDF recovery sequentially. Their collectors have separate 180-second budgets; source-byte reading also precedes the PDF collector’s timer.

The assertion that “nothing breaks” because the walk hands back before Structure is too broad. Those estimates also decide whether Assets starts after Structure.

**Fix claim:** Delete or correct obsolete wording, and stop presenting incomplete estimates as whole-step bounds. Changing admission budgets is a separate behavioural change.

**Safe without owner:** Comment corrections, yes.

## PQO5 — Terminal jobs retaining draft pointers

**Invariant claim confirmed; proposed fix understated. Tier 2; P2 hardening; C.**

`abandonedDraftCondition` excludes revisions referenced by **any** job, including terminal jobs. Normal session completion clears the pointer through publication/failure, except release-to-cancellation, which clears it afterward through `discardAfterCancel`.

Recount:

```sh
rg -n 'draftRevisionId: null|draftRevisionId: sql|set\(\{ draftRevisionId' src/store/*.ts
# 4 matching writer sites
```

These are writer sites, not four exclusively clearing statements: `fenceJob` also sets a non-null pointer when opening a draft.

The Jobs schema has **five CHECKs**, not three:

```text
jobs_status
jobs_id_format
jobs_running_is_fenced
jobs_upload_both_or_neither
jobs_cancelling_is_running
```

The database does not enforce transition history. “Refuses no transition” is nevertheless too absolute: it refuses moves producing invalid state shapes.

**Fix claim:** The proposed CHECK duplicates no existing terminal-pointer constraint, but it cannot land with just the stated primitive change:

1. Today’s ordinary remote Stop can make `releaseStepIn` write `cancelled` while retaining a pointer, immediately violating the CHECK.
2. Clearing the pointer there makes `discardAfterCancel`’s subsequent `WHERE draft_revision_id = ref.revisionId` match nothing; its row-count guard then rolls the transaction back.
3. Public fixture terminal methods can also violate the CHECK when used with a draft.
4. Existing database rows were not surveyed.

Revise both cancellation statements together, preserve their ownership proof, characterise the path, and audit existing rows before adding the constraint.

**Safe without owner:** Building a corrected implementation and tests, yes. Migration readiness is unestablished; risky existing-data remediation requires the owner.

## PQO6 — Tests allegedly never seen red

**Overstated. R for transport red/green; database regression execution unverified here. Tier 1 verification/documentation work; P3.**

The transport plan’s Gates section already records the reviewer’s six new cancellation cases going red when retry-entry checks were removed. The postmortem’s “execution pending” wording is stale.

Current-tree run:

```sh
npx vitest run tests/ai-call-transport-retry.test.ts tests/store-session.test.ts
```

```text
Test Files  2 passed (2)
Tests       278 passed (278)
```

I independently tested the six cancellation cases in a scratch copy under `/tmp`, selecting:

```text
opens no attempt when the signal aborts as the backoff finishes
opens no retry if the activity callback aborts after the wait
```

Removing these two guards from the scratch `ai-call.ts`:

```ts
if (n > 1) options?.signal?.throwIfAborted();
if (attempt > 1) options.signal.throwIfAborted();
```

produced:

```text
original:  6 passed, 0 failed, 254 skipped
mutated:   0 passed, 6 failed, 254 skipped; exit 1
restored:  6 passed, 0 failed, 254 skipped
```

The whole Open-before-Structure test file also records earlier mutation failures. That does **not** prove its later constrained-resume regression has been seen red. I did not independently revalidate the claimed database **8/8** result.

The Messages loop does contain the post-wait cancellation check; the existing during-backoff test does not exercise that continuation boundary.

**Fix claim:** Update the stale evidence record, retain the distinction between earlier file-level evidence and the new resume case, and add the missing Messages boundary case. No replacement retry framework is justified.

**Safe without owner:** Yes.

## Agreements

| Opus | Sol | Independent agreement |
|---|---|---|
| PQO4 | PQ4 | Queue contracts retain the filesystem, one-step and obsolete expiry descriptions. |

PQO5 and Sol PQ1 both mention draft disposal, but identify different problems; they are not an independent finding match.

Sol’s additional findings survive tracing:

- **PQ1:** Freshness reads precede `runStep`’s catcher; ordinary failure escapes `walkClaim`, whose `finally` removes the timer. My probe returned `began=0, settled=0, ran=0, jobStatus="running"` (**R** coordinator, **C** persistence).
- **PQ2:** `NOWAIT` contention returns busy before job classification; the coordinator casts an absent owner-scoped read to `Job`. My probe serialised `{"ran":null,"busy":true,"done":false}`. The route sends 200, then `terminalOf(advanced.job)` dereferences `.status` (**R/C**).
- **PQ3:** Live Labels failure calls `markNavLabelsFailedIn` without checking another active Labels carrier; expiry explicitly checks that carrier first (**C**, P2).

## Disagreements

There is no direct code-level contradiction between the two finding lists. Their omissions are different coverage, not opposing verdicts.

The apparent disagreement over Simple freshness is also not a contradiction: Sol declines normalisation; Opus asks whether its existing exception should become policy. The code proves differing policies, not an inconsistency requiring a fix. Leave that product question out of this build.

## Missed by both

No additional live defect established. The important extra discovery is in the **fix**, not current behaviour: PQO5’s proposed pointer clearing would break `discardAfterCancel`.

## Build order and file overlaps

Tier 0 first; then ease × value:

| Order | Work | Main file set / overlap |
|---|---|---|
| 1 | Sol PQ1: freshness failure settlement | `jobs.ts`, failure-seam tests |
| 2 | PQO1: deadline-success hand-back | `jobs.ts`, claim/session tests; overlaps 1 |
| 3 | Sol PQ2: absent job after busy | `jobs.ts`, queue tests; overlaps 1–2 |
| 4 | PQO2: persist and lift titles | `jobs.ts`, `store/jobs.ts`, `pg-jobs.ts`; overlaps 1–3 |
| 5 | Sol PQ3: surviving Labels ownership | `pg-session.ts`, `pg-jobs.ts`, successor tests; overlaps 4 |
| 6 | PQO4: stale comments | Above queue files plus `pipeline.ts`; fold into their owning changes |
| 7 | PQO3: obsolete session deletion | `pipeline.ts`, `store/session.ts`, `pg-session.ts`, guard tests; overlaps 5–6 |
| 8 | PQO5: terminal-pointer constraint | `pg-jobs.ts`, `pg-session.ts`, schema/migration, fixture tests; overlaps 4–7 |

Items 1–5 belong in one staged queue worktree because their file sets overlap. Keep PQO3 and PQO5 as subsequent stages. PQO6’s evidence corrections and Messages test can use a separate, non-overlapping worktree. Hold the last-step Stop policy for the owner.