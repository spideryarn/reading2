# A sweep that stamped the timestamp it read as activity

**2026-09-07.** `npm run worktree:sweep` had never removed a worktree and could not.
Its own inspection pass ran `git status` inside each tree, which stamped that tree's
admin-directory mtime, which it then read back as *this tree is alive*. Every worktree
on the box reported `active 1 min ago`; one had not been touched for five days.
Fourteen gigabytes of finished worktrees, eleven of them fully merged, sat behind a
guard that could never expire — while the tool's output, `nothing to remove.`, is
exactly what a healthy tree prints.

Found while answering a question about something else: *"would it solve this whole
class of issues if all agents worked in worktrees?"* Nobody was looking for this.

## The class

`docs/postmortems/260906e` calls it *a guard that agreed with the thing it was
watching*. Nine instances there, all in tests. These two are in **tooling**, and they
sharpen the name:

> **An instrument the workflow itself disturbs.**

Not a logic error in either case — a measurement error. One tool wrote the signal it
then read. The other had no model of a state that the daily workflow puts the index
into. Both were invisible because *the disturbed reading is the normal reading here*:
a sweep always runs its own inspection first, and agents merge `origin/dev` several
times a day.

## Four defects, stacked

They compound, and only the stack explains why nobody noticed.

1. **The self-stamp.** `worktree-check.ts`'s `git status` takes `index.lock` in the
   tree it is inspecting. Creating and unlinking that file modifies the directory, so
   the mtime moves **whether or not the index needed writing** — which also means an
   inspector was contending for a lock inside trees other agents were working in.

2. **`%ct` on a reflog is the commit's date, not the entry's.**
   `git log -g -1 --format=%ct <ref>` returns the committer date of the commit the
   entry points at. The branch-reflog signal was therefore a duplicate of the
   commit-date signal one line above it, and neither moved when a worktree was created
   or fast-forwarded — the two cases the reflog was added to cover. Measured on a
   worktree created that second from a January commit: `%ct` said 5994.9h, `%gd
   --date=unix` said 0.0h.

3. So **the contaminated mtime was the only signal ever reporting anything recent.**
   Remove it naively and the tool breaks worse than it was.

4. **The test for (2) could not fail.** `expect(lastActivity).toBeGreaterThanOrEqual(headTime)`
   where `lastActivity` is `Math.max(headTime, …)` over that same number. And its
   comment said *"backdate the trunk commit far past the floor"* while the code
   backdated nothing.

## The commit that introduced it

Not one commit. (1) and (2) shipped with the sweep; (4) shipped as its guard. The
compound bug required all of them, which is the honest answer and the uncomfortable
one: each looked reasonable in review, and the review that would have caught it is one
that ran the thing and read the number.

## The second guard, same shape

`check-staged-revert.ts` — the first line of the commit recipe every agent runs — only
ever consulted `HEAD`. Mid-merge it reported the incoming side's deliberate deletions
as reverts, and attached the advice `git reset -- <path>`, which mid-merge *restores
the file the other branch deleted*. The guard against undoing committed work,
instructing an agent to do it.

And underneath that, the case no per-path rule can see: **a stale index equal to
`HEAD` makes `git diff --cached HEAD` empty**, so there is nothing to iterate over.
The check printed `✓ nothing in the index undoes a commit`; the commit that followed
had two parents and none of the incoming work; the incoming commit became an
*ancestor*, so every "did it land?" test says yes while the code is gone. That is the
2026-08-29 incident's exact shape, approved by the guard written for it.

Its `unknown` state also exited 0 — a run that judged nothing was indistinguishable
from a run that found nothing, in the file whose whole subject is that failure shape.

## The fix that is right for the long term

- `GIT_OPTIONAL_LOCKS=0` on the **env of the one `spawnSync` seam**, not as a flag per
  call site, so a command added later cannot reintroduce the write.
- `lastActivityAt` reads reflog **entry** timestamps (`%gd --date=unix`) and keeps the
  maximum of HEAD reflog, branch reflog and admin mtime. Commit date dropped.
  The mtime stays deliberately: a reflog entry inherits `GIT_COMMITTER_DATE` and so
  can be backdated by an ordinary commit, and once we stop stamping it ourselves the
  mtime's remaining error only ever *delays* a removal.
- Mid-merge, one whole-tree question — `git merge-tree --write-tree HEAD MERGE_HEAD`
  against `git write-tree` — instead of a per-path walk. Equal is safe; anything else
  is `unknown`, exits non-zero, and never suggests `reset`.
- A `Judgement` union with an exhaustive `switch` and no `default`, so "could not tell"
  cannot be spelled as success.

## What would have caught the class

1. **A read-only tool gets read-only git by construction.** The property should hold
   for commands nobody has written yet, which means the env of the seam, not the
   discipline of the caller.

2. **Test a time-based guard by ageing the artefact, never by advancing the clock.**
   Nine assertions in `tests/worktree-sweep.test.ts` do `now() + N * HOUR`, and every
   one is blind on the axis this bug lives on: activity stamped at the real now still
   reads as a day idle against a `now` a day in the future. An injectable clock *looks
   like* the testable design and is the one thing that cannot catch a signal stuck to
   the present. (Sharpened by Sol: advancing `now` is right for pure-function tests of
   the classifier; it is acquisition tests that must age the fixture.)

3. **A verdict prints the signal that decided it.** `active 1 min ago` was read on
   eighteen worktrees without suspicion. `git was last run here 1 min ago` beside a
   five-day-old HEAD is read as wrong by the first person to see it. This paid out on
   the first run of the fixed tool: a cluster of trees all reading exactly `2.1 h` is
   the visible fingerprint of the last run of the *broken* sweep.

4. **A guard never seen to fire truly is unproven** — 260906e's first recommendation,
   and the one that applies hardest here. The sweep had never printed `REMOVABLE`.
   The check had only ever fired falsely. Neither absence was treated as information.

5. **Ask a reviewer that runs things.** Fable caught that my first fix would classify a
   five-minute-old worktree as removable after any quiet weekend — reintroducing the
   accident the tool's own header says retired its predecessor. Sol caught the dropped
   merge, the fail-open `unknown`, and one of my own measurements being an artefact of
   whole-second timestamps. Both reproduced rather than reasoned; neither finding was
   visible on the page.

## Done in this run

All four defects fixed; nine tests added, **every one watched red before the fix**,
with the red messages recorded in
[the plan](../plans/260907e-fix-the-two-guards-that-agree-with-the-thing-they-watch.md).
`check-staged-revert.ts` had no test file at all and now has eight.

Recommendation 2 is the one still wanting a home in
[silent-success.md](../reusable/silent-success.md), alongside the *paste the red
message* rule that 260906e left there for the same reason: both are rule-wording
changes to a `docs/reusable/` file, which CLAUDE.md routes through
[edit-important-docs.md](../reusable/edit-important-docs.md) one approved change at a
time.

---

Up: [postmortems.md](../project/postmortems.md)
