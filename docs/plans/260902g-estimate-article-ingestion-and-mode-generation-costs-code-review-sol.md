Not ready for the first paid run. No P0s, but five P1 correctness gaps.

## P1 findings

1. **A stale fixture does not abort; it spends anyway.**

   The hash is computed, then the job is enqueued, and a mismatch only prints `STALE FIXTURE`; execution continues into `advanceJobWith`. That contradicts the manifest contract (“re-hashed and refused”) and can spend the whole corpus on changed bytes. See [run.ts:220](evals/cost/run.ts:220) and [run.ts:254](evals/cost/run.ts:254).

   Hash every selected fixture before creating any job, and abort the entire run if any mismatch. Checking per draw would still allow earlier fixtures to spend before discovering a later stale one.

2. **“Cold” does not establish that labels ran.**

   `checkCold` validates only the step aggregation. Since both the structure call and every label call have `stepName: "hierarchy"`, one priced structure row makes `hierarchy` pass even if every label call was skipped or lost. `mustPayFor` omitting `"labels"` is correct only for the step namespace; it is not correct for the `AiJob` cold assertion. See [harness.ts:225](evals/cost/harness.ts:225) and [run.ts:297](evals/cost/run.ts:297).

   The test fixture hides this by giving label rows the impossible production value `stepName: "labels"` at [cost-eval.test.ts:177](tests/cost-eval.test.ts:177). Add a real-shape test where all rows have `stepName: "hierarchy"` and distinguish them by `job`; require both `AiJob=hierarchy` and `AiJob=labels`.

3. **Suppressing this process’s pump does not isolate the job from browser drivers.**

   A browser signed into the same local owner discovers every queued job and automatically calls `/advance` for it: [jobEngine.ts:431](src/web/jobEngine.ts:431). The eval uses `environmentOwnerId`, so `VERCEL=1` only suppresses the runner process’s pump; it does nothing to an already-open dev tab.

   If the browser wins the initial claim, the production fixture fetch will normally fail on `.invalid`, loudly but incorrectly. More seriously, if it wins a later claim handoff in a long job, it runs the remaining paid step through `PRODUCTION`, producing `job_step` rows in Product. The scope check notices only after the money has landed.

   The proposed dedicated eval owner is therefore not a nice-to-have; it is required isolation unless the durable job itself records which registry/attribution must drive it.

4. **The ledger can be partially short while every runner check passes.**

   A sink failure increments `SpendReport.writeFailures` and is swallowed at [ai-spend.ts:969](src/ai-spend.ts:969). `runStep` receives that report but exposes it only through logs. The runner later sees only persisted rows, while Postgres `forJob()` always reports `unreadable: 0` because missing rows are unknowable there: [ai-calls-pg.ts:243](src/store/ai-calls-pg.ts:243).

   If all rows fail, `no-spend` catches it. If one hierarchy row persists and all label rows fail, the draw passes and under-reports. The eval needs access to each step collector’s `calls`, `pending`, and `writeFailures`, then reconcile those counts with `forJob()` before accepting the number. Any unpriced row should also be fatal for a cost-measurement run, or require an explicit override; currently even an entirely unpriced required step continues to the next paid draw.

5. **A non-zero bill is not sufficient evidence of a cold provider cache.**

   Fresh slugs establish cold stored artefacts and PDF checkpoints, but not necessarily cold provider-side prompt caches. When compatible modes appear in one job, `sharesArticleCache` deliberately marks the first article prefix for later modes. Text-rendering modes use byte-identical `articleText`, which excludes the run-tagged URL, so a repeated fixture inside the five-minute TTL can also read the previous draw’s entry. See [pipeline.ts:248](src/pipeline.ts:248) and [article-prompt.ts:162](src/article-prompt.ts:162).

   `checkCold` only asks whether spend is positive; a warm cache read passes. For production-like per-mode numbers, enforce one on-demand mode per job, where `cacheArticle` is off. If batched-mode jobs are also measured, label them as a separate scenario and assert the expected cache creation/read sequence. Do not aggregate them as the cost of pressing each mode separately.

## P2 findings

- **The postcondition/commit attribution description is wrong, and its check cannot see that class of call.** `collectSpend(run)` finishes before `session.commit` at [jobs.ts:585](src/jobs.ts:585) and [jobs.ts:643](src/jobs.ts:643). A new paid call in `commit` would therefore fall back to the outer eval collector—not become `job_step`. That prevents Product contamination in this process, but the outer collector has no job or article attribution, so `forJob(job.id)` and the scope-leak check never see the cost. Wrap each `advanceJobWith` call in an outer attribution carrying the current job id and slug.

- **Concurrent runs can overwrite each other’s result and cleanup manifest.** The result directory uses timestamp-to-the-second plus fixture names, but not `runTag` or steps, and checkpoints overwrite `run.json` directly: [run.ts:560](evals/cost/run.ts:560). Two agents starting similar runs in one second share the directory. Include `runTag` and write checkpoints by temporary-file rename.

- **`commit` does not pin labels when `gitDirty` is true.** The record acknowledges dirtiness but still says labels are “pinned by commit” at [run.ts:430](evals/cost/run.ts:430). For paid comparable results, either refuse a dirty tree or record a patch/tree digest. This first run should ideally commit the runner before running it.

## What is sound

- `totalRows()` plus the explicit sum of credits, BYOK upstream, and computed cost is the right arithmetic.
- Both aggregations are useful and correctly implemented as reports.
- The ledger wall-clock envelope is correct for AI-call time; runner elapsed remains the separate end-to-end clock.
- I found no current ingest-path purchase outside `step.run`; begin, postconditions, commit, and publication are storage-only today.
- Exact-slug and exact-job-id cleanup is appropriately narrow. I found no prefix delete or path that deletes another article. Raw source objects remaining is intentional content-addressed retention.
- Decisions 2, 4, and 6 are sound. Decision 1 needs the additional `AiJob` cold assertion; decision 3 needs more fatal conditions; decision 5 is sound only for a clean tree.

I could not rerun the suite in this read-only review environment: Vitest was stopped by an `EROFS` write to `.vite-temp`, and the `tsx` typecheck runner by an `EPERM` IPC socket. Those happened before project code executed.