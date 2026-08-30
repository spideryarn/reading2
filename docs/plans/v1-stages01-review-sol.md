# Verdict: NO-SHIP

## Critical

### 1. Production never enters the job scope

`runInJob()` is defined at `src/job-scope.ts:52`, but nothing in production imports or calls it. At `0fdd2fe`, `src/jobs.ts:952` calls `runStep()` directly; `runStep()` immediately calls `contextPaths()` at `src/jobs.ts:313`.

The deployed sequence is therefore:

1. `contextPaths()` → `fsLocations()` → `dataRoot()`.
2. `currentJobId()` returns `null`.
3. `dataRoot()` throws at `src/store/data-root.ts:159-166`.
4. No step starts.

The built bundle confirms this: `runInJob()` was tree-shaken away, leaving only an `AsyncLocalStorage` instance and `currentJobId()` at `api-dist/vercel.js:47042-47046`. Nothing can populate it.

Do instead: wrap the complete claimed-job body—session creation, step execution, and finalization—in `runInJob(job.id, async () => …)`, inside the existing owner scope. When Stage 3 lands, put this in the coordinator, not the route. Add an integration test that advances a real/fake job with `VERCEL=1`, no override, and observes its path after an `await`.

## High

### 2. This is not yet one filesystem root

The deployment branch itself is correct: `chooseDataRoot()` checks deployment before invoking the lazy repository walk (`src/store/data-root.ts:154-172,185-211`). Thus `findRepoRoot()` is unreachable on Vercel unless an override is supplied.

But other live paths still derive roots independently:

- At the reviewed commit, `src/pipeline.ts:66,757-788` has its own `ROOT` for `articleExists()` and `urlForSlug()`. In the bundle that points at `/var/task`, and both functions swallow every error as “absent”. This is the known Stage 2 problem, but it disproves “only these two files”.
- `importArticle()` calls direct filesystem loaders at `src/store/import.ts:453-496`. Those loaders use separate roots:
  - `src/comments.ts:35-37`
  - `src/chat.ts:50-52`
  - `src/searches.ts:50-52`
  - `src/glossary-lookups.ts:55-59`
  - `src/shelf.ts:45-47`

Consequently a future job-scoped `importArticle()` reads pipeline artefacts from `/tmp/spideryarn/...` but reader-state files from `/var/task/data/...`. On first ingest those should be absent, but the split is silent and becomes dangerous if bundled data exists or the first-ingest restriction changes.

Do instead: complete Stage 2’s database-backed slug checks. For publication, either parameterize the file loaders with the resolved article directory or use a first-ingest/content-only importer that does not read reader state.

Other module-derived roots—filesystem job, upload, blob, and ledger adapters—remain, but valid production configuration selects Postgres/Supabase before using them.

### 3. Stage 0 does not yet compose with the claim-once coordinator

For today’s one-step request the arithmetic is correct:

```text
420s lease - 20s margin = 400s self-abort
400s < 800s maxDuration
```

However, `advanceJob()` starts one fixed timer after one fixed claim (`src/jobs.ts:837-899`), and `noteProgress()` deliberately does not renew the lease (`src/store/pg-jobs.ts:305-311`).

Therefore, under Stage 3’s “claim once and walk the whole job” design, 400 seconds is the budget for the entire claim—not a fresh 400 seconds for every step. Resetting the per-step timer without extending the lease lets the lease expire while later steps are running; extending it changes the non-renewable-lease safety model.

If the future route merely requires 400 seconds remaining, a step starting at invocation time 400s aborts exactly when Vercel kills the function, leaving no unwind time. It must reserve at least the deadline plus a platform/unwind margin—probably the full 420-second lease. Yes, this also means a short final step may be refused once earlier work consumes roughly 380–400 seconds.

Do instead: before Stage 3, define one absolute invocation cutoff and one compatible lease expiry. Do not treat the current 400-second step deadline as independently renewable without redesigning the lease.

### 4. `GET /api/source/:slug` changes from 404 to 500

After the ownership check, `sendSource()` calls `fsLocations()` at `src/routes.ts:243-250`. The new no-scope error is a plain error, so the route catch maps it to 500 at `src/routes.ts:3229-3247`.

Previously, missing deployed files became `manifest === undefined` and the route returned 404. The new 500 is more honest diagnostically, but it is still a reader-facing regression.

The default throw is right; weakening it would recreate silent absence. Do instead: serve the current revision’s `rawSourceSha256`/`rawSourceKind` through Supabase Storage. This is the only jobless `fsLocations()` route caller I found.

## Test quality

The focused suites pass: 2 files, 17 tests.

`tests/data-root.test.ts` tests the pure selection logic well: exact roots, call-time override, segment validation, and no-scope refusal. But it manually calls `runInJob()` at lines 187-201, so it passes while production never does. It also:

- crosses no `await`;
- tests no concurrent scopes;
- does not advance a job;
- does not exercise `importArticle()`;
- would still pass if every `src/store/import.ts` change were reverted;
- does not catch the independent pipeline and reader-state roots.

`tests/jobs-lease-budget.test.ts` correctly catches the stated “420s lease with 300s host limit” mutation. It would not catch:

- the actual timer being changed to ignore the exported constants;
- a one-millisecond unwind margin;
- route-level budgeting being omitted;
- Vercel silently clamping the deployed value;
- a newer, longer measurement.

Its measurement floor is already stale. `data/_ai-calls.jsonl:47-51` records one ToC run with five calls, 408,991ms summed duration and 368,026ms wall time—not 324,000ms over three calls. The 400-second deadline still covers its recorded wall time, but with about 32 seconds rather than 23% headroom.

## What remains working

- Ordinary local pipeline commands, tests, and evals still resolve to the repository root.
- `db:import` remains local-compatible and its direct artefact reads honor `SPIDERYARN_DATA_ROOT`; its reader-state loaders do not honor the override.
- `db:export` is unchanged because it requires explicit output roots.
- Warm reuse within the same job remains intended because the job id is stable across `/advance` calls.
- Retry creates a new job id and loses the warm cache, intentionally.
- No legitimate CLI or exporter dependency on cross-job warm artefacts was found.

Stage 0 is acceptable in isolation for the current one-step route. Stage 1 is not operational until the production coordinator actually enters the scope.