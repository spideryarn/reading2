You are reviewing code that has just been built, before it is pushed. You may fix what you find
inside this change; report anything wider for me to decide rather than fixing it.

The plan: docs/plans/261003m-a-transport-blip-fails-an-import-one-countable-retry-on-the-messages-wire.md
Your own plan review: docs/plans/261003m-a-transport-blip-plan-review-sol.md
The commit: 64a76dff3 (`git show 64a76dff3`). The code is in src/messages-stream.ts (streamMessage,
worthAnotherAttempt, waitOrStop), src/anthropic-call.ts (withoutStatus), src/labels.ts and
src/simple-summary.ts (attempts()), and the tests in tests/messages-stream.test.ts and
tests/anthropic-call.test.ts.

Run what you need: `npx vitest run tests/messages-stream.test.ts tests/anthropic-call.test.ts`,
`npm run typecheck`. Do not run the full suite (it is running elsewhere). Do not commit, push,
rebase, stash, reset or checkout; leave your edits in the working tree.

Check in particular:
1. The retry loop in streamMessage. Listener forwarding across attempts; `settled` memoisation; the
   first attempt being opened eagerly; an unhandled rejection if a caller never awaits finalMessage();
   `recordFailure` reading `current` (is it always the attempt that just failed?); `aborted()` and
   `attempts()` at every point in the call's life.
2. Accounting. Is it exactly one beginSpend and one recordSpend per network attempt on every path:
   success, failure, retry, abort mid-stream, abort during the wait, signal already aborted when
   streamMessage is called? Anything left in `pending`?
3. worthAnotherAttempt. Is each of the three shapes classified as the comment says, against the
   installed SDK (node_modules/@anthropic-ai/sdk, v0.120.0)? Is `err.type` really where an SSE error
   event's type lands? Can an abort or a missing-key failure reach it?
4. Every caller of streamMessage (grep it). Does any other caller count requests, cache or
   fingerprint per call, hold its own retry loop that now multiplies (labels, structure,
   structure-deepen, simple), or sit under a deadline short enough that 2 s of backoff matters?
5. anthropicCallFailed's new branch: is every character of the diagnostic ours? Does anything read
   `.status === 503` or match "status 503" on a status-less failure and now behave differently
   (grep src/ and tests/)?
6. Do the tests prove what their names say? Would any pass with the retry removed, or with the
   boundary moved from message_start to first text? Is the abort-during-wait test timing-safe on a
   loaded machine?
7. Tests elsewhere in tests/ that stub a failing Messages transport and will now make three requests
   and wait about two seconds each: find them, and say whether any assertion is now wrong.
8. The comments and docs changed in the commit (messages-stream.ts, docs/project/ai-gateway.md, the
   postmortem under docs/postmortems/): any claim that is not true of the code?

Answer with numbered findings, each P0/P1/P2 with file and line, say for each whether you fixed it,
and end with one line: "VERDICT: land" or "VERDICT: do not land" and why.
