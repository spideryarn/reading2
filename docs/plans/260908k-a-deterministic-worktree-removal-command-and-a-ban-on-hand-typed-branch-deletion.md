# A deterministic worktree removal command, and a ban on hand-typed branch deletion

**Status as of 2026-09-09: built and on `dev`.** Evidence: `worktree:remove` in `package.json`,
`scripts/worktree-remove.ts` and `scripts/worktree-inuse.ts` exist, and the command has been run
against real worktrees on the box. **Three GPT Sol reviews, and each one changed the design** — the
plan ([review-sol](260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion-review-sol.md),
*"not ready to build"*), the code
([code-review-sol](260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion-code-review-sol.md),
*"not safe to land as written"*), and the fix round
([verify-sol](260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion-verify-sol.md),
*"still not safe to land"*). Sections
[What the review changed](#what-the-review-changed) and
[And what the review of the code changed](#and-what-the-review-of-the-code-changed) say what moved and
what was answered back.

**The single most useful thing in this file, if you read nothing else:** twice, fixing one of Sol's
findings created a worse one. Told the landed proof must be *retaken*, I moved it after the
destructive call. Told a present-and-prunable registration was force-deleted, I dropped `--force` —
which protected an unrelated replacement directory and not the case that actually loses files. **A
fix round is where bugs come from, and it needs its own review, not a re-run of the tests.**

Greg asked for this at 2026-09-08 23:30:

> can we write a script to deal with worktree removal that is more deterministic and careful, and
> then ban use of `git branch -d`? and/or add a hook to it?

## The incident, and what it actually shows

Tonight the Overseer removed `worktree-260908f-overseer-status-card` by hand: `worktree:check` said
SAFE TO REMOVE, then `git worktree unlock`, `git worktree remove`, `git branch -d <name>`. Nothing
was lost — the branch was fully merged — but the whole sequence was hand-typed git, and branch
deletion is forbidden outright by the Overseer's own runbook
([overseer.md § The gates](../project/overseer.md)).

**The directly supported cause is documentation.** Every place that describes removal either stops
short of it or hands out hand-typed git:

- `AGENTS.md:218` — *"Before deleting a worktree, run `npm run worktree:check` inside it"* — names the
  **check** and stops. `overseer.md:88` says the same. Neither names a removal command.
- `worktrees.md:415` **hands the agent the hand-typed form**: after an `ExitWorktree` refusal it says
  to run `git worktree remove .claude/worktrees/<name>` from the primary. An agent doing exactly what
  the doc says ends up where the Overseer ended up.

**And a structural contributor.** Measured in the primary, 2026-09-08 23:5x:

```
$ npx tsx scripts/worktree-sweep.ts
  keep      worktree-260908f-roadmap-baseline
              3 commits that origin/dev does not have
              HEAD last moved 1 min ago — under the 24h floor
  keep      worktree-adversarial-fixtures
              git was last run here 7.9 h ago — under the 24h floor
  … (nine trees, every one of them "under the 24h floor")

  nothing to remove.
```

`worktree:sweep -- remove --branch <name>` re-runs `classifyAll`, so it re-earns the same floor and
refuses too. **On this snapshot the sanctioned command could not remove any tree on the box.** An
agent that has just finished, or an Overseer reaping a tree whose session ended ten minutes ago, is
refused by the only tool it is allowed to use.

*(One snapshot does not prove the command has never removed anything, and nothing here proves the
Overseer knew about it and was turned away. The floor is a real structural contributor; the missing
and contradictory docs are the cause this incident actually demonstrates. The first draft of this
plan said the hand-typed git was "the documented consequence" of the floor, which was tidier than
the evidence — GPT Sol, finding 10.)*

## Goal

One command an agent can be told to run, that:

- refuses with a **reason** in every unsafe case, and prints what it checked;
- lets the agent that owns a tree remove it the moment it is done, on **proof** that the request came
  from the owner, not on an inference;
- refuses to pull a tree out from under anybody else — and does not confuse *"nobody is running in
  it"* with *"nobody wants it"*;
- deletes the `worktree-<name>` branch only on proof that **everything it ever pointed at** has
  landed, atomically, from inside the script — so hand-typed `git branch -d` can be banned outright
  without banning the job it does.

## Ownership is provable, and that is the whole design

The 24h age floor exists because a sibling repo's sweep removed **live** worktrees: a fresh tree whose
tip equals the trunk passes the merged test trivially. It is a proxy for *"is somebody still using
this?"*, and it is a bad proxy in one direction only — it refuses the owner who has just finished.

**Do not replace the proxy. Add a proof beside it, and let the proof waive it.**

`claude --worktree` writes the owning session's pid **and start time** into the worktree lock:

```
$ git worktree list --porcelain
worktree /home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal
locked claude session 260908k-worktree-removal (pid 1097274 start 73180403)

$ awk '{ rest=$0; sub(/^.*\) /,"",rest); split(rest,f," "); print f[20] }' /proc/1097274/stat
73180403
```

Field 22 of `/proc/<pid>/stat` is the process's start time in clock ticks since boot. The start time
is what makes this safe against **pid reuse**: "that pid exists" is not the test, "that pid exists
*and* was started at that instant" is.

And measured in this very worktree, the ancestor chain of a command run by this session is:

```
1142822 bash   cwd=…/worktrees/260908k-worktree-removal
1142820 bash   cwd=…/worktrees/260908k-worktree-removal
1097274 claude cwd=…/worktrees/260908k-worktree-removal   ← the pid in the lock
1097267 bash   cwd=/home/greg/code/spideryarn2
 132280 tmux: server cwd=/home/greg
      1 init
```

**So the owner can prove it is the owner**: the `(pid, start)` in the lock appears in the ancestor
chain of the process asking for the removal. That is not an exemption carved out for convenience — it
is positive evidence that the session which owns the tree is the one requesting its removal, and it
cannot be produced by any other session on the box.

**Two consequences, and they are the plan:**

- **Owner-authorised removal waives the age floor.** The person standing in it knows they are done —
  which is exactly the argument `worktrees.md` already makes for why `worktree:check` has no floor.
- **Third-party removal keeps the floor, unchanged.** No live process is *not* the same fact as
  finished: an agent can land an intermediate commit, schedule a continuation for an hour's time, and
  exit because the box is loaded. Its tree is clean, landed, unlocked by a dead pid and empty of
  processes — and still wanted. `/proc` cannot see intent, and this plan will not pretend it can
  (GPT Sol, finding 3).

**So tonight's incident is fixed by the docs and by the owner-side command, not by weakening a
guard.** The tree the Overseer reaped should have been removed by the session that owned it. Where a
session dies without cleaning up, the right answer is that the tree waits out the floor and the sweep
reaps it — that is a bounded, quiet cost, and it is the careful answer Greg asked for.

### The liveness signals are vetoes, never permissions

Two of them, failing in opposite directions, and **a hit from either refuses**:

- **A — the lock owner is alive** (`(pid,start)` matches `/proc`), and is *not* the authorising
  ancestor. A lock outlives the session that wrote it, so a `SIGKILL`ed session leaves one claiming a
  dead pid; that is why this is checked against `/proc` rather than believed.
- **B — a process has its cwd under the tree**, excluding the asking process and its ancestors. This
  catches what A cannot: measured tonight, two live processes sitting in `dock-last-titles`, a
  worktree that has already been removed.

**Three-valued, and it fails closed.** Either signal active → refuse. Otherwise either signal
*unknown* → fall back to the age floor. Clear only when both applicable signals are conclusively
clear. "One signal is unknown and the other found nothing" is **not** clear (GPT Sol, finding 5).

**UID first, then readability.** Confirmed foreign-UID processes are ignored; a stable **same-UID**
pid whose cwd cannot be read is an `unknown`, not an absence.

### Signal B was built once already, measured, and thrown away — on purpose

`worktree-check.ts:843`, the listener scan, carries the record: the `orchestrator-setup` session built
exactly this cwd sweep on 2026-09-08, measured it, and discarded it — *"it fired on 8 of the 13
worktrees, against 2 that actually had a server in them"*, and *"`/proc/<pid>/cwd` is unreadable for
575 of the box's 910 processes … silently blind rather than wrong, which is the worse of the two."*

My own count tonight was 2 of 6 trees, not 8 of 13. **Both are right, and the disagreement is the
measurement**: theirs was mid-day with a dozen live agents, mine at 23:50 with most sessions dead.

It is right *here* and was wrong *there* for three reasons:

1. **Different question, different cost of a hit.** `worktree:check` is asked constantly, about the
   tree you are standing in, so a hit there is almost always your own shell. This command is asked
   rarely, about a tree somebody has decided is finished, and a hit is the fact they are missing.
2. **Excluding self and ancestors removes the case that was firing** — your own shell.
3. **It is a veto, not the verdict**, and it is second to an exact signal.

The 575 unreadable processes are handled by not pretending: same-UID and unreadable is an `unknown`
that costs you the age floor, foreign-UID is ignored, and the counts are printed. Failing closed on
575 unreadable processes would refuse every removal for ever — the `/logs/` mistake a *third* time.

## Design: `npm run worktree:remove`

```bash
npm run worktree:remove                        # inside the worktree — this one
npm run worktree:remove -- --branch <name>     # from the primary — that one
npm run worktree:remove -- --branch <name> --dry-run
```

One target, named or implied. **No bulk form**, for the reason the sweep already gives: a verdict must
not be carried from an earlier decision into a later deletion.

### The order of operations, and what each step is for

| # | Step | Refuses on |
|---|---|---|
| 1 | Resolve the target: `--branch <name>`, or the tree we are standing in | not a worktree; the primary; no such branch |
| 2 | Classify the registration: **absent** → ghost; **present and prunable** → `UNKNOWN` | a present-but-prunable tree, with `git worktree repair` named |
| 3 | `git fetch origin dev`, once, taking the **sha** not the ref name | a failed fetch → `unknown` → refuse |
| 4 | `blockers(gather(path, sha))` — `worktree:check`'s whole judgement, unchanged | dirty, unlanded, gitignored state git has no copy of, hidden-from-status, in-progress merge/rebase/bisect, a server listening from inside |
| 5 | **Ownership proof**: lock `(pid,start)` in our ancestor chain? | — (this grants, it never refuses) |
| 6 | **In-use veto**, three-valued: signal A, signal B | either active → refuse, naming the pid and its command |
| 7 | **Age floor**, unless owner-authorised, or as the `unknown` fallback | under 24h and not the owner |
| 8 | Unlock, if locked — **stop if the unlock fails** | a failed unlock |
| 9 | `git worktree remove <path>`, **no `--force`**, `cwd` = primary. On failure, **restore the lock** | git's own refusal, on its own terms |
| 10 | Branch: prove, then delete atomically (below) | anything the branch ever pointed at that has not landed |

**Step 2 is a bug fix in existing code.** `ghosts()` in `worktree-admin.ts:186` and `classifyOne` in
`worktree-sweep.ts:161` both treat `!present || prunable` as a ghost, and a ghost is removed with
`forceRemoveThrowawayWorktree`, which passes `--force --force`. So a worktree **whose directory is
still there, full of files**, but whose `.git` link is broken, is force-deleted today. A ghost must be
an **absent** path; present-and-prunable is `UNKNOWN` and names `git worktree repair` (GPT Sol,
finding 1).

**Step 4 is a call, not a copy.** This plan does not change what `worktree:check` decides is safe, and
keeps no cheaper duplicate of that judgement beside it — the sweep's header explains why.

**Step 9 spawns with `cwd` = primary rather than inheriting.** Measured on a scratch repo:
`git worktree remove .` from *inside* the tree succeeds (exit 0) and deletes the directory out from
under the shell; every command after it fails with `getcwd: cannot access parent directories`. Node
survives it, the caller's shell does not — so the in-tree form ends by saying so and naming the
primary. **The recommended flow for an agent is `ExitWorktree({action:"keep"})` first, then
`npm run worktree:remove -- --branch <name>` from the primary** — the owning `claude` process is still
an ancestor there, so the ownership proof still holds and the shell survives.

### What happens to the branch

**Chosen: delete it, on a proof taken after the worktree is gone, with a compare-and-swap.**

```
git rev-list --no-walk <tip and every reflog oid> --not <fetched trunk sha>   # must print nothing
git update-ref -d refs/heads/<branch> <expected-oid>                          # fails if it moved
```

Three things here, each from the review:

- **The proof is retaken, not re-read.** The first draft said step 10 would "re-assert" the landed
  fact by re-reading `trunk.kind === "landed"` from facts gathered earlier. That is not re-assertion:
  a peer can resume the tree, commit, and leave it clean again between the gather and the delete
  (GPT Sol, finding 2). The ancestry test is run again, against the captured trunk sha, after the
  worktree is removed.
- **`git update-ref -d <ref> <old-oid>` instead of `git branch -D`.** `-D` is not compare-and-delete;
  `update-ref` with an expected old value is, and it fails rather than deleting a branch that moved
  under us.
- **The reflog is included in the proof, not waved at.** `--is-ancestor` on the tip proves that
  everything reachable *from the current tip* has landed — not that nothing was lost. A branch that
  once pointed at `U` and was then moved back to a landed commit passes a tip test, while `U` survives
  only in the branch and worktree reflogs, both of which this command is about to delete (GPT Sol,
  finding 6). Feeding every reflog oid into one `rev-list --not <trunk>` costs one process and closes
  it. It needs a branch-moving operation `AGENTS.md` bans — which is exactly the kind of "cannot
  happen" that this repo keeps finding in postmortems.

The claim this plan will **not** make: that a merged commit is reachable "for ever". It is reachable
while the trunk is append-only, which is a convention, not a git guarantee.

**Passed over:**

- **Leave the branch, always.** Cheapest, and close to what happens today — measured, **11
  `worktree-*` branches with no worktree**, all merged. Harmless, but it makes `git branch --list`
  useless for "what is in flight", and grows by one per piece of work.
- **Never delete; have a periodic sweep report the pile.** A second mechanism, a second thing to run,
  and it still ends in somebody deleting a branch — later, and with less context than the removal had.

### An orphan branch is a target too

`--branch <name>` with no worktree on it is not an error, it is the **stuck state** — and the state
those 11 branches are in. It runs the same fresh ancestry proof and the same CAS deletion, with no
worktree steps. Without this, a removal that succeeded and whose branch deletion failed transiently
would leave a mess that the new hook forbids anyone from cleaning up by hand (GPT Sol, finding 7).

A **ghost** (registration present, directory absent) is unregistered, and its **branch is left alone** —
the sweep's rule, unchanged and for its stated reason.

### Two commands, or one?

`worktree:sweep -- remove --branch <name>` keeps working and calls the same primitive, so there is
**one removal implementation**. The 24h floor stays in `classifyOne`, which decides what the sweep's
report *advertises*. Its vocabulary changes though: a tree that is clean and landed but under the
floor is no longer flatly `keep` — it prints as **safe, but young — its owner may remove it now**,
without a paste-ready command. `REMOVABLE` otherwise comes to mean "old enough to advertise" rather
than "the primitive would accept it", which is the sort of drift an operator reads straight past
(GPT Sol, finding 9).

## Banning `git branch -d`

### The mechanism: extend the PreToolUse hook that already exists

`.claude/hooks/protect-shared-tree.sh` is a versioned, tested Claude Code `PreToolUse` Bash hook that
already bans one git verb repo-wide, wired in `.claude/settings.json` (tracked). Fewest moving parts by
a distance: distributed by `git pull` like any other file, applies to every agent on both machines and
in every worktree with no per-clone setup, and it has a test harness whose shape — *every guard
confirmed by making it refuse, with innocent controls alongside* — is exactly what this needs.

**The sanctioned path is out of its reach without a carve-out.** The removal script deletes the branch
with Node's `spawnSync`, which is not a Bash tool call, so the hook never sees it and no env-var
exemption is needed. That is a **convenience, not a security property** — it is the same boundary that
lets any script or alias past. This is a guard against absent-mindedness in the place absent-mindedness
happens, not enforcement.

**The match must be per-command, not per-payload.** The first draft proposed *the word `branch`
followed across intervening flags by a delete flag*, over the whole command text. That refuses
`git branch --show-current && npm install -D package` — an ordinary daily compound (GPT Sol, finding
8). So: split the text on command separators (`&&`, `||`, `;`, `|`, newline) first, and require
`branch` and the delete flag **within one segment**. Cases the tests must cover: `-d`, `-D`,
clustered `-df`, `--delete`, `-D` before the branch word, a global `-C <path>` in front, and the
innocent controls `git branch`, `git branch --list`, `git branch --show-current`, and the compound
above.

**Cut from scope:** `git tag -d` (nothing in this incident or the sanctioned path involves tags) and
`git push --delete` / `git push origin :ref` (remote-ref protection is more consequential and belongs
in branch protection, not in a local-cleanup regex).

**Known bypasses, stated rather than chased:** git aliases, `git update-ref -d refs/heads/<name>`, and
any script whose text is not in the Bash call. The hook is a nudge.

### Passed over: a `reference-transaction` git hook

Checked rather than assumed — git 2.43.0 on the box, and `reference-transaction` (since 2.28) fires on
branch deletion and can abort a transaction by exiting non-zero in the `prepared` phase. Rejected on
three counts:

- **Distribution.** Hooks live in `.git/hooks`, per-clone and untracked. Versioning them needs
  `core.hooksPath` pointed at a tracked directory, itself a per-clone `git config` — none is set
  today, so the box and the Mac each need a manual step, and that is a change to the file that builds
  the next box ([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md)). Worktrees
  would be covered for free, sharing one common `.git`.
- **Blast radius.** It runs per transaction phase on *every* ref update: every commit, every merge,
  every fetch. A bug or an interpreter start-up there taxes everything every agent does. The Claude
  hook fires only on Bash tool calls.
- **It cannot tell an agent from a human**, so it would refuse Greg at his own terminal.

It would not strictly need an env-var carve-out — it could permit a deletion by ref and expected old
OID — but that is more machinery than this problem warrants. What it would buy that the Claude hook
cannot is catching deletions from any tool at all; measured, that is not the exposure, since the 11
orphan branches show the tool-driven path *leaves* branches rather than deleting them.

### And the rule text (a proposal, not an edit)

`AGENTS.md § Never run a git command that throws work away` and `overseer.md § The gates` both need a
sentence, and **neither is edited by this plan** — they are rules, so they go to Greg as before/after
under [edit-important-docs.md](../reusable/edit-important-docs.md), in the debrief.

## `ExitWorktree` bypasses all of this, and always will

Claude Code's own tool removes a worktree with `discard_changes: true` without a prompt, and removes
gitignored files while doing it — `worktrees.md` already records that those "44 uncommitted files"
were once somebody's paid eval results. The tool is not ours to change, so:

- **`ExitWorktree` is for *leaving* a worktree (`action: "keep"`), and is not a removal path.** It is
  also the *first half* of the recommended removal flow, because it is what gets the shell out before
  the directory disappears.
- **`worktrees.md:415` stops handing out hand-typed git**, and names the command instead.
- **The script will not pretend to intercept it.** No lock, no marker file, no wrapper — anything that
  half-worked here would be a guard whose failure looks like success.

## What the review changed

GPT Sol's verdict on the first draft was *"not ready to build"*. Nine findings, eight taken:

| # | Finding | Taken |
|---|---|---|
| 1 | `present && prunable` is force-deleted as a ghost | yes — ghost is **absent only** |
| 2 | `branch -D` after a stale proof; a peer can commit in between | yes — retaken proof + `update-ref -d <old-oid>` |
| 3 | "no live process" ≠ "finished" | yes — floor kept for third-party removal |
| 4 | **the in-tree form refuses its own primary case** — the lock names the live asking process | yes — ownership by ancestor-chain proof |
| 5 | `cannot-tell` aggregation failed open | yes — strict three-valued, UID-filtered |
| 6 | `--is-ancestor` on the tip is not "nothing is lost" | yes — reflog oids in the proof; claim narrowed |
| 7 | unlock/removal/deletion partial-failure states | yes — stop on unlock fail, restore lock, orphan-branch mode |
| 8 | matcher false-positives on ordinary compounds | yes — per-segment match; tag and remote deletion cut |
| 9 | sweep's `REMOVABLE` vocabulary drifts | yes — "safe, but young" |
| 10 | the diagnosis was too tidy | yes — softened above |

Finding 4 is the one that would have shipped a command that refused the case it was built for.

## And what the review of the *code* changed

GPT Sol's verdict on the built code was *"not safe to land as written"*
([review](260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion-code-review-sol.md)).
Eight findings. **The worst of them was created by fixing the plan review's second finding**: told that
the landed proof must be *retaken* rather than re-read, I moved it after `git worktree remove` — and
that call deletes the worktree's HEAD reflog, so a proof that then found an unlanded detached commit
was announcing a loss it had already caused. Reproduced: `git reflog --all` names the commit before
the removal and nothing names it after; `git fsck --unreachable` is all that is left.

| # | Finding | What changed |
|---|---|---|
| 1 | the proof ran **after** the destructive call | the whole proof completes first; a refusal now costs nothing |
| 2 | the "retaken" proof was a snapshot passed through — ABA on the branch | `proveAndDeleteBranch` re-reads the reflog; residual window named in the code |
| 3 | `--ignore-missing` and swallowed read failures both read as "landed" | flag dropped; `reachableOids` returns `cannot-tell` on any failed read |
| 4 | ghost force-removal races a restored directory | **no `--force` anywhere in the file** — measured, a plain removal clears an absent registration by itself |
| 5 | `authorised` waived the floor even when a signal was unknown | `shouldWaiveFloor` requires `authorised && idle` |
| 6 | `--dry-run` skipped the proof, so it promised what a real run would refuse | proof runs before the dry-run return |
| 7 | a lock with **no reason** was not restored after a failed removal | `relock` handles the reasonless case |
| 8 | the hook required `git` per *payload*, not per command | `git`, `branch` and the flag must land in one segment |

**Two of its findings I checked and answered back, with measurements.**

- **The `--force --force` data loss (plan finding 1) does not exist as stated**, and Sol agreed on the
  static case: git's worktree validator requires `<path>/.git` to point back at the admin entry, and a
  present-and-prunable registration is *by definition* one where that is missing. What Sol then
  reproduced is a different thing — a *genuine* ghost whose directory is restored between the listing
  and the removal — and that is real. It is closed by dropping force entirely rather than by
  classifying harder.
- **"A stable same-uid pid whose cwd is unreadable is an unknown" (code finding 5) is right in
  general and wrong here, and the count says so.** Walked on this box: of 208 same-uid processes, 202
  readable, 1 gone mid-walk, **6 permanently opaque — `systemd --user`, `(sd-pam)`, two `sshd`, two
  `postgrest`**. Blocking on those makes the scan report an unknown on *every* run, which takes the
  owner waiver — the point of the whole feature — with it. They are counted and printed instead.
  Conflating "exited" with "opaque" was a genuine bug and is fixed; it was found by an end-to-end
  test, after every unit test with a fake `/proc` passed.

**What is knowingly not built**, so it is a decision rather than an oversight: the ABA window between
the final reflog read and the `update-ref -d` compare-and-swap. Closing it needs an
`update-ref --stdin` transaction held open across the re-read, which means an async child process in
an otherwise synchronous script. The exposure is a peer moving a branch away and back, twice, in two
adjacent process spawns, on a branch whose worktree has just been removed. Named in
`deleteRefIfUnmoved`'s docstring rather than left for the next reader to find.

## And what the review of the *fix round* changed

The third review's verdict was *"still not safe to land"*, and five of its seven findings were real.
**Two of them existed only because of the previous round's fixes**, which is the lesson this plan is
worth reading for.

| # | Finding | What changed |
|---|---|---|
| 1 | **dropping `--force` closed the wrong race** — a plain removal on a registered path removes *whatever is there*, so a ghost whose original tree is moved back is found valid and deleted | ghosts go through `git worktree prune`, which asks whether the registration is *still* stale, and which cannot delete a file at all |
| 2 | the HEAD-reflog proof is a snapshot | not narrowed; the **claim** is weakened to "the tip and the reflogs that still exist" |
| 3 | **the ambient-daemon pushback was wrong** | `AMBIENT_OPAQUE_COMMS` names the four; anything else opaque is a blocker |
| 4 | `update-ref -d` does not refuse a **checked-out** branch the way `branch -D` does | `checkedOutSomewhere` immediately before the delete |
| 5 | the hook missed quoted and escaped flags; the carry mis-handled backslash parity | preceding class takes quotes and backslashes; carry continues only on an **odd** count |
| 6 | a **locked** ghost could not be cleared at all | `pruneGhost` unlocks first, because prune exempts locked entries by design |
| 7 | `refExists` conflated "absent" with "could not ask" | `lookupRef` is three-valued |

**Finding 3 is the one worth dwelling on.** I had argued from a census — 208 same-uid processes, six
permanently opaque, all daemons — that opaque implies harmless. Sol did not argue back; it built the
counter-example: a same-uid `python3` that chdir'd into a worktree and called
`prctl(PR_SET_DUMPABLE, 0)`, whose cwd then read as unreadable while genuinely being the worktree.
*"The six ambient daemons prove that blocking every opaque PID is operationally unusable; they do not
prove every opaque PID is a daemon."* A census can only ever tell you what is there, and the question
was what **could** be. Both halves are now true at once because the known set is named and the
unknown blocks — the shape [worktree-check.ts](../../scripts/worktree-check.ts) already uses for
gitignored paths.

## Stages

Each ends with a GPT Sol review of the code, per `engineering-manager.md`.

- **Stage 1 — `scripts/worktree-inuse.ts`.** Lock-reason parse, `(pid,start)` liveness, ancestor
  chain as `(pid,start)` pairs, UID-filtered cwd scan, three-valued composition. Pure functions over
  injected text, so the tests need no real processes. **Red first**: a live non-owner pid refuses; a
  stale lock whose start time differs does not; an ancestor's cwd does not; a same-UID unreadable pid
  is `unknown`, not clear.
- **Stage 2 — `scripts/worktree-remove.ts` and `npm run worktree:remove`.** The removal primitive,
  the ghost fix, the retaken proof and CAS deletion, unlock/restore, orphan-branch mode. The sweep
  imports it. Tests for every refusal path, red first, against real git.
- **Stage 3 — the hook.** Per-segment deletion match in `protect-shared-tree.sh`, with its refusals
  and its innocent controls in the test script.
- **Stage 4 — docs, and the first real use.** `worktrees.md` gets the command at § Before you remove
  one, § ExitWorktree, § Sweeping them up and the table at the top. Then `npm run worktree:check` in
  this worktree, and remove it with the new script.

## References

- [worktrees.md](../project/worktrees.md) — § Before you remove one, § ExitWorktree refuses for two
  reasons, § Sweeping them up, § Traps
- [`scripts/worktree-sweep.ts`](../../scripts/worktree-sweep.ts) — `classifyOne`, `removeOne`, and the
  header's account of the age floor
- [`scripts/worktree-check.ts`](../../scripts/worktree-check.ts) — `gather`, `blockers`, `report`,
  `fetchTrunkSha`, `listenersUnder` (the `/proc` precedent this borrows, and the measurements)
- [`scripts/worktree-admin.ts`](../../scripts/worktree-admin.ts) — `listWorktrees`, `ghosts`,
  `forceRemoveThrowawayWorktree`
- [`.claude/hooks/protect-shared-tree.sh`](../../.claude/hooks/protect-shared-tree.sh) and its `.test.sh`
- [260828r-worktrees.md](260828r-worktrees.md) — the original design
- [260907c-a-sweep-that-stamped-the-timestamp-it-read-as-activity.md](../postmortems/260907c-a-sweep-that-stamped-the-timestamp-it-read-as-activity.md)
