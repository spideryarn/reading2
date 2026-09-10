# Stage B task: the scheduler through the launch protocol

You are implementing Stage B of `docs/plans/260910f-scheduled-dispatch-one-durable-occurrence-one-reconciled-launch.md`
in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/scheduled-dispatch`.

Read the whole plan first. Its section **"Review dispositions — Sol, plan round 1"** overrides D1–D8
wherever they differ, and so does the fix-check beside it (`…-plan-fixcheck-sol.md`), if present.
Then read the launch protocol as merged from dev: `tools/overseer/launch-protocol.ts`,
`launch-store.ts`, `launch-admission.ts`, `launch-artefacts.ts`, `launchers.ts`, and its plan
`docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md`. Also read
`tools/overseer/launch-gate.ts`.

## What this stage is for

A live session job starts through `launchOccurrence` and nothing else. Its history is the launch
journal, projected into the planner. Its material is pinned. Its run spec is authorised. And
`occurrences.json` has a real source.

## The pieces, and the files

1. **`tools/overseer/jobs.ts`**
   - `JobWork`'s session arm becomes `{ kind: "session"; run: RunSpec }`, hashed by `behaviourHash`.
   - A new `Occurrence` arm, `launch`, projected from a schedule-origin `LaunchRecord`.
   - The `LastRun` arms `launch-open` and `launch-resumable` (dispositions F1 and M2).
   - `due()`'s `due` arm gains `dueAt`.
   - `lastRunOf` uses `endedAt` (F4). `lastSessionLaunchOf` uses the first attempt's `launchingAt` and
     skips attempt-less occurrences (F3).
   - Exhaustive switches everywhere.
2. **`tools/overseer/launch-occurrences.ts`** (new)
   - `launchOccurrencesOf(fold, sessionJobIds)` returns the `launch` arm per schedule-origin record.
     Carried entries go in too: an attributable one as held under its job, an unattributable one
     holding every session job (F2).
   - `observedOf(record, artefacts)` returns the Stage A `ObservedLaunch`, with `tmuxSession` = the
     current attempt's correlation id (M6) and `answer` carrying sha256 from `exit.json`.
   - The launch journal's history standing, for the planner (F2).
2b. **Fable's P2 and P3 on F1 (in the plan's dispositions) are binding here.**
   - **P2:** the `resume` verdict is decided **before `due()`**. Only the pin, dry-run, spacing and
     usage gates apply to it, not the clock.
   - **P3:** one comparator (`reservedAt`, then index order) is used by `lastRunOf`,
     `newestAttemptOf` and the resume candidate. `launchOccurrencesOf` preserves fold order.
   - A superseded sibling is `abandon`ed before the new revision is planned, and a refused `abandon`
     plans nothing.
3. **`tools/overseer/schedule-plan.ts`**
   - `PlanInput.history` per kind (F2).
   - The `resume` verdict (F1).
   - `usage-held` from a `LaunchGate` value, after spacing, for live session jobs (M5).
4. **`tools/overseer/scheduler.ts`**
   - `TickInput.launch?: Pick<LaunchProtocol, "launchOccurrence" | "resumeOccurrence" | "abandon" | "view">`.
     This is the whole capability the scheduler holds. `view()` returns the read-only
     `LaunchJournalView` (`status`, `fold`, `attemptDir`) over the same open store. The fold read
     through it feeds `launchOccurrencesOf` and the history standing. Each attempt's exit.json is read
     with `readArtefacts(view().attemptDir(id, attempt), correlationId)`. `AttemptRef` has no
     `artefactDir` since the protocol's Stage 1b.
   - The session arm calls that capability's `launchOccurrence` (or `resumeOccurrence` / `abandon`). It uses the
     existing origin for `resume`, and otherwise `scheduleOrigin({ jobId, scheduledAt: dueAt,
     behaviourHash })`, `launcherKind: "tmux-headless"`, the job's `run` and the pinned material.
   - `materialOf` (D3) reads every document once, re-hashes it against this tick's authorised
     digest, and refuses on a mismatch.
   - Every `LaunchOutcome` arm becomes a report. `invoked` is never "completed".
   - Delete `TickInput.spawn` and the events.jsonl session path.
5. **`tools/overseer/dispatch.ts`**: delete `gjdRemoteDispatch` and its helpers, and keep
   `jobsEnabled` / `JOBS_ENABLED_VAR`. Update `tests/overseer-dispatch*` as appropriate.
6. **`scripts/overseer.ts`** (`schedulerWiring`, with no spawn) and **`scripts/overseer-activate.ts`**
   (F6: a warning when the result is disarmed, and blocking on arm).
7. **`tools/overseer/standing-jobs.ts`**
   - The fixture gets `run: { timeoutMinutes: 5, access: "read-only" }`, and **re-pin the fixture
     only**.
   - `get-ready-to-deploy` and `feedback-sweep` get proposed run specs in their definitions
     (`{ timeoutMinutes: 180, access: "write" }` and `{ timeoutMinutes: 120, access: "write" }`), and
     their pins are **not** updated. They must read NOT AUTHORISED, and every test that asserted them
     authorised must now assert the refusal, with the reason.
8. **`tools/overseer/schedule-preview.ts`**, **`tools/fleet/schedule-parse.ts`**, the wire block's
   `SchedulePreview*` types, and **`web/src/SchedulePreview.tsx`**
   - The new verdicts (`resume`, `usage-held`) and the new attempt arm (`launch`).
   - The `sessionTimeout` / `sessionNoOverlap` literals become the run spec's minutes and
     `"enforced"`.
   - The preview merges the same launch index the tick does, with the same function.
9. The protocol's no-production-caller allow-list gains `scheduler.ts`, and still asserts that
   nothing but the composition calls an adapter.

## Red first (each test watched red, then green)

- A restart after invocation and before receipt, then ten ticks: exactly one launcher invocation.
- A restart after `planned`, and a `waiting` followed by free capacity: each invokes exactly once,
  with the same origin (F1).
- A moved hash while one occurrence waits: the old one is superseded and never launched.
- `outcome-unknown` holds its job through a due instant.
- A day of downtime gives one launch.
- A material/digest race refuses.
- A delayed admission, then a restart: spacing counts from `launchingAt` (F3).
- A terminal event plus a release six hours later: cadence counts from `endedAt` (F4).
- Each ledger corrupted independently holds only its own kind (F2). A carried unattributable entry
  holds every session job.
- `invoked` is never `succeeded`.
- A moved run spec re-pins.
- Activation with stale live pins: warns when disarmed, blocks on arm (F6).

## How to work

- Write like the surrounding files.
- Use a temp dir per test, and never `~/.overseer`.
- Keep your own tmux socket, if any, under the temp dir.
- Run the focused suites (every `tests/overseer-*` file you touch or that imports what you change;
  grep for them). Then `npm run typecheck` (the exit code, both streams), then `npx biome lint
  <files>`.
- Do not commit, do not run the full suite, and do not start or stop the real daemon or the
  dashboard.
- `daemon.ts` is Stage C's, not yours.

## Report back

Files changed, the red-first counts, exact results with exit codes, and every departure.
