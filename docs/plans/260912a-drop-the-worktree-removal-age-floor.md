# Drop the worktree-removal age floor

> Get rid of the 24h worktree-removal floor. If they are finished successfully and safe to remove,
> it's fine to do so immediately. Consider this approved, and push.
>
> — Greg, 2026-09-12, to the Overseer

**Status:** built, 2026-09-12. The code, the tests and the docs landed together; then the sweep was
run and every tree it now calls removable was removed, bar the five the brief protected.

## Why the floor was there

[260908k](260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion.md)
kept it for two reasons, and both are worth answering rather than overruling.

1. **A fresh tree passes the merged test trivially.** `worktree:setup` merges `origin/dev`, so a
   five-minute-old tree is clean and "landed" before its agent has done anything. The sibling repo's
   sweep deleted live trees exactly this way. The floor was a proxy for *somebody is using this*.
2. **"No live process" is not "finished".** An agent can land an intermediate commit, schedule a
   continuation and exit, leaving a clean, landed, process-free tree it still wants.

The first is now answered by evidence rather than by a proxy. Since 260908k, `worktree:remove` has two
liveness vetoes — **the lock's owner is alive** (its exact `(pid, start)` in `/proc`), and **a process
of ours has its cwd inside the tree** — and measured on this box today, a session that entered its
tree with `EnterWorktree` trips both: its `claude` process's cwd *is* the tree, and the lock names it.
A peer's five-minute-old tree is refused because its session is alive, not because it is young.

The second is the one Greg has now decided. What it costs is small by construction: the tree it
removes is clean, landed and has nothing gitignored that `worktree:check` could not account for, so
the loss is a `worktree:setup` for whoever comes back — not work.

## What changes

A third party may remove a tree on the evidence the owner needs today, minus the clock:

| check | refuses on | unknown |
|---|---|---|
| `worktree:check` (dirty, untracked, gitignored `data/`, `.env.local`, listeners, trunk) | any blocker | refuses |
| the landed proof — tip, branch reflog and this tree's HEAD reflog on `origin/dev` | any commit not there | refuses |
| liveness — lock owner alive and not the asker; a process with its cwd inside | either | **refuses** (was: fall back to the floor) |

**The owner lock stays, and it no longer grants anything.** It used to waive the floor. Now its only
job is to stop signal A vetoing the owner itself: when a session removes its own tree from inside,
the lock's pid is alive — it is the asker — and without recognising that, "the owner is alive" would
refuse every owner. So `asking` means *exempt from signal A*, and the removal then needs exactly what
anyone else needs.

**The sweep asks liveness too, and `young` is gone.** `REMOVABLE` has to mean "the removal command
would accept it", and without the floor, the only thing standing between a peer's fresh tree and a
paste-ready command in the sweep's report is the liveness check. So `gatherAll` reads it per tree and
`classifyOne` turns `in-use` and `unknown` into `keep` reasons.

Deleted rather than switched off: `MIN_IDLE_HOURS`, `lastActivityAt`, `describeIdle`, `ageFloor`,
`idleLine`, `shouldWaiveFloor`, `Liveness.authorised`, the `young` verdict, `SweepFacts.lastActivity`,
`RemoveOptions.now` and `.minIdleHours`, and the tests that exercised them.

## The simpler options passed over

- **Set `MIN_IDLE_HOURS = 0`.** One line, and it leaves the activity reading, the waiver and the
  `young` vocabulary in place, describing a rule that no longer exists. The brief said delete; so does
  [silent-success.md](../reusable/silent-success.md) about checks that are there and do nothing.
- **Drop the floor from the sweep's report without adding liveness.** Fewer moving parts, and it would
  print a peer's fresh tree as `REMOVABLE` with a paste-ready command beside it. The removal would
  still refuse it, but a report whose headline word the removal disagrees with is the drift 260908k
  wrote `young` to prevent.
- **Delete the ownership proof too.** Then a live owner would veto itself, and a session could never
  remove its own tree from inside — the case 260908k's review found first.

## What this knowingly gives up

- **A tree whose session has exited, meaning to come back**, can be removed. Nothing in it is lost —
  that is what `worktree:check` and the landed proof are for — but the session comes back to no tree.
  Greg's call, above.
- **A session that works in a tree without `EnterWorktree`** — a `cd` from the primary, say — has no
  lock and no process sitting in the tree between tool calls, so neither signal sees it. The floor
  covered this; nothing now does. The rule already says to enter a worktree, and the doc says so.
- **The Mac has no `/proc`**, so liveness is always `unknown` there, and `worktree:remove` now always
  refuses a live tree on the Mac where it used to accept one after 24 hours. Ghosts and orphaned
  branches are unaffected, and no tool reads cwds there; if the Mac needs it, `lsof -d cwd` is the
  place to start.

## What the code review found

GPT Sol, 2026-09-12, verdict *REFUSE* on the first draft — and it was right to.

1. **High, fixed here: a private PID namespace failed open.** Reproduced in Sol's own Codex sandbox:
   its `/proc` omitted the live host pid named in this tree's lock and every host process with a cwd
   here, so `liveness()` called the lock stale and the tree idle. The floor had been the only thing
   behind that answer. Fixed with a positive control, not a note: `/proc/self/ns/pid` must name the
   host's initial PID namespace (inode `4026531836`, fixed by the kernel since 3.8); anything else,
   or an unreadable link, is `unknown`, which refuses. Red first, through `liveness()` with the real
   `/proc` and an injected namespace link, because an unprivileged `unshare` is refused on this box.
2. **Medium, not fixed — older than this change:** a live tree whose directory was *renamed* reads as
   a ghost, and the ghost path skips liveness; unregistering it deletes the git admin directory under
   the moved tree. The floor never covered this either (a ghost was always removable at once). Left
   for its own change.
3. **Medium, fixed by Sol:** an owner pid whose `/proc/<pid>/stat` exists but will not parse read as
   `stale`. It is now `unreadable` → `unknown`.
4. **Low, fixed by Sol:** the real-process fixtures now wait for the child's cwd and process group, and
   the hidden-process test asserts the refusal names that exact pid.

## The namespace fix, back to Sol

The fix above went to GPT Sol on its own, findings-only, the same day — dispatched by the Overseer as a
review debt (queue item `qi-3bmkw2ft`). Prompt:
[…-namespace-review-prompt.md](260912a-drop-the-worktree-removal-age-floor-namespace-review-prompt.md);
answer: [`…-namespace-review-sol.md`](260912a-drop-the-worktree-removal-age-floor-namespace-review-sol.md).
Verdict *REFUSE*, but not on the namespace fix.

- **The namespace fix holds.** Sol ran `liveness()` for real inside its sandbox (`pid:[4026533427]`)
  and got `unknown` naming the namespace; without the gate the same inputs composed to `idle`, so the
  test is a real one. `4026531836` is the reserved initial-namespace inode, dynamic ones come from a
  separate range, and a mismatched procfs fails closed either way round.
- **P1, fixed: one liveness read is not a lease.** A peer resuming a clean, landed tree with a stale
  lock after the read had it unlocked and removed from under it. Now the registration is re-read before
  the unlock (a changed lock refuses untouched), and liveness is read again after it, just before
  `git worktree remove` — which refuses by itself a tree re-locked in between. Red first, through an
  injected per-call liveness (`RemoveOptions.liveness`), because the interleaving cannot be made with
  real processes in a single-threaded test; two refusals and a control. The residual — a peer entering
  *without* locking between the last read and the removal — needs an exclusion shared with
  `EnterWorktree`, and is left named in the code and in [worktrees.md](../project/worktrees.md).
  The sweep's matching drift (a row printed `REMOVABLE` whose tree a peer entered while the report was
  being built) is left: the report destroys nothing, and the removal re-reads twice.
- **P2, not fixed: the host namespace does not prove an unrestricted `/proc`.** Under `hidepid`, or for
  an owner running as another uid, a live owner's stat reads as absent, which `ownerStanding` calls
  stale. Not reachable on this box as it stands: `/proc` is mounted without `hidepid`, and every agent
  runs as `greg` (checked by both of us). The fix when it matters is `kill(pid, 0)` telling `ESRCH` from
  `EPERM`, as `tools/overseer/launch-artefacts.ts` already does.
