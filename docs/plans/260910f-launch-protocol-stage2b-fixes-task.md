# Stage 2b task: Sol's Stage 2 findings

Worktree `/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol`. Plan
`docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md` — read its
Stage 2 status paragraph and the paragraph under it about the first review run. Stage 2 is commit
3858a4a9; Stage 1b (9662df2f) came after it and changed `launch-protocol.ts` (no journalled
`artefactDir`, `launchingAt`, `resumeOccurrence`/`abandon`, `inspect`/`inFlight`, the per-class
hold). Read the current files before editing and undo none of it.

## The findings

First run: `docs/plans/260910f-launch-protocol-stage2-review-sol-findings-a.md`. Re-run:
`docs/plans/260910f-launch-protocol-stage2-review-sol-b.md` (and its `-findings.md`), once it lands —
this brief will list its findings below.

- **F20 (P1)** — closing a `run-claude` tmux pane during its **auth probe** leaves no `exit.json`:
  `probeAuth` calls `runChild` without the launch's `onHangup`, so `runChild` re-raises SIGHUP after
  killing the probe and the wrapper's finaliser never runs. Fix: pass the launch-aware hangup hook
  into the probe's `runChild` (an optional `onHangup` argument to `probeAuth`, given `launch?.hangup`).
  The record is `ending: not-run`, verdict failed, cause `hangup` — the probe is not the paid run.
  Red first with a real-tmux test on your disposable socket: a stand-in `claude` whose
  `auth status --json` blocks and records its pid; wait for that pid, kill the session, assert the
  probe pid is gone and `<attempt>/exit.json` exists with that ending and cause. The existing tmux
  test waits for the paid child, so it cannot see this branch. Check run-codex for the same shape
  (a pre-spawn child without the hook) and fix it the same way if it exists.

- **A read-only journal view for `scheduled-dispatch`** (not a finding; agreed): in
  `launch-protocol.ts`, `export type LaunchJournalView = Pick<LaunchJournal, "status" | "fold" |
  "attemptDir">`, and `LaunchProtocol` gains `readonly view: () => LaunchJournalView`, returning the
  same open store's methods (so its fold reflects every write). Update the test that pins the
  composed protocol's keys to nine, deliberately, and add one asserting the view object has exactly
  those three keys and no `append`/`writeMaterial`/`writeIntent`. Allowed file:
  `tools/overseer/launch-protocol.ts` and `tests/overseer-launch-protocol.test.ts`.

- **`RunSpec` gains a pinned `account`** (agreed with `scheduled-dispatch`, sent to the fixer
  mid-stage): `run-claude`'s `--account` takes a named handle only — no `auto` — and without it a
  `tmux-headless` session would run on the daemon's own account, since it inherits the creating
  client's environment. Dispatch policy is pool accounts only (`dispatch.ts`). So the scheduler picks
  a named pool account at plan time (it holds the per-account usage), `run.account` is pinned in
  `planned`/`intent.json` and in F5's conflict check, the adapters pass `--account <handle>`, and the
  session environment carries no `CLAUDE_CONFIG_DIR` or other account-routing variable of the
  daemon's. `run-claude` stays the authoritative check (unknown handle, wrong family, orchestrator,
  default `.claude` → a failed verdict in `exit.json`).
- **The `tmuxHeadlessLauncher` header comment** still says `--prompt-file <material.txt>`; the code
  passes the attempt-private `prompt.md`. Correct the comment.

### The re-run's findings (`260910f-launch-protocol-stage2-review-sol-b.md`, full record `…-sol-b-findings.md`)

**Do F22 first — before running any test that spawns a wrapper.**

- **F22 (P0, reasoned) — a test could still run the real `claude`/`codex`.** The tests put fake
  binaries on `PATH`, but the wrappers then call `loadRepoEnv()`, and a `.env.local` that assigns
  `PATH` would replace it unless `SPIDERYARN_ENV_PINNED` names `PATH`. The safety preflight in
  `tests/overseer-launchers.test.ts` (~711–714) runs before that reload, so it does not establish
  what the wrapper will resolve. (Today's `.env.local` sets no `PATH`, so nothing ran — the fix is
  to make that not a matter of luck.) Fix: every spawned wrapper's environment pins `PATH` (and any
  test-controlled account-routing variables) through `SPIDERYARN_ENV_PINNED`; the preflight resolves
  `claude`/`codex` through the same environment-loading path the wrapper uses. Test: a temp repo
  environment whose `.env.local` assigns a `PATH` without the fake, and assert the wrapper still
  resolves the fake (have the fake write a marker; assert the marker).
- **F21 (P1, established) — a failed `run-codex` leaves its answer in a temporary directory.** At
  ~`scripts/run-codex.ts:655-657` the launch record takes the attempt's temporary `outFile`, and the
  failure exits (~671-693) happen before the durable copy (~696-704), so `exit.json` names
  `/tmp/run-codex-…/output-N.txt` and `answer.md` is absent. Fix: on a launched run, copy the last
  attempt's output to the durable answer path and record that path before the failure ladder is
  evaluated. Tests: empty, invalid and non-zero outcomes each leave `answer.md` (possibly empty) and
  an `exit.json` naming it.
- **F23 (P1, established) — several post-start `gjd-remote` failures never write `exit.json`.** The
  job writes `start.json` early, but the only exit write is after Claude, so the directory guard,
  the missing-CLI check, account validation, the identity check and the "started" bookkeeping can
  all `failTo` out without it. Fix: install an `EXIT` trap in the job script immediately after the
  successful `start.json` write, which writes `exit.json` (ending `not-run` or `exited` with the
  script's status, verdict `null`) through the same durable helper; on the normal path write the
  explicit result after Claude and disable the trap before the later bookkeeping and `exec bash -l`.
  The pieces live in `scripts/gjd-remote-launch.ts`. Tests: the generated job, run under bash in a
  temp dir with an invalid directory and with no `claude` on PATH, leaves `start.json` **and**
  `exit.json`; the normal path writes exactly one `exit.json` (the trap does not overwrite it).
- **F24 (P2, established) — `run-codex`'s pane-close wiring is untested.** Removing
  `onHangup: launch?.hangup` at ~`run-codex.ts:523` leaves every test green. Fix: a direct
  wrapper-subprocess SIGHUP test with a fake child (no tmux needed), after F22's pinning; show it
  red by removing the hook, then restore.

## How to work

Red first for every finding. Files: `scripts/run-claude.ts`, `scripts/run-codex.ts`,
`scripts/launch-dir.ts`, `tools/overseer/launchers.ts`, `tools/overseer/launch-artefacts.ts`,
`scripts/gjd-remote-launch.ts`, and their tests. **`scripts/subagent-cli.ts` only within the
Overseer's approval** (SIGHUP handled as SIGTERM, plus the `onHangup` hook — nothing else in that
file). Small targeted edits; re-read each region before editing. Plain single Bash commands with
literal paths; a temp dir and your own tmux socket per test; **no test may run the real `claude` or
`codex`** — a new tmux session takes its PATH from the creating client, so put the stand-in on that
client's PATH and assert which `claude` resolves before launching. Focused suites only:
`npx vitest run tests/overseer-launchers.test.ts tests/gjd-remote-launch-id.test.ts
tests/run-claude.test.ts tests/run-codex.test.ts tests/overseer-launch-artefacts.test.ts
tests/fixture-ids.test.ts`; `npm run typecheck` by exit code. Do not commit.

## Report back

For each finding: the test, the red failure, the fix, green; final exit codes; any finding you
judged wrong, with evidence.
