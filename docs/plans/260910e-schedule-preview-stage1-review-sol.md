## Verdict

Commit `18f64a04` should not be accepted unchanged because of F1, an established P1. The working-tree fixes close it; I found no remaining P0/P1 and no input that caused an unauthorised session launch, an unintended extra dispatch, or a dry-run ledger write.

No daemon or dashboard process was started, signalled, or reconfigured. Neither scheduler environment variable was set.

## Findings

### F1 — P1, established: duplicate jobs could still earn `ARMED`

(a) With two authorised session definitions both named `twin`, the planner refused both and launched zero, but `eligibilityOf()` returned `eligible, eligible`; consequently `schedulerStandingOf()` reported `ARMED`.

The reproducing test failed red with:

```text
Expected: ["ineligible", "ineligible"]
Received: ["eligible", "eligible"]
```

This violates the checkpoint’s authoritative claim that at least one loaded job can run.

(b) Fixed by extracting the planner’s duplicate preflight into `duplicateJobIds()` and applying it before per-job eligibility checks. See [schedule-plan.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/schedule-plan.ts:223), [scheduler.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/scheduler.ts:396), and the reproducer in [overseer-schedule-plan.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tests/overseer-schedule-plan.test.ts:650).

### F2 — P2, established: rule document pins were not historical pins

(a) Copy the three rule sources to a temporary checkout, append a comment to `rules.ts`, then call `ruleJobs(tempRoot)`. The composite behavior hash correctly becomes unauthorised, but `authorisedDocuments` equals the newly read documents exactly. The refusal therefore cannot say which document moved; the rule pins-agree test was a restatement rather than independent evidence.

This does not weaken dispatch safety—the composite hash still refuses—but it breaks D4’s promised diagnosis.

(b) Fixed by storing literal authorised digests for the three rule sources and retaining load-time digests only in `behaviour.documents`. The behavior hash remains the sole gate. See [rule-jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/rule-jobs.ts:241) and [overseer-rules.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tests/overseer-rules.test.ts:814).

### F3 — P2, established: dry-run could be classified as an activation blocker

(a) An authorised dry-run session passed to:

```ts
eligibilityOf([dryJob], { session: false, rules: false })
```

returned `ineligible`, because capability checks ran before dry-run classification. This contradicts the contract that a dry-run requires no launcher and cannot stop activation. Current shipped activation supplies both capabilities, so this was not wrong shipped behavior today.

(b) Fixed by retaining authorisation first, then classifying dry-run, then checking capabilities for live jobs. See [scheduler.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/scheduler.ts:405) and its test [here](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tests/overseer-schedule-plan.test.ts:644).

## Launch-path and evidence audit

Every production path reaching `launch` receives a fresh document reading:

1. `schedulerWiring()` creates `readJobDocument(root)` and puts it in the armed daemon’s job options: [overseer.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/scripts/overseer.ts:609).
2. The daemon’s jobs timer passes that reader into `schedulerTick`: [daemon.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/daemon.ts:1017).
3. `schedulerTick` calls `resolveEvidence()` immediately before `planJobs`: [scheduler.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/scheduler.ts:486).
4. Only an authorised planner arm reaches the injected launch: [schedule-plan.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/schedule-plan.ts:342).

`evidenceAsBuilt` is used only by eligibility/headline checks when explicit evidence is absent. It cannot reach reservation, spawn, or `launch`.

## Suspicions resolved

1. `evidenceAsBuilt`: safe at its current call sites; no real-launch path uses it.
2. Checkpoint and scheduler readings can differ if a file changes between their separate timer callbacks. Each result describes its own timestamp, so this is ordinary snapshot staleness, not contradictory evidence at one instant. Combining them would not close the explicitly deferred digest-to-session-read race.
3. Hashing dry-run `why` is acceptable. It makes harmless rewording cost a re-pin, but avoids a special field inside a hashed type that the hash silently ignores. I would keep it.
4. `waiting.nextDueAt` is absolute. Since `remainingMs = everyMs - (now - last)`, `now + remainingMs` equals `last + everyMs`, including after a backward clock jump.
5. Rule `authorisedDocuments` were a diagnostic hole; fixed as F2.

## Verification

- Red-first run: 3 intended failures, 86 passes.
- Exact nine-file focused scope after fixes: **9 files, 322 tests, exit 0**.
- `npm run typecheck`: exit 1 before compilation because this sandbox denied `tsx`’s `/tmp` IPC socket with `EPERM`.
- Equivalent driver, `node --import tsx scripts/typecheck.ts`: **exit 0**, all 1,966 source files covered.
- Biome on the five touched files: exit 0; three pre-existing informational findings elsewhere in `overseer-rules.test.ts`.
- `git diff --check`: exit 0.
- Full `npm test` was not run, as requested.

Changed files:

- [tests/overseer-rules.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tests/overseer-rules.test.ts)
- [tests/overseer-schedule-plan.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tests/overseer-schedule-plan.test.ts)
- [tools/overseer/rule-jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/rule-jobs.ts)
- [tools/overseer/schedule-plan.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/schedule-plan.ts)
- [tools/overseer/scheduler.ts](/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview/tools/overseer/scheduler.ts)

No commit was made. The two pre-existing untracked plan/task files were untouched.