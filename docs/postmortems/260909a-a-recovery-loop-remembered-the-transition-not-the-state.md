# A recovery loop remembered the transition, not the state

The periodic readiness runner was caught in code review before it was started. Nothing reached a
reader. Two preparation steps were keyed only to files crossed by the latest fast-forward: if
`npm ci` failed after the branch advanced, the next tick saw no new diff and never retried it; the
migration arm also watched the nonexistent `supabase/migrations/` rather than this repository's
`drizzle/` directory. Both could leave Readiness unknown indefinitely, and a half-installed
`node_modules` could instead manufacture a sticky red commit.

Introduced by `0dc023fb`, whose intent was to avoid repeating expensive preparation on idle ticks.

## The class: transition-triggered recovery cannot converge after the transition is consumed

The loop treated “this path changed during the merge I just performed” as equivalent to “the state
derived from this path is current”. They differ exactly after failure: Git has already consumed the
edge, while installation or migration has not reached the state it was meant to establish. Catching
the exception in the outer loop preserved the process but not its ability to recover.

The sibling in the same runner was the fleet-client prerequisite. Its failed build was logged and
then deliberately followed by the suite known to need its output, because the comment still assumed
a thrown tick ended the process. Once tick failures were retried, that premise had become false.

## Why nothing went red

The focused tests covered the pure decision after all readings had already been gathered. They did
not exercise the impure boundary that advances Git, prepares derived state, fails, and enters the
next tick. The migration predicate was tested only by inspection of its intended clause, not with a
path from the repository it claimed to watch.

The review added the original failing evidence: a `drizzle/*.sql` path did not request migration,
and no restart-state function existed. The focused file went from 17 green tests to six red tests
before the repairs; three of those reds covered preparation and restart convergence.

## What would have caught it, ranked by ease against value

1. **Model preparation as pending state, initialised pending on every process start and cleared only
   after success.** Done. This directly represents the invariant and survives a failed tick; restart
   deliberately redoes the idempotent preparation.
2. **Use one real changed path from each owned directory in the pure classifier test.** Done for
   `package-lock.json`, `drizzle/*.sql`, and `drizzle/meta/_journal.json`.
3. **A fully injected two-tick integration harness.** Rejected for now. It would prove command order
   more literally, but needs seams for Git, npm, the database, the store, `/proc`, timers, and child
   processes. The state reducer plus success-only clearing closes the class without turning this
   small runner into a framework.

## The long-term fix

`PreparationNeeds` is state carried across ticks. Dependencies, migrations, and the fleet client
start pending; relevant changed paths make them pending again; only a successful command clears each
flag. A restart starts conservatively pending, so an interrupted install cannot be mistaken for a
prepared checkout. The migration input is the real `drizzle/` tree, and fleet build failure now
throws into the retrying tick boundary instead of running a suite against a missing prerequisite.

## The thing I would tell myself

I knew the loop had to recover from a throwing tick, but I checked only that control returned to the
`while`. In a recovery loop, returning is not recovery: I have to ask whether the next iteration can
still observe the unfinished obligation after the event that created it is already history.

---

Up: [postmortems.md](../project/postmortems.md)
