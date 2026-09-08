# Cross-family code review: the Codex/GPT harness adapter, v1

You are reviewing **built code**, not a plan. Weight this higher than a plan-stage review: a plan
review cannot find a walk that returns the wrong process, or a capability table that declares
something false.

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter`
Branch: `worktree-harness-adapter`, off `dev`. **Read the repo directly** — the diff below is the
change, but the surrounding files are yours to open. In particular read `tools/overseer/work.ts` in
full (the sibling module this shares a process-table walk with) and
`tests/fixtures/overseer-process-trees/README.md` (what the captures do and do not cover).

## What this is

This box runs ~26 tmux panes, each holding an agent or a shell. A dashboard renders them as rows and
can, for Claude sessions only, put a keystroke into one. The stage's principle, written down before
the work started:

> One adapter per harness, and honest about what each can do. Claude, Codex and bare shells have
> genuinely different capabilities; flattening them into one 'message an agent' verb produces a UI
> that lies.

**v1 is honest recognition, not new control.** Nothing new becomes steerable. There is no launch
path and no way to type at a Codex. If you find code that would let a keystroke reach something new,
that is a P0 and I want to hear it loudly.

What was added:

- `tools/fleet/wire.ts` — `HarnessKind`, `Capability`, `HarnessCapabilities`. **Types only.** That
  file is compiled a second time by `tools/fleet/web/tsconfig.json`, a DOM-only project, so a
  `const` or an `import` there breaks the browser build. Verify I did not add either.
- `tools/overseer/harness.ts` — the `Harness` discriminated union (six arms), the
  `HARNESS_CAPABILITIES` table, `classifyPaneHarness`, `describeHarness`.
- `tools/overseer/work.ts` — three small changes: `WorkUnknownCause` renamed to `TreeReadFailure`
  with an alias kept, `resolveExecutable` exported, and the codex recogniser widened from `exec` to
  `exec|e|review`.
- `tools/fleet/steer.ts` — a header comment only. No code change.

## The measurement, because the design is supposed to follow it

`ps -eo pid=,ppid=,etimes=,args=` plus `tmux list-panes`, twice, on 2026-09-08:

| | 11:58 UTC | 12:15 UTC |
|---|---|---|
| panes | 22 | 26 |
| `claude-code` | 15 | 17 |
| `shell` | 7 | 6 |
| `codex-batch` | 0 | 1 |
| `codex-interactive` | 0 | 2 |
| `unknown` | 0 | 0 |

Also measured: `tpgid` equals the pane's own `pgid` on 21 of 22 panes, and **0 of 15 `claude`
processes has a process group of its own**. The 22nd is an interactive `bash -l`, where a foreground
child does get one — that is the positive control showing the reading works.

Also measured: at 11:58, **two of the three running `codex exec` processes had `ppid 1` on their
`npm exec`** — orphaned paid reviews belonging to no pane. Deliberately not fixed here.

## The claims I am making. Check each one; say so if a claim is wrong

1. **A Claude session running a Sol review is ONE session, not two.** The walk is breadth-first and
   the shallowest harness wins, so a real `codex exec` at depth 8 under a `claude` at depth 1
   classifies as `claude-code`. Is BFS actually what the code does? Is there an input where a deeper
   harness wins, or where the pane's own row is skipped?
2. **`unknown` is never reached silently.** Every arm of `HarnessUnknownCause` carries a distinct
   `why`, and an unrecognised pane never comes back as `shell`. Is there a path that returns `shell`
   for something that is not positively a shell — or an `unknown` whose `why` is empty or useless?
3. **The capability table cannot gain an arm without declaring itself.** `Record<HarnessKind, …>`
   plus an exhaustive `switch` with `never`. Is there a consumer that would silently accept a new
   arm? Is `capabilitiesOf` reading the record a hole in that argument?
4. **Exactly one kind can be steered with prose**, and it is `claude-code`. Nothing else in the diff
   grants a capability.
5. **One declaration per fact.** `TreeReadFailure` and `CODEX_BATCH_SUBCOMMAND` are shared between
   `work.ts` and `harness.ts` rather than written twice; `resolveExecutable` is reused so both halves
   of the fake-codex guard (never peel a shell, nothing under `/tmp` is an installed tool) apply to
   harness recognition for free. **This repo lost a morning to sixteen hand-written joins across one
   boundary, ten of them lossy.** Look hard for a seventeenth in this diff.
6. **Widening the codex recogniser to `exec|e|review` is safe and correct.** Evidence: `codex --help`
   on this box says `exec … [aliases: e]` and `review  Run a code review non-interactively`. Could
   this now match something that is not a paid batch run? `codex reviewer` and `codex export` are
   tested as non-matches.
7. **The `shell` label vs the harness label is informational only in v1.** A `bash -l` with a `codex`
   in the foreground classifies as `codex-interactive`, not `shell` — but every non-`claude-code`
   kind refuses steering, so nothing is typed at either. I claim this is safe *now* and becomes
   load-bearing the moment a later stage makes `codex-interactive` steerable. **Is that reasoning
   right?** If making the codex arm steerable later would let text reach a shell that has got its
   terminal back, say so — that is the trap I most want found.

## Things I already know and do not need told

- `work.ts`'s `claude --model x -p …` KNOWN GAP. Handled here by returning `ambiguous-harness`
  rather than guessing; deliberately narrower than work.ts.
- pid reuse is undetectable at this seam. Recorded in both module comments.
- No fixture of a long-lived `codex exec` that somebody waited 45 minutes for.
- `codex login` classifies as `codex-interactive`. Imprecise, harmless, commented.

## What I want

Ranked findings, most severe first. For each: the file and line, a concrete input or state that
produces a wrong output, and what you would do instead. **Include your verdict on each of the seven
claims above, including the ones you agree with** — an unstated agreement is indistinguishable from
an unread section. If you think the six-arm union is over-built for v1 and four would do, say so
plainly and say which two you would cut; I would rather hear that now than after it ships.

## The diff

The scoped diff was generated at review time and handed to the reviewer alongside this file; it is
not kept in the repo, because it goes stale the moment the branch moves and `git diff` reproduces it.
The reviewer also read the working tree directly, which is the instruction at the top.
