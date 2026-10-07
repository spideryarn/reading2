# A timer duration is not the boundary it belongs to

The Messages cancellation test added by `99dcc2030` selected the first global timer lasting
375–625 ms. That is the current first backoff's duration, not its identity. An SDK timer could
share it; a changed backoff could cease to match it. The class is **identifying an asynchronous
boundary by an incidental policy value**. The retry implementation was correct; its test could
fail for the wrong reason.

The `wrapped === 1` assertion prevented a vacuous pass when no timer matched. It did not prove
that a matched timer belonged to the retry wait. During the pipeline-tidy code review, setting
`backoffMs` to 1 without changing cancellation handling gave:

```text
the backoff's timer was never seen: expected +0 to be 1
Tests  1 failed | 85 skipped (86)
```

The fix wraps the real exported `waitOrStop`, awaits its successful resolution, then aborts
before the caller resumes. The test asserts that wait was called exactly once with its signal.
It also checks opened attempts, HTTP sends, completed ledger rows and pending rows, so opening
attempt 2 and aborting before fetch is still detected. Removing the post-wait cancellation check
from `src/messages-stream.ts` produced:

```text
expect(call.attempts()).toBe(1)
AssertionError: expected 2 to be 1
Tests  1 failed | 85 skipped (86)
```

The source mutation was restored. Final permitted suites: 354 passed, 0 failed across three
files. No Postgres execution was attempted in the review sandbox.

Countermeasures, in order: identify the actual wait seam while keeping its real implementation;
assert that the fixture crossed it; mutate the retry-entry guard and inspect the specific
failure. A second fixture mutation should vary the incidental policy value too.

The sibling OpenRouter tests wrap the first timer instead. Their scripted transports currently
have no SDK timer competing with it; no defect there was established. This belongs beside
[the continuation-boundary bug](261005i-cancellation-checked-before-an-await-does-not-authorize-the-next-attempt.md)
and [the distinction between a test's claim and its scope](260906a-a-red-first-test-defends-the-change-not-the-code.md).

Up: [Postmortems](../project/postmortems.md)
