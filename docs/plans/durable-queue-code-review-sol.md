NO-SHIP. The claim primitive is sound in isolation, but cancellation, expiry, and enqueue contain concurrency blockers.

All line numbers refer to `c109658`.

## Findings

### 1. Critical — expired claims are never swept in production

Evidence:

- `failExpired` exists at `src/store/pg-jobs.ts:268` and `src/store/jobs-fs.ts:299`.
- `git grep failExpired` finds no production caller—only definitions, comments, and `tests/store-jobs-parity.test.ts`.
- A busy claim never checks expiry: `src/store/pg-jobs.ts:165-214`.
- Both drivers retry `busy` indefinitely: `src/jobs.ts:482-512`, `src/web/useJobs.ts:153-197`.
- Any non-`StaleAttemptError` after claiming is rethrown without releasing: `src/jobs.ts:697-707`.

Reproduction:

1. Claim a Postgres job.
2. Kill the invocation, or make `noteProgress` throw after the claim.
3. Wait past `lease_expires_at`.
4. Every `/advance` still returns `busy`; the local pump backs off forever. Nothing calls `failExpired`.

This also answers the `noteProgress` case: if its database call rejects—even ambiguously after the update committed—the `finally` deletes the local abort handle, but the job remains `running` with nobody holding it.

The missing dependency is a production driver for lease expiry. The lease currently records a deadline but does not enforce one.

Confidence: 100%.

### 2. Critical — cross-instance cancellation permanently creates `queued + cancelling`

Evidence:

- `requestCancel` writes `cancelling=true` to both queued and running jobs: `src/store/pg-jobs.ts:317-327`.
- `releaseStep` changes a running job to queued but preserves `cancelling`: `src/store/pg-jobs.ts:217-241`.
- A subsequent claim requires `cancelling=false`, then reports `stopping`: `src/store/pg-jobs.ts:184-214`.
- The abort map is process-local: `src/jobs.ts:95-105`.
- `cancelJob` tries `cancelIdle`, then `requestCancel`, then the local abort: `src/jobs.ts:1197-1201`.
- The schema permits queued jobs with `cancelling=true`: `src/db/schema.ts:787-801`.

Reproduction:

1. Instance A is running a non-final step.
2. Instance B handles Stop. `cancelIdle` fails because the job is running; `requestCancel` sets the flag. B has no local controller to abort.
3. A completes successfully and calls `releaseStep`.
4. The row becomes `status='queued', cancelling=true`.
5. Every later claim returns `stopping`; nothing transitions the row to `cancelled`. The Stop button is already disabled.

There is a narrower version even within one instance: the claimant may release between `cancelIdle` and `requestCancel`, producing the same state.

If it was the final step, `finish` can instead clear the cancellation and report `done`.

The transition needs to atomically choose either “queued → cancelled” or “running → cancelling”; a successful release also needs to settle a cancellation it observes.

Confidence: 100%.

### 3. Critical — existing-article work can be redirected to a different article

Evidence:

- On a different-work conflict, `enqueue` always reallocates a slug: `src/jobs.ts:853-874`.
- For requests with neither URL nor upload—the normal shape for summaries, glossary, ideas, etc.—it blindly selects `${request.slug}-${n}`: `src/jobs.ts:869-873`.
- On the next loop it reads that suffix’s URL and builds the job against it: `src/jobs.ts:832-851`.
- The plan explicitly expected a 409 for this case, not renaming: `docs/plans/durable-queue-and-uploads.md:306-310`.

Reproduction:

1. `paper` has an active glossary job.
2. `paper-2` is a different article already on the shelf.
3. Enqueue `{slug: "paper", steps: ["summary"]}`.
4. The active-slug conflict is “different work”, so the request becomes a summary job for `paper-2`.
5. It can successfully summarise the wrong article.

If `paper-2` does not exist, the job merely fails against a nonexistent article. Neither outcome is acceptable. Slug reallocation is valid for new URL/upload ingestion, not for work targeted at an existing slug.

Confidence: 100%.

### 4. Critical — URL identity is missing from `workKeyFor` and `sameWork`

The two functions agree exactly, but they agree on an incomplete identity.

Evidence:

- The key contains steps/force, upload ID, guidance, and profile only: `src/jobs.ts:903-919`.
- `sameWork` compares the same fields and also omits `job.url`: `src/jobs.ts:948-975`.
- The test grid contains no URL dimension: `tests/jobs.test.ts:603-618`.
- `enqueueOrGet` trusts equality of those keys after an active-slug conflict: `src/store/pg-jobs.ts:124-162`.

Reproduction:

1. Concurrently add `https://a.example/news` and `https://b.example/news`.
2. Both run `freeSlug("news", …)` before either insert and both see `news` as free.
3. Both produce the same work key because their default work parameters match.
4. The first insert wins. The second conflicts on `jobs_active_slug`, sees the same key, and returns the first URL’s job.
5. One requested article silently never gets ingested.

`owner` and `slug` are implicit in the unique-index conflict; upload filename is display-only; result/status/timestamp fields correctly do not define work. The canonical `urlKey(url)` is the missing source-identity field.

Confidence: 99%.

### 5. High — the filesystem adapter does not durably retain its work key

Evidence:

- Work keys exist only in an in-memory `Map`: `src/store/jobs-fs.ts:63-66`.
- Persistence serializes only `Job`: `src/store/jobs-fs.ts:78-84`.
- `loadFromDisk` restores jobs but never restores keys: `src/store/jobs-fs.ts:147-171`.
- A loaded active job therefore always compares as different work: `src/store/jobs-fs.ts:223-227`.

Reproduction:

1. Enqueue a filesystem job and stop the process while it remains active.
2. Restart. `sweepStopped` restores it as queued, but its key is absent.
3. Repeat the same enqueue.
4. `enqueueOrGet` reports `sameWork:false`. For the same URL, `freeSlug` keeps returning the original slug, so `enqueue` repeats until its 20-try 409 at `src/jobs.ts:825-874`.

This is bounded rather than infinite, but it deterministically spins and rejects a valid repeat request.

Confidence: 100%.

### 6. High — the filesystem move dropped legacy-owner migration

Evidence:

- The loader reads and indexes historical JSON unchanged: `src/store/jobs-fs.ts:161-171`.
- Reads and lists require exact `job.ownerId`: `src/store/jobs-fs.ts:187-212`.
- The pre-move loader stamped records lacking an owner; that code is absent from the adapter.

A read-only workspace scan found 34 existing `data/_jobs/*.json` records without `ownerId`. For example, `data/_jobs/spya-xvp6ub.json` is a valid completed job but has no owner.

Reproduction: restart with any pre-owner job file, then call `listJobs` or `getJob`; it is silently invisible to every owner.

The new `listJobs` ownership policy itself is otherwise safe: its only production callers are the authenticated list route and `jobForSlug`, at `src/routes.ts:2164` and `src/routes.ts:2944`.

Confidence: 100%.

### 7. High — the deadline is cooperative, and the fence accepts an expired lease

Evidence:

- The timer only aborts a signal: `src/jobs.ts:632-636`.
- `runStep` awaits the stage and finishes its artefact marker before the outer signal check: `src/jobs.ts:338-367`.
- The fence does not require an unexpired lease: `src/store/pg-jobs.ts:392-393`.
- If an ignoring step eventually succeeds after the timer, the outer branch records `cancelled`, not `INTERRUPTED`: `src/jobs.ts:672-676`.
- The promised deadline test is absent from `tests/jobs.test.ts`.

Reproduction:

1. Make a stage ignore its signal and resolve after 250 seconds.
2. At 220 seconds the controller aborts, but the awaited stage continues.
3. With today’s missing sweeper, its fenced finish is still accepted after lease expiry and is misreported as reader cancellation.
4. If a future sweeper runs at 240 seconds, it can mark the job failed while the live stage continues writing artefacts.

Twenty seconds is ample against the measured 2.6-second synchronous block, but it cannot guarantee unwinding from arbitrary signal-ignoring work. The architecture needs either enforced termination or a fence around the artefact commit.

Confidence: 100% on behavior; 90% on likelihood with today’s stages.

### 8. Major — a successful terminal write can still make `/advance` return 500

Evidence:

- `endJob` commits `finish`, then separately runs retention: `src/jobs.ts:423-439`.
- A retention failure escapes through `advanceJob`: `src/jobs.ts:697-707`.
- The route converts that into 500: `src/routes.ts:3059-3078`.
- The local pump logs the exception and terminates: `src/jobs.ts:488-499`.

Reproduction: allow `finish` to succeed, then make `trimFinished` reject. The durable row is terminal, but `/advance` says failure. The browser’s next retry discovers the completed job, so this self-heals, but the request result contradicts the committed transition.

Retention should not invalidate the result of a successful finish.

Confidence: 100%.

### 9. Major — Postgres enqueue arbitration has a normal finish race

Evidence:

- `enqueueOrGet` performs a conflicting insert and then a separate select: `src/store/pg-jobs.ts:124-162`.
- It explicitly throws if the conflicting active row disappears before the select: `src/store/pg-jobs.ts:157-161`.

Reproduction:

1. Insert conflicts with an active job.
2. That job finishes between the insert statement and the follow-up select.
3. The select finds no active holder and enqueue returns 500 instead of retrying the insert.

Confidence: 98%.

## What is sound

For two simultaneous advances of one job, both adapters admit exactly one claimant: Postgres through the conditional update, filesystem through synchronous mutation before its first post-claim await. For two different jobs, Postgres’s partial unique index and filesystem’s `runningNow()` similarly enforce one running job. Successful Postgres progress/release/finish transitions are each atomic; successful filesystem persistence writes one atomically-renamed JSON document.

Multiple drivers can exist for one job—the local pump and one or more browser tabs—but only one step executes under a claim. Backoff is reasonable. The failure is termination: a dead claim has no sweeper, and an unexpected `advanceJob` exception makes the local pump stop without settling its claim.

The claimant’s actual pipeline writes are not fenced by the job attempt: `beginStep`, the stage, and `finishStep` occur at `src/jobs.ts:338-346`. That limitation is documented for the pending transactional stage runner, but it means the answer to “does every write carry the fence?” remains no.

I did not run the suites because this workspace is managed read-only and the relevant tests write `data/_jobs`, article fixtures, and Postgres. The review used the committed `c109658` snapshots; current uncommitted changes in `src/db/schema.ts` and `src/routes.ts` were excluded.

**NO-SHIP.**