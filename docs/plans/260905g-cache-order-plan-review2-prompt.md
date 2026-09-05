# Review (round 2): a plan to fix ordering in the browser's offline response cache

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/cache-order-fence`, branch
`worktree-cache-order-fence`. TypeScript + ESM, React client, Vitest. Still a **plan review**,
before any code is written.

You refused round 1. I accepted the refusal in full and replaced the mechanism.

## The candidate

Live pre-commit; base `add1f65b`. Untracked files:

- `docs/plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md` — **the plan,
  rewritten**. Read it in full.
- `docs/plans/260905g-cache-order-plan-review-sol.md` — your round-1 review, kept in the tree.
- `docs/plans/260905g-cache-order-plan-review-prompt.md`, and this file.

(Not durable — I will record the resulting commit SHA here once it lands.)

Same code under discussion as round 1: `src/web/lib/offline-store.ts` and `src/web/lib/api.ts`
§§ `apiFetch`, `attempt`, `saving`, `cacheable`, plus the `supabase.auth.onAuthStateChange` callback
at the foot of that file. Specification being implemented: `docs/plans/260905e-main-app-architecture-review.md`
§ "A0. Cache freshness currently follows completion order, not request order".

A separate subagent is concurrently writing the Stage 1 reproduction tests in
`tests/offline-store.test.ts` and a new `tests/cache-issue-order.test.ts`. Those may or may not
exist yet when you look; they are **not** part of this candidate. Ignore them.

## What changed since round 1

The timestamp mechanism is **gone**. The plan now implements A0's own design — a monotonic sequence
reserved in IndexedDB before each cacheable GET is issued, plus an owner mutation epoch — with your
F3, F5 and F7 folded into it. The relevant new sections are "The mechanism: a ticket reserved before
the request goes out" and the rewritten Stage 1 and Stage 2.

| ID | Finding, verbatim (abbreviated) | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | "the clocks disagree within one tab" — `stamp()` may run ahead of `Date.now()` while retirement uses raw `Date.now()` | fixed | Moot. No timestamp is used for ordering anywhere. |
| F2 | "wall time is not a cross-tab issue order"; a backwards adjustment restores invalidated or signed-out data, which "is wrong, not merely stale" | fixed | Accepted as stated, including that my "stale, not wrong" claim was false. Mechanism replaced with your (b): reserved ticket + owner epoch. The plan records why the cheap version was rejected, so the next reader does not re-propose it. |
| F3 | "the version-2 upgrade can hang offline reads" — a held-open v1 connection blocks `openDB`; `readCached` awaits a promise that never settles | fixed | New section "Opening the database is bounded": `open()` returns `Promise<IDBPDatabase \| null>`, races the upgrade against a bounded deadline and the `blocked` callback, installs `blocking` on v2 connections, closes a connection that lands after we gave up. Give-up is per attempt with a cooldown rather than permanent for the page — **please check that weakening**. Stage 1 has a blocked-upgrade test. |
| F4 | "treating legacy `issuedAt` as zero can overwrite a newer legacy response" | fixed | Moot by construction: a request issued before the v2 database is open cannot reserve, so it cannot cache. Stated explicitly at the end of the "Opening the database is bounded" section. |
| F5 | "owner-wide eviction retirement can leave the new article half cached" | fixed | Eviction now has **no** retirement at all. The committed sequence lives in the `meta` store rather than on the response row, so deleting a body does not reset the ordering baseline. Stated as the reason for that separation. |
| F6 | "Stage 1 cannot make every listed test red"; and the store-level reverse-completion framing is wrong because overlapping readwrite transactions serialise | fixed | Stage 1 split into "Expected red — the defects" and "Expected green — the controls", with your framing ("the newer response invokes its write before the older response invokes its own") stated in the preamble. |
| F7 | eviction transaction placement should be explicit; do not fold it into the response commit | fixed | Adopted verbatim in substance: own transaction, after the commit, failing independently. |
| F8 | history count off by one — "four times since" | fixed | Now "three later commits". |

Treat the fixes as unreviewed prose written by someone else, and spend most of the run on what has
changed.

## What it is meant to do

Unchanged from round 1. `src/web/lib/offline-store.ts` is an IndexedDB store of already-received
JSON API responses, partitioned by signed-in user id, read back **only** when a GET fails at the
transport layer. Not a sync engine. Invariants that must not break:

- No response may overwrite a **newer** successfully committed body.
- A **failed** newer request must not prevent an **earlier successful** response from filling an
  empty cache.
- A GET issued before a successful mutation must not restore pre-mutation data after invalidation.
- After `forgetUser(A)`, no response for A in flight before teardown may recreate A's rows,
  including after A signs back in; B's rows untouched throughout.
- Nothing may throw at a caller, and every public operation must **settle** — a reader with no
  storage, a blocked upgrade, or a locked database gets a working app and no saved copies.
- Eviction stays whole-article.
- The account partition and the `x-spideryarn-offline` / `x-spideryarn-saved-at` headers are
  unchanged; `savedAt` stays the reader-facing "we got this at" value.

Out of scope: A1–A10 of the architecture review, service workers, offline writes, new dependencies,
any server or database change.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/offline-store.test.ts`) and a script (`node --import tsx <script>`), and
build a throwaway harness under `/tmp` — your round-1 `fake-indexeddb` harnesses were the most
valuable thing in that review, so please do that again. No network, not even loopback.

## Attack it

Independently, before my questions. Break the reserved-ticket commit rule: find an interleaving of
GETs, mutations, LRU touches, evictions, the `commit`-row sweep, sign-out and sign-back-in, across
one tab or two, that leaves a stale body committed over a newer one, loses a body that should have
been kept, recreates a signed-out reader's data, or wedges the cache so nothing can be written
again. Then attack the plan as a plan: a stage that cannot be verified, a case listed as "expected
red" that would in fact pass today, a case listed as "expected green" that would not.

Same output contract as round 1: an ID, a severity, established or reasoned, (a) the concrete
scenario or contract violated, (b) the smallest closing change. **IDs continue from F8** — reuse an
ID only for the same finding, number new ones from F9 up. Same severity scale:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

Worth less than anything you find yourself.

1. **The `commit`-row sweep.** Deleting an ordering baseline is only safe because the epoch advances
   in the same transaction, retiring every outstanding ticket. Is that reasoning sound, and is
   "more than a few thousand rows for one owner" a trigger that can fire at a bad moment?
2. **Pipelining the reservation with `accessToken()`.** The reservation must complete before the
   request is issued. Awaiting both before `send()` satisfies that — but `apiFetch` has a retry path
   after `refreshSession()`, and I reserve a *fresh* ticket there. Is a fresh ticket for the retry
   right, or should the retry keep the first attempt's ticket?
3. **The cooldown instead of a permanent give-up.** Your F3(b) said "disable caching for this page".
   I weakened it to per-attempt with a cooldown so the cache returns when the blocking tab closes.
   Does that reintroduce anything?
4. **`invalidate` advancing an owner-wide epoch** discards unrelated in-flight cache writes for that
   owner — A0 sanctions this, but it means posting a comment while an article is loading can leave
   that article uncached entirely. Is "none" genuinely safer than "half" here, or have I traded one
   of your F5 complaints for another?
5. **Anything in the plan that reads as decided but is not implementable** — I would rather find it
   now than in Stage 2.

Do not change any file.

---

**Landed as `942b5827`** on `dev`, 2026-09-05 — closing the live pre-commit candidate above.
