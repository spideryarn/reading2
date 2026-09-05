## Verdict: refuse

Three established P1s remain: eviction can delete a write while reporting success, the deadline is per transaction rather than per public operation, and a rejected transaction callback can commit partial state.

### F14 — P1 — established: eviction can delete the body just written and return `true`

[`writeCached`](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/src/web/lib/offline-store.ts:479) stamps the new row with `Date.now()`, then [`evict`](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/src/web/lib/offline-store.ts:569) ranks solely by that wall clock.

(a) I seeded 100 articles with `lastOpened = 2000`, moved the clock back to `1000`, and saved a new article. The harness produced:

```json
{"accepted":true,"rowPresent":false,"count":100}
```

The commit succeeded, eviction considered the newly received article oldest, deleted it, and `writeCached` still returned `true`. Equal timestamps can produce the same result through the index/primary-key tie order. This violates the module’s explicit success contract and loses an article the reader just received.

(b) Smallest repair: protect the just-committed slug from that invocation of eviction and evict another candidate. Add a full-cache test with pre-existing future/equal `lastOpened` values. A logical recency counter would additionally make “reading keeps it alive” robust to clock rollback.

### F15 — P1 — established: one public operation gets multiple 3-second budgets

[`writeCached`](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/src/web/lib/offline-store.ts:467) runs a bounded commit and then awaits a separately bounded eviction at [line 505](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/src/web/lib/offline-store.ts:505). Opening has another independent deadline.

(a) I held the commit transaction for two seconds, queued a second lock behind it to hold eviction, and measured the single call:

```json
{"accepted":true,"elapsedMs":5004}
```

The existing deadline test permits anything under ten seconds, so it does not assert the plan’s “every public operation bounded by its own deadline” requirement.

(b) Give each public call one absolute deadline and pass its remaining budget through `open`, commit, and eviction. Add a two-lock test asserting the whole call, not each constituent transaction, is bounded by `DEADLINE_MS`.

### F16 — P1 — established: rejected work is not aborted, allowing a partial commit and stale overwrite

[`bounded`](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/src/web/lib/offline-store.ts:308) converts a rejected `work` promise directly to `{ ok: false }`; only the timer calls `tx.abort()`.

(a) I injected a synchronous IndexedDB failure on the `meta.put(commit)` after the response `put` had succeeded. The transaction then auto-committed the response without its commit row. The older ticket subsequently overwrote it:

```json
{
  "newerAccepted": false,
  "bodyAfterPartial": {"which":"new"},
  "olderAccepted": true,
  "finalBody": {"which":"old"}
}
```

The same shape can leave retirement deletes committed without the epoch advance. The existing timeout test aborts a transaction that has not begun executing, so it cannot detect either partial-write case.

(b) On any `work` rejection, attempt `tx.abort()` before resolving `{ ok: false }`, and consume the resulting `tx.done` rejection. Add fault-injection tests after the first store write/delete and assert both stores roll back.

### F17 — P2 — established: the replacement test does not cover the old clock-inversion input

The replacement pair at [offline-store.test.ts:291](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/tests/offline-store.test.ts:291) correctly covers both commit orders, but it does not prove clocks are absent from the decision.

(a) Reintroducing `existing.savedAt > now` alongside the sequence fence would leave both replacement tests green under their ordinary timestamps. A backwards clock adjustment would then reject a genuinely later ticket—the regression the removed future-stamp input detected.

(b) Keep the new pair, and add the old setup with the corrected expectation: forge the existing row’s `savedAt` into the future, then assert a later ticket returns `true` and replaces it.

### F18 — P3 — established: the plan still contradicts its correction

The plan correctly says the sign-out test cannot distinguish where the epoch advances at [lines 294–300](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:294), but its completed checklist still says that test fails when the advance is outside the delete transaction at [lines 327–329](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:327).

(b) Replace the latter claim with the actual reason: atomicity is required for failure containment but is not asserted by that test.

Transaction review otherwise found no external awaits inside live transactions: the awaits are IndexedDB requests or `tx.done`; both `getAllKeys` calls in `sweep` are legal, and the `MAX_COMMITS + 1` threshold is correct. Swallowing `tx.done` itself does not hide failures in write paths because those paths also await it; F16 is the separate rejection-before-`tx.done` hole.

The v1→v2 path correctly clears `responses` and creates `meta` in the same upgrade transaction. Repeated `abandon()` calls and the no-IndexedDB case did not reveal an additional failure. The `\uffff` bound is not universal for arbitrary JavaScript strings, but it covers this app’s slash-prefixed, percent-encoded URLs.

Verification:

- Requested tests: 34/34 green.
- Four other candidate cache suites: 69/69 green.
- Throwaway ordering/deadline/failure harnesses were under `/tmp`; no repository file was changed.
- I attempted the file-only harness in system Chrome, but this sandbox killed Chrome at launch with `SIGTRAP`/`setsockopt: Operation not permitted`. I therefore cannot claim a real-browser run; the auto-commit conclusion above is from transaction inspection plus `fake-indexeddb`.