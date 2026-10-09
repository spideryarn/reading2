# A live claim can lose a removal trigger

Up: [postmortems.md](../project/postmortems.md) · change: [plan 261008j](../plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md)

Found before the public-topic change shipped. An un-share during a running public rethink found
the live claim and started no duplicate work. The rethink then wrote its older nine-card snapshot
onto the now-eight-card shelf. The arrival drain saw no additions and returned, leaving every
public topic withheld until another trigger. Privacy remained protected; automatic updating failed.

The class is **lost invalidation behind an in-flight lease**. Preventing duplicate work is correct,
but the change that made work necessary was never replayed. An additions-only drain is not a
reconciliation of a shelf that can also lose articles.

The live-claim and arrival-drain mechanisms date to `062ef8404` (261003f); the defect arose when
the uncommitted 261008j change relied on them to remove withdrawn public input. Previously a
reader's removed membership was harmless. Existing tests simulated additions during a rethink,
but removals only between completed requests.

The regression withdraws an article inside the fake naming call and runs the overlapping trigger.
Before the fix it failed because the final result still had property `a1`.

`src/public-shelf-topics.ts` now makes one further coordinator decision after actual refresh work
finishes, within the same site scopes and request collector. Its next job takes a separate
allowance after the original one finishes. The coordinator skips draining arrivals into a public
tree with withdrawn input, releasing the claim for reconciliation. Reader behavior is unchanged.

Countermeasures, ranked by effort against value:

1. **Test a removal during the leased operation**, including removal plus arrival. Added to
   `tests/shelf-topic-sets.test.ts`, checking final public projection and allowance ordering.
2. **Reconcile once after completing the work**, not just drain additions. Implemented for the
   public composition. Further concurrent changes or a refused allowance can still leave topics
   hidden until a later trigger; this pass is deliberately bounded.
3. **Persist a dirty version and retry from a durable worker** — a stronger eventual-update design,
   deferred because this change uses request-owned work and has no worker or scheduler. Unbounded
   immediate retries were rejected: they can extend a request indefinitely under listing churn.
