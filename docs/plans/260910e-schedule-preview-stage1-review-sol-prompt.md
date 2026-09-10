# Review: Schedule preview Stage 1 — one planner for tick and preview, fresh document evidence, dry-run

Repo: /home/greg/code/spideryarn2/.claude/worktrees/schedule-preview, branch worktree-schedule-preview. TypeScript,
ESM, run with tsx; tests are vitest. This is the Overseer daemon's scheduler on the Hetzner box — it is OFF
(`OVERSEER_JOBS_ENABLED` unset) and this stage must keep it launching nothing.

## The candidate

Committed: commit 18f64a04 (one commit)
            git diff 18f64a04^ 18f64a04
            changed paths: git show --stat --format= 18f64a04   (17 files)

Start with: tools/overseer/schedule-plan.ts (new), tools/overseer/scheduler.ts (schedulerTick refactored onto it),
tools/overseer/daemon.ts (scheduler region: the headline per checkpoint, the tick's readDocument), and
tools/overseer/standing-jobs.ts (pins, prompts, fixture). This is where to begin, not the limit of scope.

## What it is meant to do

The plan is docs/plans/260910e-schedule-preview-make-periodic-work-inspectable-before-launch.md — § Decisions D2, D3,
D3b, D4, D5 and § Stage 1. Your plan review of it is docs/plans/260910e-schedule-preview-plan-review-sol.md; all eight
findings were accepted. In short:

- `planJobs` owns the whole gate order (history lost → duplicate-id preflight over the whole list → per job:
  authorisation → due → dry-run → spacing → dispatch) and is pure given its inputs; `launch` is injected and the
  spacing clock moves only on `true`. `schedulerTick` keeps only the sweep and side effects, and its behaviour must be
  unchanged except where intended.
- Session jobs are authorised against their documents digested THIS tick; rule jobs against load-time digests. The
  daemon's `StoredScheduler` headline is recomputed from the same reading on every checkpoint.
- `JobBehaviour.dispatch` (live | dry-run) is hashed. A due dry-run job reports `dry-run`, reserves nothing, writes
  nothing, never moves spacing, and cannot earn `ARMED` nor stop activation.
- Duplicate ids: every definition sharing an id refused, zero spawns.
- `authorisedDocuments` pins exist only for diagnosis; the behaviour hash stays the sole gate.
- Both session prompts forbid the session creating its own recurrence.

Invariants it must not break: nothing is dispatched whose behaviour — including the documents as they are now, for a
session job — does not hash to its pin; an unreadable or unsupplied reading refuses; nothing launches with the
scheduler off; the ledger never records an attempt that did not happen.

Deliberately out of scope (later stages): the preview file and CLI block (Stage 2), the browser (Stage 3), the race
between the tick's digest and the session reading the document (the Scheduled-dispatch stage).

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside the stage under review — each finding red-first, with the test that
reproduces it — and leave everything wider as a finding for me to decide. Do not commit. List every file you changed at
the end. Do not run the full `npm test`; run focused files, e.g.
`npx vitest run tests/overseer-schedule-plan.test.ts tests/overseer-jobs.test.ts tests/overseer-schedules.test.ts tests/overseer-rules.test.ts tests/overseer-standing-jobs.test.ts tests/overseer-daemon.test.ts tests/overseer-cli.test.ts`,
and `npm run typecheck` (judge by exit code). Never start, signal or reconfigure a running daemon or the fleet
dashboard, and never set OVERSEER_JOBS_ENABLED / OVERSEER_RULES_ENABLED. My raw focused-suite run (9 files, 318 tests,
exit 0) is logs/tmux-jobs/sp-s1-focused-1340-2534435.log in this worktree; typecheck exited 0.

## Attack it

Independently, before you read my questions below. The invariant to break: **find any input — a definition list, a
ledger state, a document edit, a clock, a failing append — under which the refactored tick dispatches something the
old tick would not have (other than the intended duplicate fix), or dispatches a session job whose current documents do
not hash to its pin, or records something for a dry-run job.** Hand me the call sites, not only the functions: who
builds `DocumentEvidence`, and does every path that can reach `launch` get fresh evidence?

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) what shows it fails its own claim — the input or mutation I can run
  - (b) the smallest change that closes it — a code block, or exact replacement wording
A finding with no (a) goes last.

Severity: P0 data loss, exploitable security, incorrect charging, or broadly unusable; P1 user-visible wrong behaviour
or an authoritative contract violated; P2 design/maintainability risk with no wrong behaviour today; P3 prose/comment.
Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. `evidenceAsBuilt` is used by `schedulerWiring` and the activation preflight — is anything that can reach a real
   launch fed evidence-as-built instead of a fresh reading?
2. The headline is recomputed per checkpoint by reading documents on the checkpoint timer as well as the jobs timer —
   can the two readings disagree in a way that shows `ARMED` over a refusal, or the reverse?
3. The dry-run `why` is inside the hash, so rewording it costs a re-pin. Acceptable, or should only the kind be hashed?
4. `waiting.nextDueAt` is `now + remainingMs`; is it the absolute `last + everyMs` under a backward clock jump, as
   the plan claims?
5. The rule jobs' `authorisedDocuments` come from their load-time digests, which makes the pins-agree test for rules
   a restatement of the pin-is-current test. Is that a hole?
