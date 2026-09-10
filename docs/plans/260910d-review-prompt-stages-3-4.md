# Review: sanitisedEnv's drop list now beats --pass-env, and a routed Claude child cannot be handed a credential

Repo: /home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests, branch worktree-pool-env-tests.
TypeScript, ESM, run with tsx; tests are vitest.

## The candidate

Committed: commit 56511857 (one commit on top of 1209bc70)
           git show 56511857
           changed paths: `git show --name-only 56511857` (7 files)

Start with: `scripts/subagent-cli.ts` § `sanitisedEnv`, `scripts/run-claude.ts` § `claudeEnv`,
`tests/subagent-cli-sanitised-env.test.ts`, and the two new tests in `tests/run-claude.test.ts`
§ "account routing". The plan is
`docs/plans/260910d-tests-pinned-to-one-account-environment-and-sanitisedenv-drop-wins.md`. That is
where to begin, not the limit — the manifest is. The two test-environment edits in the same commit
(`tests/helpers/account-neutral-env.ts`, `gjd-remote-account.test.ts`, the spawn envs in
`run-claude.test.ts`) are in scope too.

## What it is meant to do

1. `sanitisedEnv(parent, passThrough, drop, onOverruled?)`: a name on both `passThrough` and `drop`
   is withheld from the child, and `onOverruled` is called once with those names, but only names the
   parent actually has. The default callback writes a WARNING to stderr naming the variables and
   never their values. Everything else is unchanged: the secret-name denylist, and passThrough
   re-adding a secret that only the denylist took.
2. `claudeEnv(parent, auth, passThrough, stateDir?, onOverruled?)`:
   - **Unrouted** (`stateDir` undefined): must behave exactly as before for every input. Every drop
     is restorable, because a name that is asked for (via `--pass-env`, or via `--auth env` for the
     three credentials) is left out of `drop`.
   - **Routed**: the three credential variables (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
     `CLAUDE_CODE_OAUTH_TOKEN`) and every `CLAUDE_*` / `CLAUDECODE` name are absolute. They are
     withheld however they are asked for, and the child's `CLAUDE_CONFIG_DIR` is the state
     directory.
   - What `run-claude` routes on (`--account`, or `CLAUDE_CONFIG_DIR` being present) must not
     change.
3. The test helper `accountNeutralEnv` strips six named variables from a spawned child's
   environment, so a test's answer does not depend on which account the runner is on.

The only callers of `sanitisedEnv` are `claudeEnv` and `run-codex.ts` § `childEnv`. The latter
passes no `drop`, so it should see no change. Confirm that for yourself.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside the stage under review, each finding red-first with
the test that reproduces it. Leave everything wider as a finding for me to decide. Do not commit.
List every file you changed at the end.

You can run single test files, e.g. `npx vitest run tests/run-claude.test.ts`, and
`npm run typecheck`. My raw green run of the six suites that reach `subagent-cli` (222/222) is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/0c8bc732-c1dc-4675-af27-495ff3e523b6/scratchpad/green1.log`.
The reds from before the change are described in the plan.

Do not touch `scripts/run-codex.ts`, `scripts/gjd-remote.ts`, `scripts/claude-accounts.ts`,
`tools/overseer/`, or `tools/fleet/`.

## Attack it

Independently, before you read my suspicions below. The claims to break:
(i) there is an input on which an unrouted `claudeEnv` now returns a different environment from
`1209bc70`'s;
(ii) there is a way to ask that gets a credential into a routed child's environment;
(iii) `onOverruled` is silent when something the caller asked for was withheld, or it leaks a value.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the input or mutation I can run that shows it fails its own claim
  - (b) the smallest change that closes it
A finding with no (a) goes last.

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
- A routed run with `--auth env` now reaches the probe with no credential, and `authConflict`
  refuses it with a message about unapproved API keys. The run is refused loudly, but for a reason
  that names the wrong cause. The plan leaves this to run-claude's owner. Is that wrong enough to
  matter?
- The routed absolute list includes `CLAUDE_CODE_USE_BEDROCK` via the `CLAUDE_*` sweep, so a routed
  run can no longer be sent to Bedrock with `--pass-env`. I think that is right, because
  `routedAccountConflict` demands firstParty anyway.
