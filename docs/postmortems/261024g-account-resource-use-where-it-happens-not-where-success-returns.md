# Account resource use where it happens, not where success returns

Up: [postmortems.md](../project/postmortems.md)

Code review found this before the multi-page importer shipped, so nothing reached a reader. The
30 MiB continuation budget charged a returned document and the special `too-large` error. A fetch
could read almost the whole allowance, then fail content sniffing or mid-stream, and the next link
would receive the whole allowance again. Twenty hostile links could repeat it.

## The class: a return value cannot account for work spent before a throw

The budget was measured from successful outputs even though the scarce resource was consumed by
stream reads. The test made the same assumption: it summed retained pages. Reserving `maxBytes`
before a request bounded one attempt, but retries and failures made it no aggregate bound.

Commit `cff6e504e` introduced the accounting while implementing plan-review finding F6. The code's
comment claimed an aggregate download cap; only retained bytes had one.

The fix adds a byte observer at the shared stream-reading boundary. `followPages` debits each chunk,
including failed attempts, stops a retry once its logical fetch has spent the reservation, and uses
the returned byte length only as a compatibility fallback for injected test fetchers. Keeping the
observer at `readStreamCapped` is the long-term design because that is the first place decompressed
bytes are known and every exit path passes through it.

## What would have caught it, ranked by ease against value

1. A fake that reports 700 bytes and then throws, followed by an assertion that the next request
   receives 300 of a 1,000-byte budget. Done; it failed `[1000,1000]` before the fix.
2. Test counters at consumption boundaries, including a thrown exit, rather than summing outputs.
   Done for the stream observer and the feature budget.
3. Charging every failed fetch its full reservation was rejected. It is safe but would let one
   early DNS or HTTP failure prevent later valid chapters without having spent the bytes.

The thing I would tell myself: if an operation can throw after doing work, its return value is not
an accounting interface.
