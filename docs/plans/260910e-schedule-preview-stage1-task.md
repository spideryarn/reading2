# Stage 1 task — the scheduler core (plan 260910e)

You are implementing Stage 1 of `docs/plans/260910e-schedule-preview-make-periodic-work-inspectable-before-launch.md`
in the worktree you are in (`/home/greg/code/spideryarn2/.claude/worktrees/schedule-preview`). Read that plan in full
first — § What already exists, § Decisions D2, D3, D3b, D4, D5, and § Stage 1 are your spec — and Sol's review beside
it (`docs/plans/260910e-schedule-preview-plan-review-sol.md`). Then read, in full, the code you will change:
`tools/overseer/jobs.ts`, `scheduler.ts`, `schedules.ts`, `standing-jobs.ts`, `rule-jobs.ts`, and in
`tools/overseer/daemon.ts` only the scheduler region (`schedulerStandingOf` near line 744, the checkpoint ticker near
771, the jobs ticker near 987), and `scripts/overseer.ts`'s `schedulerWiring` (~line 572). The comments in these files
are long and carry the reasons; keep their voice and density in what you write.

## What to build

1. **`tools/overseer/schedule-plan.ts`** — `planJobs(input, launch)`, pure given its inputs (plan § D2). It owns the
   gate order: history-lost → **duplicate-id preflight over the whole list, refusing every definition that shares an
   id before anything is planned** → per job: authorisation → `due()` → dry-run → spacing → dispatch. Document
   evidence for session jobs is an input (`ReadonlyMap<jobId, readonly DocumentReading[]>`, a reading being
   `{ path, sha256 }` or `{ path, why }`), never read inside it. `launch(job) → boolean` is injected; the in-loop spacing
   clock moves only on `true`. Export whatever per-job verdict type the preview (Stage 2) will need — next-due as an
   absolute instant where one exists — but build no preview file yet.
2. **`schedulerTick` refactored onto `planJobs`**: it keeps `sweep` first, resolves evidence via a new **required**
   `TickInput.readDocument(path)` for session jobs only, and its `launch` does the existing reserve → spawn → record
   dance and returns the real answer. The `SchedulerReport` union gains `dry-run` (and whatever duplicate-id arm you
   need); `describeReport` covers them. Behaviour for everything that is not new must not change: the existing
   `tests/overseer-jobs.test.ts`, `overseer-schedules.test.ts`, `overseer-rules.test.ts`, `overseer-daemon.test.ts`,
   `overseer-standing-jobs.test.ts`, `overseer-cli.test.ts` stay green with only mechanical edits (a new required field
   supplied). If an assertion has to change in meaning, stop and say why in your answer.
3. **`JobBehaviour.dispatch: { kind: "live" } | { kind: "dry-run"; why: string }`**, hashed: a `BEHAVIOUR_ENCODERS`
   entry. A dry-run job that is due reports `dry-run` and writes nothing to the ledger, never counts against spacing;
   `eligibilityOf` calls it ineligible. Rule jobs and the two standing jobs are `live`.
4. **Fresh evidence**: session-job documents are re-digested every tick (the tick) and the daemon's `StoredScheduler`
   headline is recomputed from the same fresh evidence on every checkpoint (`checkpointUpdate`), not once at start.
   Rule jobs keep their load-time digests. Correct the false claim in `standingJobs()`'s doc comment ("nothing
   dispatches the edited document either"). Wire `readDocument` through `schedulerWiring` → `DaemonOptions.jobs` →
   the tick; use `digestDocument` from `standing-jobs.ts`.
5. **D3b**: append to both `GET_READY_TO_DEPLOY_PROMPT` and `FEEDBACK_SWEEP_PROMPT` exactly: "This run is one
   occurrence of a schedule the Overseer owns: do not create a /loop, cron job, timer or any follow-up schedule." Update
   the comment that says the prompt is copied from the doc.
6. **`AuthorisedJob.authorisedDocuments: readonly JobDocument[]`** (full sha256), required. Standing jobs pin them as
   literals beside `AUTHORISED_HASHES`; rule jobs take their load-time digests. Add a test: for every shipped job,
   `behaviourHash({ ...behaviour, documents: authorisedDocuments }) === authorisedHash`, and a second assertion that
   altering one digest makes it unequal.
7. **The fixture job `schedule-fixture`**: `tools/overseer/schedule-fixture.md` (one short paragraph: this is the
   Overseer's harmless fixture job; reply with the single line `schedule fixture ran` and stop; do not read, edit, run
   or commit anything), a prompt pointing at it, `dispatch: dry-run` with a why, schedule every 24 h, lease 1 h, initial
   delay 2 h, added to `STANDING_JOB_SCHEDULES`, `STANDING_JOB_IDS`, the pins, and the shipped-job tests.
8. **Re-pin all four jobs** (`get-ready-to-deploy`, `feedback-sweep`, `wedged-work`, `launch-mode`) and pin the
   fixture. Each re-pin gets a dated comment in the house style saying exactly what moved (the `dispatch` field; for
   the two standing jobs also the D3b sentence) and that nothing else about the job changed.

## How

- **Tests first, red then green.** Write the duplicate-id test (zero spawns, every duplicate refused) and watch it go
  red on the current code before fixing. Same for the planner scenarios in plan § D2 that are new (startup, interval
  boundary, missed intervals, forward and backward time jump, already running) — those that already pass on the
  current `due()` are characterisation, say so in their comments.
- Put new planner tests in a new `tests/overseer-schedule-plan.test.ts`. **Do not copy a uuid from another test
  file** — `tests/fixture-ids.test.ts` fails if any uuid appears in two test files.
- Run the focused suites with `npx vitest run tests/overseer-*.test.ts tests/systemd-units.test.ts`, then
  `npm run typecheck` (judge it by its exit code — it writes ✗ to stderr and its last lines are always ✓; do not pipe it
  through `tail`), then `npx biome lint` on the files you touched. Do **not** run the full `npm test`; the manager runs
  it through tmux.
- **Do not commit** — the manager reads your diff and commits. Do not run any git command that changes state.
- Stay inside: `tools/overseer/{jobs,scheduler,schedules,standing-jobs,rule-jobs,schedule-plan}.ts`,
  `tools/overseer/schedule-fixture.md`, `tools/overseer/daemon.ts` (scheduler region only — another session owns its
  usage pass), `scripts/overseer.ts` (`schedulerWiring` only), `scripts/overseer-activate.ts` only if it no longer
  compiles, and `tests/overseer-*.test.ts`. Anything else: stop and report.
- Never restart or signal the running Overseer daemon or the fleet dashboard (port 8787), and never set
  `OVERSEER_JOBS_ENABLED` or `OVERSEER_RULES_ENABLED`.
- Use a scratchpad under `/tmp/claude-1000/-home-greg-code-spideryarn2/649e0f1c-7c49-4f44-80ad-314e4bce9858/scratchpad/stage1/`
  if you need one.

## Your answer

End with: the files changed; each test you saw red first and the command that showed it; the focused-suite and
typecheck results with exit codes; every existing assertion whose meaning you changed and why; the new pins, and
anything in the plan that turned out wrong or that you decided differently.
