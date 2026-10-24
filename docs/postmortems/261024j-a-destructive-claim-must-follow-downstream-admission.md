# A destructive claim must follow downstream admission

Nothing reached a reader: review of commit `9966db02df90` found that opening the receiver while
another file was uploading could consume the extension capture and then reject it. The extension's
atomic take and the page's `used` flag happened before the upload engine admitted the file.

## The class: destructive claim before downstream admission

At-most-once delivery and one-at-a-time processing were each correct alone. Composed in the wrong
order, the first destroyed the only copy before the second could refuse it. Any queue, lock or quota
check downstream of a destructive read has this shape.

The introducing commit was `9966db02df90`. Its refusal test asserted the error sentence and that no
navigation happened; it did not ask whether the input could still be processed afterwards.

## Why nothing went red

The refusal was treated as the successful outcome of the test. No assertion represented the user's
actual outcome: once the current upload finishes, the captured page is still added exactly once.

## What would have caught it, ranked by ease against value

1. **Assert admission before destructive take** — the receiver now recognises every in-flight phase
   and waits before asking the extension. Added to the handoff tests.
2. **Retain and release around the race** — if another picker starts while the extension reply is in
   flight, the cached `File` is unspent and retried after that transfer settles. Done.
3. **Add a general multi-file upload queue** — rejected: it changes the product's one-upload rule
   and is disproportionate to a receiver that can wait on the existing engine subscription.

## The long-term fix

The component subscribes to the upload engine and does not take the capture until it is free. A
started ref keeps the extension's own transfer from tearing down its receiving effect. The narrow
race between take and send releases the page-level claim only for the engine's explicit busy
refusal, then retries from the already-cached file.

## The thing I would tell myself

I would put the irreversible operation after the last admission check, then test the refusal path by
continuing, not by stopping at the error message.

---

Up: [postmortems.md](../project/postmortems.md)
