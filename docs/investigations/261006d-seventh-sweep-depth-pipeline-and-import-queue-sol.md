# Seventh sweep, depth: pipeline and import queue (GPT Sol, read-only, 2026-10-06)

## What I read

Read at `bf78e90c7f718fb042d51f9aa394c72c335514a5`. No files changed, network requests made, or database connections opened.

**Read in full:** `src/store/pg-jobs.ts`, `src/store/jobs.ts`, `src/store/pg-session.ts`, `src/store/pg-successor.ts`, `src/store/job-fence.ts`, `src/sharing-steps.ts`, `src/structure-slices.ts`, `src/messages-stream.ts`, `src/transport-retry.ts`, `src/another-window.ts`, and `src/web/useJobs.ts`.

**Read in part, concentrating on execution and failure boundaries:**

- `src/pipeline.ts`: the step definitions, freshness checks, product contracts, and source-acquisition helpers; not every import or historical comment.
- `src/jobs.ts`: the step runner, claim/session opening, claim walk, deadline handling, enqueue/deduplication, cancellation, retry, and retention callers. Some supporting commentary and helpers received a lighter read.
- `src/store/pg-revisions.ts`: publication, failed-draft settlement, Labels failure marking, and abandoned-draft sweeping.
- `src/structure.ts`: the generation path, whole-document checkpoint handling, and the switch to sliced structure.
- `src/structure-deepen.ts`: expansion-wave execution, retries, checkpoints, cancellation, refusal handling, and accounting.
- `src/simple-summary.ts`: generation, staggered admission, validation retries, sibling cancellation, draining, and usage accounting.
- `src/ai-call.ts`: transport admission/retry, stream finalisation, failure metering, and the JSON, image, transcription, and decision entry points.
- `src/source-hash.ts`, `src/step-order.ts`, `src/ai-spend.ts`, and the jobs constraints in `src/db/schema.ts`.
- `src/web/AddPage.tsx`, `src/web/jobEngine.ts`, and the job routes in `src/routes.ts`: the queue contract, terminal evidence, disappearance, and advance responses.
- `src/fetch.ts`: stored-source reads, size bounds, integrity checks, and relevant pipeline callers.

**Skipped as depth reads:** the remaining fetch implementation, extraction internals, most of `src/messages.ts` and `src/models.ts`, and asset-collection internals. I inspected their pipeline boundaries but do not claim a file-by-file audit of those implementations.

Read the required sweep method, the specified fifth- and sixth-sweep sections, the fifth pipeline investigation and its Opus review, `vision.md`, the requested architecture sections, and the relevant ingest-queue sections. Also read the high-powered-AI freshness policy and relevant postmortems covering transport retry, retry cancellation, raw-source bounds, publication-year preservation, sliced structure, producer/successor completion, stream-error precedence, and provisional job snapshots.

The selection favoured the coordinator and transactional store. This command counted path appearances in matching commit histories, including merges—not independent defects:

```sh
git log --since=2026-09-20 --format= --name-only -i --grep=fix -- \
  src/pipeline.ts src/jobs.ts src/store/pg-jobs.ts \
  src/structure.ts src/structure-deepen.ts src/structure-slices.ts |
  sort | uniq -c | sort -rn
```

It returned: pipeline **33**, jobs **9**, structure **8**, pg-jobs **7**, slices **4**, deepen **1**.

## What the method could not see

There was no Postgres, provider, object storage, or browser execution. Therefore the investigation cannot establish production frequency, actual billing, transaction-lock behaviour under contention, or the visible timing of early publication.

Two in-memory coordinator probes reproduced faulty outputs without touching persistence. Their durable consequences are supported by the code, not by database reproduction.

These permitted unit suites passed:

| Command | Result |
|---|---:|
| `npx vitest run tests/structure-slices-second-pass.test.ts` | 50 passed |
| `npx vitest run tests/structure-slices-adversarial.test.ts` | 20 passed |
| `npx vitest run tests/ai-call-transport-retry.test.ts` | 260 passed |

No test run was red. These results support the inspected slice and retry behaviour; they do not validate the proposed fixes or the database races below.

## Findings

Ranked by ease × value, with Tier 0 first. The reproduction state and the proposed fix are separate claims.

### PQ1 — A freshness-read failure abandons a live claim

**Location:** `src/jobs.ts`, `runStep`, the `await stepIsDone(...)` condition; `walkClaim`, its outer catch and `standDown`. Also `src/pipeline.ts`, `stepIsDone`.

**Evidence:** **R** for the coordinator escape; **C** for the durable claim remaining running.  
**Tier:** 0. **Ease:** 4/5. **Value:** 4/5. **Score:** 16.  
**Risk:** Medium: preserve skip behaviour and the distinction between an ordinary failure, a lost claim, and a lost draft.

**Failing input:** An ordinary unforced job claims successfully and opens its session. Its power read succeeds. A freshness read then fails transiently—for example, `session.reads.interrupted` rejects once while subsequent database operations would succeed.

`stepIsDone` awaits store reads outside `runStep`’s failure handler. The exception reaches `walkClaim`, whose outer catch handles `StaleAttemptError` and `DraftGoneError`, but rethrows this ordinary read failure. Its `finally` clears the deadline timer and local abort entry. No settlement or release occurs.

The claimant has stopped, but the persisted job remains running until lease expiry and a later sweep. It can hold its article’s line and consume a global running slot for the remainder of the 760-second lease.

The in-memory probe replaced `pgJobStore.claim` with a successful claim, supplied a session whose freshness read threw, and counted step admission, settlement, and execution:

```json
{
  "thrown": "transient freshness read",
  "began": 0,
  "settled": 0,
  "ran": 0,
  "jobStatus": "running",
  "stepStatus": "pending"
}
```

**Sibling evidence:** `readStepPower` failures and the new stand-in-tree read are captured before preflight and rethrown inside the existing step failure handler. The freshness read has no equivalent protection. Commit `5618365c1` also brought session-opening failure into the existing storage-failure recovery rather than abandoning the claim; this remaining exit has the same underlying failure class.

**Fix claim:** Capture freshness failure and route it through the existing failure handling, following the power/structure-read pattern. Preserve actual skips and propagate lost-claim/lost-draft errors normally. Do not turn a failed read into “not current” and start paid work.

This reuses `runStep`’s failure reporting and the session’s fenced settlement. A new retry framework or state machine would duplicate mechanisms already present.

**Orchestrator validation:** Add a transient freshness-read failure case to `tests/step-failure-seam.test.ts`, allowing subsequent settlement writes to succeed. Assert no paid step ran, the job ended with the normal retryable failure, and its draft pointer was cleared. Then run:

```sh
npx vitest run tests/step-failure-seam.test.ts
```

### PQ2 — Queue-lock contention can produce a successful advance response without a job

**Location:** `src/store/pg-jobs.ts`, `claim`, the `lockUnavailable` branch; `src/jobs.ts`, `advanceJobWith`, `case "busy"`; `src/web/jobEngine.ts`, `terminalOf`.

**Evidence:** **R** for the malformed coordinator result; **C** for the contention path and client failure.  
**Tier:** 0. **Ease:** 5/5. **Value:** 2/5. **Score:** 10.  
**Risk:** Low.

**Failing input:** The queue singleton is locked by another claim. An advance request names a missing job, a job belonging to another owner, or a job that disappeared before the follow-up read.

The `NOWAIT` failure returns `busy` before classifying the requested job. The coordinator then does:

```ts
job: (await store.get(id, owner)) as Job
```

The assertion hides `undefined`. The route sees a non-null `Advanced` and sends HTTP 200. JSON omits the missing `job` property. The browser’s `terminalOf(advanced.job)` reads `.status` and throws.

The in-memory probe forced `claim → busy` and `get → undefined`:

```json
{
  "returnedNull": false,
  "wire": "{\"ran\":null,\"busy\":true,\"done\":false}",
  "jobIsUndefined": true
}
```

**Sibling evidence:** `refusalFor` classifies the requested job before returning machine-level refusals at the concurrency cap and the article queue. Its comment describes this exact missing-job/HTTP-200 defect. That shared classifier arrived in `540927feb`; the older `NOWAIT` branch from `32d192cd26` still bypasses it.

**Smallest fix claim:** Remove the assertion. Read the owner-scoped job in the coordinator’s busy branch and return `null` when it is absent. This also closes disappearance between classification and the follow-up read. Reuse the nullable-read pattern already used by `lostTheClaim`; no new helper is necessary.

Do not add a query inside the transaction after the failed `NOWAIT` statement: that transaction has already encountered a PostgreSQL error.

**Orchestrator reproduction:** In an isolated test database, first verify the chosen id is absent:

```sql
SELECT id FROM spideryarn.jobs WHERE id = 'spya-000000';
```

Hold this transaction open in one connection:

```sql
BEGIN;
SELECT 1
FROM spideryarn.queue_state
WHERE id = 1
FOR UPDATE;
```

While it is held, make an authenticated `POST /api/jobs/spya-000000/advance`. Current code should return 200 without `job`; the corrected behaviour is 404. Finally:

```sql
ROLLBACK;
```

Add the contention case to the queue tests and run:

```sh
npx vitest run tests/second-job-queues.test.ts
```

### PQ3 — A live Labels failure ignores another job still carrying the work

**Location:** `src/store/pg-session.ts`, `settleIn`, `navLabelsFailed`; `src/store/pg-jobs.ts`, `settleExpired`, `stillCarryingLabels`; `src/store/pg-revisions.ts`, `markNavLabelsFailedIn`.

**Evidence:** **C**. Not reproduced against Postgres.  
**Tier:** 0; a shared-rule extraction would be Tier 2.  
**Ease:** 3/5. **Value:** 2/5. **Score:** 6.  
**Risk:** Medium: transaction ordering, owner scope, and exclusion of the settling job matter.

**Failing input:**

1. Published revision P has pending paragraph labels.
2. Labels job A is running against P.
3. A distinct Labels job B is queued on the same article—for example, a forced run with a different work key.
4. A begins Labels and fails normally.

The live session marks P’s labels failed. `markNavLabelsFailedIn` checks that the base remains current and pending, but does not check whether another active job still carries Labels.

The expiry path explicitly checks that condition. It leaves P pending while B remains queued or running and is not cancelling. Thus normal failure and lease-expiry failure give different durable answers to the same ownership question.

**Impact limit:** The current UI withholds paragraph labels for both `pending` and `failed`; the old “still arriving” sentence was removed. This is a durable-state defect, not a reproduced visible error message. Its value is lower than PQ1’s.

**Sibling evidence:** Commit `d0c00b26ba` added the expiry path’s surviving-job check. Its explanation names ownership rather than mere membership as the missing fact. The live settlement caller did not receive that protection.

**Smallest fix claim:** Apply the existing surviving-Labels-job check before the live path marks the base failed. Preserve its current `unfinished === "labels"` and error-only conditions.

**Extraction claim:** After characterising both paths, put the surviving-job decision in one transaction-local helper. It must exclude the settling job explicitly, retain owner scope, and preserve article-before-job lock ordering. The existing expiry rule is the mechanism to reuse; introducing a second Labels failure policy would reproduce the drift.

Do not mechanically unify `unfinished` with step-list membership. Those criteria have different written explanations; the demonstrated defect is the missing surviving-job check.

**Orchestrator validation:** Extend the existing live failure case in `tests/publication-enqueues-the-labels-successor.test.ts` to keep a distinct Labels job queued. Assert the base stays pending and the queued job survives. Keep the existing lease-expiry counterpart, which already checks surviving ownership. Run:

```sh
npx vitest run tests/publication-enqueues-the-labels-successor.test.ts
```

### PQ4 — Queue-contract comments describe the deleted filesystem design

**Location:**

- `src/store/jobs.ts`, “contract with two adapters” and “What an expired lease means”.
- `src/store/jobs.ts`, `releaseStep` and `noteProgress`, the three-condition fence descriptions.
- `src/jobs.ts`, the advancing section and `advanceJobWith`’s “Run exactly one” description.

**Evidence:** **C**.  
**Tier:** 1. **Ease:** 5/5. **Value:** 2/5. **Score:** 10.  
**Risk:** Low; wording only.

The contract says expiry does not permit takeover because artifacts are still files and transactional writes have not arrived. Actual expiry can requeue the same job with its draft retained, and writes go through the transactional Postgres session.

The fence comments omit lease validity. The shared predicate includes it. The advancing comments describe one step per request while `walkClaim` walks runnable steps on one claim.

These are present-tense instructions beside the interfaces a future queue change would use, not merely historical accounts.

**Fix claim:** Correct or delete these obsolete instructions. Keep dated history where it explains a surviving decision. Point to `liveAttempt`, the session, and `settleExpired` rather than copying their algorithms into another comment.

This needs no abstraction, registry, or new document. The implementation already owns the facts.

## Siblings compared

### Pipeline steps

The runtime enumeration below counted **23 steps**:

```sh
node --import tsx --input-type=module - <<'JS'
import { STEP_ORDER } from './src/step-order.ts';
console.log(STEP_ORDER.length);
console.log(STEP_ORDER);
JS
```

The following common rules apply to each row:

- **Ownership:** Production uses one Postgres session per successful claim, bound to the job’s draft and attempt. A requeued claim may retain its existing draft.
- **Crash:** `beginStep` records an unfinished run. Products, completion receipt, and the requested job transition commit together. A killed computation leaves no partially committed product; already committed earlier steps and article-scoped checkpoints have their separate lifetimes.
- **Fence/retry:** Durable writes use the shared live-attempt predicate. Transport retries belong to the gateway; step-specific answer retries and checkpoints remain local. Deadline hand-back and lease-expiry requeue share the bounded requeue budget.
- **Failure:** Ordinary execution failures pass through `runStep`, reader-safe failure wording, and session settlement. PQ1 identifies an exception before that handler. PQ3 identifies Labels’ extra published-base mutation.
- **Cost:** `collectSpend` supplies job/owner/article/step attribution around execution. Gateway attempts supply call records. Freshness failure in PQ1 occurs before paid execution.
- **Cancellation:** The step receives the claim signal. Local Stop aborts it; remote Stop is observed at claim boundaries and commit checks. A stale attempt cannot commit a result. Actual provider-side stopping was not tested.

The table gives the freshness input and meaningful variations from those common rules. Presence and an acceptable run receipt precede the additional freshness decision.

| Step | Freshness decider and hash input | Relevant variation |
|---|---|---|
| `fetch` | Raw manifest presence; no input hash | Source bytes are stored outside the revision transaction; the returned manifest commits through the session. |
| `metadata` | Metadata presence; no input hash | Minimal-paper path; source bytes are verified before reading front matter. |
| `extract` | Declared extraction products present; no input hash | PDF work can resume from article-scoped checkpoints. |
| `blocks` | `blocksMatchTheirHtml`: extraction HTML, stamped HTML, and block data | Reads the prior identity baseline; returns blocks, stamped HTML, and reading difficulty together. |
| `structure` | Presence plus `structureIsNotAStandIn`; no general stamp comparison | Whole-document/slice checkpoints survive hand-back. Early-open stand-ins have explicit replacement rules. |
| `labels` | Block hash, Labels prompt version, model generation | Tree recuts invalidate its receipt. Writes tree and manifest together; terminal failure may update the published base. |
| `assets` | `assetsInputHash`: image URLs and PDF figure references; assets version | May run against a stand-in tree. Binary storage is outside revision commit. |
| `arc` | `arcFingerprint(blocks, tree, meta)`, prompt version, model generation | Ordinary article-product settlement. |
| `tweets` | `tweetsFingerprint(blocks, tree, meta)`, including the cited head’s URL | Ordinary article-product settlement. |
| `glossary` | `articleInputHash`: blocks, tree, three-field metadata head | Reads the previous glossary to preserve identities and support additional terms. Profile changes do not force rewriting. |
| `quotes` | `quotesFingerprint(blocks, tree, meta)` | Reads the previous selection for “find more” and identity preservation. Profile excluded from freshness. |
| `ideas` | `ideasFingerprint(blocks, tree, meta)` plus profile hash | Previous artifact supplies identity continuity. |
| `timeline` | Dated article fingerprint: blocks, tree, cited head, publication date | Profile excluded from freshness. |
| `quiz` | `quizFingerprint`: blocks, tree, cited head | Profile changes deliberately require an explicit rewrite. |
| `faq` | `faqFingerprint`: blocks, tree, cited head | No previous-artifact identity baseline needed. |
| `relations` | Rendered article input plus ordered eligible paragraph pairs | Can produce a valid no-call result when insufficient paragraphs exist. |
| `simple` | `simpleFingerprint` over article input | Unforced runs compare using the stored prompt/model provenance. Parallel levels abort and drain on failure; previews are not committed products. |
| `sketch` | `sketchFingerprint(blocks, tree, meta)` plus profile hash | Ordinary article-product settlement. |
| `illustrated` | Sketch, stored figure fingerprint, illustration note; Sketch’s profile hash | Run admission refuses an unusable, stale, or wrong-profile Sketch. Brief writing and image generation are separate paid calls. |
| `skim` | Offered quotes, their article/outline/Idea associations, plus profile hash | Prerequisite artifacts are inputs; article prose is not sent by this step. |
| `debate` | `debateFingerprint`: blocks, tree, cited head/URL | Chat-wire model override is reflected in its stamp; search and synthesis have different work. |
| `citations` | `citationsFingerprint`: blocks, tree, cited head, including non-body material | Reads the prior citation baseline; PDF reference extraction and registry enrichment are additional execution inputs/work. |
| `crossrefs` | Exact body-only article rendering and top-level skeleton | Profile excluded from freshness. |

The differing profile rules, Simple’s preserved provenance, Illustrated’s inherited profile, and Structure’s stand-in check have written reasons. I do not propose normalising them.

### Job states and transition writers

The states are `queued`, `running`, `done`, `error`, and `cancelled`. `cancelling` is a flag on a running job, not another status.

| Transition | Writers | Enforcement |
|---|---|---|
| New row → queued | `enqueueOrGet`/enqueue helpers; `enqueueSuccessorIn`; retry creates another row | Database uniqueness arbitrates duplicate work and name/source reservations. |
| Queued → running | `claim` / `claimIn` | Conditional update plus queue-singleton lock. Cap, predecessor, and overlap policies are implemented in code under that lock. |
| Running → running | `noteProgress`; kept step commits; `requestCancel` sets the flag | Fenced progress/product writes. Progress does not renew the lease. |
| Running → queued | `releaseStepIn`; `pauseForDeadline`; eligible `settleExpired` rows | Conditional/fenced writes; draft retained. Pause and expiry consume the shared requeue allowance. |
| Running → done | Session settlement via `finishIn`, after publication | Publication lineage and live-attempt checks occur transactionally. |
| Running → error | Session settlement; storage-failure recovery; terminal `settleExpired` | Draft disposition and pointer clearing belong to settlement. PQ1 escapes these paths. |
| Running → cancelled | Cancel-aware release/settlement; `settleExpired`; cancellation of a lapsed claim | A live claimant is flagged first; cancellation of an abandoned claim can settle directly. |
| Queued → cancelled | `requestCancel` | Conditional settlement; no claimant needs to observe a flag. |
| Terminal → deleted | `forget`; `trimFinished` | Terminal-status predicates. |
| Terminal → new queued row | `retryJob` through enqueue | The old attempt remains terminal; retry eligibility is checked by the application. |

The database checks allowed statuses, requires a running row to carry its attempt and lease, and constrains cancelling/draft ownership. It does **not** encode the entire transition history. The named writers and their predicates enforce that history. Likewise, the database serialises cap/overlap decisions through locking; it does not independently encode those policies as a complete constraint.

There is no heartbeat. The claimant’s deadline is anchored before claiming and fires inside its fixed lease. Session writes also reject an expired or replaced attempt. I did not reproduce two-worker publication, and the inspected fence/lineage paths do not establish a defect there.

A stored running row can remain untouched without later traffic on the serverless deployment. That is the documented absence of an autonomous scheduler. PQ1 is narrower: a live request encounters a recoverable read failure, exits, and leaves an otherwise settleable claim behind.

### Failure-path siblings

| Decision | Protected sibling | Drifting sibling |
|---|---|---|
| Preflight read failure | Power and stand-in-tree reads rethrow inside the failure handler | Freshness read escapes it — PQ1 |
| Machine busy versus requested-job state | Cap/article-line refusals call `refusalFor` | `NOWAIT` refusal bypasses classification; coordinator assumes presence — PQ2 |
| Who still carries pending Labels | Expiry checks another active, non-cancelling Labels job | Live failure marks the base without that check — PQ3 |
| Claim lifetime and lease fence | `walkClaim`, `liveAttempt`, transactional session | Public contract comments retain the filesystem/one-step account — PQ4 |

## For the owner

No new product decision is needed for PQ1 or PQ2. They restore existing settlement and missing-job contracts.

PQ3 should preserve the existing expiry ownership rule. Its current visible impact is limited because both pending and failed labels are withheld. Changing that presentation would be a separate product decision; this investigation does not propose it.

I do not propose moving more work out of the early-open path, changing profile-driven regeneration, adding an autonomous worker, or changing the accepted behaviour when a successor is bound to an older publication. Those have latency, cost, or recovery trade-offs that this sandbox did not measure.

## Considered and not proposed

- **A global step/mode registry or file splitting:** no demonstrated defect requires either. They remain rejected by the earlier sweeps.
- **Consolidating pipeline and metadata freshness calculations:** the fifth sweep held this pending actual drift. I found no new mismatching result sufficient to reopen it.
- **Adding a Structure freshness stamp:** the architecture deliberately relies on consumer invalidation. A missing stamp alone is not new evidence.
- **Replacing the sliced-structure mechanism:** read its checkpoint, second-pass, central-band, hand-back, and counting paths. The targeted second-pass and adversarial suites passed. No additional live defect established.
- **Another transport retry mechanism:** the shared transport retry now checks cancellation after waits. The transport suite passed, including the recent in-band-error/finalisation regressions.
- **Pre-aborted gateway phantom records:** the image test already characterises the aborted zero-cost row and explains why the live Illustrated caller guards admission. I did not establish a newly reachable harmful caller. This is not a fresh finding.
- **Removing unused cache-group machinery:** the fifth investigation already corrected the false sharing comments and held deletion pending evidence. No new measured benefit here.
- **Arbitrary partial block-loss thresholds:** the inspected stage refuses total identity loss; choosing an additional threshold without evidence would invent policy.
- **Unifying Labels’ `unfinished` and membership criteria:** their comments state different reasons. PQ3 proves missing surviving ownership, not that every eligibility distinction should disappear.

## One level up

The zone’s overall approach remains suitable: paid computation happens outside transactions, artifacts and receipts commit through a claim-bound session, recoverable work has article-scoped checkpoints, and the fixed lease limits stale ownership. Early publication and sliced structure fit those mechanisms without requiring a second queue. The defects found here cluster at failure exits: one read bypasses settlement, one refusal bypasses nullable classification, and one published-state mutation bypasses a sibling ownership check. Closing those exits with the mechanisms already present is better supported than replacing the architecture.