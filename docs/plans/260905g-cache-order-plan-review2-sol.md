## Verdict: refuse

The reserved-ticket comparison is sound, but two established P1s remain: recovery can expose data that a failed retirement should have removed, and bounding only `open()` does not make every public operation settle.

### F9 — P1 — established: cooldown recovery resurrects data whose retirement never ran

(a) When a v1 connection blocks the upgrade:

1. A legacy cached comments row exists.
2. The v2 page successfully deletes the comment.
3. `invalidate` attempts `open()`, receives `null`, and returns without deleting the body or advancing the epoch.
4. The old tab closes.
5. After the cooldown, v2 opens and preserves the legacy row.
6. A later failed GET serves the deleted comment.

The same applies to `forgetUser`: cooldown recovery can expose the signed-out reader’s preserved rows. The fire-and-forget invalidation at [api.ts:672](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/src/web/lib/api.ts:672) provides no retry or recovery debt.

A `fake-indexeddb` harness produced:

```json
{"blocked":true,"retirementCouldRun":false,"staleBodyAfterRecovery":{"comments":["deleted later"]}}
```

Thus the cooldown weakening does reintroduce wrong data, not merely a missed cache write.

(b) Smallest closing change: recovery must remain disabled until every `invalidate`/`forgetUser` that failed during the unavailable interval has been applied. Record pending retirements before opening, replay them atomically before publishing a recovered handle, and test this exact blocked-upgrade sequence. If that fence must survive page reload, the debt needs durable storage; otherwise preserving every legacy row is incompatible with the guarantee, and the safe migration is to clear legacy bodies.

### F10 — P1 — established: the deadline bounds opening, not public operations

(a) [The plan](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:142) concludes that every public operation settles because `open()` settles. Once a handle already exists, however, any transaction can wait indefinitely behind a locked read-write transaction:

- `reserveTicket`
- the cache commit
- `readCached` and its touch
- `invalidate`
- `forgetUser`
- `cachedSlugs`
- eviction

A second `fake-indexeddb` harness held one read-write transaction open after the database had opened, then queued another:

```json
{"openAlreadySettled":true,"publicOperationSettled":false}
```

The open deadline is never consulted in that state, violating the explicit locked-database settlement contract.

(b) Bound the complete operation, including transaction completion. On expiry, abort the transaction and return the ordinary no-cache result. Merely racing `tx.done` is insufficient because the abandoned transaction could later write. A timed-out retirement must additionally enter F9’s fail-closed recovery state.

### F11 — P2 — reasoned: the proposed sweep is not actually bounded

(a) The sweep at [plan lines 218–220](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:218) triggers above a threshold but deletes only commit rows whose articles are no longer held.

If the owner has more than the threshold in commit rows whose articles remain held:

- advancing the epoch deletes nothing, leaves the count above threshold, retires live tickets, and repeats after every subsequent commit; or
- declining to advance when nothing is deleted leaves metadata unbounded and repeatedly scans it.

The first branch can continually leave newly loading articles partially cached; the second contradicts “bounded.”

(b) Define the sweep deterministically: on crossing the threshold, advance the epoch once, preserve `nextSeq`, and delete all of that owner’s commit rows. That genuinely resets the bound because the epoch retires every older ticket. Explicitly record and test the rare cost: all outstanding owner tickets are rejected. If that cost is unacceptable, omit the sweep from v1 and acknowledge that metadata remains unbounded until a more elaborate outstanding-ticket design exists.

### F12 — P2 — established: safe reservation cannot be pipelined as written

(a) The ticket needs the owner whose token will authorize the request, but current `apiFetch` learns that owner only from `await accessToken()` at [api.ts:451](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/src/web/lib/api.ts:451). Reserving concurrently requires either:

- a second lookup such as `lastKnownUser()`, reopening the already-fixed cross-account race; or
- an unmentioned speculative reservation plus owner comparison and fallback.

Therefore the cost claim at [plan lines 157–160](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:157) is not implementable from the stated mechanism.

(b) Await `accessToken()`, then reserve for its returned owner, then send. State honestly that this adds one IndexedDB round trip. A speculative fast path is possible but is unnecessary complexity here.

### F13 — P2 — established: Stage 1 still cannot be completed as specified

(a) Stage 1 says “No fix in this stage” and requires its red output to be recorded, but:

- the blocked-upgrade test becomes red only after Stage 2 changes `DB_VERSION` to 2;
- the “legacy v1 row survives the upgrade” control cannot exercise an upgrade until that same change exists.

So Stage 1 cannot produce the evidence its completion checkbox requires.

(b) Move blocked-upgrade and legacy-preservation checks into an explicit Stage 2 migration substage: bump to v2 without the deadline, observe the blocked test fail, implement the deadline, then run both migration controls.

## Suspicions resolved

- Commit-row deletion is causally safe only with an atomic epoch advance. The current sweep trigger is not safe operationally as specified; see F11.
- A fresh ticket for the post-refresh retry is correct. The retry is a newly issued request, may belong to a refreshed owner, and must observe any mutation between attempts.
- The cooldown is safe for failed reads/reservations, but unsafe after a failed retirement; see F9.
- An owner-wide mutation epoch can leave an article half cached: parts committed before the mutation remain while later parts are rejected. That is not F5 recurring—A0 explicitly accepts conservative owner-wide mutation retirement, while only eviction promises whole-article deletion—but the plan should state “possibly partial,” not imply “none.”
- The core ticket/epoch commit rule survived the ordinary GET, mutation, eviction, teardown, and retry interleavings I tested mentally. The blockers are failure recovery and transaction settlement around it.

No repository files were changed. The two harnesses were created under `/tmp`; I did not treat the concurrently written tests as part of the candidate.