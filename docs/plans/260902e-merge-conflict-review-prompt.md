# Merge conflict: a lock refactor meets a widening of what the lock holds

Repository root is this working directory — a git worktree of Spideryarn, branch
`worktree-article-job-queue`, **with an unfinished merge in progress**. Read-only: do not edit
anything, do not run `git merge --abort`, do not `git checkout --ours/--theirs`. I want a proposal,
not a resolution.

`git merge origin/dev` left three conflicted paths:

```
docs/project/ingest-queue.md
drizzle/meta/_journal.json
src/store/jobs-fs.ts
```

**Only `src/store/jobs-fs.ts` is why I am asking you.** The other two look purely additive to me and
my proposal for them is at the bottom — tell me if I am wrong about that, briefly.

## The two sides, and the history behind each

**Mine (`HEAD`, two commits: `540927f` and `750672c`).** A per-article job queue. `jobs_active_slug`
became four partial unique indexes, the per-article rule moved from enqueue time to claim time, and
`enqueueOrGet` now takes an `EnqueueTicket` instead of a bare work key. In this file that shows up
as **`keys: Map<string, string>` (work key only) becoming `tickets: Map<string, EnqueueTicket>`**
(work key, plus `reservesName: boolean` and an optional `urlKey`) — because a name reservation and a
source claim are two more facts that have to survive a restart and must stay off the public `Job`
type, exactly as `workKey` does. The plan is
`docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md`; the
built code was reviewed by you earlier today
(`...-code-review-sol.md`) and the findings are fixed in `750672c`.

**Theirs (`origin/dev`, commits `4813411` "The fence was a variable in a module, and the module kept
coming back" and `b133c8d` "Apply GPT Sol's review of the fence: SHIP WITH CHANGES").** The
module-level `Map`s became a `QueueState` object held in `processSingleton()`
(`src/process-state.ts`). This is the fix for a real incident: saving any file the dev server
imports re-evaluates every server module *in the same process* without stopping the request already
inside a step, so the new copy began with empty Maps, `sweepStopped` handed the running job back
out, and the browser restarted the same eight-minute model call — eleven times on one job, $5.43.
The write-up is `docs/postmortems/260902c-the-truncation-retry-cost-storm.md`. Read it; the reasoning
about *why* a second copy of a lock is not a slower lock but no lock at all is the thing I must not
break.

## The three hunks

They are in the working tree with conflict markers, around lines 76, 177 and 844 of
`src/store/jobs-fs.ts`. In short:

1. The declarations. Mine: six module-level `const`s including `tickets`. Theirs: the `QueueState`
   interface, a `processSingleton<QueueState>("jobs-fs", "2026-09-02", …)` call whose second argument
   is a version string their own comment says to **bump whenever a field is added or renamed**, and a
   destructuring `const { index, attempts, keys, forgotten, writes } = state;` that keeps the rest of
   the file reading as it did. Note their comment explaining why `loaded` and `writeCounter` had to
   move inside the object too.
2. `persist`. Mine: `++writeCounter` and `const stored: Stored = { ...job, ...ticket }`. Theirs:
   `++state.writeCounter` and `{ ...job, ...(workKey !== undefined && { workKey }) }`.
3. The test-only reset. Mine: `tickets.clear(); loaded = null;`. Theirs: `keys.clear();
   state.loaded = null;`.

## My proposal, which I want you to attack

Take **their** structure wholesale — `QueueState`, `processSingleton`, the destructuring, `state.`
for the two scalars — and carry **my** field inside it: `keys: Map<string, string>` becomes
`tickets: Map<string, EnqueueTicket>`, with `tickets` added to the destructuring and the singleton
version string bumped because a field changed name and type.

## What I actually want from you

1. **Is that resolution correct and complete?** Walk the rest of the file, not only the three hunks:
   git auto-merged everything else, and an auto-merge that compiles can still be wrong. In
   particular, every remaining use of `keys`/`tickets`, `loaded`, `writeCounter`, `index`,
   `attempts`, `forgotten` and `writes` — does each one now reach the singleton rather than a module
   local?
2. **The version string.** Their comment says bump it when a field is added or renamed. What
   actually happens on a dev-server restart where the old copy created the object under the old
   version and the new copy asks under a new one — does `processSingleton` throw, replace, or hand
   back the stale object? Read `src/process-state.ts`. If it replaces, is that safe *here*, given
   the whole point is that the running claim survives the restart? This is the part I am least sure
   about, and getting it wrong reintroduces the $5.43 bug in a new costume.
3. **Does anything in my change assume module-level lifetime** in a way their singleton breaks, or
   vice versa? `tickets` is read by `enqueueOrGet` to classify a conflict and written by `persist`;
   if a restart emptied it, what would go wrong, and is that better or worse than what it does now?
4. **Is `Stored` still right?** Mine spreads a whole `EnqueueTicket` into the file; theirs spreads a
   conditional `workKey`. `urlKey` is optional and `reservesName` is a boolean with a meaningful
   `false`, so a naive spread and a naive reload can disagree about a missing field. What should the
   on-disk shape be, and what should a record written before this change read back as?
5. Anything else in the merge you would want a second pair of eyes on.

## The other two conflicts

- `drizzle/meta/_journal.json`: both sides appended an entry at `idx: 52`. Mine is
  `0052_per_article_job_queue` (`when` 1788351034981), theirs is
  `20260902141103_byok_upstream_nanos` (`when` 1788358263301). Proposal: keep both in `when` order,
  mine 52 and theirs 53. Their migration is timestamp-named rather than numbered, so no file needs
  renaming. Confirm or correct.
- `docs/project/ingest-queue.md`: two new sections landing in the same place, on different subjects.
  Proposal: keep both, mine first. Confirm or correct.

Be concrete and quote lines. If my proposal is right, say so plainly and briefly rather than padding
it.
