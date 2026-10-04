# Skipping an aborted fold does not stop its consumer loop

Review of [plan 261004c](../plans/261004c-sweep-cluster-11-no-blocking-child-process-on-the-dashboard-or-the-daemon.md)
found an abort boundary that skipped a payload fold but continued consuming the source. The
candidate had not restarted the daemon; this was caught in review.

## The class: cancellation is checked inside the operation but lost at its caller

`takeProbed` awaited the process-table reading and then returned `true` when the abort signal was
set, correctly avoiding mutation of the payload fold. Its caller ignored that return value and
checked only `halted()`, which reflects `stopped`, not the abort signal. It therefore requested
another source message. The real `readStream` can yield multiple frames already parsed from one
chunk; aborting the fetch does not remove those buffered frames. Another accepted payload might
start another probe; a buffered status message could still mutate conditions after cancellation.

The review regression aborts inside the first probe and places a flag after the source's first
yield. It requires that flag to stay false and the generator's `finally` to run, establishing that
the consumer closes the source without requesting its next buffered item. The primary reviewer
saw **expected `true` to be `false`** for `askedForNext` at
`tests/overseer-daemon-work.test.ts:321` (12 passed, 1 failed), then 13/13 green after the fix.

**3666e3979**, “261004c stages 2-4: the read-only probes run through the owned child, not a
synchronous call”, introduced the awaited probe and its abort return. The loop's checks of only
`halted()` were inherited from **41918f702e**. That old arrangement did not protect cancellation
delivered during the new awaited operation: the operation's safe return was not the caller's
instruction to stop.

## Why the checks agreed

The async-fold tests established ordering and coherent state during the probe. The existing abort
test proved that the pending inventory was not folded, but its source then ended itself on abort.
It could not reveal the consumer's next request; the production source has a buffered inner frame
loop instead.

## The fix and the countermeasures, ranked by ease against value

1. **Abort at the new suspension point and observe iterator cleanup.** The cheap regression
   proves both that no next item is requested and that the source is closed. An outcome labelled
   stopped alone cannot establish either claim.
2. **Have the consumer check cancellation before handling a message and after the awaited
   operation.** The review patch adds `options.signal.aborted` to both loop guards. This is the
   appropriate long-term boundary: the loop owns whether another message is consumed, while the
   operation owns whether its already-started work is applied.
3. **Reject relying only on transport cancellation.** Buffered messages and injected sources are
   valid inputs; stopping the underlying socket does not revoke items already yielded or parsed.
4. **Reject redesigning the entire source or stop-state API for this defect.** The existing signal
   already communicates cancellation. Explicit consumer checks close the new gap without
   changing unrelated transport behaviour.

Investigation: 2026-10-04, source and git-history inspection in a read-only-code subagent; failing
regression supplied by the primary reviewer. No code or test changes were made by this subagent.

Up: [Postmortems](../project/postmortems.md).
