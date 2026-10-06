# Count the pipeline's job deadline as a deadline, and class live conversation's stops

Queue item `qi-2hz8smy5`. Up: [plans.md](../project/plans.md). It takes the first two items of
[261006d](261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md) § Left for later.

## What it is for

Greg wants to see how often model calls die part-way before deciding whether to pay twice for an
answer that broke half-way. 261006d made an `aborted` row in `ai_calls` say who stopped the call:
`stall`, `deadline` or `abort`. Two kinds of stop still say the wrong thing or nothing:

1. **The pipeline's whole-job deadline** (`DeadlineReached` in `src/jobs.ts`, 740 s into a claim)
   aborts with a class `abortClass` does not know, so the row says `abort`, the label a reader's
   Stop gets. A provider that was still answering when the job budget ran out is in neither the
   stall nor the timeout count on `/admin/costs`.
2. **Live conversation** (`src/live.ts`) writes its `aborted` rows with no class, so they show as
   *stops not classified* and can turn a group's stall and timeout figures to *not measured*.

## The design

### 1. The job deadline

`DeadlineReached` in `src/jobs.ts` becomes a subclass of `CallDeadlineReached`
(`src/call-failure.ts`, which has no imports), passing `INTERRUPTED.message` as it does now.
`abortClass` then answers `deadline` by its existing `instanceof` line, and nothing in
`src/call-failure.ts` learns about jobs. `jobs.ts` keeps its own class, so its two
`instanceof DeadlineReached` tests (whose abort was it) are unmoved.

261006d left this out because "it lives in a file that should not import the ledger's vocabulary".
The import is one class with no dependencies, and the label's definition already says a deadline
"can cap one call, a turn or a processing step"; a whole job is the next size up of the same thing.

`name`: `CallDeadlineReached` sets `this.name`, and `DeadlineReached`'s comment promises it keeps
`Error`'s name, which `errorFields` in `src/log.ts` puts in the log. The subclass sets
`this.name = "Error"` back, so the promise holds.

**The reason does arrive.** The plan review traced every path from `StepContext.signal` to a
gateway (labels, PDF reading, structure slices, structure deepening, simple summaries) and found
none that loses the reason: each composes with `AbortSignal.any` or forwards the reason, and the
bare `fatal.abort()` calls are sibling cancellation, which is rightly `abort`. Its table is in
[the review](261006f-plan-review-sol.md). So no relay needs changing.

**A burst of log lines.** `ai call stopped by our clock` is a `warn` per stopped attempt. A job
that hits its deadline with twelve calls in flight now logs twelve. Accepted: each is a row, and
the job's own line already says which job.

### 2. Live conversation

The realtime call is made by the browser; the server prices what the browser reports. A response
row is `aborted` when OpenAI's status is `cancelled` (the reader talked over the model, or the
client cancelled) or `incomplete` (the output cap or a content filter).

**No timer sends `response.cancel`**, in either engine (there is no `response.cancel` under
`src/web/live/` at all). The stall rules in `src/web/live/stall.ts` and
`src/web/live/gpt-live/stall.ts` drive a notice and a Reconnect button. Clocks of ours do end live
*conversations*: the idle and session caps and the startup and disconnection timers close the
session (review F29), and a response unfinished at that moment usually reports no terminal event
and so has no row at all. So a **received** Realtime terminal event that says `cancelled` or
`incomplete` was not made by a clock of ours, and the response branch of `acceptRealtimeUsage` in
`src/live.ts` (not `ledgerBase`, whose null default the other rows keep; F32) writes
`failureClass: "abort"` on an `aborted` row.

`failurePhase` and `failureStatus` stay null: the browser does not report where the response had
got to. That is a new shape (a class with no phase). The columns are independently nullable,
`failureCountsOf` only reads the phase of a `stall` or `deadline`, and `failureCauses` skips a
null phase (checked by the plan review with a probe).

What this does not count, said on the page:

- a live conversation our own caps or timers closed, or one that went silent: an unfinished
  response then has no row, so a zero here is a zero among recorded stops and not proof that no
  live response was cut off;
- `incomplete` (the output cap, a content filter) is nobody's Stop; it is an ordinary stop in the
  "anything else" sense (F31).

### The page and the docs

`FAILURE_NOTES` and `FAILURE_DEFINITIONS` in `src/cost-cube.ts`: the timeout note says a deadline
can cap one call, a turn, a processing step **or a whole pipeline job**, and loses the sentence
saying the job limit is not recognised; the stops note loses "and neither does live conversation"
and gains the silent-response limit. Comments in `src/call-failure.ts` and `src/cost-cube.ts`
that say the job deadline is `abort`, `docs/project/admin-costs.md`, `cost-tracking.md`,
`ai-gateway.md`, and 261006d's *Left for later*.

Old rows are not rewritten.

## The simpler options passed over

- **A `job_deadline` label of its own.** It would keep "the call was slow" apart from "the job ran
  out". Not taken: the item asks for it to be counted as a deadline, the label already disclaims
  how long the call ran, and a fourth label is a change to every fold.
- **Recognising the job's class by name in `abortClass`.** No import, and a string match on a
  writable property, which that file refuses on purpose.
- **Leaving live rows null and only rewording the note.** Cheaper, and leaves every group with a
  live stop reading *not measured* for a thing that cannot happen there.

## Stages

One stage and one commit (the page's notes and their tests cover both halves, so splitting
them would have meant a commit with a false note in it), then one GPT Sol code review.

Red first:

- `abortClass` of the job's reason is `deadline` (needs the class reachable from a test, or a
  test through the queue).
- Through the stubbed transport: a call whose signal is a job controller aborted with the job's
  deadline reason records `aborted / deadline`; the same controller aborted bare (a reader's Stop,
  `cancelJob`) records `abort`.
- `acceptRealtimeUsage` for a `cancelled` and an `incomplete` response writes class `abort`, phase null;
  `completed`, `failed` and a transcription row write null.
- `failureCountsOf` over a group holding only classed live stops reads `0` for stalled and timed
  out, not *not measured*.

Then `npm test`, `npm run typecheck`, lint on touched files, a mutation check, and a browser check
of `/admin/costs` at 1440, 820 and 390 wide (the notes changed; the columns did not).

## Progress

- [x] GPT Sol review of this plan ([the review](261006f-plan-review-sol.md), *build it*). F29
  (P2, clocks do close live sessions; the premise is narrowed to "no timer sends
  `response.cancel`"), F31 (P3, say what `incomplete` is) and F32 (P3, the function is
  `acceptRealtimeUsage`) taken above. **F30 (P1, already there before this work): GPT-Live records a
  failed or incomplete backend response as `ok / completed`**, because its usage report carries no
  status. Not fixed here: it is a change to what the browser reports and what the server accepts,
  independent of this item. Reported to the Overseer as a new item.
- [x] Built, as designed. The job-deadline test goes end to end through the queue
  (`tests/claim-session-postgres.test.ts`: a real claim, one real gateway call on the step's
  signal with only the provider's URL stubbed to hang, the `ai_calls` row read back from
  Postgres), seen red as `"failureClass": "abort"`. Its control, a reader's Stop through
  `cancelJob`, was `abort` before and after. The live test (`tests/realtime-usage.test.ts`) was
  red as `[ 'cancelled', null ]`. The fold test over classed live stops was never red: the fold
  already handled a class with no phase, so it is a characterisation test. Mutations checked:
  `extends Error`, `failureClass: null`, and dropping `this.name = "Error"` each turn a test red.
  The live limits went in as a note of their own in `FAILURE_NOTES`, not inside the stops note.
  `cost-tracking.md` and `live-conversation.md` said nothing this made false.
- [x] GPT Sol code review of `996ec16a0` ([the review](261006f-code-review-sol.md), *land it*, no
  P0 or P1). It fixed five things itself, all checked and kept:
  - F33 (P3): `AiCallRow`'s comment in `src/ai-spend.ts` and `ai-gateway.md` still said only a
    gateway's aborted row carries failure fields.
  - F34 (P3): the live note said a closed conversation "usually leaves no row". Earlier responses
    of that conversation have rows; it is the unfinished response with no terminal usage report
    that has none. Reworded on the page, in the comment and in the docs.
  - F35 (P2): the job-deadline test could pass with the signal already aborted before the call
    began. It now asserts the call starts first, and the lease allows ten seconds for setup, not
    1.5, so the test takes about ten seconds.
  - F36 (P2): a failed assertion skipped the test's ledger clean-up. The suite's teardown now
    sweeps `ai_calls` for its own slugs.
  - F37 (P3): `ai-gateway.md` said every earlier job-deadline row says `abort`; older ones have no
    class.
- [x] Browser check, by a Sonnet subagent: four `aborted` rows seeded in the local database (two
  deadlines part-way, one stall, one live `abort` with no phase) and deleted afterwards;
  `/admin/costs` at [1440](261006f-shot-1440.png), [820](261006f-shot-820.png) and
  [390](261006f-shot-390.png) wide. Seven notes, none cut off; the page does not scroll sideways;
  *Timed out* `2 (2 part-way)`, *Stalled* `1 (0 part-way)`, no stop left unclassified, and the
  causes table lists the deadline and the stall and no `abort` row. At 390 the last columns start
  off-screen inside the table's own scroll box with no cue, as 261006d already recorded.

## Left for later

- **F30: GPT-Live records a failed or incomplete backend response as `ok / completed`**
  (`src/web/live/gpt-live/delegations.ts`, `backendReport`, `src/live.ts` near the
  "Only `response.completed` is reported" comment). Its usage report carries no status. Found by
  the plan review, already there before this work, and a change to what the browser reports and
  what the server accepts. Reported to the Overseer.
- Old rows are not rewritten: job-deadline stops from before this say `abort` or nothing, and live
  stops from before this say nothing.
