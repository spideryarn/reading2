# Real process trees, for the Overseer's work classifier

Captured from this box's own process table on **2026-09-08, 06:20–06:45 UTC**, with

```
ps -eo pid=,ppid=,etimes=,args=
```

Each file is one **subtree**: the pane process itself on the first line, then every descendant, in
the order a depth-first walk found them. Every field is verbatim — the only edit is the trim to one
subtree. Columns are `pid ppid etimes args`, where `etimes` is whole seconds of elapsed time; that
is what `parseProcessTable` turns into an absolute start time, and it is why these files do not go
stale the way a fixture full of wall-clock timestamps would.

**Why real ones.** A hand-written fixture agrees with whatever its author imagined. The single most
important number in this whole stage — that a `codex exec` sits **eight levels below the pane** —
is one nobody would have guessed, and a plausible invented fixture would have put it at two or
three and the classifier would have been built to find it there.

## The files

| file | pane pid | what it is |
|---|---|---|
| `codex-review-under-pane.txt` | `3184904` | **CONTROL.** A Claude session with a **real, paid `codex exec`** running under it. Captured during a deliberate one-word review run, so the tree is the genuine `run-codex.ts` chain rather than a reconstruction. |
| `headless-claude-under-pane.txt` | `3184904` | **CONTROL.** The same pane during a **real `npx tsx scripts/run-claude.ts` run** — `claude --print` at the bottom of an identical chain. |
| `quiet-claude-pane.txt` | `652780` | A Claude session doing nothing but hold two MCP servers open. The `no-child-work` baseline. |
| `browser-pane.txt` | `430640` | A Claude session with a whole headless Chrome under it — 20 processes, none of them a job anyone is waiting on. |
| `shell-pane-running-tests.txt` | `1234211` | **CONTROL.** A **`shell`-kind** pane running the suite under `scripts/tmux-job.ts`. Real, and 21 minutes into a run when captured. |
| `orphan-fake-codex.txt` | — | The two rows of the `/tmp/fake-codex-*/codex` test harness, **reparented to init** (`ppid 1`) since 2026-09-01. Not a subtree; it exists to be pasted onto another file. |
| `codex-batch-pane.txt` | `94316` | **CONTROL.** A pane that *is* a paid `codex exec` — `tmux-job.ts` running `run-codex.ts` directly, rather than an agent dispatching one. Captured ~12:15 UTC, 258 s into a real `gpt-5.6-sol --effort high` review. |
| `codex-interactive-pane.txt` | `4108994` | **CONTROL.** A `bash -l` pane with a **bare interactive `codex`** TUI in it, 718 s old. The only capture of an interactive Codex this repo has. |

### The last two were captured seventeen minutes after a measurement said they did not exist

At ~11:58 UTC on 2026-09-08 this box had **22 panes, 15 `claude-code`, 7 `shell`, and no Codex pane of
any kind** — the harness stage's first measurement, and it was recorded as the finding that a Codex
process here is always a *child of a Claude session* or an orphan, never a fleet row. At ~12:15 UTC
there were 26 panes, one `codex-batch` and two `codex-interactive`, all three genuine.

Nothing was wrong with the first reading. **The fleet is a moving tree, and "there are none" is a
reading rather than a property** — the same lesson `work.ts` records about a single `WorkReading`,
one level up. Both numbers are in the plan doc, both with their timestamps, and neither is presented
as the state of the box.

## Three of these are POSITIVE CONTROLS, and that is their job

`codex-review-under-pane.txt`, `shell-pane-running-tests.txt` and `headless-claude-under-pane.txt`
are not ordinary coverage. **They exist so that a future zero means "there was none" rather than "we
stopped finding any."**

The number this module produces is allowed to be nought — on a quiet fleet, `no-child-work`
everywhere is the correct answer, and it was the answer measured over 927 session-rows on the day
these were captured. The difficulty is that a zero from a working instrument and a zero from a
broken one are the same number, and after any refactor the second is the likelier: a regex that
stopped matching, a walk that stopped descending. Almost every other test in
`tests/overseer-work.test.ts` asserts an *absence*, so almost all of them would pass a classifier
that had quietly stopped detecting anything at all.

These three are the ones that would not. Each holds real, running, paid-for work — a genuine
`codex exec`, a genuine 21-minute suite, a genuine `claude --print` — and the `POSITIVE CONTROL`
block in the test file asserts each is still found, with a fourth test checking that **every**
recogniser has one, so the table cannot grow an entry that no capture stands behind.

If one of them goes stale, **re-capture it; do not relax the assertion.** Weakening a control leaves
the number looking the same and meaning nothing. There is a third control that needs no fixture:
`probeProcessTable` refuses any reading that does not contain its own pid, on every call.

## What the capture proves

- **A `codex exec` pane's codex is at depth 5, not 8.** `codex-batch-pane` is
  `sh -c ( npx tsx run-codex.ts … )` → `npm exec` → `sh -c 'tsx'` → `node …/.bin/tsx` →
  `node --require …preflight.cjs` → `codex exec`. Three levels shorter than the dispatched case
  below, because there is no `timeout` wrapper and no Bash-tool `bash -c` above it. Same tool, same
  wrapper script, two different depths on one box on one morning — which is the depth lesson stated
  twice rather than once.
- **An interactive `codex` is at depth 1 and has NO subcommand at all**: `bash -l` → `codex`. That is
  the whole of the command line. So an interactive Codex cannot be told from a batch one by anything
  except the subcommand, which is why `CODEX_BATCH_SUBCOMMAND` is anchored and shared.
- **Codex spawns a helper of its own**, `…/releases/0.153.4-…/bin/codex-code-mode-host`, under both
  the batch and the interactive one. Anything walking below a matched harness would find it and have
  to decide what it was; nothing does, because a match is never descended into.
- **A dispatched `codex exec` is at depth 8.** pane → `claude` → the Bash tool's `/bin/bash -c
  source …snapshot…` → `timeout` → `npm exec` → `sh -c 'tsx'` → `node …/.bin/tsx` → `node
  --require …/preflight.cjs` → `codex exec`. `claude --print` sits at exactly the same depth
  through the same chain.
- **The depth is not a constant, and that is the actual lesson.** Measured again later the same
  morning: **7** for a `codex exec` dispatched without the `timeout` wrapper, **5** for a plain
  `npx vitest run`, **3** for a suite under `scripts/tmux-job.ts`. Every wrapper an agent happens to
  type adds a level, so the only safe rule is to walk the whole tree — a limit tuned to 8 would have
  been tuned to one person's typing habits.
- **Five processes in that chain carry the words `run-codex.ts`, and exactly one carries `codex
  exec`.** A recogniser that matched the wrapper would count one review five times.
- **The pane can be older than its Claude.** `quiet-claude-pane` has a pane 115341 s old holding a
  `claude` only 75741 s old — the pane outlived a previous conversation. So pane age is not session
  age, and `panePid` is a handle rather than a history.
- **One pane holds several concurrent Bash-tool children.** `codex-review-under-pane` has three at
  once, two of them running `sleep`. So "is there a bash under this pane" says nothing at all.
- **The `sh -c 'tsx'` and `npm exec` shims are everywhere.** Any recogniser that matches on argv[0]
  has to look through the `node …/.bin/<tool>` shim, and must not look through a shell.

## What these fixtures do NOT cover

Stated because absence is invisible, and a test that uses only these will look thorough while never
touching the branches below.

- **No `codex exec` that anybody was actually waiting 15–45 minutes for.** Both model runs here
  were one-word probes that finished in seconds. The trees are identical in shape, but nothing here
  exercises a long-lived job, and nothing here can show what a *second* reading of the same job
  looks like.
- **No two jobs under one pane, and no nested job.** Every capture has zero or one. So the
  non-empty-tuple `jobs` type, the deterministic ordering, and the "stop descending at a match" rule
  are all tested from **constructed** tables built by hand in `tests/overseer-work.test.ts`, and
  every such case says `(constructed)` in its name.
- **No cycle, no duplicate pid, no unparseable line, and no negative `etimes`.** The kernel produces
  none of these. They can only reach the classifier from a store, a replay, or a merge of two
  readings, so those tests are constructed too.
- **No failed probe.** `ps` did not fail once. The probe's failure arms are exercised against
  `definitely-not-ps`, `/bin/true` (exit 0, no output) and `/bin/false` instead — real binaries, but
  not real failures of `ps`.
- **Only three of the recognisers' many possible command lines.** There is exactly one real example
  of each of `codex exec`, `claude --print` and `vitest run`. `vitest --watch`, a bare interactive
  `codex`, and `claude` wearing `--print` inside its prompt are all constructed.
- **One box, one user, one moment.** Every pid, every path and both `gjd-remote/jobs/*.sh` pane
  commands are this machine's. Nothing here would survive being pointed at a different box, and it
  should not be edited to look as if it would.

## What was surprising

- **The fake-codex harness is orphaned, not under a pane.** It was launched by
  `tests/run-codex.test.ts` on 2026-09-01 and has been reparented to init ever since, so at the
  moment of capture it belonged to no session at all. That is luck rather than design: a test run
  now would put one under whichever pane ran `npm test`. Both guards in `work.ts` — shells are never
  peeled, and nothing under `/tmp` is an installed tool — exist because of it.
- Its command line is `bash /tmp/fake-codex-qAz9Um/codex -o /tmp/run-codex-gc.txt` — **no `exec`
  subcommand at all**, so requiring the subcommand would have excluded it on its own.
- **`etimes` disagrees with what the dashboard thinks a session's age is**, and should: it measures
  the pane process, and `gjd-remote` reuses panes.
- The chain is long enough that a session dispatching a review has **eight processes** attributable
  to one wait. Nothing about that is visible from the pane.

## Re-capturing

Take the whole table with the command at the top of this file, then cut one subtree per file,
keeping the pane row first. Do not reorder or reflow the lines: the leading whitespace is `ps`'s own
right-alignment and the parser is deliberately tested against it. If you re-capture, re-derive the
pane pids in the table above — they are this boot's, and they mean nothing after a reboot.
