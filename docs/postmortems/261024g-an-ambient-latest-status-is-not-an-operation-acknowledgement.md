# An ambient latest status is not an operation acknowledgement

Nothing reached a publisher: review of commit `9966db02df90` found that an asynchronous Chrome Web
Store upload could be followed by publication of the wrong draft. The polling endpoint returned the
item's latest upload state without a version or operation id; the script filled in the expected
version itself and then “verified” that value.

## The class: uncorrelated asynchronous completion

An item-wide latest state is ambient shared state, not an acknowledgement of the operation that
this process started. Supplying a missing observed field from the expected value is synthetic
evidence: the later equality check can only agree with the program itself.

The introducing commit was `9966db02df90`. The direct-success path was sound because the upload
response itself carried `crxVersion`; only the asynchronous path lost correlation.

## Why nothing went red

The unit test checked `uploadOutcome` with a real version but never passed it the versionless shape
returned by `fetchStatus`. The call site manufactured the field before the tested function saw it.

## What would have caught it, ranked by ease against value

1. **Test the boundary's real response shape** — a polled `SUCCEEDED` without a version now has to
   refuse. Added.
2. **Keep observed and expected values different in the type and flow** — the polled outcome cannot
   return `done`; it can only continue waiting or fail closed. Done.
3. **Add a single-writer lock around the store item** — rejected: it still would not turn the API's
   item-wide answer into proof of this package, and would add operational state to maintain.

## The long-term fix

The script may auto-publish only when the upload response itself says that the exact expected
version succeeded. If Google chooses asynchronous processing, it reports progress and then requires
dashboard verification and manual publication. That gives up automation where the API gives up
correlation.

## The thing I would tell myself

I would never populate a response field with the value I hope the remote system processed. Missing
correlation is a property of the protocol, not a blank for the client to complete.

---

Up: [postmortems.md](../project/postmortems.md)
