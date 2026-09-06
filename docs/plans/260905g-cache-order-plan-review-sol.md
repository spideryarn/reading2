## Verdict: refuse

The timestamp substitution does not deliver A0’s invariants. Established P1s F1–F5 block the plan as written.

### F1 — P1 — established: the clocks disagree within one tab

(a) `stamp()` may run ahead of `Date.now()`, while retirement uses raw `Date.now()` ([plan lines 85–97](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:85)):

1. Freeze `Date.now()` at 1000.
2. Two attempts receive stamps 1000 and 1001.
3. The second request predates a successful mutation or sign-out.
4. Retirement records `retiredAt = 1000`.
5. That pre-retirement response arrives with `issuedAt = 1001`, passes `issuedAt > retiredAt`, and recreates the deleted row.

This breaks both mutation invalidation and sign-out fencing without multiple tabs or a clock adjustment.

(b) Smallest local repair—not sufficient for F2—is to obtain retirements from the same monotonic source:

```ts
const retiredAt = stamp();
```

The robust repair is F2’s IndexedDB ticket/epoch mechanism.

### F2 — P1 — established: wall time is not a cross-tab issue order

(a) Two tabs have independent `last` variables. Requests issued in different tabs during the same millisecond receive equal stamps. If the older response commits first, the newer successful response is rejected by the strict `>` comparison. Freshness therefore does not follow issue order.

The stated clock-jump cost is also understated ([plan lines 112–118](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:112)):

- A high-stamped pre-mutation request followed by a backwards adjustment can compare newer than the later `retiredAt`, restoring invalidated or signed-out data. That is wrong, not merely stale.
- A retirement written during a forward jump can prevent new tabs or a reloaded page from caching anything after the clock moves back, potentially until wall time catches up.

(b) Replace the timestamp mechanism with the original [A0 contract](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905e-main-app-architecture-review.md:118):

```text
Before each cacheable network attempt, reserve in IndexedDB a ticket
{ ownerEpoch, sequence }. Bound the reservation wait; if it fails or times
out, issue the network request but irrevocably skip caching it.

At commit, accept only when the owner epoch is still current and the ticket's
sequence is greater than the URL's last committed sequence. Advance the
committed sequence only when a body commits. Mutations and account teardown
atomically advance the retained owner epoch while deleting affected bodies.
```

That preserves the failed-newer-request invariant because “latest issued” and “last successfully committed” remain separate.

### F3 — P1 — established: the version-2 upgrade can hang offline reads

(a) A tab running today’s version-1 code can retain its database connection. The proposed version-2 `openDB` is then blocked indefinitely: current code supplies neither a `blocking` close handler nor a bounded fallback ([current `open()`](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/src/web/lib/offline-store.ts:89)). On transport failure, `attempt` awaits `readCached`, which awaits that unresolved promise; the reader gets neither the cache nor the working no-cache app promised by the contract.

A real `fake-indexeddb` harness produced:

```json
{"blocked":true,"settled":false,"oldVersion":1}
```

(b) Add this explicit Stage 2 requirement:

```text
Database opening is bounded. If the v2 request is blocked or exceeds the
deadline, disable caching for this page and make every public operation settle
with its ordinary no-cache result. Install a `blocking` handler on v2
connections that closes them for future upgrades. Test with a deliberately
held-open raw v1 connection and assert that readCached settles promptly.
```

The handler helps future upgrades; the bounded fallback is still necessary because already-deployed v1 code has no handler.

### F4 — P1 — established: treating legacy `issuedAt` as zero can overwrite a newer legacy response

(a) During the blocked-upgrade window:

1. New v2 code issues request R1 and stamps it.
2. Its cache open waits behind an existing v1 connection.
3. The old tab issues and commits newer response R2 as a legacy row.
4. The old connection closes; v2 upgrades without rewriting R2.
5. R1 resumes. Missing `issuedAt` becomes zero, so older R1 overwrites newer R2.

I reproduced the relevant IndexedDB interleaving: the v1 connection successfully wrote after the v2 request became blocked, and that row survived the upgrade. Thus “any stamped response wins” ([plan Stage 2](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:155)) is not merely conservative.

(b) Exact replacement:

```text
Preserve legacy rows, but only a cache-eligible ticket reserved after the v2
database has opened may replace one. A request issued before upgrade completion
must irrevocably skip caching. Do not model missing issuedAt as an ordering
value comparable with requests that could overlap v1 writers.
```

The pre-network IndexedDB reservation naturally enforces this.

### F5 — P1 — established: owner-wide eviction retirement can leave the new article half cached

(a) With 100 articles already cached for A:

1. Prose and glossary requests for article Z are issued concurrently.
2. Prose commits first, bringing the count to 101.
3. Eviction deletes an old A article and advances A’s owner-wide `retiredAt`.
4. Z’s valid glossary response was issued before that retirement, so it is rejected.
5. Z remains permanently prose-only until another fetch.

This makes ordinary eviction discard an unrelated successful response and directly contradicts “half an article is worse than none.” The conservative owner epoch accepted for mutations should not automatically be reused for device-wide eviction.

(b) Fence eviction at `(userId, slug)`, not owner:

```text
Eviction records an article-scoped retirement generation for every affected
(userId, slug). Cache commit checks both the owner mutation epoch and that
article's eviction generation. Evicting one article must not retire unrelated
in-flight responses belonging to the same owner.
```

The resulting metadata-retention problem must be solved explicitly; it cannot be hidden by calling one row per owner equivalent.

### F6 — P2 — established: Stage 1 cannot make every listed test red

(a) These are preservation controls and already pass current behavior:

- T1 succeeds while newer T2 fails: only T1 writes, so its body remains.
- Direct A → B switching already preserves both partitions.
- Non-cacheable and non-JSON responses already cause no write.

Also, “OLD write begins, NEW write begins and commits, OLD commits last” is the wrong store-level reproduction: overlapping IndexedDB read-write transactions are serialized. The actual defect is that the newer response invokes its cache write before the older response invokes its write.

(b) Replace the Stage 1 opening with:

```text
Run defect-characterisation tests red: reverse response completion,
pre-mutation response, LRU save/delete races, eviction race, teardown fence,
cross-tab ordering and blocked upgrade. Preservation/control cases—newer
failure, direct account switch, non-cacheable/non-JSON and legacy
preservation—are expected to remain green against current code.
```

For the direct store test, capture `oldIssued < newIssued`, commit NEW first, then invoke OLD. Add one deferred-fetch integration test using real `apiFetch` and the real store if the plan retains its claim that both must be driven together.

### F7 — P2 — reasoned: eviction transaction placement should be explicit

(a) The safe design is not to fold eviction into the response’s commit transaction. A separate eviction transaction is race-safe provided selection and every deletion/retirement are in that one read-write transaction: competing response writes on `responses` serialize before or after it. Folding a potentially large scan into every response commit lengthens the transaction and lets an eviction failure abort an otherwise valid cache write.

(b) Replace the eviction Stage 2 bullet with:

```text
After the response commit completes, run eviction in a separate readwrite
transaction spanning selection, revalidation, whole-article deletion and its
article-scoped retirement updates. Catch eviction failure independently; a
successful response write remains successful if eviction fails.
```

### F8 — P3 — established: history count is off by one

(a) The new provenance section says the file was touched “four times since” `ad90b175` ([plan line 50](/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence/docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md:50)). `git log --follow` shows three later commits; four includes the introducing commit itself.

(b) Replace “four times since” with “three times since” or “four commits in total.”

Suspicion 5 is not a finding: `retiredAt` is a response-eligibility fence, not a body-validity marker. Provided every retirement and its corresponding deletion are atomic, `readCached` should not consult it—especially while retirement remains owner-wide.

Verification: the permitted current test passed, 15/15. Two throwaway `fake-indexeddb` harnesses established the blocked-upgrade and legacy-overlap sequences. No repository files were changed.