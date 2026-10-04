# The error handler depends on the reporting sink it must survive

Up: [Postmortems](../project/postmortems.md).

Caught during code review of [261004g](../plans/261004g-overseer-report-drain-artefact-checks-stop-blocking-the-daemon.md),
using a disposable store. No live daemon was restarted. A failed report drain could reject shutdown
before the store was closed.

## What happened

The regression test “a failed drain with broken note and fallback logs still settles and releases
the lock” ends the source as the drain rejects. The report degradation note throws `ENOSPC`, and
the fallback logger throws `EPIPE`. Before the fix, the test failed with:

```text
AssertionError: promise rejected "Error: EPIPE" instead of resolving
log -> reports catch -> settleInFlight -> runOverseer
```

`stopHere()` was never reached. The same test passed after containing the fallback logger's throw,
and asserted that the lock had been released.

## The error handler depends on the reporting sink it must survive

The reports promise catches failure from the drain and its normal diagnostic. Its catch then calls
a fallback logger without containing that logger's failure. `.finally()` clears `reportsRunning`,
but cannot turn a rejected promise into a fulfilled one.

The root cause is treating diagnostic delivery as infallible inside the boundary intended to
contain failures. During shutdown, settlement propagates that diagnostic failure before cleanup.
While the daemon remains active, the same chain can instead produce an unhandled rejection.

Commit `a4c542458d62554facf11e83a95b6499ffab7fbc` introduced the asynchronous reports chain, its
fallback diagnostic and its settlement await. The root-cause review also found similar unguarded
fallbacks in attention and recovery handlers; those are outside this stage.

## Why nothing went red

The existing throwing-drain test supplied a functioning note log and logger. It exercised the
failure being handled, but neither failure inside its handler. The new test crosses both diagnostic
boundaries and checks the daemon outcome and released lock.

## What would have caught it, ranked by ease against value

1. **Fail both diagnostic sinks in the regression test.** Cheap, implemented, and seen red before
   the fix. It checks cleanup after the handler fails.
2. **Inspect terminal handlers when changing background promise chains.** Low cost: identify every
   operation that can reject after the intended containment boundary.
3. **Make logging universally non-throwing.** Rejected for this stage. It changes unrelated failure
   policies and requires a wider audit.

## The fix that is right for the long term

The scoped fix contains exceptions from the report drain's final fallback diagnostic, keeping the
background promise fulfilled and cleanup reachable. Adding only a catch to the shutdown await
would protect shutdown while leaving an unhandled rejection possible during normal operation.

The wider audit should apply explicit diagnostic failure policies to other background handlers.
The lesson is to test failure in the error handler itself whenever it claims to keep a background
task from terminating its owner.
