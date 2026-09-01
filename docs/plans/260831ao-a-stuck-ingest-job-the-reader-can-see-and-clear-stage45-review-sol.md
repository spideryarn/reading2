Verdict: I would not ship Stages 4–5 unchanged. The state mapper is sound, but the hierarchy timing evidence and the missing band warning are reader-facing correctness problems.

## Findings

1. **High — the hierarchy “usual” measurement is not measuring successful current attempts.**

   [`STEP_TIMING`](/home/greg/code/spideryarn2/src/job-state.ts:225) groups AI calls by `jobId` and uses their whole span. Of the six referenced jobs, only `spya-epn0ze` finished successfully; the other five ended in error. For example, [spya-zf0bgj](/home/greg/code/spideryarn2/data/_jobs/spya-zf0bgj.json:26) failed, and its current hierarchy attempt lasted about 459 seconds, while the AI-call aggregation counts 772 seconds. [spya-v2f7b3](/home/greg/code/spideryarn2/data/_jobs/spya-v2f7b3.json:32) similarly records a 67-second final attempt inside a much larger aggregated span.

   That means the data is both:

   - Mostly time-to-failure, not time-to-success.
   - Not the same clock `displayJob` shows, namely the current `JobStep.startedAt`.

   So “This step usually takes a few minutes” and the ten-minute threshold are not supported. Re-measure successful attempts as `step.finishedAt − step.startedAt`; until there are enough, hierarchy should have no “usually” line.

   Sketch is much better: all 13 calls succeeded and the 121–199 second spread supports “two or three minutes,” although only one was an actual `job_step`.

2. **Medium — unmeasured steps still make a statistical claim.**

   Every unknown step gets the guessed three-minute threshold, then emits “This is taking longer than usual” through [`stateOf`](/home/greg/code/spideryarn2/src/job-state.ts:368). That contradicts the stated rule that unmeasured steps say nothing about usual duration.

   Keep the safety warning, but use different copy, such as “This step has been running for a while — you can stop it.” Reserve “usual” for measured steps.

3. **Medium — the transport warning is missing exactly where many readers wait.**

   Keeping transport health outside `displayJob` is correct. Omitting it from [`JobProgress`](/home/greg/code/spideryarn2/src/web/JobProgress.tsx:126) is not. A reader drawing a sketch or generating a glossary may never look at the shelf card; their only surface can therefore spin indefinitely without the warning Stage 5 exists to provide.

   [`useStepJob`](/home/greg/code/spideryarn2/src/web/useStepJob.ts:151) already owns the queue subscription. It can expose `stalled` alongside `job`, avoiding transport data on `Job` or `displayJob`. Stage 6 will have to widen this seam anyway.

4. **Medium — interruption is classified by mutable prose.**

   [`job.error === INTERRUPTED.message`](/home/greg/code/spideryarn2/src/job-state.ts:329) makes historical jobs stop being classified as interrupted when the sentence is reworded. That is precisely what the stable `[jb-gone]` code is designed to prevent.

   The “a job is a struct” argument supports adding an explicit cause such as `endingKind: "interrupted"`; it does not support comparing a struct’s prose field. Until such a field exists, the stable code is less fragile than full-message equality.

5. **Low — three failures is about 16 seconds, not 24.**

   The first `/advance` happens immediately. Failures occur roughly at 0s, 8s and 16s; the warning appears on the third failure before its following wait. The threshold itself is reasonable, but the comments and docs claiming ~24 seconds are wrong.

## The five decisions

1. **Per-step thresholds:** correct design. Hierarchy’s evidence is not adequate; sketch’s is. The 140-second window from ten minutes to the 740-second self-abort is mechanically useful, but ten minutes is not evidence-backed by the current aggregation. One supposed 772-second “run” could never complete inside that deadline.

2. **Interrupted classification:** `failureKind === "retry"` is definitely too broad, but full prose equality is also wrong. Prefer an explicit structured cause; stable code parsing is the safer interim choice.

3. **Transport health:** correct separation, unacceptable surface gap. Show it in `JobProgress`.

4. **Independent clock:** necessary, and one second while busy is right. [`useNow`](/home/greg/code/spideryarn2/src/web/useNow.ts:21) cleans up both interval and listener, so I see no leak. A one-day idle interval is harmless but unnecessary—it really fires daily, contrary to “never fires.” Supporting a disabled interval would be cleaner.

5. **Attempt duration:** per-step is the right v1. Do not add `attemptStartedAt` merely to fill an empty field. Add it only when there is a concrete job-level sentence or metric to show. Omitting terminal duration is honest.

## Tests

Several claims are not pinned:

- “Says how long … beside what it is doing” uses three independent `toContain` assertions at [job-card-progress.test.tsx:126](/home/greg/code/spideryarn2/tests/job-card-progress.test.tsx:126). It does not pin order, adjacency, or even the same row.
- “Asks `jobWorthRetrying`” at [job-state.test.ts:159](/home/greg/code/spideryarn2/tests/job-state.test.ts:159) cannot prove delegation and omits `"ours"` and `"bug"`. An implementation that only rejects `"blocked"` passes.
- The interruption test does not distinguish exact-message equality from `[jb-gone]` parsing; either implementation passes.
- The tests distinguish hierarchy from fetch at six minutes but do not pin the actual seven- and ten-minute boundaries.
- Nothing advances fake time after mounting. A clock that never ticks after its first render passes every new test, and cleanup is untested.
- `NOW = Date.now()` does not freeze the clock. Exact `2m 14s` and `1m 14s` assertions can flake if the worker pauses for a second.

Other negative assertions that can pass because the relevant UI disappeared:

- “only counts the step the reader is waiting on” passes if done step rows render nothing.
- The unmeasured-fetch half passes if the fetch row does not render.
- “says nothing about the driver over one unlucky request” passes if that card disappears.
- “keeps quiet … once the job is over” passes if terminal cards disappear.

The repaired tab test now correctly asserts that the card exists first. `job-progress-band.test.tsx` has no negative-render assertions.

## Copy and codes

“Waiting to continue,” “Stopping after the current step,” and the tab dependency are plain and direct. The sketch estimate is honest. The hierarchy estimate is not supported, and “longer than usual” is false for guessed steps.

The no-code rule is right for ordinary status and timing sentences. It is not fully right for `DRIVER_STALLED`: repeated transport failure is a problem, and it is exactly something a reader may report. Either give that sentence a stable code or narrow the documentation instead of claiming none of these states is a problem.

## Purity and totality

`displayJob` is pure over a typed `Job`: it reads no clock, mutates nothing, and delegates retryability to another pure function.

It is total over the declared `Job` union:

- Malformed, future or missing step time → `elapsedMs: null`, never slow.
- No running step, including no steps → `step: null`, running maps to working.
- Cancelling beats slow.
- No lease is consulted.

It is not total over arbitrary malformed wire JSON: missing `steps` throws, an unknown `status` produces an undefined state, and a non-finite `now` can reach `elapsedLabel` as nonsense. That is acceptable only if “total” explicitly means total over validated `Job`.

## Stage 6

Stage 6 must address three seams:

- [`HttpError`](/home/greg/code/spideryarn2/src/web/lib/api.ts:195) currently retains only `message` and `status`; [`errorFor`](/home/greg/code/spideryarn2/src/web/lib/api.ts:218) discards every other structured field.
- `useStepJob` filters jobs through `writesStep`, so it cannot represent a blocker that does not contain the requested step.
- The blocking job must come from the atomic claim result, not a later `listJobs()` lookup.

I would model the blocker separately from the requested job and add the transport-health result to that same widened `StepJob` seam.

The focused Vitest command could not execute in this read-only review environment: even the runner config loader needed to create `/tmp/.../ssr` and `/tmp/.../client`. No test result should be inferred from that startup failure.