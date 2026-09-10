# Code review: Stage 2 of a job-launch bookkeeping module — the launchers

Repo: this worktree (`.claude/worktrees/launch-protocol`), branch `worktree-launch-protocol`.
TypeScript + ESM, `tsx`, vitest. Ordinary reliability engineering for an internal job scheduler:
a daemon keeps a journal of the jobs it starts; this stage makes each way of starting a job write
evidence files the daemon can find again after its own restart.

## This is a second attempt

Your first run stopped after five minutes ("Selected model is at capacity") having recorded one
finding, which is accepted and queued for the fix round, so do not spend time on it:

- **F20 (P1)** — closing a `run-claude` pane during its auth probe leaves no `exit.json`, because
  `probeAuth` calls `runChild` without the launch's `onHangup` and the SIGHUP is re-raised before
  the finaliser runs.

## The candidate

Committed: commit 3858a4a9 (one commit). `git show --stat 3858a4a9`.
Start with: `tools/overseer/launchers.ts`, `scripts/gjd-remote-launch.ts`, `scripts/launch-dir.ts`,
the `scripts/gjd-remote.ts` hunks, `scripts/run-claude.ts` / `run-codex.ts` hunks,
`scripts/subagent-cli.ts` (one approved change: SIGHUP handling in `runChild`), then
`tools/overseer/launch-artefacts.ts` and `launch-protocol.ts`, then the tests. The manifest in
`git show --stat` is the scope.

Another implementer is fixing Stage 1 findings in this worktree while you read, so working files
may differ. Review the committed bytes (`git show 3858a4a9:<path>`).

## What it is meant to do

The plan: `docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md`
— D6, the "Review dispositions" section (your plan review; F3, F5, F6, F9 and F13 apply here), the
paragraphs agreeing the seams with `scheduled-dispatch` and `gradual-recovery`, and the Stage 2
status paragraph, which lists the implementer's departures and the gaps it left. The properties to
check:

1. Each launcher carries the correlation id in its **first** external effect (tmux `new-session -e`
   at creation), never set afterwards.
2. The launched side writes `start.json` durably before the job's real work (for gjd-remote, before
   Claude, and a failed write means Claude does not start), and one final `exit.json` on every way
   the run can end.
3. The wrappers' existing behaviour is unchanged without `--launch-dir`: routing, auth, stdin,
   the sanitised environment, answer validation, console output, and `run-codex`'s credential
   fallback rules.
4. The prompt a launched job receives is exactly the pinned material: a private copy, re-hashed
   against `intent.json` immediately before the CLI is spawned.
5. Paths and ids crossing the shell, ssh and tmux layers are quoted, not merely validated.
6. Closing a wrapper's tmux pane no longer leaves its CLI child running, and still leaves an
   `exit.json`.

## What you can run

The tree is read-only for you; /tmp and node_modules caches are writable. Run the focused suites
yourself: `npx vitest run tests/overseer-launchers.test.ts tests/gjd-remote-launch-id.test.ts
tests/run-claude.test.ts tests/run-codex.test.ts`. The real-tmux tests may skip in your sandbox. No
network. My run: `docs/plans/260910f-launch-protocol-stage2-results.txt` (384 tests, exit 0;
typecheck exit 0). **No test may run the real `claude` or `codex` binary**: one early version of a
test did, because a new tmux session takes its PATH from the creating client. Check that none can.

**Write each finding to `/tmp/260910f-launch-protocol-stage2-review-sol-b-findings.md` as soon as
you have it**, then give the whole review as your final answer.

## What to check

Confirm each of the six properties against the code, and for each say whether the tests exercise it
(a test that would pass even if the code did nothing is a finding). Then check the gaps the status
paragraph admits: is each one named honestly, and is any of them worse than described?

For each finding: an ID (continue from F21), a severity, established (you ran it or can point at the
exact lines) or reasoned; (a) the test or input that shows it; (b) the smallest fix.

| | |
|---|---|
| **P0** | data loss, security, incorrect charging, or the service broadly unusable |
| **P1** | wrong behaviour a user could see, or a stated contract broken |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | comment or prose defect |

## My own questions — read last

1. `gjd-remote`'s launch lines are placed inside `cmdNewClaude`, which has no unit test; their
   placement is checked against the source text. Is the ordering actually right in the committed
   job script: `start.json` before the directory guard and before Claude, `exit.json` straight after
   `_gjd_claude_status=$?`?
2. The SIGHUP change in `runChild`: does anything other than SIGHUP behave differently now, and on a
   run without `--launch-dir`, is the re-raise still what it was?

Do not change any file in the repo.
