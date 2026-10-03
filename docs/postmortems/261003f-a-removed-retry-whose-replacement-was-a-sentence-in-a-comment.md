# A removed retry whose replacement was a sentence in a comment

Up: [postmortems.md](../project/postmortems.md)

Report `spya-x4zut6`, 2026-10-03. Plan and fix:
[261003m](../plans/261003m-a-transport-blip-fails-an-import-one-countable-retry-on-the-messages-wire.md).

## What happened

Greg imported an article. The import itself worked. Ten single-step jobs then wrote its modes, and
one of them, Arc, failed 0.7 seconds after it started. The card offered Retry and said the AI
service was having trouble.

Production's log has the step failing 595 ms in, on a cold-started function, with
`Anthropic SDK request failed, status 503. [ai-upstream]` and **no `status` field on the logged
error**. No server sent a 503. The SDK's error had no HTTP status at all, which means the
connection failed or the stream opened with an error event, and our own code wrote "503" as a
default. Nine sibling calls in the same seconds were fine.

## The real root cause

On 2026-08-28, commit `a81c14a1b` ("Every AI call now goes one way, and says what it cost") set
`maxRetries: 0` on the Anthropic client. The reason was good and still is: the SDK retries inside
one operation, so one spend record could hide three billed attempts.

The comment written beside it named what the change cost and what covered it:

> a transport blip that the SDK used to paper over now surfaces as a failed step. That is the
> honest trade — the pipeline already retries at the step level, where a retry is visible on the job

Nothing retries at the step level except a person pressing Retry. So for five weeks every
Messages-wire call, eighteen call sites, failed its step on one dropped connection. An import makes
about ten such calls.

## The class

**A safeguard removed for a good reason, with its replacement named in a comment and never built.**

The removal was reviewed and correct. The sentence about the replacement was a belief about another
part of the system, written at the moment of removal, and nobody checked it because it sat next to
a decision that was right. It is a close cousin of
[written-down-is-not-checked.md § A sentence is not a fix](../reusable/written-down-is-not-checked.md#a-sentence-is-not-a-fix):
there the sentence stands in for a fix, here it stands in for a safety net.

The second defect is its own small class: **a default that prints as a fact.** `status ?? 503` was
meant to pick a reader sentence, and the same number was then interpolated into the diagnostic, so
the log asserted something no server said.

## The fix that is right for the long term

Shipped: `streamMessage` retries an attempt that failed before `message_start`, three goes in
total, each its own spend record. The diagnostic now says "no HTTP status" and which kind.

That is also the long-term shape for this wire. What is not done:

- The other wires (`src/ai-call.ts`) have their own retry rules and were not audited. Queued.
- A stream that dies after `message_start` still fails the step. Retrying it means paying twice,
  which is a decision rather than a fix.

## What would have caught it, ranked by ease against value

1. **When removing a safety net, name the test that shows its replacement working.** A habit,
   free. The `maxRetries: 0` commit had a test that one call is one record; it had none that a
   failed connection still ends in an answer, and writing that test would have found there was
   nothing to make it pass. Done now: `tests/messages-stream.test.ts` § a transport blip is
   retried.
2. **A diagnostic interpolates only what it was given.** One edit, done: the "503" default no
   longer reaches the message. The general rule is that a fallback value chooses behaviour and is
   never printed as an observation.
3. **Count job failures by diagnostic in production.** Would have shown `[ai-upstream]` failures
   at sub-second durations as a pattern weeks ago. Not done here: it needs somewhere to look, and
   Sentry already groups these for anyone who opens it. Worth doing when there is a regular
   production-errors read.
4. A chaos test that drops a random connection during a full import — rejected. The gap was not
   that failure was hard to provoke; a one-line stub provokes it. Nobody asked the question.
