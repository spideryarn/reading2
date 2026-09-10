# Tests pinned to one account environment, and `sanitisedEnv` drop wins

The defect slice of
[260909g](260909g-several-claude-subscriptions-on-the-box-and-a-fleet-that-spreads-across-them.md).
Dispatched by the Overseer on 2026-09-10 as session `pool-env-tests` (a successor; the first stalled
before it made a worktree).

## Why

Since 260909g every session the Overseer dispatches runs with `CLAUDE_CONFIG_DIR` set to a pool
account's directory. The `codex-accounts` session measured two suites that fail for exactly those
sessions and pass for everyone else, and each one presents as "I broke this file":

- `tests/run-claude.test.ts`: 11 end-to-end tests. `run-claude.ts` routes whenever the variable is
  present at all, and the fake `claude` cannot answer the routed auth probe.
- `tests/gjd-remote-account.test.ts`: 1 test. It asserts the shell's `CLAUDE_CONFIG_DIR` reads
  `unset` after the job, but the shell inherited the runner's before the job started.

**The rule this slice installs: a test decides the account environment its child sees; the runner
does not.**

A second defect sat in the same place. `sanitisedEnv(parent, passThrough, drop)` re-added every
`passThrough` name after applying `drop`, so a name on both lists crossed to the child. That means
`--pass-env` quietly defeats a drop list.

## Stages

### Stage 1 — sweep, read-only, then Sol

- [x] Reproduce both named reds under `CLAUDE_CONFIG_DIR=/home/greg/.claude-gregmindstone`: 12
  failed, 55 passed. With it unset, all 67 pass.
- [ ] A/B over every candidate file, meaning any file that spawns, mentions one of the six
  variables, or imports an account-routing module: 141 files. A = all six unset; B = all six set.
- [ ] The list, each entry with the mutation that shows it.
- [ ] Sol review of the list.

_Status:_ in progress.

### Stage 2 — the tests stop depending on the runner

- [x] `tests/helpers/account-neutral-env.ts`: `accountNeutralEnv(overrides)`, meaning
  `process.env` minus the six named variables, plus whatever the test sets on purpose.
- [x] Both named files use it. Red first: 12 failed under the pool environment (above). Green:
  67/67 with all six set, and 67/67 with all six unset.
- [ ] Every other file the sweep names.

### Stage 3 — `sanitisedEnv`: drop wins, and the caller is told

- [x] Red: `tests/subagent-cli-sanitised-env.test.ts`. 3 of 5 failed before the change; the two
  that passed are the controls (an absent name is not reported; the denylist re-add still works).
- [x] `sanitisedEnv` gets an optional fourth argument, `onOverruled(names)`. It is called once with
  the names that were on both lists and present in the parent. By default it writes a WARNING line
  to stderr naming the variables, never their values, so a caller who passes nothing is still told.

### Stage 4 — `claudeEnv`: what a routed child may be handed

The brief's premise needed one correction, which the Overseer accepted. `claudeEnv` puts every
`ANTHROPIC_*` name in `drop` and relies on `passThrough` winning. That is how `--auth env` gets
`ANTHROPIC_API_KEY` back, and how `--pass-env ANTHROPIC_BASE_URL` and `CLAUDE_CODE_USE_BEDROCK`
work. So a blanket "drop wins" on its own would silently break all three.

The Overseer authorised the split below in `scripts/run-claude.ts`, on condition that it does not
change what `run-claude` routes on:

- **Restorable drops.** The `ANTHROPIC_*` prefix, `CLAUDE_CODE_USE_*` and the parent-session
  plumbing. These leave `drop` when the caller passes them, so an unrouted run behaves exactly as it
  did before.
- **Absolute drops.** These apply only when routed. Every `CLAUDE_*` name, plus the three credential
  variables (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`). The Overseer's
  words: *"a routed child can never receive CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_AUTH_TOKEN however
  it is asked."*

- [x] Red: a routed child with `--auth env`, or with `--pass-env CLAUDE_CODE_OAUTH_TOKEN`, receives
  the parent's token. Two new tests in `run-claude.test.ts` § account routing, both red before the
  change (`expected 'oauth-of-another-account' to be undefined`).
- [x] Green, with the two existing restorable-name tests unchanged. The six suites that reach
  `subagent-cli` pass, 222/222, and typecheck is clean.
- [ ] Sol review.

A routed run with `--auth env` now reaches the child with no credential. The probe then reports the
claude.ai login, and `authConflict` refuses it with its message about unapproved API keys. So the
run is refused loudly, but for a reason that names the wrong cause. A refusal in `parseArgs` that
says "a routed run takes its account from its state directory" would be clearer. That belongs to
`run-claude.ts`'s owner and is not done here.

**Done in-session rather than by Codex**, because it is about twenty lines and the design was
settled before any code was written.

### Stage 5 — the guard

_To be decided after the sweep._

## Which stages Codex implemented

_Filled in as they land._
