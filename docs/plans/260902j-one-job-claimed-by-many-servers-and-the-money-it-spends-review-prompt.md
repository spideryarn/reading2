# Review prompt: the plan for the duplicate-claim cost storm

You are reviewing a **plan, before anything is built**, in the Spideryarn repo. Be adversarial. If
the plan should not be built as written, say **STOP** in your first line and say why.

## What to read

1. `docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md` — the plan.
2. `src/store/jobs-fs.ts` — the filesystem job store; `claim`, `releaseStep`, `finish`,
   `settleExpired`, `requestCancel`, `sweepStopped`, `loadFromDisk`, `ready`, `persist`, `writeOnce`,
   `fenced`.
3. `src/store/pg-jobs.ts` — `claim` and `claimIn`, the Postgres fence the plan claims is sound.
4. `src/store/jobs.ts` — the `JobStore` contract and `ClaimOutcome`.
5. `src/jobs.ts` — `advanceJobWith`, `walkClaim`, `runStep`, `pump`, `LEASE_MS`,
   `DEADLINE_MARGIN_MS`, `STEP_BUDGET_MS`, `settleExpired`'s callers.
6. `src/store/job-fence.ts`, `src/store/session.ts`, `src/store/live.ts`.
7. `tests/store-jobs-parity.test.ts`, `tests/jobs-fs-load.test.ts`, `tests/claim-session-files.test.ts`.
8. `docs/postmortems/260826a-toc-max-tokens.md` — the earlier, different bug on the same stage.

## The evidence behind the diagnosis

From `data/_ai-calls.jsonl` (in the primary checkout `/home/greg/code/spideryarn2/data/`, gitignored):

- Job `spya-zf0bgj`, step `hierarchy`, structure call: **11 rows, 11 distinct `runId`s**, started
  17:48:10, 17:50:49, 17:50:56, 17:51:13, 17:51:28, 17:51:34, 17:51:53, 17:52:04, 17:52:43, 17:53:08,
  17:53:23 on 2026-08-30. Each ran 235–513 seconds. The first finished at 17:53:27, i.e. **they
  overlap**. Total $5.57.
- Job `spya-p38nga`: the same shape, 10 overlapping structure calls, $5.05.
- Outputs are **not** all at the 52,225-token ceiling: 32,913 / 26,856 / 25,748 / 47,605 / 21,830 are
  all below it. So "every call truncated" is false.
- Job `spya-v2f7b3`, article `read` (1,867 input tokens, ~50s a call): **6 overlapping structure
  calls, all `outcome: "ok"`, all producing a usable tree.** The storm is not article-length
  dependent and does not need a failure.
- `ps aux` on the box today shows **three `vite` dev servers started from the same checkout**
  (default port, `:5399`, `:5303`), all over one `data/` directory.
- `SPIDERYARN_STORE` was unset for these runs (the evidence is in `data/_jobs/*.json` and
  `data/_ai-calls.jsonl`, the filesystem stores), so the **files** adapter was in use.

## The claim the plan makes

1. The mechanism is **concurrent duplicate claims of one job by separate server processes**, because
   `fsJobStore.claim` fences on module-scope memory (`index`, `attempts`) that `ready()` fills from
   disk once, and the attempt token is never written to disk.
2. Postgres does **not** have this bug: `claimIn`'s single `UPDATE … WHERE status = 'queued'` is the
   fence, and `settleExpired` only ever moves a lapsed job to a terminal status.
3. The fix is (i) a parity test that is red on files and green on Postgres, and (ii) an atomic
   on-disk lock file (`open(…, "wx")`) in the files adapter carrying the attempt and lease expiry.

## What I want from you

Answer each, briefly and concretely, with file:line where you can:

1. **Is the mechanism right?** Is there a *simpler or different* path that produces 11 overlapping
   claims of one job — inside one process — that the plan has missed? Specifically consider: the
   `pump` loop, `settleExpired`'s callers, `sweepStopped` running more than once per process, Vite's
   module runner re-instantiating `src/store/jobs-fs.ts` in-process on a file change (the API is
   loaded via `await import("./src/routes.js")` from `vite.config.ts` and `src/routes.js` does not
   exist on disk, only `src/routes.ts`), the `walkClaim` deadline, and `StaleAttemptError` handling.
   If module re-instantiation in one process is a real second mechanism, say so — it changes the fix,
   because a lock file keyed on the job would still hold but the plan's story would be incomplete.
2. **Is claim 2 true?** Does the Postgres path provably prevent two concurrent claims of one job, or
   is there a window — `settleExpired`, `requestCancel`'s lapsed-lease branch, the deadline abort,
   `releaseStep` — where a second claimant can start while the first is still inside a step and still
   spending?
3. **Is the fix the right shape?** An atomic lock file per job in `data/_jobs/`. What breaks: crash
   leaving a stale lock (the lease covers it — does it?), NFS/overlayfs, `vitest` running many test
   files in parallel over temp dirs, the existing `writes` queue and `persist`'s tmp+rename, the
   restart sweep in `loadFromDisk`, `settleExpired` needing to break another process's lock, Windows.
   Is there a materially simpler design with the same guarantee?
4. **Is the deliverable right?** The brief this came from says: if the current queue provably
   prevents the bug, ship a pinning test and a postmortem and **no speculative fix**. The plan argues
   files is still the default (`src/store/live.ts`) and is what the box runs, so it fixes it anyway.
   Do you agree, or should stage 2 be dropped in favour of making Postgres the default / refusing a
   second server on one `data/`?
5. **The test.** Is `vi.resetModules()` + two dynamic imports a sound way to simulate two processes
   over one `data/_jobs/`? Will it actually go red today? Is there a trap (module-level `data-root`
   resolution, the `writes` queue, `forgotten`) that would make it pass for the wrong reason — which
   would be worse than not having it?
6. **Anything the plan should also do, or should stop doing.** Including anything it says that is
   false.

Rank findings P0/P1/P2. End with a one-line verdict: BUILD, BUILD WITH CHANGES, or STOP.
