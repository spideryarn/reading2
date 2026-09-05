# Review: a plan to fix ordering in the browser's offline response cache

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence`, branch
`worktree-cache-order-fence`. TypeScript + ESM, React client, Vitest. This is a **plan review**,
before any code is written.

## The candidate

Live pre-commit; base `add1f65b`. Scoped path — one new, untracked file:

- `docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md`

(untracked: that file only. Not durable — I will record the resulting commit SHA here once it
lands.)

Start with that plan. The code it proposes to change is
`src/web/lib/offline-store.ts` (358 lines, read it in full) and `src/web/lib/api.ts` §§ `apiFetch`,
`attempt`, `saving`, `cacheable`, `slugOf`, and the `supabase.auth.onAuthStateChange` callback at
the foot of the file. Existing tests: `tests/offline-store.test.ts`,
`tests/api-fetch-offline.test.ts`, `tests/offline-remount.test.tsx`,
`tests/shelf-cached-paint.test.tsx`, `tests/article-cache-call-site.test.ts`,
`tests/article-cache-group.test.ts`, `tests/cacheable-covers-artefact-routes.test.ts`.

Background: the defect being fixed is item **A0** of
`docs/plans/260905e-main-app-architecture-review.md` § "A0. Cache freshness currently follows
completion order, not request order" — read that section, it is the specification this plan is
answering. The original design of the cache is
`docs/plans/260827r-offline-reading.md`. Repo working agreements are in `CLAUDE.md` / `AGENTS.md`
(they are the same file); the house style rules for docs are in that file's "How we write docs here".

This is where to begin, not the limit of scope — the manifest above is.

## What it is meant to do

`src/web/lib/offline-store.ts` is an IndexedDB store of already-received JSON API responses,
partitioned by signed-in user id, read back **only** when a GET fails at the transport layer (no
network). It is not a sync engine: no write queue, no service worker, no offline writes.

The confirmed defect: `writeCached` takes `const now = Date.now()` when the *write begins* and
guards with `if (existing && existing.savedAt > now) return false`. That orders responses by
**completion** time, so an older GET that completes last overwrites a newer one. Four sibling
operations (`readCached`'s `lastOpened` touch, `evict`, `invalidate`, `forgetUser`) read a snapshot
and then write or delete outside the transaction that produced it.

The plan proposes replacing the completion-time guard with an **issue stamp**: `apiFetch` records
`issuedAt` immediately before each network attempt, threads it to `writeCached`, and the commit
transaction accepts a response only if `issuedAt > meta.retiredAt` for that owner **and**
(`no existing row` **or** `issuedAt > existing.issuedAt`). `invalidate`, `forgetUser` and `evict`
set the owner's `retiredAt`. This deliberately **differs** from the mechanism A0 itself sketched
(reserved monotonic per-URL sequence tickets + an owner mutation epoch, reserved in IndexedDB
*before* each cacheable request is issued); the plan's § "The mechanism" argues why and states the
cost. Judging that substitution is the single most valuable thing you can do here.

Invariants that must not break:

- No response may overwrite a **newer** successfully committed body.
- A **failed** newer request must not prevent an **earlier successful** response from filling an
  empty cache.
- A GET issued before a successful mutation must not restore pre-mutation data after invalidation.
- After `forgetUser(A)`, no response for A that was in flight before teardown may recreate A's rows,
  **including after A signs back in**; B's rows must be untouched throughout.
- Nothing in this module may throw at a caller. A cache that cannot be written is a feature that
  quietly does not happen; a reader with no storage (Node, Safari private window where
  `indexedDB` *throws on access*) must get a working app and no saved copies.
- Eviction stays whole-article: half an article is worse than none.
- The account partition (`${userId}\n${url}`) and the `x-spideryarn-offline` /
  `x-spideryarn-saved-at` response headers are unchanged.
- `savedAt` stays the reader-facing "we got this at" value.

Deliberately out of scope: any other item (A1–A10) of the architecture review, service workers,
offline writes, cross-tab messaging, new dependencies, server or database change.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/offline-store.test.ts`) — it uses `fake-indexeddb` and needs no network or
Postgres — and a script (`node --import tsx <script>`), and you can build a throwaway harness under
`/tmp`. You have **no network, not even loopback**, so anything needing Postgres or a local service
will skip. Nothing in this candidate's scope needs either.

## Attack it

Independently, before you read my questions below. **Try to break the proposed commit rule**:
construct an interleaving of GETs, mutations, LRU touches, evictions, sign-out and sign-back-in that
either (a) leaves a stale body committed over a newer one, (b) loses a body that should have been
kept, (c) recreates a signed-out reader's data, or (d) permanently wedges the cache so nothing can
ever be written again. Then attack the plan as a plan: a stage that cannot be verified, a test in
Stage 1 that would pass against the *current* code (and so would never go red), a claim in the
invariant table that the mechanism does not actually deliver.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — a code block, or exact replacement wording for the plan

A finding with no (a) goes last.

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1 — direct evidence with no unresolved material inference —
and name what established it. Reasoned findings rank and inform but do not block.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

1. **The wall clock.** The stamp is `Math.max(Date.now(), last + 1)`, monotonic within a tab only.
   Two tabs share the wall clock, so an NTP correction or a user changing the system clock could
   invert order across tabs. I claim the failure mode is *stale, not wrong*. Is that right, and is
   there a sequence where a clock jump produces something worse than staleness — in particular
   around `retiredAt`, where a backwards jump could make a `retiredAt` written *later* compare as
   *earlier*, or a forwards jump could retire the cache far into the future and wedge it?
2. **Eviction setting `retiredAt`.** Eviction walks *every* account's rows (the cap is device-wide),
   so it may delete another owner's article and would then bump that owner's `retiredAt`, discarding
   their unrelated in-flight cache writes. Is that acceptable, or does it need to be per-article?
3. **`evict` inside the commit transaction.** Today `writeCached` calls `await evict(instance)`
   *after* `tx.done`. If the commit and the eviction are separate transactions there is a window;
   if they are one, a large eviction lengthens every write. Which way, and does the answer change
   the "never throws" contract?
4. **Legacy rows.** DB_VERSION 1 rows have no `issuedAt`. The plan treats missing as `0`, so any
   stamped response wins. Is there a case where that is wrong rather than merely conservative?
5. **The `retiredAt` row is per owner, and `readCached` does not consult it.** A body committed
   before a retirement stays readable until something deletes it. `invalidate`/`forgetUser` do
   delete, so I believe this is fine — but is there a path where `retiredAt` advances without the
   corresponding bodies being deleted, leaving readable data that should be gone?
6. **Stage 1's redness.** I want every listed test to fail against the current code. Which of them
   would in fact pass today, making it a test that proves nothing?

Do not change any file.

---

**Landed as `942b5827`** on `dev`, 2026-09-05 — closing the live pre-commit candidate above.
