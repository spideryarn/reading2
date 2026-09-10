# Stage 2 code review — health off the request thread

## Candidate

Live pre-commit candidate at base `87002cb7a292f4c75394f54168a58d530a4edbbf`.

Scoped paths:

- `tools/fleet/health.ts`
- `tools/fleet/refresh.ts`
- `tools/fleet/server.ts`
- `tests/fleet-health.test.ts`
- `tests/fleet-refresh.test.ts`
- `tests/fleet-health-wiring.test.ts`

Candidate untracked files: none. The worktree also has unrelated untracked `.git-commit-msg-rc`
and `scripts/tmp-rc-watch.sh`; ignore them. `tools/fleet/child.ts` and
`tests/fleet-child.test.ts` contain concurrent Stage 1 work owned by another process. Read the
helper contract, but do not review or edit either file.

This candidate is live, not durable. Start with `tools/fleet/health.ts` and
`tests/fleet-health.test.ts`; that is where to begin, not the limit of scope.

## What it is meant to do

Implement Stage 2 of
`docs/plans/260910c-responsive-collection-monitoring-must-keep-answering-while-it-measures.md`:
split health assembly from command gathering; retain the synchronous collector; add an asynchronous
collector over one owned-child helper with six cheap commands under `limit(3)` and a separately
bounded `vmstat`; make every probe failure field-local and actionable; await async health after
either collection success or failure without moving publish, retention, or drain; and wire one
module-scope owner into the server.

The three Stage 2 test files pass, 68/68. The required four-file command currently has one failure
inside the concurrent, explicitly off-limits `tests/fleet-child.test.ts`. Typecheck likewise reaches
only one error in that file. Do not attribute either to this candidate without showing the path.

## What you can and cannot run, and what you may change

This is a findings-only review. Do not change any file and do not commit. You may run:

`npx vitest run tests/fleet-health.test.ts`

The sandbox has no network or local service access. Review the live diff with:

`git diff 87002cb7a292f4c75394f54168a58d530a4edbbf -- <the six scoped paths above>`

## Attack it

Independently verify that the server request thread is no longer synchronously blocked on the
per-minute health pass, while the old synchronous callers retain their behavior. Try to break:

- one assembly shared by both gatherers;
- field-level independence for every `OwnedOutcome` arm;
- unique ownership keys and bounded concurrency;
- pid and non-zero live-duration visibility for refused and timed-out probes;
- the since-boot vmstat sample exclusion;
- A17 and the exact publish → retain → drain ordering;
- the server-lifetime owner guarantee.

For each finding give an ID (`F1`, `F2`, …), severity, and whether it is established or reasoned.

- P0: data loss, exploitable security, incorrect charging, or service broadly unusable.
- P1: user-visible wrong behavior or an authoritative contract violated.
- P2: design or maintainability risk with no wrong behavior today.
- P3: non-behavioral prose or comment defect.

For every finding provide (a) the exact input or mutation that demonstrates failure and (b) the
smallest fix. Findings without (a) go last. Refuse only on an established P0/P1.

## My own suspicions — read last

These are already my doubts; spend most of the review elsewhere.

- The user brief says the six cheap commands run under `limit(3)` and `vmstat` has its own longer
  bound. The implementation runs vmstat beside that limiter, allowing four total children. Is that
  the direct contract, or does the plan's shorter wording require all seven under the same limiter?
- Cheap probes retain a 5 s deadline and vmstat gets 10 s. The plan does not name exact numbers;
  check whether this honestly distinguishes expected sampling from a wedge on an overloaded box.
- The sync/async equivalence test mocks only `execFileSync`, because the managed sandbox returns
  EPERM for ad-hoc fixture executables. Check that it cannot pass if either gatherer changes argv or
  assembly meaning.
- The health adapter preserves every non-ok `why` and appends structured pid/duration facts to
  refused/timed-out arms. Check the wording stays truthful when `exitObserved` is true or pid is
  null, and that no zero is presented as healthy.
