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
- [x] A/B over every candidate file, meaning any file that spawns (`child_process`, `spawn`,
  `exec*`), mentions one of the six variables, or imports an account-routing module (`run-claude`,
  `run-codex`, `gjd-remote*`, `claude-accounts`, `subagent-cli`, `tmux-job`,
  `tools/overseer/{accounts,codex-usage}`). That is 141 files. A = all six unset. B = all six set to
  pool values: `CLAUDE_CONFIG_DIR=/home/greg/.claude-gregmindstone`, an empty `CODEX_HOME`, and
  dummy tokens and keys.
- [x] The list, each entry with the mutation that shows it:

  | file | unset | set | why |
  |---|---|---|---|
  | `tests/run-claude.test.ts` | 48/48 | 37/48 | 11 end-to-end tests spawn `run-claude.ts` with `...process.env`; it routes on the variable, and the fake `claude` cannot pass the routed probe |
  | `tests/gjd-remote-account.test.ts` | 19/19 | 18/19 | the bash shell inherits `CLAUDE_CONFIG_DIR`, so `after=unset` is false before the job ever runs |
  | *every other candidate* (139 files) | pass | pass | A and B are identical: 141 files and 4,771 tests in each, 0 failed, the same 21 skipped. The only differences are the two tests added to `run-claude.test.ts` between the runs |

  **Read with this caveat.** B read the working tree, and both named files had already been fixed
  when it started, so B's green says nothing about them. Their rows come from the reproduction at
  the top of this stage. B started before the stage 5 guard existed, so for every other file it is
  an unguarded measurement.

  **What the sweep cannot see.** A test outside the 141 that reaches one of the six in-process,
  through a module it imports transitively. The stage 5 guard covers that case whether or not
  anyone finds it.
- [x] Sol review of the list: `260910d-review-sol-sweep.md`. Sol did not reject the two-file
  finding, but showed that the sweep did not establish it repo-wide:

  | ID | Finding | Disposition |
  |---|---|---|
  | F1 (P1, established) | `.env.local` beats the inherited environment, so A and B never actually varied `CODEX_API_KEY` or `OPENAI_API_KEY` | Accepted. The repo-wide R2 below pins both with `SPIDERYARN_ENV_PINNED`. That governs the worker's own load. The lanes overwrite the pin after it, so a `tsx` child that reloads `.env.local` still gets the repo's values; that is the same for every runner, so it is not this class |
  | F2 (P1, established scope gap) | The filter is textual and lists only files that match directly: 141 of 793 `.test.ts` files, and no `.test.tsx`. `declared-spend.test.ts` reaches `ANTHROPIC_API_KEY` transitively (24/24 either way) | Accepted. Replaced by the repo-wide A/B below |
  | F3 (P2, reasoned) | Two of the 64 presence combinations are not independence. It misses one-hot cases, cancellation between variables, and empty versus absent | Recorded as a limit. No finite sweep proves value-independence; the guard is what closes the class |
  | F4 (P3, separate class) | `fleet-transcript.test.ts` returns silently without asserting when `$HOME` has no transcript over 2 MB | Out of scope, since this is `$HOME`, not account routing. Raised in the debrief |

- [ ] **Repo-wide A/B** (F1 and F2). The whole suite, twice, under the pool environment. R1 uses the
  normal config, with the guard; it is also the stage gate. R2 uses a copy of the config without
  the guard's delete line, with the two keys pinned.

_Status:_ on the 141 candidates, the list is two files, both the ones already named and both fixed
in stage 2. That does not establish it repo-wide until the A/B above has run.

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
- [x] Sol review (write-capable) of 56511857: `260910d-code-review-sol-stages-3-4.md`. No P0 or
  P1. The prompt was `260910d-review-prompt-stages-3-4.md`.

  | ID | Finding | Disposition |
  |---|---|---|
  | F1 (P2) | Unrouted `claudeEnv` now puts a restored name in a different position in the child's environment | **Overruled.** The names and values are identical to before, and nothing reads an environment by position. Sol's fix deleted and re-appended keys to keep the old order: eight lines to preserve something that is not a contract. Reverted, along with the test that pinned the order; a comment at the call says why |
  | F2 (P2) | A name inherited from `Object.prototype` (`toString`) was reported as overruled | Kept: `Object.hasOwn` |
  | F3 (P2) | A routed run with `--auth env`, or with `--pass-env <credential>`, was refused for the wrong reason | Kept. `parseArgs` now refuses both up front, saying a routed run takes its account from its state directory. It tests the existing routing condition, `--account` or `CLAUDE_CONFIG_DIR` present, and does not change it. `parseArgs` takes `env` so tests can pass one. **This widens `run-claude.ts` beyond the split the Overseer authorised**, and the debrief says so |
  | F4 (P3) | The routed boundary was under-tested: a future `CLAUDE_*` name, `CLAUDECODE`, and routed restoration of a non-credential `ANTHROPIC_*` | Kept: tests added |
  | F5 (P3) | Nothing tested that several overruled names are reported together | Kept: tests added |

  After the review, the seven suites that reach this code pass 230/230 under the pool environment.
  Typecheck and lint are clean.

**Done in-session rather than by Codex**, because it is about twenty lines and the design was
settled before any code was written.

### Stage 5 — the guard

**Chosen: `vitest.config.ts` deletes the six account-routing variables when the config loads**,
before any worker or child process exists. The Overseer authorised it, since the file was outside
this slice's set. It follows the precedent of the readiness-token delete in the same file, and
the names come from `ACCOUNT_ROUTING_VARIABLES` in the helper, so there is one list.
`tests/account-neutral-env.test.ts` asserts from inside a worker that none of the six arrived.

**What it cannot see**, which is also written beside the delete in `vitest.config.ts`:

- A routing variable that is not on the list.
- A child that re-reads a login shell's profile (`bash -l`).
- `.env.local`. Setup files load it over the inherited environment, so its `OPENAI_API_KEY` and
  `CODEX_API_KEY` reappear in workers. Those values are the same for every runner, so they are not
  this class, but they are not absent either. The in-worker test exempts exactly the names
  `.env.local` defines.

The in-worker test cannot fail on a runner that carries none of the six. It is meaningful on
exactly the runs where the class bites.

**The option passed over: a static scan of test files for `{ ...process.env` in spawn options.** It
is cheaper to reason about, but it cannot see a spawn with no `env:` at all, which inherits
implicitly, or an environment built in a helper.

**Mutation check.** The Overseer's condition was that the guard be shown to be *what makes* the
suite runner-independent, not a second thing that happens to pass. The two originally-red files
are now fixed by the helper, so removing the guard alone could not show that. The check therefore
ran the **unfixed** originals, copied from `1209bc70`, with all six variables set to pool values:

| config | result |
|---|---|
| with the delete | 70/70 passed: both unfixed originals and the guard test |
| a copy of the config with the delete line removed | 13 failed: all 12 original reds, plus the guard test (`expected [ 'CLAUDE_CONFIG_DIR', …(3) ] to deeply equal []`) |

The temporary copies were deleted afterwards.

- [x] Delete, comment and in-worker test.
- [x] Mutation check (above).

## Which stages Codex implemented

_Filled in as they land._
