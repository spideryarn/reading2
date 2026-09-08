# Fix the two guards that agree with the thing they watch

**Status:** done, 2026-09-07. Both guards fixed, nine tests added, every one watched
red first. Reviewed by Fable (before) and GPT Sol (design), whose findings are the
reason the shipped fix is not the one this plan opened with — the ledger is at the end.

Two safety checks in `scripts/` are, right now, incapable of firing correctly. Neither
is broken in a way that shows: one prints the same words a healthy tree would print,
and the other prints an alarm that is always false in the situation that produces it.
They are the same shape — the guard shares an assumption with the thing it watches —
and that shape has a name in this repo already:
[silent-success.md](../reusable/silent-success.md), and nine instances in
[docs/postmortems/260906e](../postmortems/260906e-a-guard-that-agreed-with-the-thing-it-was-watching.md).

This came out of Greg's question after the A10 stylesheet split: *"Would it solve
this whole class of issues if all agents were working in worktrees?"* Answering it
meant measuring the worktrees, and the measurement is what turned both bugs up.

## Why this is worth doing now

`.claude/worktrees` is **14G** with **21G free** on the box — room for about 25 more
worktrees. Eleven of the sixteen are fully merged into `origin/dev`: finished work,
still on disk. `npm run worktree:sweep` exists to reclaim exactly those, and it
reports `nothing to remove.` It has never removed anything, and cannot.

Adoption is not the problem — 175 merges from worktree branches against 46 from the
primary over three days, and zero tracked-file edits in the primary right now.
**Teardown is the problem**, and the tool for it is broken.

The second guard matters more as worktrees spread, not less. Every true positive
`check:staged-revert` can produce needs a **shared index**, which worktrees
eliminate. Every false positive needs a **merge**, which worktree agents do
constantly. Under universal worktrees that guard would be nothing but its failure
mode.

---

## Bug 1 — the sweep stamps the mtime it then reads as activity

### What it does

`scripts/worktree-sweep.ts` never removes a worktree touched in the last
`MIN_IDLE_HOURS` (24). That floor is load-bearing and documented: `worktree:setup`
merges `origin/dev` at creation, so a five-minute-old worktree is clean and contains
the trunk, and every other check calls it removable while its agent is still reading
its first file.

`lastActivityAt()` (`scripts/worktree-sweep.ts:225-246`) takes `Math.max()` of three
signals: HEAD's commit date, the branch reflog top, and
`statSync(.git/worktrees/<name>).mtimeMs`. The third is documented as the fallback
for a **detached** worktree, which has no branch and so no branch reflog.

### The defect

In `gatherAll()` (`:262-284`) `checkFor()` runs **before** `lastActivityAt()`, and
`checkFor` is `gather()` from `scripts/worktree-check.ts`, which at `:612-613` runs
`git status --porcelain` twice inside that worktree. `git status` refreshes the index
and writes it back through `index.lock` + rename, which changes the **directory**
mtime. `lastActivityAt()` then reads that stamp as evidence the tree is alive.

Reproduced directly:

```
before:        1788806483
after status:  1788806491     <-- git status --porcelain in the worktree
after diff:    1788806491
```

`git log` and `git rev-parse` do not stamp it. Only the index write does — which is
why this is a *directory* mtime and not a file one.

Measured across the live worktrees, admin mtime against real activity:

```
                                       admin mtime   HEAD reflog   last commit
a5-mode-surface                        1788805008    1788803745    1788803745
agent-a8b787452ea1b7081                1788803916    1788358078    1788358078
api-dispatch-by-domain                 1788805623    1788803294    1788803294
now = 1788806538
```

(The middle column is read with `%ct` and so is identical to the right-hand one —
that is a second defect, and § *(b)* below is about it.)

`agent-a8b787452ea1b7081` was last touched **5.2 days ago** and classifies as
"active 1 min ago". Every worktree does. `worktree:sweep` is a permanent no-op, and
its output — `nothing to remove.` — is exactly what a healthy tree would print.

### Why no test caught it

`tests/worktree-sweep.test.ts` runs against **real** git worktrees, not mocks, so
the self-stamp really happens there too. It is invisible because the tests inject
`now` **forward**: `classifyAll(primary, { now: now() + (MIN_IDLE_HOURS + 1) * HOUR })`.
Activity stamped at real-now still reads as 25 hours idle against a `now` 25 hours in
the future. The suite moves the clock rather than the worktree, and that is precisely
the axis the bug lives on.

### The fix — two halves, and they are not duplicates

**(a) Stop writing to a tree we are only reading.** `GIT_OPTIONAL_LOCKS=0` in the
environment of `run()` in `scripts/worktree-check.ts` — set once for the whole
inspector rather than as a flag on the two `status` calls, so it cannot regress
call-by-call the next time somebody adds a command there. Same effect as
`git --no-optional-locks`; measured in this worktree:

```
git status                         1788806816 -> 1788806846   STAMPED
git --no-optional-locks status     1788806846 -> 1788806846   no stamp
git status (again, index fresh)    1788806846 -> 1788806846   no stamp   <-- WRONG, see below
git log -1                         1788806846 -> 1788806846   no stamp
```

**The third line of that is an artefact and the correction matters.** These are
whole-second timestamps and those two calls landed in the same second; Sol re-measured
with real gaps and `git status` stamps the directory **whether or not the index needed
writing**, because taking `index.lock` at all — creating and unlinking it — modifies
the directory:

```
status with a FRESH index: 1788811003 -> 1788811005  STAMPED
GIT_OPTIONAL_LOCKS=0     : 1788811005 -> 1788811005  no stamp
```

The conclusion is unchanged and the stated mechanism was wrong, which would have
misled whoever read this next — an uncalibrated measurement inside the plan about
uncalibrated measurements.

This is worth doing on its own account, separately from the sweep. `worktree:check`
is an inspector, and it currently writes the index of a worktree **another agent is
working in** — contending with their git commands for `index.lock` for no benefit to
anybody. A read-only tool should be read-only.

**(b) Read the reflog's own timestamp, which the code does not currently do.**

My first version of this fix was to swap the mtime for the worktree's HEAD reflog,
`git log -g -1 --format=%ct HEAD`. **That is wrong, and wrong in the dangerous
direction.** `%ct` is the *commit's* committer date; asking for it on a reflog walk
does not give you the reflog entry's time. Measured in a scratch repo, a worktree
created *this second* from a commit dated 2026-01-01:

```
                             %ct(HEAD)   %gd(HEAD)   %gd(branch)
detached @ ancient commit      5994.9h       0.0h          —
attached, fast-forwarded       5994.9h       0.0h        0.0h

raw: HEAD@{1788807113}     now = 1788807113
```

`%gd` with `--date=unix` gives the entry's own time; `%ct` gives the ancient commit.
So the fix is **`git log -g -1 --date=unix --format=%gd <ref>`**, parsing the
`<ref>@{<unix>}` it prints, for both HEAD and the branch — HEAD because it is the one
a detached worktree has.

**This means the shipped branch-reflog signal is broken too**, and has always been.
`worktree-sweep.ts:229` reads it with `%ct`, so it returns the commit date — the same
number as signal 1, one line above it. Two of the three signals are the same value,
and the third is the one we stamp ourselves. `lastActivityAt` has only ever been able
to answer "when did something last write this worktree's index", and the sweep's own
`git status` is what writes it.

That also explains why the fast-forward case looked covered:

```ts
/* tests/worktree-sweep.test.ts:154 */
expect(row.facts.lastActivity).toBeGreaterThanOrEqual(headTime);
```

`lastActivity` is `Math.max(headTime, …)` computed from the same `git log -1
--format=%ct`, so this assertion is **vacuous** — `Math.max(x, …) >= x` for every
input. And the test's own comment says

> *Backdate the trunk commit far past the floor and check the worktree created just
> now is still held.*

— but nothing in the test backdates anything. The `beforeEach` commits with no date
override, so the "old" commit is a second old, and the trap the test names cannot
arise in it. A comment describing a setup the code does not perform, guarding an
assertion that cannot fail. That is the third and fourth instances of the class,
sitting inside the test written for the second one.

(a) alone would fix today's symptom. (b) is what makes the signal mean what its own
doc comment claims, and the failure is silent and in the dangerous direction, so it
should not rest on every future reader being careful.

**Had I shipped the `%ct` version, it would have been worse than the bug.** Fable put
the number on it: with the mtime gone and `%ct` in its place, a five-minute-old
worktree classifies as removable whenever `origin/dev`'s tip is more than 24 hours old
— a quiet weekend. That is exactly the accident the header says retired the previous
version of this tool, reintroduced by the fix for it.

Rejected: keeping the mtime but reading it *before* `checkFor`. Not mainly because of
the reorder — because a *directory* mtime is stamped by any reader's lock file, ours
or anyone's. An ordering constraint that nothing enforces is not a fix.

### Three signals become one

With the entry timestamp read correctly, the other two are **dominated** and go:

- a commit made in the tree writes a HEAD reflog entry at the same instant;
- a commit merged in is entered at merge time, which is later than its commit date;
- the branch reflog moves only when HEAD does, in a tree with a branch checked out —
  and a detached tree has no branch at all.

So `lastActivityAt` becomes one line, and `Math.max` over three numbers becomes
nothing. Fewer parts touching each other, which is the house preference and also the
honest description: there is one question here, *when did this worktree's HEAD last
move*.

Fail-closed cases, checked: with `core.logAllRefUpdates=false` the reflog read is
empty and exits 0, which parses to no signal → `null` → *"could not tell when it was
last active"* → keep. Reflog expiry (90 days by default) lands in the same place.

The mtime's remaining defender: an agent editing files for six hours without running
a single git command. That tree is *dirty*, and `blockers()` holds it on that ground
rather than on the floor. Fable measured the one real gap — `base`, detached, HEAD
last moved 162h ago while its index was touched 124h ago — and what is lost there is a
session's working directory, not data, in a tree that is clean and landed by
construction.

### Say which signal decided it

`active 1 min ago` is what hid this. The reason line becomes
`HEAD last moved 124.6 h ago — under the 24h floor`, so the next person to read a
sweep sees the quantity that was wrong rather than a verdict derived from it.

### The calibration test

Reading must not count as activity, asserted directly:

```
lastActivity of a fresh worktree
  → sleep past a second boundary
  → classify again
  → the two must be equal
```

With the bug the second value is larger. Written and watched red before any fix:

```
AssertionError: expected 1788806971 to be 1788806970
```

One second apart — the signal is tracking the wall clock, not the worktree.

### The second calibration test, and the rule it stands for

The classify-twice test above is good but not sufficient: it passes against **both**
broken forms, because commit dates do not drift either. The one that separates them is
to **age the fixture**: create the worktree from a commit backdated 48 hours with
`GIT_COMMITTER_DATE`, classify with the **real** `now`, and expect a keep whose only
reason is the floor. That is red against `%ct`, red against a bare commit date, and
green only when the reflog entry time is read.

The general rule this file needs, and the reason it was blind:

> **Age the fixture, do not move the clock.**

Nine assertions here do `now() + N * HOUR`. Every one of them is blind on exactly the
axis this bug lives on — activity stamped at the real now still reads as a day idle
against a `now` a day in the future. The clock was the wrong thing to make injectable;
it is the artefact's age that carries the meaning. The existing vacuous fast-forward
test gets rewritten this way too.

### What it changes on the box

Simulating the fixed floor against the eighteen live worktrees, seven clear it —
`base` at 162.9h, `agent-a8b787452ea1b7081` at 124.7h, `structure-mode` at 78.5h,
`feedback-cap-admin` at 74.1h, and three more; every other tree stays held. They still
have to satisfy every `worktree:check` blocker afterwards; the floor simply stops
being universal.

On these particular trees the corrected reading and the naive `%ct` one agree, because
each is an ordinary attached branch whose last commit really is its last activity. The
difference appears only in the detached and fast-forward cases — which is exactly
where the guard earns its keep, and exactly where `%ct` is silently 250 days wrong.

---

## Bug 2 — `check:staged-revert` cannot read a merge

### What it does

`scripts/check-staged-revert.ts` is the first line of the commit recipe every agent
runs ([version-control.md § Commit your own files, by name, in one
command](../project/version-control.md#commit-your-own-files-by-name-in-one-command)).
It asks whether the staged content of a path is byte-identical to what that path held
*before* one of its own commits — a revert sitting in the index. It was written after
six hours of phantom reverts on 2026-08-29.

### The defect

It only ever consults `HEAD`. `MERGE_HEAD` appears nowhere in the file.

During a merge the index legitimately holds the incoming side's content. If the branch
being merged deliberately went back — reverted something, deleted a file — the staged
blob matches an older state of that path and the check calls it a revert. Hit on
2026-09-06 mid-merge: four findings, all four `origin/dev`'s own deliberate work
arriving (`219c4bc1`, retiring the `SPIDERYARN_STORE` tombstone).

Reproduced from scratch rather than from the anecdote. A scratch repo where `dev`
deliberately retires a tombstone this branch never touched, then `git merge --no-commit`:

```
merge left MERGE_HEAD: 1f4c6d2e  (exit 0)
staged vs HEAD:
  M       live.ts

--- check:staged-revert says ---
  ✗ live.ts
      staged content is exactly what this path held before ea9af46 — "add the tombstone"
      ...
      Do NOT `git commit` or `git commit -a` until it is cleared;
      `git reset -- <those paths>` restores the index from HEAD and touches no file on disk.
```

**It fails in the dangerous direction**, and worse than "a false alarm". Its advice —
`git reset -- live.ts` — during a merge unstages the incoming deletion and puts the
retired tombstone back. The guard whose whole purpose is stopping an agent from
undoing somebody's committed work is, mid-merge, instructing them to do exactly that.
An agent following the recipe to the letter gets a wrong answer and a wrong remedy.

There is no test file for this script at all, which is why nobody found it.

### Why "it cannot judge mid-merge, so say so and stop" is the wrong answer

This was the tempting option — the honest-sounding one — and it is wrong for a reason
worth writing down. Mid-merge, **this repo's own commit recipe does not work**:

```
$ git commit -m "just this one" -- unrelated.txt
fatal: cannot do a partial commit during a merge.
```

The pathspec form that makes an agent's commit safe from everyone else's index is
refused during a merge. The only way to conclude a merge is a whole-index
`git commit` — precisely the form this check exists to guard, and the form CLAUDE.md
otherwise forbids. **Mid-merge is when the check matters most, not least**, so a guard
that stands down there stands down at the only moment it is load-bearing.

(That is also a gap in the docs, and not one this plan fixes: the recipe in
`version-control.md` is written as though it always applies, and mid-merge it cannot.)

### The fix

When `MERGE_HEAD` exists, compute what the merge *should* produce and compare the
index against that:

```
T = git merge-tree --write-tree HEAD MERGE_HEAD
```

A staged path whose blob equals `T:<path>` — or which is absent from both the index
and `T` — is the merge doing its job. Count those and say
`merge in progress, N paths explained by it` rather than going quiet.

**Not `MERGE_HEAD:<path>`, which was my first rule and has a real hole.** A path
changed only on *HEAD's* side has `MERGE_HEAD:P == base:P`, so staging the base
content — a genuine revert of this branch's own commit — matches `MERGE_HEAD:P` and
is excused. Reproduced:

```
CLAIM 2  staged a.txt      = 078f94bbce
         MERGE_HEAD:a.txt  = 078f94bbce
         base:a.txt        = 078f94bbce
         MERGE_HEAD rule would excuse this genuine revert: YES — the hole is real

         merge-tree --write-tree -> 8a7c028afa (exit 0)
         merge-tree's a.txt      = a19f1f8c81
         merge-tree rule catches it: YES
```

`merge-tree` costs the same one git call and closes it, so there is no reason to ship
the weaker rule. Reachability of the hole is admittedly low — git refuses to *start* a
non-fast-forward merge over a stale index — but it is reachable by a peer in the
shared primary, which is the situation this whole file exists for.

### The rest of what is wrong with that file, found on the way

- **Conflicted paths are silently skipped.** `git rev-parse :<path>` fails on an
  unmerged path, so `U` entries produce no finding and no mention. It should say
  `N paths still in conflict, not judged`.
- **stderr leaks** into the output: `fatal: path 'd.txt' exists on disk, but not in
  'HEAD'` for an added path, and `fatal: invalid object name '<root>^'` at a root
  commit. `objectId()` swallows the exception but not the child's stderr.
- **`git revert --no-commit` and `git cherry-pick --no-commit`** produce exactly the
  false alarm this fix removes for merges, with the staleness lecture attached. Five
  `existsSync` lines (`CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge/`,
  `rebase-apply/`, and a `MERGE_HEAD` with more than one line — an octopus) that say
  *cannot judge during a `<op>`* and exit 1. Cheap, and unlike the merge case exiting
  1 there is right, because those operations do not force a whole-index commit.
- **If `merge-tree --write-tree` fails** (git older than 2.38; the box is 2.43), say so
  and exit 1. Never fall back quietly to the HEAD-only judgement — a quiet fallback to
  the broken rule is how this class survives a fix.

### One corner that stays

A conflict resolved by hand *to theirs*, where theirs is an older version of the path,
still reads as a revert. It is named in the header rather than special-cased: the
alternative is to excuse every path in the conflict list, which would blind the check
precisely where a human just made a judgement call.

### The calibration test

The script's `git()` closes over the process cwd, so nothing can be tested against a
scratch repo. Thread a `cwd` through and export the finding logic, then two tests
that are each other's control:

- **positive** — a real staged revert is still caught, mid-merge and not
- **negative** — the incoming side of a merge is not a finding

The positive control is the whole point. Without it this fix is indistinguishable
from switching the check off.

---

---

## The class, which is worth more than either fix

Both of these are usually named *a check that agrees with the thing it watches*. That
is not quite it. The sharper name, and the one that generalises:

> **An instrument the workflow itself disturbs.**

One tool wrote the signal it then read. The other had no model of a state that the
daily workflow — merging `origin/dev` several times a day — puts the index into.
Neither is a logic error; both are measurement errors, and both were invisible because
the disturbed reading is the *normal* reading here.

Three cheap moves fall out, and they are what to carry away:

1. **A read-only tool gets read-only git by construction** — `GIT_OPTIONAL_LOCKS=0` in
   the environment of the one `spawnSync` seam, not a flag remembered at each call
   site. The property should hold for commands nobody has written yet.
2. **A time-based guard is tested by ageing the artefact, never by advancing the
   clock.** An injectable `now` looks like the testable design and is the one thing
   that cannot catch a signal stuck to the present.
3. **A verdict prints the signal that decided it.** `active 1 min ago` was read
   eighteen times without suspicion; `admin dir touched 1 min ago, HEAD last moved
   124 h ago` would have been read as wrong by the first person to see it.

And the one [260906e](../postmortems/260906e-a-guard-that-agreed-with-the-thing-it-was-watching.md)
already ranks first, which applies squarely here: **a guard never seen to fire truly
is unproven.** The sweep has never printed `REMOVABLE` on this box. The check has only
ever fired falsely. Both belong in that postmortem's ledger, and the first true firing
of each should be recorded here when it happens.

## Deliberately not in scope

- **The `noDescendingSpecificity` findings, the misfiled CSS sections** and the rest
  of A10's `§ Left undone` — unrelated, tracked in
  [260906d](260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md).
- **`worktree:check`'s ignored-paths blocker.** Several of the seven worktrees that
  clear the fixed floor will be held by it instead, over build and test logs in
  `logs/` — the same thing that blocked me on 2026-09-06. Whether logs should count
  as work is a real question and a separate one.
- **Installing the pre-commit hook** that `version-control.md` says is still missing.
- **Judging a cherry-pick, revert, rebase or octopus merge.** Those get five
  `existsSync` lines that refuse to judge and exit 1 — in scope, because a
  `git revert --no-commit` fires the same false alarm today. Working out what the
  right answer *is* during one is not.
- **The recipe's mid-merge gap in `version-control.md`.** `git commit -F msg --
  <paths>` cannot run during a merge, and the doc that prescribes it does not say so.
  Its wording is a rule, so it goes through
  [edit-important-docs.md](../reusable/edit-important-docs.md) as a before/after for
  Greg, not with this change.
- **Removing any worktree.** This change makes the sweep *able* to offer removals.
  Acting on them is Greg's call, one at a time, which is how `removeOne` is built.

---

## The review ledger, and what it changed

Fable first, on the plan's first draft; GPT Sol on the revision. **Sol overruled Fable
on four points and me on three**, and the shipped fix is neither of my first two
designs. Every claim below I reproduced myself before acting on it.

### What Sol found that neither of us had

**A stale index equal to `HEAD` during a merge silently drops the entire merge, and
the guard says `✓`.** This is the blocking finding, and it is the original 2026-08-29
incident's exact shape:

```
git diff --cached HEAD  : EMPTY (nothing to judge)
check:staged-revert     : exit 0 — ✓ nothing in the index undoes a commit
commit succeeded with    : 2 parents
incoming.txt in the tree : NO — the merge was silently dropped
```

No per-path rule can see it, because there are no differing paths to walk. The
incoming commit becomes an *ancestor*, so `merge-base --is-ancestor` — the test
`worktree:check` uses for "did it land?" — says yes while the code is gone. That
killed the per-path `merge-tree` design and replaced it with whole-tree equality,
which is also less code.

**`unknown` exited 0.** A run whose only output was "could not tell" printed a leading
`✓` and passed. That is the file's own subject matter, in the file. Now a `Judgement`
union with an exhaustive `switch` and no `default`, so a fourth state fails the
typecheck rather than inheriting whatever the last branch did.

### Where Sol overruled Fable, and Sol was right

Fable said make the HEAD reflog the **sole** signal. Sol said keep the maximum of
three, and demonstrated why: **a reflog entry inherits `GIT_COMMITTER_DATE`**, so an
ordinary backdated commit backdates the entry too.

```
CLAIM 3  reflog entry after a backdated commit: HEAD@{1768435200}  (5659.9h old)
         BACKDATED — reflog time is spoofable
```

Reflog time is not authoritative. And once the inspector stops stamping the admin
mtime, that signal's remaining error is *over*-reporting activity, which only ever
delays a removal — the safe direction. Dropping an independent conservative signal is
the dangerous one. So: HEAD reflog entry, branch reflog entry, admin mtime, maximum of
the three; commit date dropped.

Two more of Fable's suggestions cut on Sol's evidence:

- **The cherry-pick / revert / rebase markers.** On git 2.43 a clean
  `git cherry-pick --no-commit` leaves **no** `CHERRY_PICK_HEAD` at all, so the guard
  would not have covered its own stated case. Verified: `ABSENT`.
- **Threading `cwd` through production code so tests could reach in.** The tests spawn
  the real CLI with `{cwd: scratch}` instead. What matters is the exit code an agent's
  shell sees, and an import-based test cannot check that. Nothing in
  `check-staged-revert.ts` changed shape to be testable.

### Where Sol corrected me

My `git status (again, index fresh) → no stamp` measurement was **uncalibrated** —
whole-second timestamps, same second. Re-measured with real gaps:

```
CLAIM 4  status with a FRESH index: 1788811003 -> 1788811005  STAMPED
         GIT_OPTIONAL_LOCKS=0        : 1788811005 -> 1788811005  no stamp
```

`git status` stamps the admin directory *whether or not the index needed writing* —
taking `index.lock` at all is a directory modification. The conclusion held; the stated
mechanism was wrong, and the wrong mechanism would have misled the next reader.

Sol also caught that my aged-fixture test committed only in `primary`, leaving the
worktree ahead of `origin/dev`, so its `keep` could have been true for the wrong
reason. And it rejected my blanket "never advance the clock" rule: advancing `now` is
correct for pure `classifyOne` tests; ageing the fixture is what acquisition tests
need. That is the sharper form and is what the helper's docblock now says.

## Calibration: every test watched red first

| Test | Mutation | Red message |
|---|---|---|
| reading is not activity | *(the bug as shipped)* | `expected { at: …206 } to deeply equal { at: …205 }` |
| " | remove `GIT_OPTIONAL_LOCKS=0` | same, one second apart |
| worktree aged by creation, not by HEAD | drop mtime, keep `%ct` | `expected 432000 to be less than 3600` |
| clean merge passes | restore merge blindness | `expected 1 to be +0` |
| dropped merge is caught | " | `expected +0 to be 1` |
| hand-resolved conflict stands aside | " | `expected +0 to be 1` |

The third row is the one that matters most in hindsight: **432000 seconds is exactly
five days**, and it is what a worktree created *that second* would have reported under
the fix this plan originally proposed.

## What the sweep says now

Still `nothing to remove`, and now for reasons a person can act on — ignored paths git
has no copy of, uncommitted files, unlanded commits — rather than a uniform
`active 1 min ago`. Naming the signal earned its keep on the first run:

```
keep      worktree-feedback-cap-admin
            2 ignored paths git has no copy of
            git was last run here 2.1 h ago — under the 24h floor
```

A cluster of trees all reading exactly `2.1 h` is the fingerprint of the last run of
the *broken* sweep, which stamped every tree it looked at. That residue ages out within
24 hours, after which those trees become judgeable on their merits for the first time.
It is visible as a cluster only because the verdict now names its evidence.

## Left undone

- **The mid-merge gap in the commit recipe.** `git commit -F msg -- <paths>` is refused
  during a merge, and `version-control.md` prescribes it without saying so. Its wording
  is a rule, so it goes to Greg as a before/after under
  [edit-important-docs.md](../reusable/edit-important-docs.md).
- **`worktree:check`'s ignored-paths blocker**, which now holds most of the trees the
  floor used to hold. Whether build and test logs under `logs/` should count as work is
  a real question and a separate one.
- **The first true firing of either guard** is still unrecorded, because neither has
  had one. A guard never seen to fire truly is unproven, and both remain so.

---

## One day later: the constraint moved, it did not go away

Re-measured 2026-09-08, with the fix on `dev` and running from a tree that has it.

**The floor is honest now.** Verdicts name their signal, the values are real, and the
`2.1 h` residue predicted above did age out. Two brand-new trees are held by the floor
*alone*, which is exactly what it is for.

**And almost nothing became removable, for a reason this plan put out of scope.**
Of eighteen trees, all but two carry a non-floor blocker, and on eleven of them it is
the same one:

```
FAIL 1 ignored path git has no copy of
     logs/
```

`logs/` is where `scripts/tmux-job.ts` writes, and CLAUDE.md tells every agent to use
`tmux-job.ts` for long jobs. **So the prescribed tooling generates the thing that
blocks teardown**, on every tree that has ever run a test suite or a review. The age
floor was never the binding constraint; it was merely the one that fired first and
hid the next one.

The disk went the wrong way meanwhile — 14G over 16 worktrees on 2026-09-07, **15G
over 19** now, with 20G free. Roughly three worktrees a day arriving and none leaving.

That is not an argument against this change: an honest floor is a precondition for
anything else, and until it landed the second blocker was invisible behind the first.
It does mean the *goal* — reclaiming finished worktrees — needs one more decision, and
it is a product call rather than an engineering one:

> **Should build and test logs count as work that blocks removal?**

They are rebuildable by definition, and `worktree-check.ts` already has the concept —
`disposable`, for ignored paths it recognises as regenerable, which are counted rather
than listed. Adding `logs/` to that set is a small change to one classifier. What makes
it Greg's call and not mine is that it is a *safety* classifier: the argument for the
current behaviour is that "rebuildable" is a claim about the future, and the file that
refuses to guess is the one that has never lost anybody's work.

A second, smaller residue: a tree running a checkout from before this fix still stamps
every worktree it sweeps, so a synchronised cluster can reappear (`6.0 h` on six trees
today). Self-limiting as worktrees turn over, and harmless while `logs/` holds
everything anyway.
