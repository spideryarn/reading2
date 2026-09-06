# Review: a `claude -p` subagent wrapper, mirroring the existing `codex exec` one

Repo: `/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent` (a git
worktree of the spideryarn repo), branch `worktree-claude-cli-as-subagent`. TypeScript + ESM, run
with `tsx`, vitest for tests.

## The candidate

Live pre-commit: base `e78bfc0a388495adacd79fc1334ad474619480a2`
scoped paths: `scripts/run-codex.ts`, `docs/reusable/README.md`,
`docs/reusable/codex-cli-as-subagent.md`
untracked (new files — a pathspec cannot name these, read them directly):
`scripts/subagent-cli.ts`, `scripts/run-claude.ts`, `tests/run-claude.test.ts`,
`docs/reusable/claude-cli-as-subagent.md`

`git diff e78bfc0a -- scripts/run-codex.ts docs/reusable/` shows the modified half.
(Not durable — it named a tree rather than bytes. **It landed as `e8f00815`**, on `dev`; that
commit also carries the fixes for every finding this review returned, so what this review actually
saw is those paths before those fixes.)

Start with `scripts/run-claude.ts` and `docs/reusable/claude-cli-as-subagent.md`. That is where to
begin, not the limit of scope — the manifest above is.

## What it is meant to do

The repo already has `scripts/run-codex.ts`: a wrapper that lets a Claude Code session dispatch
`codex exec` safely (documented in `docs/reusable/codex-cli-as-subagent.md`). This change adds the
mirror image — `scripts/run-claude.ts`, driving `claude -p` — so that a Codex-primary run, a shell
script, a cron job, or the always-on Hetzner box can reach Opus with no Claude harness present.

Three parts:

1. **`scripts/subagent-cli.ts` (new)** — the machinery both wrappers share, *moved out of*
   `run-codex.ts` unchanged except for renames: the spawn (fd 0 closed, process-group watchdog,
   64 MiB capture cap), the name-based environment denylist, the bounded answer read and the
   middle-truncating formatter, `answerIsUsable`, `loadRepoEnv`. `runCodex` → `runChild` (binary
   now required, and a new optional `cwd`); `childEnv` → `sanitisedEnv(parent, passThrough, drop)`.
   `run-codex.ts` keeps its old exported signatures as thin adapters so
   `tests/run-codex.test.ts` (69 tests) is unchanged and green.

2. **`scripts/run-claude.ts` (new)** — the Claude wrapper. Access profiles `read-only` / `review`
   (default) / `write`; `--auth subscription|env`; the answer parsed out of a
   `--output-format stream-json` transcript that is captured to a file rather than printed.

3. **`docs/reusable/claude-cli-as-subagent.md` (new)** — the doc, in the house style: intent,
   measured facts, and why a design went one way rather than the obvious other way.

The invariants that matter:

- **Nothing but the answer and a short status may reach the caller's stdout.** The transcript
  (every tool call and its full result) goes to a file. This is the whole reason the wrapper exists,
  and it fails silently — a leak looks like a working run.
- **A run that produced no verdict must not be reported as success**, and must be distinguishable
  from a run that produced an empty one.
- **The child environment is deny-by-default on the variable's name**, plus exactly the credential
  `--auth` asked for, minus the calling Claude session's own plumbing.
- **`run-codex.ts` behaviour is unchanged.** The extraction is meant to be a pure move.

Deliberately out of scope: any automatic credential fallback for Claude (the codex wrapper has one;
no equivalent failure has been observed here), and `--stream` (rejected — there is no separate
final-message file to fall back on, so streaming would give up the answer capture too).

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You can run one test file
(`npx vitest run tests/run-claude.test.ts`, `npx vitest run tests/run-codex.test.ts`) and a script
(`node --import tsx <script>`), and you can build a throwaway harness under `/tmp`. You have **no
network, not even loopback**, so anything that would call the real `claude` or `codex` binary will
fail — those runs are mine, and their results are quoted in the doc and in the source comments.

Both test files pass here: 69 (codex) and 28 (claude). `npm run typecheck` is clean.

## Attack it

Independently, before you read my questions below.

The invariant to break: **make `run-claude.ts` report a success that isn't one, or leak into the
caller's context, or spend the wrong credential** — and, separately, **find any behaviour of
`run-codex.ts` that the extraction changed**.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) what shows it fails its own claim — the input or mutation I can run, or the exact reachable
        source path, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — a code block, or exact replacement wording
A finding with no (a) goes last.

Severity by consequence: **P0** data loss, exploitable security, incorrect charging, or the thing
broadly unusable; **P1** user-visible wrong behaviour or an authoritative contract violated; **P2**
design or maintainability risk with no wrong behaviour today; **P3** non-behavioural prose or
comment defect. A defect in the *doc* that will cause a P1 to ship is not a P3 because it is made
of prose.

Refuse only on an **established** P0 or P1 — direct evidence with no unresolved material inference —
and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- The extraction: `sanitisedEnv` gained a third `drop` list and `runChild` gained `cwd`. Did I
  change the meaning of `childEnv` for codex callers, or lose the `env` default that `runCodex`
  used to apply?
- `parseResultEvent` scans the NDJSON backwards for `type: "result"`. Is there a real stream in
  which that finds the wrong event, or in which a legitimate result line is skipped?
- The failure ladder in `main()`: `parsed?.isError` is checked before the exit status, so an
  informative subtype wins over a bare `exited 1`. Is there an ordering in which that hides
  something the caller needed — a spawn failure, a timeout, a signal?
- `--access write` does not pass `--restricted` (so the project's own hooks still apply) and does
  pass `--allowed-tools Bash`. Is that combination weaker than I think in a way the doc does not
  admit?
- The doc claims `--permission-prompts none` + a tool allowlist is a *real* boundary while saying
  it is not an OS sandbox. Is any sentence in that doc stronger than the measurement behind it?
