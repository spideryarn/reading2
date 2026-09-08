# Code review: stop `worktree:check` crying wolf on `logs/`

You are reviewing finished code, not a plan. Work in
`/home/greg/code/spideryarn2/.claude/worktrees/worktree-check-false-alarms`.

## What to read, in this order

1. `docs/plans/260908b-stop-worktree-check-crying-wolf-on-logs.md` — the plan, with the measurements.
2. `scripts/worktree-check.ts` — the file changed. Read the **whole** file including its header
   comment; the design intent (fail closed, read-only, never writes) is load-bearing and predates me.
3. `tests/worktree-check.test.ts` — the tests changed.
4. `docs/project/worktrees.md` § "Before you remove one" and the new
   § "`ExitWorktree` refuses for two reasons that are not about your work".
5. `scripts/worktree-sweep.ts` — the only other caller of `blockers(gather(path))`.
6. The scoped diff: `/tmp/claude-1000/-home-greg-code-spideryarn2/41af5333-4b48-4b90-accf-2ccf803b77f5/scratchpad/wcfa-diff.txt`
   (or `git diff` in the worktree — the plan doc is untracked, so read it from disk).

## The problem

`npm run worktree:check` answers *would deleting this directory lose anything?* and fails closed on
every unknown. `/logs/` was added to `.gitignore` three hours after the check first landed and nobody
gave it a verdict, so from that afternoon **every worktree in which a job had been run refused to be
removed** — 13 of the box's 19 trees, measured 2026-09-08 — at a directory holding nothing but the
stdout of a command you could run again. Greg's report:

> I keep asking an agent to remove the worktree when it says it has pushed everything, and it seems
> to trigger some sort of check that says it's not safe to do so, which the agent then inspects and
> decides is a false alarm.

Nothing was ever lost to it. What it cost was the standing of the refusal.

## What changed

1. A new `"logs"` `IgnoredVerdict`. `logStrays()` walks `logs/` and treats top-level subtrees in
   `TRANSIENT_LOG_SUBTREES` (`tmux-jobs`, `dev-server`) as disposable, reporting everything else by
   name. Necessary because `git status --ignored=matching` collapses a wholly-ignored directory into
   the single entry `logs/`, so no `DISPOSABLE_IGNORED` prefix could ever name a subtree of it.
2. `onlyStaleLines()` narrows the `.env.local` "differs" blocker: if every meaningful line of this
   copy is also in the primary's, nothing in it exists only here, and it prints as verified.
   `COPIED_FROM_PRIMARY` became a record with a `lines: boolean`, so
   `.claude/settings.local.json` (JSON) keeps blocking.
3. A test reading the repo's own `.gitignore`, failing if a literal directory in it has no verdict
   and is not in `BLOCKS_ON_PURPOSE`.
4. Docs.

## What I most want you to attack

**This change loosens a safety guard. The failure mode has no error message: printing SAFE over the
top of work nobody has a second copy of.** Be adversarial about that specifically.

1. **Can `logStrays` be made to miss something?** Symlinks, a path git quotes because of an odd
   character, `logs` being a symlink itself, a race with a peer writing into the tree mid-walk, case
   sensitivity, an empty directory, permissions (EACCES) — `gather()`'s caller in `worktree-sweep.ts`
   catches a throw and calls the tree unjudgeable, but `worktree-check.ts`'s own `main()` does not.
   Is an unreadable `logs/` reported as safe?
2. **Is `dev-server` safe to allowlist?** Unlike `tmux-jobs` it has no writer anywhere in the repo —
   I found it only as an ad-hoc shell redirect in the primary. Argue it either way.
3. **Is the line-subset claim actually sound?** "Every meaningful line of A is in B ⟹ deleting A
   loses nothing" — find the counterexample if there is one. Consider multi-line values, a `KEY=` the
   worktree *removed*, duplicate keys, trailing-whitespace normalisation (I `trim()` each line),
   `export ` prefixes, CRLF, and a file that is not really line-oriented despite the flag.
4. **Does anything leak a secret?** `.env.local` contents must never reach stdout or a return value.
   Check `onlyStaleLines`, `differsFromPrimary`, and the `diff` command string that is now printed.
5. **The `.gitignore` coupling test** — does it actually fail on the case it claims? Does it silently
   skip more than it should (globs, negations, nested `.gitignore` files elsewhere in the repo)? Is
   there a way to add an ignore rule that the test passes and the check then blocks on for ever?
6. **The blocker count.** `f.unexplained.length` is printed as "N ignored paths". I folded the `diff`
   hint into the same string for that reason. Did I miss another place where a hint inflates a count?
7. Anything in the docs or the plan that overstates what was measured.

## Evidence

`npm run worktree:sweep` before and after (the plan doc has the table). Every new test was watched
red first: the three real-worktree cases against the unfixed code, the exact-segment test against a
`startsWith` version, and the `.gitignore` test against a fake `/new-cache-dir/` line.

## Answer format

Findings ordered by severity, each with: the file and line, the concrete input or state that triggers
it, what goes wrong, and how sure you are. Say plainly if you think a change should be reverted.
**Also state your verdict on the conclusion itself** — is "recognise more, fail closed on the rest"
the right response to this class of false alarm, or have I talked myself into loosening a guard that
was correct as it stood? If you think the whole framing is wrong, say so first.
