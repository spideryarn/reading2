# Stage 2 task — the preview file and the CLI (plan 260910e)

You are implementing Stage 2 of `docs/plans/260910e-schedule-preview-make-periodic-work-inspectable-before-launch.md`
in the worktree you are in (`/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview`). Read the plan's § D1, D6,
D7 and § Stage 2, then read Stage 1's code, which you build on and must not re-derive: `tools/overseer/schedule-plan.ts`
(`planJobs`, `JobPlan`, `resolveEvidence`), `tools/overseer/jobs.ts`, `scheduler.ts` (`eligibilityOf`,
`schedulerStandingOf`), `standing-jobs.ts`, `rule-jobs.ts`, `schedules.ts`, `arming.ts`, the scheduler region of
`tools/overseer/daemon.ts` (the checkpoint ticker, `checkpointUpdate`, the jobs ticker), `scripts/overseer.ts`
(`schedulerWiring`, the `run` and `status` cases), `tools/overseer/status-cli.ts` (`statusLines`), and
`tools/fleet/zones.ts` (`zonedLine`). Keep the house comment voice.

## What to build

1. **Wire types**, appended as one block at the end of `tools/fleet/wire.ts` (types only, no runtime values, no
   imports — that file's rule). A `SchedulePreview` with `schema: 1`, `writtenAt`, `instanceId`, `listRevision`,
   `capabilities: { session: boolean; rules: boolean }`, `arming` (armed at / the reason there is none), `history`
   (intact / lost + why), `headline` (the `StoredScheduler` kinds + why), `missedRunPolicy`, a `caveat` sentence
   (as of `writtenAt`; rows after a proposed launch assume it succeeded), and `jobs: SchedulePreviewJob[]`. Each job:
   `jobId`, `resourceClass` (`claude-session` | `in-process-rule`), `dispatch` (live | dry-run + why), `verdict`
   (the `JobPlan` kinds, each with its sentence; `nextDueAt` / `firstEligibleAt` absolute UTC ISO where one exists, or
   an explicit `after-in-flight-settles` / `none` arm — never a null standing for two things), `lastAttempt` (never, or
   the newest occurrence for the job: its state, `reservedAt`, the settle instant, the outcome — and a sentence that a
   session job's `finished` is the `gjd-remote` launcher exiting, not the session), `schedule` (everyMs, launcher lease,
   initialDelayMs), `sessionTimeout: "not built"`, `sessionNoOverlap: "not enforced"`, `prompt` (the `what`),
   `behaviourHash` and `authorisedHash`, and `documents` (path, pinned sha256, current reading, changed yes/no).
   Discriminated unions throughout (`strict` + `noUncheckedIndexedAccess` are on; no bag of optionals).
2. **`tools/fleet/schedule-parse.ts`** — a browser-safe leaf (NO node imports; `zones.ts` is the precedent) with
   `parseSchedulePreview(json: unknown)` → `{ kind: "preview"; preview }` | `{ kind: "unsupported-schema"; schema }` |
   `{ kind: "unreadable"; why }`. A job verdict or state kind it does not know becomes that row's own `unreadable` arm,
   never a throw and never another kind. Instants are range-checked (fleet-dashboard-modes.md § Absence is stated: a
   finiteness check does not catch `1e300`). This one parser is used by the CLI (below), the fleet route and the
   browser (Stage 3).
3. **`tools/overseer/schedule-preview.ts`** —
   - `schedulePreview(input) → SchedulePreview`, **pure**: runs `planJobs` with a `launch` that answers `true` for a
     live session job and `false` otherwise, and turns each `JobPlan` into a row. Nothing about the gates is decided
     here — if a row needs a fact the plan does not carry, add it to `JobPlan` rather than re-reading the ledger.
   - `listRevision(definitions)` — a short hash over each job's id, `authorisedHash`, schedule fields and dispatch
     mode, in definition order. Test that each of those moving moves it, and that a document edit does NOT (documents
     are the per-tick check's business).
   - `MISSED_RUN_POLICY = "one-run"` with the sentence, and a test that holds it against `planJobs` (three days down on
     a 3h job → one dispatch plan, then held).
   - `writeSchedulePreview(storeDir, preview)` (temp + rename, like `arming.ts`'s write) and
     `readSchedulePreviewFile(storeDir)` → absent | the parser's result | unreadable. File name `schedule.json`.
   - `schedulePreviewLines(read, checkout: { listRevision } , nowMs)` → string[] for the CLI: one headline line, then
     per job its verdict, next due via `zonedLine` (London first), last attempt, dispatch mode, prompt revision
     (hash vs pin, and each changed document with both digests), and a line comparing the daemon's `listRevision` with
     the checkout's (*"the running daemon holds list abc; this checkout builds def — a restart loads it"*). An absent
     file says the running daemon predates this build and writes no preview.
4. **The daemon writes it.** `DaemonOptions` gains `preview?: { definitions; readDocument; capabilities; listRevision }`
   — absent means *this daemon was given no job list*, and the reader says so. On every checkpoint tick (the ticker that
   calls `store.checkpoint(checkpointUpdate())`), after the checkpoint: resolve evidence, run `schedulePreview` with the
   in-memory `store.occurrences` / `store.occurrenceHistory`, the arming, the fresh headline, and write the file. A
   write failure is logged once when it starts failing and once when it recovers, not every 30 s, and never stops the
   daemon. Do not touch the usage pass or anything outside the scheduler/checkpoint region.
5. **`schedulerWiring` always returns a `preview`** (the full definitions — standing + rules — with `readDocument`, the
   capabilities this arming holds, and the `listRevision`), and the `run` case passes it to `runOverseer`. It is never
   something the daemon can dispatch from.
6. **`overseer status`** prints `schedulePreviewLines` as a `schedule` block after the output of `statusLines` (in the
   `status` case of `scripts/overseer.ts`, building the checkout's list with `standingJobs(repoRoot())` +
   `ruleJobs(...)` for the revision comparison).

## How

- Tests first where behaviour is new; a new `tests/overseer-schedule-preview.test.ts` and `tests/fleet-schedule-parse.test.ts`.
  Cover: each verdict kind becoming a row; a changed document shown with both digests; `lastAttempt` for never /
  finished / refused / unknown / in flight; `listRevision`; the file round-trip through the real parser; an unknown
  verdict kind and an unknown schema; a daemon test (in `tests/overseer-daemon.test.ts`'s style, disposable store, fake
  timers as that file does) proving a daemon started with the scheduler OFF writes `schedule.json` with the jobs in it
  and dispatches nothing; the CLI block with and without the file. **Do not copy a uuid from another test file**
  (`tests/fixture-ids.test.ts`).
- Run `npx vitest run tests/overseer-*.test.ts tests/fleet-schedule-parse.test.ts tests/fleet-imports.test.ts tests/fleet-compile-guards.test.ts tests/fixture-ids.test.ts`,
  then `npm run typecheck` judged by exit code (never piped through `tail`), then `npx biome lint` on touched files.
  Not the full `npm test`.
- **Do not commit**; no git command that changes state.
- Stay inside: `tools/fleet/wire.ts` (append only), `tools/fleet/schedule-parse.ts`,
  `tools/overseer/schedule-preview.ts`, `tools/overseer/schedule-plan.ts` (only to carry a fact a row needs),
  `tools/overseer/daemon.ts` (scheduler/checkpoint region), `scripts/overseer.ts` (`schedulerWiring`, `run`, `status`),
  and their tests. Anything else: stop and report.
- Never restart or signal the running Overseer daemon or the fleet dashboard (8787); never set
  `OVERSEER_JOBS_ENABLED` / `OVERSEER_RULES_ENABLED`; tests use `OVERSEER_STORE_DIR`-style disposable directories,
  never `~/.overseer`.
- Scratch: `/tmp/claude-1000/-home-greg-code-spideryarn2/649e0f1c-7c49-4f44-80ad-314e4bce9858/scratchpad/stage2/`.

## Your answer

The files changed; each test seen red first and the command; the suite and typecheck results with exit codes; any
existing assertion whose meaning changed; a sample of `overseer status`'s new block run against a disposable store with
the scheduler off; and anything you decided differently from this task.
