# Code review, with fixes: the transport retry on the OpenRouter seams (261005j)

You may write in this worktree. **Fix what is inside this stage, narrowly and red-first; report,
do not fix, anything wider you notice.** Do not commit. Do not attribute any sentence to a named
person, and do not add quotations from anyone: write only your own words into docs and comments.

## The candidate

- Commit `949fa80ba` on this worktree's branch, on top of `a1f9119c2` (the plan) and base
  `abbeb33b4`. `git show --stat 949fa80ba` lists every changed path; `git show 949fa80ba -- <path>`
  is the diff. The working tree is clean, so anything `git status` shows afterwards is yours.
- The plan and what the plan review already found:
  `docs/plans/261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md`
  and `docs/plans/261005j-the-other-ai-wires-plan-review-sol.md`.
- Start with `src/ai-call.ts` (`send`, `neverAnswered`, `worthAskingAgain`, `mayAskAgain`,
  `backOff`, `asTransportAttempts`, `acceptedStream`, `openRouterStream`, and the four whole-call
  seams), `src/transport-retry.ts`, `src/messages-stream.ts` (a move, meant to change nothing),
  `src/pdf-read.ts` § `withTransportRetries` and `refuseBodyError`, `src/embeddings.ts` §
  `embedBatch`, the three one-line opt-outs, `tests/ai-call-transport-retry.test.ts`, and
  `docs/project/ai-gateway.md` § "A transport blip is retried". That is where to start, not a
  limit on scope.

## State of the evidence, said plainly

- `npm run typecheck` is green on this commit.
- `tests/ai-call-transport-retry.test.ts` was red first (45 of 98,
  `docs/plans/261005j-red-first.txt`) and 98 of 98 green after the fix, on a tree slightly earlier
  than this commit.
- **Nothing else has run on this commit.** The machine is out of memory and is refusing test
  runs. Seven older tests were edited by hand afterwards (the table in the plan's "As built") and
  have not been run since: three in `tests/ai-call.test.ts`, one in `tests/ai-call-images.test.ts`,
  four in `tests/quick-search.test.ts`, two in `tests/embeddings.test.ts`. The planned mutations
  (delete the per-attempt meter, the abort check, the `priced` guard, the `200` boundary) have
  not been run either.
- **Because of that memory pressure: run at most one test file at a time, and only through
  `flock /var/tmp/spideryarn-heavy.lock npx vitest run <one file>`.** If vitest prints
  "REFUSING TO START", nothing ran: say so, do not retry in a loop, and reason from the code
  instead. No full suite, no typecheck, no build.

## What to do

Attack it independently first. Money: is it still exactly one spend row per network attempt and
none for a wait; can any path re-buy a call the provider billed; can a row be left pending
(a generator closed during the backoff, an abort between attempts)? Behaviour: does every caller
still classify an abort, a deadline and a refusal as before; is `options.end` right after a
retried stream; does any opted-out caller now behave worse; did the move out of
`messages-stream.ts` change that wire? Tests: do the hand-edited older tests still test what
their names say, and does any new test pass for the wrong reason? Docs and comments: is every
sentence true of the code?

Severity, by consequence: **P0** data loss, exploitable security, incorrect charging, or the
service broadly unusable; **P1** user-visible wrong behaviour, or an authoritative contract
violated; **P2** design or maintainability risk with no wrong behaviour today; **P3**
non-behavioural prose or comment defect.

Give every finding an ID, a severity, file and line, and whether you fixed it (with the test you
saw red, if you could run one) or are reporting it. End with one verdict: *land*, *land after the
listed fixes*, or *do not land*.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `backOff` throws `signal.reason` after `waitOrStop` rejects. Whether every caller's abort test
  (`abortedBy`, `stoppedByReader`, `explainAbort`, pdf-read's `error.name === "AbortError"`,
  quick search's cancellation) treats that as the abort it is, including an `AbortSignal.timeout`
  whose reason is a `TimeoutError`.
- In `acceptedStream`, `onActivity` is called after a failed attempt even when the caller's
  stall clock has already fired.
- Embeddings now waits up to 30 s on a dropped connection. Whether its route still answers
  inside its platform limit.
- Whether the fake-clock edits in `tests/embeddings.test.ts` can hang (`AbortSignal.timeout` is
  not faked).
