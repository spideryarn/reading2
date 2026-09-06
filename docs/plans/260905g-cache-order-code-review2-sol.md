## Verdict: refuse

F15–F18 are closed, but F14 remains open under a concurrent-write interleaving. That is an established P1: `writeCached` returns `true` for a row already evicted before the call settles.

### F14 — P1 — established: one write’s eviction can delete another concurrent write

The original single-write case is fixed: the old harness now reports:

```json
{"accepted":true,"rowPresent":true,"count":100}
```

However, [`evict()`](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/src/web/lib/offline-store.ts:636) only excludes its own `spare`.

(a) I started from 100 articles, blocked both stores, then queued commits A and B before either eviction could start. A received timestamp `1000`; B received `500`. The transaction order was commit A, commit B, evict A, evict B:

```json
{
  "firstAccepted": true,
  "firstPresent": true,
  "secondAccepted": true,
  "secondPresent": false,
  "count": 100
}
```

Eviction A saw 102 articles, spared A, and deleted B plus one old article. Eviction B then saw 100 articles and did nothing. B returned `true` despite already being absent.

The exclusion itself cannot under-delete: for `N > 100`, removing one candidate still leaves `N - 1 >= N - 100` candidates. The spared slug therefore cannot be the only candidate. `spare === ""` is harmless because empty slugs are excluded from `freshest` before filtering. A timed-out eviction can still leave the cache oversized, but that is the existing accepted independent-failure behavior.

(b) Smallest schema-free closure: after eviction, perform an exact-key, bounded presence check using the same deadline, and return `false` unless presence is confirmed. This makes concurrent eviction conservative without changing LRU ordering. A durable guarantee that concurrent writes cannot choose one another as victims would require shared pending-write metadata or logical recency—the larger design previously declined.

### F19 — P2 — established: the F15 test still depends on suite order

The new `onVersion2()` helper is correctly kept out of `seed`, and its placement in the two full-cache seeding helpers is sound. It does not paper over the upgrade test.

But the new F15 test at [offline-store.test.ts:1012](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/tests/offline-store.test.ts:1012) opens two raw connections before booting the module. Run alone, those are version-1 connections and block the v2 upgrade:

```text
expected false to be true
tests/offline-store.test.ts:1039
```

Thus the isolated test fails before exercising the intended commit/eviction locks. It passes in the whole file only because the earlier upgrade describe already created v2.

(b) Add `await onVersion2()` before the first `rawOpen()` in this test.

## Closure ledger

- **F15: closed in production code.** The old two-lock harness fell from 5013 ms to exactly 3000 ms. A separate probe delaying `open` for two seconds and then blocking the transaction settled at 2999 ms, confirming open and transaction consume the same absolute budget. `start()` cannot extend a caller’s deadline; its separate timer can only disable the shared handle sooner. The fresh `touch` budget is defensible because it is detached bookkeeping and cannot delay or alter the already-returned cached body.
- **F16: closed.** Both original fault harnesses now roll back. The failed commit leaves no new body; the failed retirement retains both body and commit metadata before abandonment. All seven `bounded` sites remain correct: the two readonly sites have nothing durable to lose, while reserve, touch, commit, eviction, and retirement all require rollback on rejection.
- **F17: closed.** The future-stamped replacement test passes alone and directly discriminates the removed clock comparison.
- **F18: closed.** The checklist now accurately names failure containment and points to the F16 rollback test at [the plan’s Stage 2b checklist](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:327).

`performance.now()` is suitable in the supported browser contexts: it is monotonic and unaffected by wall-clock corrections. Frozen tabs or sleeping devices suspend JavaScript/timers as well, so this is an active-time bound rather than a promise to execute while the environment itself is suspended.

Verification:

- Requested suites: **40/40 green**.
- Original F14/F15/F16 harnesses rerun.
- Additional concurrent-eviction and open-budget harnesses run from `/tmp`.
- Both F14 tests, both F16 tests, and F17 pass individually.
- The F15 test fails individually for F19’s version-order reason.
- No repository file changed.