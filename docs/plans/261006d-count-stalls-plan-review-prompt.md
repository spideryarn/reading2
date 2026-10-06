# Review: a plan to record our own stall clock and deadline apart from a reader's Stop in `ai_calls`

Repo: this worktree, branch `worktree-qi-pwhxm2t2-count-stalls`, TypeScript + ESM. Read-only
review: change no file.

## The candidate

Live, pre-commit. One untracked file:

- `docs/plans/261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md`

It builds on committed work: `docs/plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md`
(read its § Stalls and § Left for later), `src/call-failure.ts`, `src/ai-call.ts` (`CallEnd`,
`Meter.failed`, `abortedBy`, `openRouterStream`'s `finally`), `src/messages-stream.ts`
(`recordFailure`, `isAbort`, `AttemptEnd`), `src/cost-cube.ts` (`failureCountsOf`, `failureCauses`,
`FAILURE_NOTES`), and the eight runners found by `grep -n 'abort(new Error("stalled"))' src`.
Those are where to start, not a limit on scope.

## What to do

Attack the plan before it is built. Is each statement in it accurate against the code? In
particular check, by reading the call sites and by running a small Node snippet where one settles
it (`AbortSignal.any` reason propagation, the reason of `AbortSignal.timeout`, what `fetch` and the
Anthropic SDK reject with when a composite signal aborts):

- whether the signal's `reason` at each place an `aborted` end is made really is the reason of the
  clock that fired, on both wires, including the Messages wire where the SDK owns the abort;
- whether any reader of `SpendRecord.failure`, `failurePhase` or `failureClass` assumes a non-null
  failure means `outcome = 'error'` and would now be wrong (folds, the eval budget, the detail
  read, the two-reads check in the cost analysis, any SQL);
- whether the *not measured* rule for stalls can show a wrong zero or hide a real count;
- whether there are stall or deadline clocks that reach a gateway and would be recorded as `abort`
  that the plan does not name;
- whether anything else is simpler and as good.

Severity: **P0** data loss, security, incorrect charging, service broadly unusable. **P1**
user-visible wrong behaviour or an authoritative contract violated. **P2** design or
maintainability risk, no wrong behaviour today. **P3** prose defect. Refuse (*change first*) only
on an established P0 or P1: direct evidence, no unresolved inference. Say for each finding whether
it is established or reasoned.

Number findings **F15 upward** (F1–F14 are taken by 261006b's chain). End with a verdict line:
`VERDICT: build it` or `VERDICT: change first`.

## My own suspicions, worth less than yours

- The Messages wire records `aborted` when `stream.aborted` is true; I have not checked that
  `options.signal.reason` is the right thing to read there in every case (a stop while waiting
  between retries, `stream.abort()` with no signal).
- Recording `abort` rows with a phase might leak into *died part-way* or the causes table through a
  fold that tests the phase and not the outcome.
- Leaving `DeadlineReached` (`src/jobs.ts`) as `abort` may be the wrong call.
