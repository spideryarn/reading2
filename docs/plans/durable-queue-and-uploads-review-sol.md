Verdict: **NO-SHIP. The plan is wrong in shape, not merely incomplete.** A durable job row cannot make the current filesystem pipeline durable, and the proposed fence does not protect all durable writes.

## Findings

### 1. Critical — the queue will still fail across Vercel invocations

The plan calls the queue “the last piece,” but every pipeline stage still reads and writes local files. The existing artefact seam is filesystem-only; its Postgres adapter does not exist.

Evidence:

- The queue hardcodes `fsArtifacts` and says the Postgres swap is separate: `src/jobs.ts:22`
- The Postgres artefact adapter is explicitly unwritten: `src/store/artifacts.ts:24`
- Upload acquisition writes `raw.pdf` and `raw.json` directly: `src/pipeline.ts:739`
- The existing revision wrapper admits stages still write the filesystem and a fresh Postgres draft remains empty: `src/store/revisions.ts:24`
- The superseded migration plan correctly required the shared transactional stage runner before the advance endpoint: `postgres-storage-implementation.md:118`

Reproduction: invocation A advances `fetch`, writing ephemeral `raw.json`. Invocation B receives the next `/advance`, sees no local file, concludes fetch is incomplete, and runs it again. No durable article reaches the Postgres reader.

The stage CLIs also bypass any future shared transaction unless they are moved onto the same runner.

**Confidence: 100%.**

---

### 2. Critical — the proposed fence does not fence artefacts, step runs, drafts, or publication

The job commit predicate itself is correct:

```sql
WHERE id = $id
  AND attempt_id = $attempt
  AND status = 'running'
```

But applying it only to the job row is insufficient. The plan’s claim that the artefact attempt marker independently protects outputs is false: it is a separate marker, not the job attempt, and it is not checked atomically with the write.

Evidence:

- The plan relies on two independent fences: `durable-queue-and-uploads.md:199`
- `finishStep` explicitly says its marker is not a lock: `src/store/artifacts.ts:277`
- Filesystem stages write before `finishStep` validates the marker: `src/jobs.ts:520`
- `recordStepRun` is an unfenced upsert: `src/store/pg-revisions.ts:611`
- Publication only fences when an optional job token is supplied: `src/store/pg-revisions.ts:647`
- The current lifecycle publishes without supplying it: `src/store/revisions.ts:187`
- The rethink explicitly requires draft, step-run, publication and job transition in one transaction: `job-queue-rethink.md:242`

Reproduction: A owns job attempt J1 and artefact marker X. Its lease expires; B claims J2. Before B replaces X, A finishes and writes its result because X still matches. A’s later job commit is rejected, but the stale output has already landed.

The necessary shape is one transaction that verifies the live job attempt and commits the artefact, step-run, revision/pointer changes, and job transition together.

**Confidence: 100%.**

---

### 3. Critical — enqueue deduplication and slug reservation remain process-local

The plan moves job records but does not replace the in-memory atomicity assumptions around `activeFor`, `freeSlug`, and upload slug selection.

Evidence:

- Active-work dedup scans the local `Map`: `src/jobs.ts:966`
- The upload code acknowledges its slug race is only closed within one process: `src/jobs.ts:981`
- `activeFor` remains a map scan: `src/jobs.ts:1112`
- Neither the jobs schema nor the proposed additions contain an active work key or slug reservation: `src/db/schema.ts:577`, `durable-queue-and-uploads.md:304`

Reproductions:

1. Two invocations enqueue the same work simultaneously. Both see no active job and insert different queued rows. The running index serializes them but does not deduplicate them; the model work is paid twice.
2. Two uploads named `paper.pdf` both select slug `paper`. The second job can later publish into the first upload’s article, violating “uploads never adopt an existing article.”

Creation must be a transactional `enqueue-or-return-existing` operation with an immutable work key and atomic slug reservation/active-slug constraint.

**Confidence: 98%.**

---

### 4. Critical — expired-lease stealing is unsafe locally, and it is not human-triggered

A fixed lease longer than 300 seconds is defensible on Vercel because the function is killed at 300 seconds. It is not defensible locally, where a model or pipeline step can remain alive indefinitely.

The plan’s premise that stealing happens because a human explicitly asks to resume is also wrong. The browser driver automatically advances and retries jobs: `src/web/useJobs.ts:153`, `src/web/useJobs.ts:336`.

Reproduction: a local model call runs beyond the lease. The browser or another local pump automatically steals it. Both calls continue, producing duplicate cost and—under the current write design—competing outputs.

Use a renewable lease/heartbeat locally, or enforce an actual execution deadline that guarantees the claimant has stopped before expiry. Stealing is safe only after every durable side effect is atomically fenced.

**Confidence: 100%.**

---

### 5. High — the step-release and cancellation protocols are unspecified

Claim changes a row to `running`, but the plan only explicitly clears the attempt and lease for terminal completion: `durable-queue-and-uploads.md:214`.

Reproduction: step 1 succeeds and the job remains `running` with an unexpired lease. The next HTTP request has a new attempt token and receives `busy` until expiry.

A nonterminal success must atomically transition back to `queued` and clear the attempt/lease, unless the same claimant is defined to retain ownership across subsequent requests.

Cancellation has a similar hole: `requestCancel` may set `cancelling` after the claimant read the row. The commit predicate does not include or atomically inspect that flag, so the claimant can commit another step and leave an ambiguous state. Generic `commit(patch)` is too weak; the store needs explicit transition operations.

**Confidence: 95%.**

---

### 6. High — the unique running index is a mutex, not a scheduler

`jobs_only_one_running` correctly enforces at-most-one running job, and handling its `23505` as `busy` is correct. It does not cause a queued job to start.

The proposed local loop exits when it sees `busy`: `durable-queue-and-uploads.md:360`.

Reproduction: A is running when B is queued. B’s local loop gets `busy` and exits. A completes, but nothing restarts B if the browser is closed—the exact local behavior §5 claims to preserve.

The local adapter needs a real pump that continues scanning queued work or retries `busy` with backoff. Using the same claimed primitive from browser and local pump is sound; the current proposed lifecycle is not.

**Confidence: 100%.**

---

### 7. High — `Job.profile` has no database column

The plan says only upload and failure fields are missing, but `Job.profile` is persisted state: `src/types.ts:1477`. The jobs table has no profile column: `src/db/schema.ts:577`.

Reproduction: enqueue personalized summary work, then advance it in another invocation. The reconstructed job has no profile, so later stages silently use an unprofiled prompt and stamp.

Add nullable `profile text`; keeping it out of the public API response is still correct.

**Confidence: 100%.**

---

### 8. High — stale claimants can poison upload records

The upload’s conditional `pending → claimed` update is a correct replacement for the filesystem `wx` marker. However, later `verified`/`rejected` transitions are fenced only by upload status, not the owning job attempt: `durable-queue-and-uploads.md:292`.

Pipeline acquisition writes those terminal states inside the claimed step: `src/pipeline.ts:705`, `src/pipeline.ts:771`.

Reproduction: A’s job lease expires and B steals it. Stale A rejects the upload first. B successfully verifies the object but cannot settle it because the upload is already terminal.

The terminal upload transition must be committed with the live job-attempt check.

**Confidence: 97%.**

---

### 9. Major — the upload schema does not preserve the existing state model

Problems in the proposed table:

- The status check omits `expired`, which exists in the current state machine: `src/source.ts:210`.
- Nothing requires `verified` records to have SHA/byte evidence or rejected records to have a reason.
- `bigint` byte fields do not match the TypeScript `number` fields and commonly return as strings through `pg`: `src/upload-records.ts:77`.
- `claimed_at` has no `UploadRecord` field.
- `upload_id ON DELETE SET NULL` can leave `upload_filename` populated, an impossible half-`JobUpload`: `src/types.ts:1372`.
- Owner deletion cascading uploads while jobs restrict owner deletion creates inconsistent retention policy.
- `failure_kind` should have a nullable check against the closed TypeScript union: `src/messages.ts:40`.

The never-delete-staging-object rule itself is preserved, and the expiry grace window can be preserved by the conditional claim. The table constraints are the problem.

**Confidence: 96%.**

---

### 10. Major — retention, migration ownership and parity tests are not implementation details

Current behavior retains only 50 finished jobs per owner: `src/jobs.ts:1313`. The plan leaves retention open, while `list()` reads every job. That is an immediate behavior and payload regression.

It also omits required parity around:

- `retryJob` creating a new job while preserving upload, guidance and profile: `src/jobs.ts:1451`
- `forgetJob` refusing active jobs: `src/jobs.ts:1515`
- Filesystem `sweepStopped`: `src/jobs.ts:326`
- The `example` fixture and filesystem shelf lookups
- Tests asserting `queue_state` remains present: `tests/db-schema.test.ts:263`
- Upload API tests expecting the Vercel refusal: `tests/uploads-api.test.ts:122`

Given the shared `schema.ts`, “ride the same migration” is not an adequate migration procedure. The plan must assign migration ownership, generate after the conflicting work lands, inspect the exact diff, update snapshot/constraint guards, and remove any `queue_state` custom database objects deliberately.

**Confidence: 100%.**

## Verdict

**NO-SHIP.** Build this in this order:

1. Finish the Postgres artefact/revision store and one transactional stage runner used by jobs and CLIs.
2. Define atomic enqueue deduplication and slug reservation.
3. Add transition-shaped job/upload operations, renewable local leases, and end-to-end job-attempt fencing.
4. Add a real local queue pump.
5. Specify retention, schema constraints, migration ownership, and adapter-parity tests.
6. Only then cut `/advance` and uploads over to Postgres.

The running-row predicate, partial unique index, and conditional initial upload claim are individually sound. They do not rescue the current overall design.