# A previous 404 cannot settle the next failed retry

The sweep cluster 5 review found a pre-existing Thread retry defect, reported as F17, P1. After a
clean 404, a failed recheck and another failed retry, the hook stays `loading` although the request
has finished. [Tweets](../../src/web/Tweets.tsx) then says *Looking for a thread…* beside the
failure. No production incident was established. It was reported rather than fixed in that review,
because the older Thread recheck policy was outside the two candidate commits' narrow repair.

**Fixed 2026-10-04**, in stage 2 of the same plan, by countermeasures 1 and 2 below: the recheck
catch now ends `loading` (back to `none`, which is what the earlier 404 said) while keeping the
recheck sentence and anything already loaded, and
[tests/tweets-retry-settles.test.tsx](../../tests/tweets-retry-settles.test.tsx) is the transition
test, seen red first with the review's own message. `answered` keeps its meaning.

## The class: historical success is used to decide whether a new request must settle

[useTweets](../../src/web/useTweets.ts) records `answered.current = true` for a thread or a clean
404. Its recheck catch preserves the view whenever that flag is true. However, `retryRead` uses a
different fact: `loaded === null` means move to `loading`. After a 404 both conditions are true.
The retry moves to `loading`, fails, and its catch sets only the error because a previous request
answered. The old answer cannot settle this new request's pending status.

`897020835`, *Tweets become a mode, with a wide band and a link from each post to its passage
(260929f)*, introduced the flag, its 404 assignment, the status-preserving catch and the null-based
retry together. The full defect is present there. Candidate `64e947f0e` changes only the opening
catch's sentence classification; its explicitly retained `THREAD_RECHECK_FAILED` branch and the
retry are unchanged.

## Why the matrix did not catch it

[The candidate matrix](../../tests/read-error-matrix.test.tsx) verifies an opening failure followed
by success, and a retry that answers 404. Neither traverses 404 → failed recheck → failed retry.
The temporary review reproduction did, and failed: *the GET rejected, so this is no longer
loading: expected 'loading' not to be 'loading'*. The request had completed and the hook held
`THREAD_RECHECK_FAILED`, so the loading state was stale, rather than a slow request. The temporary
test was not retained as a failing gate in this scoped repair.

Local evidence from this review is `/tmp/sweep5-review-thread-reported.log`; the removed test is
preserved at `/tmp/sweep5-review-thread-reproduction.test.tsx`. These are temporary machine files,
not repository artefacts. To reproduce elsewhere with the matrix's mocked network harness: mount
a probe calling `useTweets`, answer its opening GET with 404 and assert `none`; fail `refresh()`
with a transport error; fail `retryRead()` the same way; observe the recheck error and assert that
the completed request is no longer `loading`. That last assertion failed until the fix above.

## What would have caught it, ranked by ease against value

1. **A missing-result → failed recheck → failed retry transition test** — cheap; the temporary
   review reproduction already proved the defect. Retain it in the separately scoped repair and
   require that every completed read settles its pending status.
2. **Use current request state to settle failures** — preserve any accepted thread, but terminate
   `loading` even when a previous read answered 404. This is the proposed narrow follow-up fix;
   no implementation is included here.
3. **A broader request state machine** — rejected for this report. The defect can be repaired
   locally, and a new abstraction would still need the same transition test.
4. **Reset the historical answered flag on every retry** — rejected as the default remedy. The
   flag also chooses the existing recheck sentence and preserves accepted content; changing its
   meaning would braid settlement and history together again.

## The fix that is right for the long term

Separate the facts *a previous read answered* and *this read is still pending*. Historical success
can choose recheck copy or preserve accepted content; it cannot excuse leaving a completed request
in `loading`. The fix does the narrow half of that — the catch settles the request — without a
second flag: only a 404 can leave the hook both answered and `loading`.

Up: [Postmortems](../project/postmortems.md).
