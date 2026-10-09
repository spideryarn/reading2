# A requeued job does not buy the Illustrated plates again

Bug fix under Greg's standing rule (2026-10-09: *"You are definitely authorised to fix bugs any time
you notice them"*). Left open by
[261009l § Plan review, finding 6](261009l-a-requeued-job-does-not-buy-the-debate-search-again.md#plan-review-gpt-sol-and-what-changed):
*"Illustrated's plates are the other dear un-checkpointed purchase, and whole-step `oncePerJob` would
break its intended second window."* Same class as
[261009g](../postmortems/261009g-a-resume-rule-sized-for-checkpointed-work-rebuys-a-purchase.md) —
*a resume rule sized for checkpointed work, applied to a purchase that is not* — so no new postmortem;
that one's § The fix that is right for the long term gets its open paragraph closed.

## The problem

The `illustrated` step is two units (src/illustrated.ts § `generateIllustrated`): a **brief**
(one Sonnet call) and the **plates** (one image call per scene, sequential, about $0.30 for a set).
The brief is banked in a checkpoint keyed by the job (`briefBank`, src/pipeline.ts), so when the
plates will not fit in what is left of the claim the step hands itself to the job's next window on
purpose (`NeedsAnotherWindow`), and that window draws the plates without buying the brief again.

The plates have no such bank. They are drawn into memory and stored as blobs only after the whole set
is back. So when a window ends while plates are being drawn — the process killed or deployed over and
its lease lapsed (`settleExpired`), up to `REQUEUE_BUDGET` = 2 times — the next window reads the
banked brief, finds the plates fit, and draws the whole set again. Every plate the first window paid
for is lost and bought again, up to three times a job, on one press.

The deadline pause rarely reaches the plates: they start only when all of them fit on their own
clocks (`PLATE_CAP_MS` each, plus the settle margin). It can still race the overhead around them —
the fit check is before the marker, drawing and blob storage after — and a lapse reaches them
outright. Both requeues keep the job row's columns, so the fix covers both.

## Options

1. **Whole-step `oncePerJob`**, as Debate has. Rejected: the step's *own* hand-back after banking the
   brief is a second window of the same job; the marker would refuse it, and every Illustrated
   whose brief took the room would fail.
2. **A checkpoint per plate** — bank each plate's bytes (or a blob key) as it comes back, and let the
   next window draw only the missing ones. Rejected for now: it still re-buys the plate that was in
   flight when the window died (one plate of up to three, so it does not meet "cannot double-buy"),
   it needs the style reference re-read from the blob store to keep the set in one hand, it moves
   blob storage inside the loop, and it is the most code. It is the better reader experience — an
   interrupted set resumes rather than fails — and is the upgrade if interrupted paints turn out to
   be common.
3. **Chosen: the same once-per-job marker, put down at the plate phase rather than at the step.**
   The brief and its hand-back are untouched. Immediately before the first plate is drawn, the step
   asks the job row whether this job has begun its plates before; if it has, it fails with a sentence
   and draws nothing. The reader presses Retry (a new job) to paint again.

## The fix

- **A purchase name, not only a step name.** `JobStore.beginPaidStep(id, attempt, purchase)` takes a
  `PaidPurchase` — `StepName | "illustrated-plates"` — instead of a `StepName`. The column
  (`jobs.paid_step_begun`, text) already holds any string, so **no migration**. The store method and
  its fence are otherwise unchanged.
- **`StepContext.beginPaidWork?(purchase)`**, the same call bound to this claim, for a step that marks
  a purchase *inside* itself. Set by `runStep` (src/jobs.ts) next to `jobId`; absent from the command
  line and tests, where nothing requeues.
- **`generateIllustrated` gets `beginPlates?: () => Promise<void>`**, awaited after the fit check
  (and so after the brief is banked and after any hand-back) and before `drawPlates`, only when there
  is at least one plate. The pipeline's `illustrated.run` wires it to
  `ctx.beginPaidWork("illustrated-plates")` and throws `stageFailure(PLATES_NOT_REPEATED)` on
  `"begun-before"`. The eval passes nothing.
- **A new reader sentence**, `PLATES_NOT_REPEATED` (src/messages.ts, kind `retry`, code
  `jb-plates-once`): *"These pictures may already have started being painted when the job stopped,
  so they may already have been paid for. They were not painted again by themselves. Press Retry to
  paint them."* Its own code rather than Debate's `jb-paid-once`, whose sentence says "search".
  Illustrated shows a failed job through `JobProgress`, whose button is Retry.

**One column holds both markers, and that is safe.** A job walks its steps in order, and a step's
purchase is marked only after every earlier step committed. So at most one marked purchase is ever
unfinished in a job, and a later marker only ever overwrites the marker of a step that is already
`done` and skipped by the freshness check. In canonical order (src/step-order.ts) `illustrated` comes
before `debate`, so the overwrite that can happen is `illustrated-plates` → `debate`.

## The trade-off, named

- **An Illustrated a deploy interrupts mid-plates now fails and waits for a press**, where before it
  repainted by itself at up to $0.30 a window. The Retry is a new job, so it also buys the brief
  again (the bank is keyed by job, on purpose — 261007l). And a stage failure discards the job's
  draft (src/store/pg-session.ts), so in a `sketch` → `illustrated` job a Sketch redrawn earlier in
  the same job is lost with it and may be bought again on Retry. That is true of every Illustrated
  failure today, not new here, but this fix adds one more way to reach it. The published article is
  unchanged throughout: nothing is half-finished. That is the price of not resuming; option 2 is
  what would remove it.
- **Conservative at the edges**, as Debate's is: the marker goes down before the first request
  leaves, so a window that died after the marker and before any plate was sent is refused too.
- **A set that was fully drawn but died before it committed** is also refused. Its plates may have
  been stored as blobs one by one before the step commit, and stay orphaned — accepted already
  (src/pipeline.ts § `STEPS.illustrated`, src/illustrated-image.ts § Orphans), and not made worse.

## Tests (red first)

1. **Step level**, tests/illustrated-step-registration.test.ts § the brief between windows: two
   windows of one job sharing a checkpoint store and a fake job marker (`beginPaidWork` over a
   `Set`). The first window banks the brief and dies on its first plate — the plate call **never
   returns**, as a killed process's does not (a throw would be caught by `drawPlates` as that plate's
   failure). The second window must draw **no** plates and fail with `[jb-plates-once]`. **Red
   before the fix**: the second window draws both plates.
   Controls in the same block: the deliberate hand-back (brief banked, plates do not fit) leaves no
   marker, and the next window draws the plates; a new job, with its own row, paints.
2. **Walk level**, tests/jobs-paid-step-once.test.ts: a stub step that calls
   `ctx.beginPaidWork("illustrated-plates")`, then lapses its lease; the next window's call answers
   `"begun-before"` and the row holds `illustrated-plates`. Proves `runStep` wires the claim's fence
   into the context, which the step-level fake cannot. And a store case for the shared column: a job
   that marked `illustrated-plates` and then began `debate` is refused `debate` after a lapse.

Gates: `npm test`, `npm run typecheck`, lint on touched files.

**Watched red on 2026-10-09**, before any production change: the second window resolved with
*"2 plate(s) painted"* instead of rejecting. The walk test was checked by mutation: with
`beginPaidWork: beginPaidStep` taken out of `runStep`'s context, it goes red.

## Plan review (GPT Sol) and what changed

[Review](261009o-a-requeued-job-does-not-buy-the-illustrated-plates-again-plan-review-sol.md):
*APPROVE WITH CHANGES*, no musts. All taken: the test is described as a call that never returns
(should 1); the Retry cost names the lost Sketch in a chained job (should 2); a store case for the
shared column and a fresh-job control were added (should 3); the orphan-blob sentence was wrong and
is corrected (should 4); the deadline claim is softened (could 1); "or the reverse" is gone, since
canonical order puts `illustrated` first (could 2).

## Code review (GPT Sol)

[Review](261009o-a-requeued-job-does-not-buy-the-illustrated-plates-again-code-review-sol.md):
*APPROVE WITH CHANGES (made)*, no musts. It added a case where `beginPaidWork` throws
`StaleAttemptError` (a lost claim): the original error propagates, so the walk treats it as a lost
claim rather than a reader-facing failure, and no plate is sent. It corrected two comments that still
described only whole-step protection (src/db/schema.ts § `paidStepBegun`, src/jobs.ts §
`REQUEUE_BUDGET`), and resets `plateHangs` and `briefTakesMs` in `beforeEach` so an abandoned
first-window promise cannot leak into a later case. Checked by mutation: without the `beginPlates`
call the red-first case fails, the second window painting two plates. Its sandbox could not reach
Postgres; the Postgres cases were rerun outside it and pass.
