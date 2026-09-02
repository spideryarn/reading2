No P0. The job fence is now real within one Node process, but the broader claim that these were the only module-lifetime locks is false. I found two P1 classes and several P2 hardening/documentation issues.

## Findings

### P1 — “The two places where state is a lock” is false

The job-specific audit is complete, but the process-wide audit is not.

- The cost ledger’s `writing` promise is explicitly a same-process write mutex. A reload creates another chain, allowing concurrent `appendFile` calls that the comment says must be serialized. That risks corrupting the ledger used to diagnose this exact incident. [src/store/ai-calls-fs.ts:76](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/ai-calls-fs.ts:76)

- `streaming` is an abort registry and stale-writer barrier; after reload, Stop cannot find the old stream and edit/retry cannot await it. [src/routes.ts:1665](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/routes.ts:1665), [src/routes.ts:1877](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/routes.ts:1877)

- `turnOrder` calls itself a lock and protects multi-write chat operations from interleaving. It is unquestionably process state, not a cache. [src/routes.ts:1719](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/routes.ts:1719)

- `answering`, `searching`, `refereeing`, and `pullingClaims` are liveness registries. Their duplication makes a new module copy classify work still running in the old copy as abandoned. This is particularly concrete in files mode, where searches and criteria deliberately have no grace period. [src/routes.ts:766](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/routes.ts:766), [src/routes.ts:3133](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/routes.ts:3133), [src/store/fs.ts:456](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/fs.ts:456)

- Underneath those routes, the files-mode read-modify-write queues are also locks whose comments promise process-wide serialization. Reload duplicates them and reopens silent lost-update races: [src/comments.ts:39](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/comments.ts:39), [src/chat.ts:56](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/chat.ts:56), [src/searches.ts:188](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/searches.ts:188), [src/referee-criteria-store.ts:49](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/referee-criteria-store.ts:49).

These do not reopen the duplicate-job claim fixed here, but they are the same bug class and directly contradict the plan’s “two places” statement. [plan:276](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md:276)

### P1 — Cross-process duplicate spend remains real

As already recorded, files mode still has no fence across OS processes. With multiple Vite servers over one checkout, one job can still be claimed once per process. [src/store/jobs-fs.ts:19](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:19)

I would not downgrade the earlier P1: this fixes the observed eleven-copy amplification inside one process, but does not establish “one job, one claimant” for the stated default environment. Greg must explicitly accept that or choose Postgres/default-server exclusion.

### P2 — Shape evolution is fail-open, and “use a new key” is unsafe

`Symbol.for` is the right mechanism, but the unchecked cast accepts any value previously written under the symbol. [src/process-state.ts:72](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/process-state.ts:72)

If edited code adds or renames a required `QueueState` field, the new module gets the old object and can read `undefined`. More importantly, changing to a new key creates two independent lock universes while the old claimant is still running—the original bug again. Therefore the advice at [src/process-state.ts:56](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/process-state.ts:56) is unsafe for ownership state.

Use a stable key plus a branded/versioned envelope. On an incompatible version, either migrate the same object in place while preserving claims or fail closed with “restart the process”; do not silently construct a second lock.

The comment about callers storing a falsy value is also false because `T extends object` excludes `0`, `false`, and `""`. [src/process-state.ts:76](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/process-state.ts:76)

### P2 — The tests prove the fix, but do not pin the whole claimed contract

The mutation evidence makes them honest today, but add:

- An identity assertion that the imports genuinely are separate module facades, e.g. `second.fsJobStore !== first.fsJobStore`. Otherwise a future change in test isolation could make the fence cases pass merely because both variables reference one module. [tests/two-servers-one-queue.test.ts:66](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/tests/two-servers-one-queue.test.ts:66)

- An end-to-end “pause” test: suspend an old copy inside a fake step, reload, assert the new copy is busy, release the old step, then assert its artefact and terminal job are visible through the new copy. No current test pins the strong “old claimant completes normally” statement.

- Make the lease assertion exact: expect `[{ id: job.id, status: "error" }]`, then assert the claim is `finished` with an error job. `toContain` currently permits unrelated settlement results and does not check the ending. [tests/two-servers-one-queue.test.ts:237](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/tests/two-servers-one-queue.test.ts:237)

The Stop timeout is not a meaningful flake risk: the two seconds begin only after the reload imports and `cancelJob` finish, and abort dispatch is synchronous. [tests/jobs-walk.test.ts:415](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/tests/jobs-walk.test.ts:415)

Passing `StepContext` to `fakeStep` weakens nothing; zero-argument callbacks remain assignable, while the new test can inspect the real signal. [tests/jobs-walk.test.ts:173](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/tests/jobs-walk.test.ts:173)

## Direct answers

1. Within one process, the job fence is complete. `index`, `attempts`, `keys`, `forgotten`, `writes`, `writeCounter`, and `loaded` are all shared; after `ready()`, claim changes status and attempt without another await. [src/store/jobs-fs.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:97), [src/store/jobs-fs.ts:399](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:399)

   Remaining top-level state:

   | Module state | Classification |
   |---|---|
   | `jobs-fs` paths and `TERMINAL` | Immutable configuration |
   | `QueueState` and destructured maps | Shared correctness/locking state |
   | `fsJobStore` object | Stateless facade over shared state |
   | `jobs.ts` `store` | Immutable adapter selection |
   | `aborts` | Shared cancellation registry; correctly moved |
   | Lease/budget/string constants | Immutable configuration |
   | `PRODUCTION`/`STEPS` reference | Immutable code registry; an old request intentionally retains its generation |

   `STORE` is configuration, `artifacts-fs` is effectively stateless, and the database pool is a lazy client cache—not a lock. Reload can temporarily multiply pools/connections, but it does not weaken database fencing. The AI ledger and route registries are locks/liveness barriers, as noted above.

2. A genuine process restart still recovers: `globalThis` is new, `state.loaded` begins null, `ready()` invokes `loadFromDisk`, and `sweepStopped` requeues running work. [src/store/jobs-fs.ts:182](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:182), [src/store/jobs-fs.ts:266](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:266)

   A dead claimant being held for up to 760 seconds is fail-closed and acceptable relative to duplicate spend, though poor UX. It is not permanent: every advance sweeps globally, and every jobs-list poll sweeps the current owner while anything is running. [src/jobs.ts:1328](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/jobs.ts:1328), [src/jobs.ts:2399](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/jobs.ts:2399)

   One minor regression: a rejected `loadFromDisk()` promise is now memoized across reloads, so a transient initial directory error requires a real process restart. [src/store/jobs-fs.ts:325](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:325)

   Vitest is safe under its current isolated-file default. Within these files, cleanup is sufficient. If the suite is ever run with isolation disabled, `forgetForTests` clearing the maps while leaving `state.loaded` resolved can contaminate later files; explicitly pinning `isolate: true` would make the dependency visible. [vitest.config.ts:16](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/vitest.config.ts:16), [src/store/jobs-fs.ts:727](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:727)

3. `Symbol.for` is appropriate; the unchecked cast needs a runtime version/brand or validator. A version tag should fail closed, not select a new independent key.

4. The tests are genuine and the Stop test is not timing-sensitive on success. The lease test should be stricter, and the test mechanism should assert that two module objects really were created.

5. The “do not abort on restart” claim is substantially correct:

   - The new copy sees shared `status: running` and answers busy.
   - Socket closure does not cancel `advanceJob`; that route writes no response until `advanceJob` returns.
   - The old registry and session remain live closures.
   - `fsStoreSession` writes artefacts, clears the marker, and finishes through the old `fsJobStore`, whose methods reference the shared maps. [src/store/session.ts:442](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/session.ts:442)
   - Failure to write the eventual dead HTTP response happens after job settlement and cannot roll it back.

   The qualification is “completes under the code generation that claimed it.” If the edit changed an artefact schema or step contract, the new code may reject the old generation’s output. A stale `STEPS` registry does not reopen the claim, but “normally” is too absolute.

6. False or stale wording to correct:

   - “Every save under `src/`” is false; web-only modules receive ordinary HMR. It is every save in the server/config dependency graph. [src/store/jobs-fs.ts:32](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/src/store/jobs-fs.ts:32), [tests/two-servers-one-queue.test.ts:11](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/tests/two-servers-one-queue.test.ts:11)

   - The plan says a lapsed lease “must still be takeable”; the implemented contract terminalizes it and returns `finished`. [plan:232](/home/greg/code/spideryarn2/.claude/worktrees/agent-a8b787452ea1b7081/docs/plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md:232)

   - “The two places where [state] is a lock” is false for the modules enumerated above.

   - “Use a new key” is unsafe for a live lock, and the falsy-value comment contradicts the generic constraint.

SHIP WITH CHANGES.