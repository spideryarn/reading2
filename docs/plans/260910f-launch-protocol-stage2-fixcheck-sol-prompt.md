# Narrow check: three P1 fixes in a job-launch module's launchers

Repo: this worktree (`.claude/worktrees/launch-protocol`). TypeScript + ESM, vitest.

**This is a narrow check of three fixes, not a new review.** Discovery is closed. Look only at
whether each fix closes its finding, and whether the fix broke something next to it. Please do not
report anything unrelated.

Your findings: `docs/plans/260910f-launch-protocol-stage2-review-sol-findings-a.md` (F20) and
`docs/plans/260910f-launch-protocol-stage2-review-sol-b.md` (F21, F23). The fixes are in commit
e3bcace3 (`git show e3bcace3`), which also holds other agreed changes you need not check:

- **F20** — closing a `run-claude` pane during its auth probe now writes `exit.json` (`not-run`,
  cause `hangup`): `probeAuth` takes an `onHangup`, given `launch?.hangupBeforeRun`
  (`scripts/launch-dir.ts`).
- **F21** — a failed launched `run-codex` copies the last attempt's output to the durable answer path
  before its failure ladder.
- **F23** — `scripts/gjd-remote-launch.ts`: `launchStartLines` arms an `EXIT` trap after the durable
  start write; `launchExitLines` writes the real record and disarms it.

For each: closed, or open with the input that still reproduces it. Point at exact lines, or run the
regression test named in the commit (`npx vitest run tests/run-claude.test.ts
tests/run-codex.test.ts tests/gjd-remote-launch-id.test.ts` — tmux and nested-process tests may be
refused by your sandbox; my run of all of them is at `docs/plans/260910f-launch-protocol-stage2b-results.txt`).

The tree is read-only for you. No test may run the real `claude` or `codex`. Write verdicts to
`/tmp/260910f-launch-protocol-stage2-fixcheck-sol-findings.md` as you go, then give them as your
final answer: one line per fix.

Do not change any file in the repo.
