# A slow response overwrites a fast one

**2026-09-05.** Two GETs for the same URL are in flight — a panel remounting while the first is
still going, which `useShelf.ts` arranges on every repeat visit. The **older** one answers last, and
the offline cache keeps its body. The reader who loses their connection then reads the older answer.

A second shape of the same fault: a GET issued before the reader deletes a comment, answering after
the delete. The cached copy is refilled with the comment still in it, and offline `apiFetch` serves
that as a synthetic 200. The delete looks like it failed.

Nobody reported either. Both were found by reading, during the architecture review in
[260905e](../plans/260905e-main-app-architecture-review.md) § A0, and both were then reproduced.

## The code

[`writeCached`](../../src/web/lib/offline-store.ts), as it stood in `ad90b175`:

```ts
const now = Date.now();
/* **A slow reply must not overwrite a fast one.** Two GETs for the same URL
   can be in flight at once — a panel remounting while the first is still
   going — and the loser landing last would put older data on top of newer.
   The existing row's `savedAt` is the guard, read and written inside one
   transaction so nothing can slip between the check and the put. */
const tx = instance.transaction(STORE, "readwrite");
const existing = await tx.store.get(key);
if (existing && existing.savedAt > now) {
  await tx.done;
  return false;
}
```

The comment names the exact bug and the code does not prevent it.

## The cause, in one sentence

**`now` is taken when the write begins, so it measures when the answer arrived, not when the question
was asked** — and the answer that arrives last therefore carries the later stamp and wins, however
early it was asked for.

The transaction is real and does what the comment says. It makes the check-and-put atomic against
another `writeCached`. What it cannot do is supply an ordering the values never had: both writes are
stamped correctly and compared correctly, and the comparison ranks them backwards.

## The class

**Completion time used as causal freshness.** A timestamp taken at the end of an operation is a fact
about the operation's duration. Using it to decide which of two results is *newer* silently assumes
duration is constant, which for a network request is the one thing it is not.

Four more defects in the same file belong to a second class, **stale read-modify-write outside a
transaction** — read a snapshot, then write or delete based on it, in some later transaction:

- `readCached`'s LRU touch did `put({ ...row, lastOpened: Date.now() })` from outside the read's
  transaction, so it could put a whole **old body** back over a newer one, or **recreate a row** that
  had been deleted in between.
- `evict` chose its victims from a `getAllFromIndex` snapshot and then deleted them one transaction
  at a time, so it could delete a response that landed after the choosing — the reader handed an
  article and then having it taken away, with nothing reporting a failure.
- `invalidate` and `forgetUser` did the same `getAll`-then-delete, so a write committing into the gap
  survived a sign-out.

Both classes have the same tell: **a comment claiming a guarantee that the surrounding code does not
implement.** This repo has met that before, on the server —
[a `SELECT … FOR UPDATE` that locked nothing](260901f-a-for-update-that-locks-nothing.md), and
[the truncation retry cost storm](260902c-the-truncation-retry-cost-storm.md), which names
"read-modify-write serialised per process" as an unenforced claim in four store modules. It had not
been written up in the browser, or under this name.

## The commit that introduced it

`ad90b175`, 2026-08-27, *"Keep the article a reader is holding when the connection goes."* — the
commit that added the file whole. `git log -S` for `savedAt > now`, `lastOpened: Date.now()` and
`function evict` each returns that one commit and nothing else; the file has had three later commits
and none touched this logic. All five defects were there on day one.

Neither [the plan](../plans/260827r-offline-reading.md) nor either of its GPT Sol reviews discusses
transaction scope for `evict`/`invalidate`/`forgetUser`, or issue time versus completion time. This
was not a considered trade-off; it was never in view.

## Why it hid

**There was a test, and it agreed with the code.** `tests/offline-store.test.ts` §
*"an older reply cannot overwrite a newer one"* forged a `savedAt` sixty seconds into the future onto
a stored row and checked that `writeCached` declined to overwrite it. It passed. It named the right
bug, and it proved the wrong thing: a forged future stamp is a **clock** inversion, the defect is a
**completion** inversion, and the comparison operator is correct for the first and irrelevant to the
second. The test was written from the same mental model as the code, so it could only ever confirm
it — [silent-success.md](../reusable/silent-success.md).

Beyond that, the failure is invisible by construction. Every affected path is a *cache*: when the
network works, the wrong body is never read, because the cache is only consulted after a transport
failure. The reader has to lose their connection *after* the race to see anything, and what they then
see is a plausible older version of their own data — not an error, not a blank, just last week's
sentence presented as current.

## The fix

[260905g](../plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md). Ordering
now comes from a **sequence reserved before the request is issued**, not a timestamp taken when it
lands, and the four snapshot-then-write operations each became one transaction. The full design, and
the cheaper version that was tried and refused, are in that plan.

Worth recording that the obvious repair — stamp the request with its issue time instead of its
completion time — was drafted, reviewed and rejected. It fails the same way one level down: two tabs
share no monotonic source, and a backwards clock adjustment lets a pre-mutation response compare
newer than the retirement that followed it, which **restores data the reader deleted**. The right
answer is not a better clock but a reserved sequence, because ordering is what was missing and a
clock only ever approximates it.

## What would have caught it, ranked

1. **Write the concurrency test with two real operations, never with a forged stored value.**
   Cheapest, and it is the whole of this postmortem. The test that existed manufactured the *state*
   the race would produce and checked the code's response to it — which tests the branch and assumes
   the premise. The reproduction that works starts both operations and controls only which finishes
   first. One rule: *if the bug is about ordering, the test must not decide the order by hand.*
2. **Treat "read then write in another transaction" as a defect on sight, in review.** All four
   sibling defects are visible in the shape alone, without reasoning about any interleaving —
   `getAll()` followed by a loop of `delete`, or `get` followed by an un-awaited `put`. It needs no
   test to find and no runtime to reproduce. A lint rule is conceivable but the pattern is rare
   enough that knowing the shape is enough.
3. **Distrust a comment that asserts a guarantee.** *"read and written inside one transaction so
   nothing can slip between the check and the put"* was true and beside the point; the sentence's
   confidence is what stopped anyone checking whether the values being compared meant what the
   comparison needed. Both of this repo's earlier instances of the class have the same signature. The
   cheap habit: when a comment claims an invariant, ask what would be observable if it were false,
   and whether anything checks that.
4. **Give a cache's freshness rule an explicit owner and write it down.** This module had a
   partition rule, an eviction rule and a size rule, all documented at length, and no freshness rule
   at all — `savedAt` was doing three jobs (reader-facing "saved at", eviction input, ordering guard)
   without any of them being named. Most expensive to retrofit, and the reason it now takes a ticket
   rather than a timestamp.

Up: [Offline reading](../plans/260827r-offline-reading.md) ·
[The fix](../plans/260905g-cache-freshness-follows-issue-order-not-completion-order.md) ·
[Library](../project/library.md)
