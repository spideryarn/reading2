You are reviewing a plan before it is built. Read-only: do not edit any file.

The plan: docs/plans/261003m-a-transport-blip-fails-an-import-one-countable-retry-on-the-messages-wire.md

Read it, then read the code it changes: src/messages-stream.ts (all of it, especially messagesClient's
maxRetries comment and streamMessage), src/anthropic-call.ts, src/ai-spend.ts (beginSpend, recordSpend,
PendingCall), src/pdf-read.ts around TRANSPORT_ATTEMPTS (the precedent), tests/messages-stream.test.ts,
and the Anthropic SDK in node_modules/@anthropic-ai/sdk (how MessageStream surfaces a connection error, an
SSE `error` event, and a non-2xx status; whether `status` is undefined for each; when `message_start` fires).

Evidence for the diagnosis is quoted in the plan (production log lines). Check the inference too: is it
right that a logged error with no `status` field means the SDK error had no numeric status?

Questions:
1. Is the root cause right, and is the conclusion (retry in streamMessage, before message_start only, each
   attempt its own SpendRecord) the right fix? Is one of the passed-over options actually better?
2. Is "no message_start seen" a sound proxy for "nothing billed, nothing shown"? Any way a listener or a
   caller observes two attempts? Any caller of streamMessage (grep them) that this would break, e.g. one
   that fingerprints or caches by call, counts calls, or relies on aborted()?
3. Is the retryable set right (status undefined and not an abort; 408, 429, 500, 502, 503, 504, 529)?
   Is retrying a 429 here wise given src/ai-call.ts's and pdf-read.ts's own views on 429?
4. Accounting: does a retried attempt leave the ledger correct (beginSpend/recordSpend pairing, pending
   calls, collectSpend, aiRunId), and does anything assert "one streamMessage, one record"?
5. Anything in the tests list that would pass without the fix, or a case that is missing?
6. Anything the plan defers that should not be deferred, or includes that should be cut?

Answer with numbered findings, each marked P0/P1/P2, each naming file and line, and end with a line
"VERDICT: build as planned" or "VERDICT: change first" followed by the changes.
