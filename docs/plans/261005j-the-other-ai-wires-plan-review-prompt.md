# Plan review: a countable transport retry on the OpenRouter seams (261005j)

You are reviewing a **plan**, read-only. Change no file.

## The candidate

- The plan: `docs/plans/261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md`
  (untracked or just committed in this worktree; read it from the working tree).
- Nothing is built. The code it would change: `src/ai-call.ts` (the five seams `openRouterStream`,
  `openRouterJson`, `openRouterImage`, `openRouterTranscription`, `openRouterDecisions`),
  `src/messages-stream.ts` (the precedent: `streamMessage`, `TRANSPORT_ATTEMPTS`,
  `worthAnotherAttempt`, `waitOrStop`), `src/pdf-read.ts` § `withTransportRetries`,
  `src/embeddings.ts` § `embedBatch`, `src/shelf-terms/model-topics.ts` (the filing pass's
  once-more retry), `src/command-pick-call.ts`.
- The plan it follows: `docs/plans/261003m-a-transport-blip-fails-an-import-one-countable-retry-on-the-messages-wire.md`.
- The doc it will correct: `docs/project/ai-gateway.md` § "A transport blip is retried".

That list says where to start. It does not limit scope.

## What to do

Attack the plan independently first. Is the audit table true of the code? Is the retry rule safe
for money (one record per network attempt, never re-buying a billed call), for callers (no loop
multiplied, no deadline or stall clock broken, no out-parameter left stale), and for tests? Is
anything it calls "never retried" actually reachable by the retry as described, or the reverse?
Is there a caller whose behaviour gets worse? Is there a simpler design that does the same job?
Run any test file you like that needs nothing outside the tree (you have no network or database).

Severity, by consequence:

- **P0** data loss, exploitable security, incorrect charging, or the service broadly unusable
- **P1** user-visible wrong behaviour, or an authoritative contract violated
- **P2** design or maintainability risk with no wrong behaviour today
- **P3** non-behavioural prose or comment defect

Give every finding an ID (F1, F2, …), a severity, the file and line that shows it, and the change
you would make. End with one verdict: *build as written*, *change first*, or *do not build*.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Whether `TypeError` is the right and complete test for "fetch never got a response" on Node's
  undici, and whether an `AbortSignal.timeout` firing can surface as a `TypeError`.
- Whether "the meter saw no cost" is a sound proxy for "the refusal was not billed".
- Whether the four opt-outs are the right four, and whether quick search (20 s shared deadline,
  parallel chunks) or quiz-verdict (8 s, decorative) should also opt out.
- Whether not threading an attempt count to `locateCalls` (a spend cap) is acceptable.
- Whether throwing the signal's reason from the backoff matches what callers of each seam test
  for when they classify an abort.
