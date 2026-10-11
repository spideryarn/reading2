# A transient consumer cannot own an asynchronous write's pending state

Referee › Notes kept its set of pending sort writes inside the Notes panel. Changing to another
Referee sub-mode unmounted that panel while `useComments` continued the queued PATCH; returning to
Notes created a fresh empty set, enabled **Copy notes**, and could copy the still-unsorted grouping.
The defect was found in review of `71bb89bbf`, before it reached a reader.

## What happened

`useComments.sort` correctly owned and returned the per-comment queue promise. The panel wrapped
that promise with a local counter so two quick presses stayed pending until both writes finished.
That was correct for the lifetime the test exercised: click, wait, settle, all without unmounting.

The panel's lifetime was shorter than the operation's. Referee's chip switch replaces the panel,
but the comments hook stays mounted in the reading view and its queue carries on. On remount there
was no way to reconstruct the panel's lost counter from the still-live promise.

## Pending state owned by a shorter-lived observer

This is **pending state owned by a shorter-lived observer**: a component derives durable operation
state locally even though the operation is created and kept alive above it. Unmount is then an
unobserved state reset, not cancellation. The same class can occur whenever a modal, tab or
sub-mode puts a spinner or safety gate around work owned by a page-level hook.

The root cause was not that `.finally` failed. The queue promise settles after the panel unmounts;
there is simply no longer a mounted state cell for its completion to balance, and a later panel gets
a different cell.

## Why nothing went red

The candidate's regression test held Copy during one deferred promise and watched it release after
resolution, but never crossed the panel's mount boundary. The test therefore shared the
implementation's assumption that the observer and the operation had the same lifetime.

The plan review correctly required a count rather than a boolean for two quick presses. It did not
ask which component owned that count. TypeScript could only see that `pending` was a valid local
map; it cannot express that a promise outlives the component observing it.

## What would have caught it, ranked by ease against value

1. **Cross one real lifetime boundary in the pending-state test** — being done. The panel test now
   unmounts and remounts Notes while the comments hook's pending set remains live, and Copy stays
   disabled.
2. **Put operation state beside the operation whenever unmount does not cancel it** — being done
   here: `useComments` owns both the queue and the counted `sorting` set. This is the cheapest design
   check to make when adding a spinner or a “wait before acting” gate to a replaceable panel.
3. **Keep every sub-mode mounted and hide it with CSS** — rejected. It would preserve incidental
   local state by making all panels and their hooks permanently live, increasing work and leaving
   the ownership error in place.
4. **Add a global request registry** — rejected. The operation already has a natural owner and key;
   a second cross-app state system would add indirection without catching local promises outside it.

## The fix that is right for the long term

The review fix is also the long-term design: `useComments.sort` increments a per-comment
count before queueing and decrements it in `finally`; its public API exposes the resulting id set.
Notes renders from that set. Two presses are counted, a failed request clears it, switching panels
does not, and a late completion from an old article is not allowed to clear a same-named id on the
new article.

The regression test at the panel seam supplies a still-pending set after remount, while the hook
test proves two queued presses do not clear the id after only the first settles. Together they test
both ownership and counting rather than repeating either implementation.

## The thing I would tell myself

I saw a promise returned from the long-lived hook and treated the panel as a safe place to count it.
The first question should have been what happens when the panel disappears: if disappearance does
not cancel the write, the panel cannot be the source of truth for whether that write is pending.

---

Up: [Postmortems](../project/postmortems.md)
