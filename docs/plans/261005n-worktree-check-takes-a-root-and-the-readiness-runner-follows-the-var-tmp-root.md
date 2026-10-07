# `worktree:check` takes a root, and the readiness runner follows the `/var/tmp` root

The Overseer's queue item `qi-k2jjejb2`, and the two limits
[261005l](261005l-worktree-tooling-learns-the-var-tmp-root.md) wrote into
[worktrees.md § Where a worktree's bytes live](../project/worktrees.md#where-a-worktrees-bytes-live)
rather than fixing.

## Stage 1 — the primary's copy of the check can judge another tree

**The defect.** The fleet dashboard removes a worktree in four steps. The third is
`npm run worktree:check` with the tree as its working directory, which runs the *tree's* copy of
the script with the *tree's* `tsx`. A tree under `/var/tmp/spideryarn-worktrees/` that never ran
`worktree:setup` has no `node_modules` and no ancestor to borrow one from, so the step dies with
`tsx: not found`. The tree is kept — a safe refusal — but it cannot be removed from the page.

`scripts/worktree-check.ts` cannot be pointed anywhere else: its `main()` takes the script's own
directory as the tree and exits 2 on any argument, on purpose, because silently ignoring
`-- ../other-tree` would look like it had checked the other tree.

**The fix.** `worktree:check` accepts `--root <dir>` and answers for that tree instead:

```
npm run worktree:check                       # inside the worktree — this one, as today
npm run worktree:check -- --root <dir>       # from the primary — that one
```

The judgement is unchanged: `gather(root)` was already root-relative, and `worktree:sweep` and
`worktree:remove` already call it from the primary's code against other trees. Only the CLI learns.

`--root` is refused (exit 2, "could not look") unless all of these hold, because each one is a way
to print SAFE about something other than the tree asked about:

- it is an absolute path to a directory that exists;
- it is the **top** of a git work tree — `git rev-parse --show-toplevel` there names the same real
  directory. A subdirectory is refused: `git status` would still report repo-relative paths, but
  the corpus comparison joins `data/` onto the root it was given, finds nothing there, and reports
  "matches the fixture" over a pipeline run;
- it belongs to **this** repository — the same shared git directory as the checkout the script is
  in. Another repository's tree would be judged against the wrong ignore verdicts;
- linked metadata comes from this repository's `worktrees/` registrations, and its backlink
  resolves to the target's own `.git` pointer.

The default invocation selects the script's own directory and applies these checks too. Any other
argument is still exit 2.

The dashboard's step 3 becomes the primary's `tsx` running the primary's
`scripts/worktree-check.ts --root <tree>`, the same shape step 4 already has for the remover.

**Passed over:**

- *Delete step 3; step 4's remover re-runs the same judgement.* Fewer parts, and true. But the
  page reports a read-only gate saying no differently from the removal failing, and the first
  three steps being read-only is what lets a refusal be shown without anything having been
  attempted. Worth asking again if the plan is ever reworked; not worth the churn for this.
- *Have the dashboard run `worktree:setup` in the tree first.* 680 MB and 20 seconds installed in
  order to delete them.
- *Make the check take its tree from the working directory*, as the remover does. Quieter to
  write, and it changes what `npm run worktree:check` means when run from a subdirectory. An
  explicit flag cannot be passed by accident.

**Tests, red first.**

- `tests/worktree-check.test.ts`, against real git in a temporary repository with a linked
  worktree: `--root` naming the linked tree resolves to it; a subdirectory of it, a relative path,
  a missing directory, a tree of a different repository, a missing value and an unknown flag are
  each refused; no arguments gives the script's own root.
- The same file, through the command's `runCheck` function: `--root` on a linked tree holding an
  uncommitted file returns exit 1 and names that tree and that file.
- `tests/fleet-actions.test.ts`: step 3's argv is the primary's `tsx` and script with `--root` and
  the tree's root. The other tests that find the step by `argv[2] === "worktree:check"` find it by
  the script path instead.

## Stage 2 — a new readiness runner tree goes where new trees go — NOT BUILT

**Dropped after the plan review; what follows is the plan as it was sent, kept so the next person
does not start from the same place.** Why is under *What GPT Sol's plan review changed*, below.

**The defect.** `scripts/readiness-loop.ts` makes its runner worktree at
`<primary>/.claude/worktrees/readiness-checks`, on the 49 GB `/home` disk the create hook was
written to stop filling. Low: it is one tree.

**The fix.** One function picks the directory by the hook's own rule
(`.claude/hooks/worktree-create.sh`): the in-repo path if a tree is already there; otherwise
`<external root>/readiness-checks` when the external root exists; otherwise the in-repo path. The
external root comes from `scripts/worktree-roots.ts`, which is the one list.

**What this does not do: move the tree that exists.** The box's runner is at the in-repo path now
and the loop is using it, so under the rule above it stays there. Moving it means stopping the
loop, removing that tree and letting the loop make the next one — an Overseer job for a quiet
moment, named in the debrief. Changing the constant alone would have been worse than nothing: the
loop would try to add a second tree on a branch the first still has checked out, and fail.

**Tests, red first** (`tests/readiness-loop.test.ts`): the three cases of the rule, with the
existence check passed in.

## What GPT Sol's plan review changed

[The review](261005n-worktree-check-takes-a-root-plan-review-sol.md). Five findings, each checked
against the code.

**Taken, in stage 1:**

- **An inherited `GIT_DIR` could pass every condition and still read another tree** (F1). A git
  hook runs with `GIT_DIR` set, and git obeys it over the directory it is run in — so the check
  took its branch, index and landed-or-not from the checkout the variable named, and its files
  from the tree asked about. Not new with `--root`: `worktree:sweep` and `worktree:remove` had it
  too. Every git call `gather` reaches now runs under `gitEnv()` (`tools/fleet/readiness-git.ts`),
  including `gitCommonDir` and `gitDir` in `scripts/worktree-port.ts`. Red first, with a control
  showing the poison works on a plain git call.
- **A copied `.git` pointer** (F2): `cp -r` of a worktree leaves a directory git calls the top of a
  work tree of this repository, while HEAD and the index are the original's. The readiness runner
  already had this check; it moved to `scripts/worktree-port.ts` § `worktreePointerProblem` and
  both use it. Red first.
- **The root handed to `gather` is the real path** (F3), since the listener scan compares it with
  `/proc/<pid>/cwd`. Already how the first cut was written; a symlink test now pins it.

**Stage 2 dropped** (F4, F5). The selector in the plan is three lines, and it is not the work:

- A fresh tree under the external root is set up by the loop with
  `npx tsx scripts/worktree-setup.ts`, which is exactly the command 261005l found failing where
  there is no `node_modules` above the tree. It would have to go through the bootstrap instead,
  and that path can only be proved by letting the loop make a tree.
- The loop reuses whatever directory is at its path and then fast-forwards it, without asking
  which branch it is on. That hole exists today — `EnterWorktree({name: "readiness-checks"})`
  before the loop first ran would produce it — and a second candidate path makes it easier to
  reach, not harder.
- And on this box nothing would change: the runner that exists stays where it is under any rule
  that does not break it.

So it is three changes to an unattended loop to move one tree that would not move. Creation and
branch validation can be tested in isolated repositories; moving the existing runner deliberately
requires stopping the live loop. Too much for "also low". What it needs is written
into `worktrees.md` beside the note that it was not followed, and it goes back to the Overseer.

**Not taken:** Sol preferred deleting step 3 outright, since the remover repeats the judgement and
both refusals reach the page as the plan having stopped. True, and still passed over for the reason
above — and because the queue item, which Greg said yes to, asks for the root.

## What GPT Sol's code review changed

[The review](261005n-worktree-check-takes-a-root-code-review-sol.md). It fixed three in place, each
read and kept, and reported a fourth.

- **No arguments skipped every check `--root` makes** (CR1): a tree run from inside, with a `.git`
  pointer borrowed from a landed sibling, printed SAFE. The default now goes through the same
  validation as a named root.
- **A `.git` *directory* was taken to be the primary's** (CR2), so a copied administration directory
  passed. The target's git directory must now be the shared one or sit under its `worktrees/`.
- A listener test assumed pid 1's working directory was `/` (CR3); it makes its own process now.
- **The remover still obeyed an inherited `GIT_DIR`** (CR4, reported as wider): the gates could pass
  for one tree and `worktree:remove` act on another. Fixed here after all, because it is three
  lines at the command's entry — the location variables are dropped before anything asks git —
  with a test through the real CLI, seen red. `worktree:sweep`'s own git calls are untouched: it
  finds trees by listing them from the primary rather than by where it stands.

## Done

Code review also applied the target checks to the default invocation: selecting the script's own
directory does not prove that its `.git` pointer still belongs to it. Linked metadata must live in
the repository's `worktrees/` registrations, so a copied administration directory presented as a
`.git` directory cannot bypass the backlink check's pointer-file branch. Both regressions returned
exit 0 before the fixes, then exit 2 afterwards. The listener test now uses a process with a known
outside cwd instead of assuming PID 1 is outside the tree.

Tests seen red then green, `npm test` and `npm run typecheck`, a GPT Sol code review, one commit.
**And run for real**: a tree made under `/var/tmp/spideryarn-worktrees/` and never set up — no
`node_modules` — was judged from another checkout with `--root`: SAFE and exit 0 clean, then
`DO NOT REMOVE` and exit 1 naming one untracked file put there. No reader sees any of this, so
there is no browser check.
