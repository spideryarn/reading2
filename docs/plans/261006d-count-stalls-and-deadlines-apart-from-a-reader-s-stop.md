# Count stalls and deadlines apart from a reader's Stop

Queue item `qi-pwhxm2t2`. Up: [plans.md](../project/plans.md). It finishes what
[261006b](261006b-count-ai-calls-that-die-part-way-and-transport-retries.md) left under
*Left for later § Stalls*.

## What it is for

Greg asked for numbers before deciding whether to pay twice for an answer that broke half-way
("B"):

> A or maybe B would be better. if we go with B, let's add logging/monitoring so we'll be able to
> notice how often retries happen (and hopefully diagnose them)
>
> — Greg, 2026-10-06, on [Q-pay-twice-for-a-broken-answer]

261006b counts the calls that died part-way with an error. It does not count the ones **we**
stopped: when a provider goes silent, our stall clock (no chunk for N seconds) or our deadline
(the whole call took too long) aborts the request, and the `ai_calls` row says `aborted` with no
failure fields. A reader pressing Stop writes exactly the same row. A silent provider is probably
the commonest part-way death there is, so the count Greg will read in a week understates the thing
B would fix. 261006b has not been deployed yet (`e5a9c07a7` is not on `origin/main`), so if this
lands before the next deploy the week of data has no gap.

## Why it could not be done there, and what makes it possible

Both gateways are handed one `AbortSignal`, the caller's composite of the reader's signal, a
deadline and a stall clock. `AbortSignal.any` passes on the **reason** of whichever fired first:

- a deadline is always an `AbortSignal.timeout`, whose reason is a `DOMException` named
  `TimeoutError`. Recognisable at the gateway today, with no caller changed;
- a stall is `stall.abort(new Error("stalled"))`, written out in eight runners
  (`grep -n 'abort(new Error("stalled"))' src`). A plain `Error`, the same shape as a reader's
  Stop. Recognisable once the eight throw one shared class instead.

## The design

**One typed reason.** `src/call-failure.ts` gains `class StallReached extends Error` (message
still `"stalled"`, so anything that reads the message is unmoved) and the eight runners abort with
`new StallReached()`. That file has no imports and is already where the vocabulary lives, so both
gateways and every runner can take it from there.

**Three new labels**, completing the vocabulary 261006b's plan already listed: `stall`,
`deadline`, `abort`. One pure function picks between them from the signal's reason:

```
abortClass(reason):  reason instanceof StallReached              -> "stall"
                     a DOMException named "TimeoutError"         -> "deadline"
                     reason instanceof CallDeadlineReached       -> "deadline"
                     anything else, or no reason                 -> "abort"
```

`CallDeadlineReached` is a second small class beside `StallReached`, for the two per-call clocks
that are a `setTimeout` and a controller rather than an `AbortSignal.timeout` (F15):
`src/structure-slices.ts` (the per-call cap, which also now forwards the caller's reason in
`onStop` instead of dropping it) and `src/collect-pdf-figures.ts` (the figure budget).

Mapped, never sanitised, as before: the reason is tested, never stored.

**An `aborted` row now carries failure fields.** `outcome` stays `aborted` (nothing that reads the
outcome changes: slots, the eval budget, the existing failed-or-stopped total). The row gains:

- `failure_class`: one of the three;
- `failure_phase`: by the same acceptance boundary as an error, `before_answer` or `mid_answer`;
- `failure_status`: the response's status when there was one.

`abort` is recorded as well as the other two, on purpose: it is what says the row was written by
code that could tell the three apart. An `aborted` row with a null class is an old row, and that is
how the page knows *not measured* from zero without a date constant.

Both wires: `CallEnd` in `src/ai-call.ts` and `AttemptEnd` in `src/messages-stream.ts` become
`{ outcome: "aborted"; failure: CallFailure }`, so an abort that does not say which kind does not
compile. Every place that makes one (`Meter.failed`, the clean-end branch and the
consumer-closed-early branch of `openRouterStream`, `recordFailure` on the Messages wire) reads the
signal's reason. A consumer that closed the stream early with no signal aborted is `abort`.

Two cautions from the review, both on the Messages wire. Its retry loop reads
`recordFailure(err) === null` as "this was an abort, do not ask again" (F16): that decision must
not change now that an abort has failure fields, so the function returns a discriminated end and
the loop tests the outcome. And the class is taken **when the abort is seen**, not later (F17): an
SDK abort that settles before an outside deadline fires is `abort`, not `deadline`.

**A log line.** `ai call stopped by our clock` at `warn`, with the same six fields as the other
two, when a `stall` or `deadline` row is recorded. Not for `abort`: a reader pressing Stop is not
news.

**No migration.** `failure_class` is free text with no CHECK; `failure_phase` keeps its two words.

### Where it is shown

The same cube, no new read. `failure_class` is already a grouping column, so the folds in
`src/cost-cube.ts` gain two counts beside *died part-way*:

- **stalled**: `aborted` rows with class `stall`;
- **timed out**: `aborted` rows with class `deadline`.

Each is shown with how many were part-way (`mid_answer`), since that is the half B is about.
*Died part-way* itself keeps its meaning (an **error** after acceptance); the three are shown side
by side and not summed, because a stall mid-answer and an error mid-answer are different evidence
and one row is never both.

**Not measured**: a group's stall and deadline figures are *not measured* when it holds `aborted`
rows with a null class and none with a class; a number when every `aborted` row has a class
(zero included: no aborted rows at all means nothing was stopped, by anyone); and a number with
"N stops not classified" when it holds both. A null class is not only an old row (F18): the
realtime wire (`src/live.ts`) writes `aborted` rows and is not instrumented, and the note says so.

The causes table already lists class by phase; its filter today is "has a phase" (F19), which
would let a reader's Stop in; it becomes "has a phase, and is an error or an `aborted` row classed
`stall` or `deadline`". `abort` stays out of it: a reader's Stop is not a cause of
failure.

`FAILURE_NOTES` loses "Stalls are not measured" and gains what is still missed (below).
`npm run cost:analyse` shares the folds, so terminal, JSON and HTML follow.

### What it still does not tell apart, said on the page

- **The pipeline's job deadline** (`DeadlineReached` in `src/jobs.ts`) is our clock too, and is
  recorded as `abort`. It is a budget for a whole job, not a verdict on one call, and it lives in a
  file that should not import the ledger's vocabulary for this. Left, and said.
- **A deadline is any `AbortSignal.timeout` on the signal**, whoever set it. Every one in `src/`
  that reaches a gateway is ours, so this is right today and is a convention, not a guarantee.
- **Which clock fired first is all that is known.** A provider that sends an error at the moment a
  clock fires is recorded by whichever the code saw, as today.

## The simpler option passed over

Deadlines only, at the gateway, no runner touched. Cheaper by eight one-line edits, and it would
miss stalls, which fire sooner than deadlines on a silent provider and so are the commoner of the
two. Not taken.

A shared `stallClock()` helper replacing the eight hand-written timers was also passed over: it is
the better end state and a larger change to eight streaming runners than a count needs. The typed
reason is the part the count depends on.

## Also in this change

- `docs/project/ai-gateway.md` line 77 still says a call is kept "in Postgres or in a JSONL file".
  The JSONL ledger is gone; the line is fixed to match the code (261006b's F14).

## Stages

1. **The typed reason and the recording.** `StallReached`, `abortClass`, the eight runners, both
   wires, the log line. Red-first tests against the stubbed transport: a stall before the first
   chunk is `aborted / before_answer / stall` or `mid_answer` by the seam's boundary; a stall after
   a chunk is `mid_answer / stall`; an `AbortSignal.timeout` is `deadline`; a reader's abort is
   `abort`; the clean-end race (the cancelled read resolves `done`) keeps the class; an in-band
   error chunk already seen is still an `error` (F9 holds); a reason that is a plain
   `Error("stalled")` or an object with `name: "TimeoutError"` that is not a `DOMException` maps to
   `abort`; each of the eight runners' stall reaches the row as `stall` (one test that would go
   red if a ninth runner were added with a plain `Error`, if a cheap one exists, e.g. a source
   scan).
2. **The read, the page, the report, the docs.** Folds, section, `cost:analyse`,
   `cost-tracking.md`, `admin-costs.md`, `ai-gateway.md` (including line 77), a browser check at
   desktop, iPad and phone widths.

Each stage: `npm test`, `npm run typecheck`, a GPT Sol code review, a commit.

## Progress

- [x] GPT Sol review of this plan ([the review](261006d-plan-review-sol.md), *change first*).
  F15 (P1, two per-call deadlines the mapping missed), F16 and F17 (P2, the Messages wire), F18 and
  F19 (P3) all taken, as marked above. **F20 is wrong**: it says `e5a9c07a7` is on `origin/main`;
  `merge-base --is-ancestor e5a9c07a7 origin/main` exits 1 here, so the sentence stands.
- [x] Stage 1. Built as designed: `StallReached`, `CallDeadlineReached` and `abortClass` in
  `src/call-failure.ts`; the eight runners; both wires (`Meter.stopped` is the one place the
  OpenRouter wire makes an abort; the Messages wire takes the class in its `abort` listener, F17,
  and its retry loop tests the outcome, F16); the log line. A source scan in
  `tests/call-failure.test.ts` fails if a runner aborts with a plain `Error("stalled")` again.
  Three things learned:
  - **"`AbortSignal.any` passes on the reason of whichever fired first" needs a caveat.** On Node
    26 a composite nobody is listening to settles its reason when first read, from the first
    aborted source in *list order*. A call in flight always has a listener, so the exposure is the
    gap between two of them. Said on `abortClass`.
  - **The PDF figure budget is a step's clock, not one call's**, and F15 has it recorded as
    `deadline` while the job deadline in `src/jobs.ts` stays `abort`. The line between them is
    not principled: the first was one line in a file that already made its own reason, the second
    is a private class with its own argued design whose reason crosses many layers. Left, and the
    page says the job deadline is not recognised.
  - The aborted arm of both unions is narrowed to the three abort labels, so an abort carrying
    `refused` does not compile.
  Until stage 2 lands, a reader's Stop shows in the causes table (F19); the two are pushed together.
- [ ] Stage 2
