# Review: does this sweep support "only these two test files depend on the runner's account"?

Repo: /home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests, branch worktree-pool-env-tests.
TypeScript, ESM, vitest.

## The candidate

This is a method and a conclusion, not code. Read it in
`docs/plans/260910d-tests-pinned-to-one-account-environment-and-sanitisedenv-drop-wins.md`
§ Stage 1: the table, and the two paragraphs under it. The fixes built on it are in the same plan,
stages 2 and 5; you need not review them here.

The scripts and raw output are in the scratchpad. That location is not durable: I will copy
anything load-bearing into the plan.

- `/tmp/claude-1000/-home-greg-code-spideryarn2/0c8bc732-c1dc-4675-af27-495ff3e523b6/scratchpad/candidates.sh`
  builds the candidate list, and `candidates.txt` is its output (141 files).
- `…/scratchpad/sweep-ab.sh` runs A and then B.
- `…/scratchpad/sweep-A.json` and `sweep-B.json` are vitest's JSON reports.
- `…/scratchpad/compare-ab.mjs` does the comparison.

## What it is meant to show

The conclusion: under the six variables `CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CODEX_API_KEY` and `OPENAI_API_KEY`, no test file
in the repo changes its answer, except `tests/run-claude.test.ts` and
`tests/gjd-remote-account.test.ts`.

The brief asked for "a repo-wide sweep for tests that spawn a shell, a launcher or
run-claude/run-codex without pinning the account-routing variables".

## What you can and cannot run

The tree is read-only. You can run single test files, grep, and read the JSON. Do not run the full
suite.

## Attack it

Name a test file whose answer depends on one of the six but which this method would miss, or would
report as independent. Ways it could miss one:

- A file outside the candidate filter.
- A value choice under B that doesn't trigger the dependence. For example, an empty `CODEX_HOME`,
  or a dummy key that fails a shape check before it could matter.
- A dependence that shows only in combination with one variable unset.
- Skips that differ in meaning between the two runs.
- `.env.local` overriding the inherited values in-process: setup files call `loadEnvLocal()`, and
  it wins over the inherited environment.
- A spawned child that reads `$HOME/.codex` or `$HOME/.claude` when the variable is absent. That is
  an environment dependence of a different kind; say whether it belongs to this class.

For each finding give an ID (F1, …), a severity (P0–P3), whether it is established or reasoned,
(a) the concrete file and variable value that shows it, and (b) the smallest addition to the sweep
that would catch it. Refuse the conclusion only on an established case.

## My own suspicions — read last

These are already my doubts. Confirming them is worth less than anything you find yourself.

- The filter is textual. A test that reaches `tools/fleet` code which spawns `claude` itself would
  not match it.
- B set all six at once. A test that passes because two of them cancel out would hide.

Do not change any file.
