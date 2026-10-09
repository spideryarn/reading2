# Worktree removal on macOS, and an automatic sweep

> Okay, if you're sure that the worktrees have been successfully finished and merged into dev, then
> you have my permission now and going forwards to remove them, and we should update the script to
> do that automatically.
>
> And if there are sessions either on this laptop or on remote that are still running and have
> finished and successfully finished and pushed and we definitely don't need them anymore and you're
> confident, then it's okay to kill them even if they still have a process running as long as you're
> pretty sure that it's not something valuable.
>
> — Greg, 2026-10-09

**Status:** built, 2026-10-09; plan review and code review by GPT Sol (links below). Not yet run
against the real worktrees on the Mac — the read-only `npm run worktree:sweep` was, and it saw the
live `claude` in `mcp-spike` through `lsof`.

## The two problems

1. **`npm run worktree:remove` refuses every live tree on the Mac.** `liveness()` in
   `scripts/worktree-remove.ts` asks `scripts/worktree-inuse.ts`, which reads `/proc`; the Mac has
   none, so every answer is `unknown`, and an unknown refuses. Tonight's hand clean-up found what
   `/proc` would have found, with `lsof`: orphaned `npm run dev`/vite and a `script`/tsx job, five
   weeks old, cwd inside the tree.
2. **Removal is one tree at a time, by hand.** `worktree:sweep` classifies and deletes nothing;
   `worktree:remove` takes one branch and has no bulk form, so each removal re-earns its verdict.

## What changes

### A. A macOS path for the two liveness signals

Same two vetoes, same three-valued composition (`composeInUse`, unchanged), different source.
The Linux `/proc` path is untouched.

One snapshot, three reads, in this order:

1. `ps -A -ww -o pid=,ppid=,pgid=,uid=,stat=,command=` — the process table.
2. `lsof -n -P -w -d cwd -F pn` — every process's cwd that lsof can read. Measured on this Mac
   tonight: 1 s, exit 0, 876 of 878 same-uid processes listed; the two missing were a `<defunct>`
   zombie and one that exited mid-walk. No same-uid process was hidden.
3. `ps -o pid=,stat= -p <the same-uid pids from 1 that 2 did not list>` — the re-check that tells
   "gone" from "hidden".

Then:

- **Signal B (a process has its cwd under the tree).** Any process lsof lists with a cwd equal to
  the tree or under it is `found`, **whatever its uid** — unlike Linux, lsof shows us a foreign
  process's cwd when it can, and there is no reason to ignore it. Excluded, as on Linux: the asker,
  its ancestors (from the ps ppid chain), and its own process group (the pipeline's `tail`). The
  tree is matched against both its path and its `realpath`, because lsof prints resolved paths
  (`/tmp` is `/private/tmp`).
- A same-uid process in 1, missing from 2, and still present and not a zombie in 3 is
  **unplaceable** → `unknown`, refuses. No ambient allowlist: none was needed on this Mac.
- **lsof missing, ps missing, a non-zero exit, or output that does not parse** → `cannot-tell`,
  refuses. Fail closed, as the brief asks.
- **Signal A (the lock's owner is alive).** The Linux lock reason carries a `/proc` start time in
  clock ticks since boot, which macOS cannot reproduce, so on the Mac it is **pid-only**:
  - pid not in the table → `stale`;
  - pid in the asker's ancestor chain → `asking` — safe without the start time, because a live pid
    names exactly one process; if the original owner died and the pid was reused by our own
    ancestor, the owner is gone anyway and `stale` would have been the answer;
  - pid alive otherwise → `alive`, refuses — possibly a recycled pid, which over-refuses, the safe
    direction.
  - Unlocked and unrecognised locks behave as on Linux. (Measured: on the Mac, no worktree is
    locked at all tonight — `EnterWorktree`'s agent trees are not — so signal B carries the weight.)
- **No PID-namespace gate.** macOS has no PID namespaces; `ps` is the whole machine's table.

The darwin path is a pure function over the three reads plus a reader that runs them, so every
awkward case (zombie, hidden, recycled pid, lsof failure) is arranged in a test from text, and one
integration test on darwin spawns a child in a temp tree and checks the real reader sees it.

### B. `npm run worktree:sweep -- --remove`

Classify every tree as now, then for each `REMOVABLE` tree and each ghost, call `removeOne` — the
existing single-branch removal — **one at a time, each re-fetching and re-proving for itself**. The
loop never trusts the classification it started from; it only uses it to pick candidates. That is
the property the header's "no bulk form" was protecting, and it survives.

- `--remove --dry-run` passes `--dry-run` through to each.
- Report, at the end, in four groups: **removed**; **refused by the removal itself** (its own
  steps — a race the classification missed); **in use** (a live session or process; listed with
  who, never killed — Greg's permission to kill is for an agent's judgement, not a script's);
  **needs a look** (every other keep: `.env.local — DIFFERS`, unlanded work, untracked files,
  UNKNOWN). A ghost on a detached HEAD has no branch to name and goes under *needs a look*.
- Exit 1 if any attempted removal failed; keeps are normal and exit 0.
- `GIT_LOCATION_ENV` is dropped at the top of the CLI, as `worktree-remove.ts` already does.

### C. Docs

`docs/project/worktrees.md` § Removing one / § Sweeping them up: the new flag, the Mac path, and
Greg's two quotes above as the standing permission. The headers of `worktree-sweep.ts`,
`worktree-remove.ts` and `worktree-inuse.ts` stop saying "the Mac can never remove a live tree"
and "there is no bulk form".

## What I am not changing, and why

**`.env.local — DIFFERS` stays a blocker.** worktrees.md already records the line-subset narrowing
that was measured and reverted on 2026-09-08 (a deleted key is a subset; order matters to the
last-wins parser; a comment only here is a note). The only narrowing I can see that does not have
those holes is "byte-identical to some earlier version of the primary's file", which needs a history
we do not keep. So the automatic run reports these trees under *needs a look* and the operator
settles them with the key-names recipe already in the doc.

**No process is ever killed by the script.**

**The simpler option passed over:** making `worktree:remove` accept several `--branch` flags. It
would be the same loop in a different file, and the sweep already has the classification that picks
the candidates; putting the loop there keeps `worktree-remove.ts` one-target.

## The residual this makes more visible

An **in-process subagent's** worktree (`EnterWorktree`, or the `Agent` tool with
`isolation: "worktree"`) has no process of its own: the parent `claude` keeps its cwd in the
primary, and the subagent's shells exist only while a tool call runs. Measured tonight, on this very
tree: between tool calls nothing has its cwd here, and nothing locks it. So a subagent that has not
yet written anything — clean, and "landed" because `worktree:setup` merged the trunk — reads `idle`
between tool calls and is removable. Nothing is lost (anything written blocks, anything committed and
unpushed blocks), but the agent's next command finds its cwd gone.

This is not new — `worktree:remove --branch` has the same answer today on the box — but an automatic
loop makes it reachable without anyone choosing that tree. Options: (a) accept and document it, as
260912a accepted "no live process is not finished"; (b) skip, in the bulk run only, any tree whose
HEAD reflog or index changed in the last N minutes — a proxy of the kind 260912a removed. I propose
(a), and I want the reviewer's view.

## After GPT Sol's plan review (NOT READY → these changes)

The review is [261009v-worktree-removal-plan-review-sol.md](261009v-worktree-removal-plan-review-sol.md). Each finding, and what I did:

- **F1 (P1) — the in-process subagent residual is not acceptable for an automatic run.** Agreed, and
  there is a cooperative ownership record already, on Linux only: `.claude/hooks/worktree-create.sh`
  locks every tree it makes with the owning `claude` process's pid, which for an `Agent` subagent is
  the *parent* session — so its tree is protected by signal A for as long as that session lives.
  On the Mac the hook skipped the lock ("no `/proc`"). **It now writes the same lock on the Mac**,
  finding the `claude` ancestor with `ps` (pid, and the start time as epoch seconds for the record;
  the Mac check stays pid-only). And because the session running the sweep would otherwise be
  `asking` for every tree its own subagents hold, **the sweep treats `asking` as a keep** — a
  session removes its own tree by name with `worktree:remove`, never in bulk. What is left: trees
  made before this change have no lock on the Mac, so a subagent tree from an older still-running
  session is protected only by signal B. Named in worktrees.md.
- **F2 (P1) — excluding the whole process group can hide an independent job.** Agreed. The
  process-group exclusion now applies only to a **pipeline filter** (`tail`, `head`, `grep`, `tee`,
  `cat`, `less`, `more`, `sed`, `awk`, `sort`, `uniq`, `wc`, `cut`, `tr`, `jq`) — the case it was
  written for — so `npm run dev & npm run worktree:sweep` still refuses over the dev server. Applied
  on both platforms: the Linux path had the same hole, and one rule is easier to trust than two.
- **F3 (P1) — path + realpath is not enough on the Mac.** Containment is now: a non-absolute name
  is `unknown`; lsof's escapes (`\n`, `\xNN`, `^X`) are decoded, and both spellings are tried; a
  case-insensitive prefix match counts (over-matching is the safe direction); otherwise the cwd's
  ancestors are `stat`ed and compared with the tree's `(dev, ino)`. A tree whose realpath or stat
  cannot be read is `unknown`.
- **F4 (P2) — branchless candidates.** The bulk run never removes a tree with no branch, live or
  ghost; it reports it under *needs a look*. A test runs the sweep from a secondary worktree.
- **F5 (P1) — the `.env.local` recipe overclaims.** Agreed. The doc said "nothing printed means a
  stale copy"; it means only "no key name is only here". The recipe now also compares value hashes
  and comment lines, without printing a value, and the settling is still a judgement. The blocker
  stays.
- **F6 (P2) — tests and stated limits.** `/proc`-reading fixtures are ported to the Mac or gated
  to Linux; the three reads are ordered observations, not a snapshot, and that is written down.

## Tests (failing first)

- `tests/worktree-inuse.test.ts`: parsers for ps and lsof `-F` output; the darwin composition —
  a process in the tree refuses; asker, ancestor and same-pgid sibling excluded; a foreign-uid
  process in the tree still refuses; a hidden same-uid process is unknown; a zombie or exited one
  is not; lsof failure is unknown; lock owner pid-only standing (gone → stale, ancestor → asking,
  other → alive); realpath matching. A darwin-only integration test against the real reader.
- `tests/worktree-sweep.test.ts`: `--remove` against real worktrees with injected liveness —
  removes the removable one, keeps the dirty one under *needs a look*, keeps an in-use one under
  *in use*, and each removal re-checks (a tree made dirty after classification is refused by the
  removal and reported so).
