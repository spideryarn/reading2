Reviewed and fixed. No remaining P0/P1 findings in the edited candidate; I did not commit.

### Findings

- **F8 — P1 — Established, fixed.** A failed session-start poll stranded a pre-existing job when only quiet subscribers were mounted.
  - **(a)** Start the engine with a queued job, make the first list request fail, then let the next succeed. Before the fix, only one poll occurred and the job was never driven.
  - **(b)** Session start now creates a versioned reconciliation obligation, just like an action. Only a successfully applied poll discharges it.

- **F9 — P2 — Established, fixed.** Closing the last ordinary queue-watching surface left its already-armed timer alive, causing one trailing idle poll.
  - **(a)** Subscribe normally, let the first poll arm its timer, unsubscribe, then advance one minute. Before the fix, the count rose from one to two.
  - **(b)** Unsubscription now cancels the courtesy timer when there are no ordinary subscribers, busy jobs, or owed reconciliations.

- **F10 — P1 — Established, fixed.** A list poll already in flight when `/advance` returned 401 could overwrite the authentication error while leaving `authFailed: true`.
  - **(a)** Hold an advance and a later list request open; reject the advance with 401, then resolve or reject the older list request. Before the fix, the engine ended as either `error: null` or with the list error while remaining paused.
  - **(b)** Both success and failure continuations now discard list responses overtaken by an authentication pause.

- **F11 — P1 — Established, fixed.** Reconciliation was marked complete before the returned job list had actually been applied.
  - **(a)** Return a 200 response whose `jobs` value cannot be applied, followed by a valid list containing a running job. Before the fix, the first response paid the obligation and no retry occurred.
  - **(b)** `reconciliationCompleted` now advances only after `apply(jobs)` succeeds.

- **F12 — P2 — Reasoned, not changed because it is wider than this stage.** The default still bundles the idle cadence into `useJobs()`/`useStepJob()`. The owner-at-rest guard protects Plain and Summary, but not the general class.
  - **(a)** Add a bare `useJobs()` consumer to another persistent signed-in surface not covered by that guard; it silently buys an eight-second loop. The existing hover-card case from F3 already demonstrates the shape.
  - **(b)** Invert the default—or better, require every caller to choose explicitly—and mark the 14 current ordinary callers as requesting the cadence. I would not wait for a third quiet caller: the whole-page test is strong instance prevention, but it does not make the broader bad default safe.

### Requested trace checks

The two changed exact-request fixtures are correct:

- **ARRIVAL:** the removed `/api/jobs` was `useArc` mounting through an ordinary subscription. `subscribeQuietly` deliberately does not wake on arrival. No reader-visible behavior is hidden, and F8 now ensures the session’s initial reconciliation survives failure.
- **IDEAS:** the added `/api/jobs` is the Ideas band’s ordinary subscription becoming the first subscriber to request the idle cadence. It preserves immediate cross-tab discovery while that band is open.

The other examined paths are sound after the fixes:

- A hidden failed reconciliation retains its obligation; `visibilitychange` calls `poke()` immediately on return.
- Session teardown advances the generation and resets both counters; the new session now creates its own opening obligation.
- `useJobs.act` waits for the POST, increments the version before poking, and an older in-flight poll cannot discharge the newer version.
- `again` coalesces action pokes arriving during a poll without losing their later reconciliation.

I also completed residual F5/F7 prose cleanup: 450/hour rather than 480, and no unsupported claim about measured iPad radio/GPU cost.

### Verification

- Targeted review suite: **13 files, 130 tests passed**
- Full typecheck script: **4 projects, all 2,134 source files covered**
- Production client/API build: passed
- Lint on all changed code/test files: clean
- `git diff --check`: clean
- `npm run check` could not complete because this sandbox forbids `tsx` IPC sockets and loopback access to the local Postgres lane. Its build and independently invoked full typecheck passed.

Changed files:

- [src/web/jobEngine.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/src/web/jobEngine.ts)
- [tests/job-engine-drives-with-no-view.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/tests/job-engine-drives-with-no-view.test.ts)
- [tests/job-engine-hidden-poke.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/tests/job-engine-hidden-poke.test.ts)
- [tests/job-engine-auth-pause.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/tests/job-engine-auth-pause.test.ts)
- [tests/arc-idle-poll.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/tests/arc-idle-poll.test.ts)
- [tests/public-network-trace.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/tests/public-network-trace.test.tsx)
- [docs/project/performance.md](/home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain/docs/project/performance.md)

The pre-existing untracked feedback note was untouched.