STOP — do not build the prompt’s original lock-file design. The plan file changed during review: its current version correctly identifies Vite’s same-process module re-instantiation and proposes process-global state instead. That revised design is substantially better, but needs the changes below.

## Ranked findings

### P0 — The original lock file is not a sufficient filesystem fence

`open(..., "wx")` only arbitrates acquisition. It does not make the job record or subsequent transitions coherent across processes:

- Each process still has a stale `index`, loaded once at [jobs-fs.ts:213](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:213). After acquiring a released lock, it could overwrite newer steps or a terminal status with its old object.
- `requestCancel` can concurrently overwrite the claimant’s state because it neither owns nor consults the proposed claim lock ([jobs-fs.ts:480](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:480)).
- `writes` serializes only one module instance ([jobs-fs.ts:72](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:72)); `persist` also swallows failures ([jobs-fs.ts:113](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:113)), so safe “persist then unlock” cannot be guaranteed.
- Expired-lock recovery is an unlink/create race: one process can inspect A’s expired lock, another replace it with B’s live lock, and the first unlink B’s lock.
- `settleExpired` currently knows only module-local attempts ([jobs-fs.ts:456](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:456)); durable locks would require a new scan and recovery protocol.

NFS, overlayfs and Windows make the portability claim narrower still. The lease prevents a permanent stale lock; it does not make stale-lock replacement atomic.

### P1 — The revised process-global fix leaves a known, active cost path

Sharing state through `globalThis` is the right small fix for Vite restarts, but it still permits one claimant per OS process. There are three Vite processes using the same directory, and the plan itself records cross-process divergence at [plan:259](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md:259).

Thus the fix changes a possible eleven-call storm into a possible three-call storm; it does not establish “one job, one claimant” for the actual default setup.

Given that Postgres mode is already production-ready ([260831b:3](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/docs/plans/260831b-finish-the-database-move.md:3)), make `npm run dev` use Postgres by default, or refuse multiple files-mode servers over one checkout. Keep the process-global fix as a cheap hot-reload repair if files mode remains usable.

### P1 — The new test’s lease case contradicts the contract and the proposed implementation

The test says an expired claim is “takeable” ([two-servers-one-queue.test.ts:182](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/tests/two-servers-one-queue.test.ts:182)), but the `JobStore` contract explicitly says expiry terminalizes rather than transfers the job ([jobs.ts:29](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs.ts:29)).

Its assertion, `kind !== "busy"`, would also pass for `finished`, which is silent-success territory. Worse, after sharing the existing `index`, direct `claim()` still sees `status === "running"` and returns `busy` before examining expiry ([jobs-fs.ts:356](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:356)). The planned implementation therefore cannot keep this case green.

Change it to:

1. expire;
2. call `settleExpired`;
3. assert exact terminal status;
4. assert the next claim is exactly `finished`.

### P1 — Test cleanup stops working once state becomes process-global

The test deletes only JSON files ([two-servers-one-queue.test.ts:79](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/tests/two-servers-one-queue.test.ts:79)). After the fix, claimed jobs remain in the global `index` and `attempts` across `vi.resetModules()`, contaminating later cases and counting toward `maxRunning`.

Use random IDs, assert `enqueueOrGet(...).created === true`, and clean the shared in-memory state through a dedicated test seam. The current fixed IDs can also collide with another simultaneous run or a killed run’s residue.

### P1 — The abort half has no failing behavioural test

The revised plan also shares `src/jobs.ts`’s `aborts` map ([plan:175](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md:175)), correctly addressing Stop after hot restart. But the existing test exercises only `fsJobStore`; it cannot fail if `aborts` remains module-local.

Add a test that starts a blocking fake step through one `jobs.ts` instance, imports a fresh instance, calls Stop through it, and observes the first step’s signal abort.

### P1 — Postgres prevents a second claim of the same job, but not all overlapping spend

The same-row guarantee is sound:

- claim is `UPDATE … WHERE status = 'queued'` ([pg-jobs.ts:181](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/pg-jobs.ts:181));
- all claimant writes require the same attempt, `running`, and a live lease ([job-fence.ts:90](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/job-fence.ts:90));
- expiry and cancellation move the row terminal, never back to queued ([pg-jobs.ts:526](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/pg-jobs.ts:526), [pg-jobs.ts:621](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/pg-jobs.ts:621));
- `releaseStep` changes it to queued only after the step’s transactional commit ([pg-jobs.ts:778](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/pg-jobs.ts:778)).

But “an expired lease proves nobody is still spending” is not provable. Abort is cooperative, and the code explicitly handles a step that ignores the signal ([jobs.ts:1623](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/jobs.ts:1623)). After expiry, the old job can be terminalized and the reader can create a new retry job while the old computation still unwinds. That is overlapping article spend under different job IDs, not two claims of one job.

### P2 — Factual overstatements

- “Every save to any file under `src/`” is too broad ([plan:58](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md:58)). Only modules in the bundled config/server dependency graph restart the server; client-only modules normally HMR.
- The prose says `$5.43`, while its ledger says `$5.57` for `spya-zf0bgj` ([plan:3](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md:3), [plan:29](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md:29)). Preserve Greg’s quoted figure, but correct the plan’s own statement.
- “One small module and two declarations” understates sharing mutable primitives such as `loaded` and `writeCounter`. They must remain properties of one shared state object; destructuring them would silently recreate local copies.

## Direct answers

1. No ordinary single-module path produces the eleven claims. `pump` can multiply requests but not grants; the first claim mutates status synchronously before awaiting persistence. The 760-second lease rules out the observed cadence, and `StaleAttemptError` stops rather than retries. Vite re-instantiation is a real second mechanism—and likely the dominant one. The current plan now correctly includes it.

2. Postgres prevents concurrent claims of the same job. Expiry, Stop and release do not reopen that row while the claimant is valid. It does not prove the old computation has stopped, so a separate retry job can overlap after expiry.

3. The original lock-file fix is not the right shape. The revised process-global state is right for hot restarts, but has only a process-local guarantee. Postgres is the materially simpler existing cross-process design.

4. Do not ship only a pinning test: files mode demonstrably does not prevent the bug. But do not invest in a partial filesystem transaction protocol either. Ship the hot-restart repair plus postmortem, and move shared development to Postgres—or enforce files mode’s single-process restriction.

5. `vi.resetModules()` is sound only when called before each import, as the current `aServer()` does. The first two cases deterministically go red today: the cold instance sweeps `running` to `queued`, and the warm instance retains its stale queued object. The hardcoded job root makes them genuinely share storage; `SPIDERYARN_DATA_ROOT` does not affect this adapter. Fix the weak expiry assertion, fixed IDs, missing `created` assertion, and in-memory cleanup. Add the Postgres concurrent control requested by the brief.

6. Add the cross-reinstantiation Stop test, a truly concurrent Postgres claim test, and an explicit operational decision for the three files-mode processes. Remove the false “expired claim is takeable” claim and narrow the Vite wording.

BUILD WITH CHANGES