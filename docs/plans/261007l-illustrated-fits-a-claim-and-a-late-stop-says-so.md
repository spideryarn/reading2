# Illustrated fits a claim, and a late Stop says so

2026-10-07. Builder: Claude (Opus), for the Overseer. Queue item **qi-ny9thbvd**, from the seventh
sweep ([261006m § Where this stands, item 3](261006m-seventh-codebase-sweep-depth-umbrella.md#where-this-stands-2026-10-07)),
settled by the Overseer on Greg's *"If you're confident and/or these aren't hard to reverse,
consequential, risky … then just go with your judgment"*:

> Illustrated's step is split so no single request can outrun a claim (engineering, nothing a reader
> sees); and a Stop that came too late says so in one line instead of "Done — read it".

Two parts, one commit each.

**Status, 2026-10-07**: both built, red first. GPT Sol's plan review
([…-plan-review-sol.md](261007l-illustrated-fits-a-claim-and-a-late-stop-says-so-plan-review-sol.md))
found five things and all five changed the build; Part 1 below is the plan as written, and
[§ What the plan review changed](#what-the-plan-review-changed) says what was built instead where
they differ.

## Part 1: no Illustrated request outruns a claim

### What production says (read-only, `ai_calls`, 2026-10-07)

| | n | median | p90 | max | max output tokens |
|---|---|---|---|---|---|
| the brief (Sonnet 5, `messages`) | 15 | 230 s | 263 s | **428 s** | 45,070 (37,079 of it reasoning) |
| a plate (`gemini-3.1-flash-image`), ok | 30 | 11.5 s | 15.0 s | 42 s | — |
| a plate, error | 3 | 241 s | 241 s | **241 s** | — |

The 739.3 s worst step from [261007h](261007h-five-more-step-budgets-to-what-they-measure.md) was
**not** a long brief: it was a 246 s brief followed by two image calls that each failed after 241 s
(job `spya-jcpz2w`). The stored briefs (78 paintings, at most 3 plates) are at most 23,347
characters, so the visible answer is about 8,000 tokens; the rest of a brief's output is reasoning.

So both halves can outrun a claim today: the brief's `max_tokens` (72,000) is 948 s by
`deadlineFor`, and the plates have no clock at all, so three failing plates are 723 s on their own.

### The split

The step is already two kinds of request: one brief, then up to `MAX_PLATES` (4) plates. Make each a
unit that fits a claim, bank the brief between them, and hand the job back between units with the
machinery the structure step already uses (`NeedsAnotherWindow`, src/another-window.ts; a
checkpoint, src/store/checkpoints.ts):

1. **The brief fits a claim.** `ILLUSTRATED_ANSWER_TOKENS` 32,000 → **12,000**, so `max_tokens` is
   52,000 and its `deadlineFor` is 685 s, under the 740 s claim and under the step's own 700 s
   reservation. Production's largest brief, 45,070 tokens, still fits; the visible answer (about
   8,000) has half again as much room. A brief that would run past 52,000 tokens now fails with the
   existing *ran past its room* sentence; today the same brief would run 550–760 s, then the plates
   would push the step past the deadline, and the product would be discarded and the brief paid for
   again in the next window.
2. **Each plate gets a clock**: `PLATE_CAP_MS` = 120 s, the whole draw including its transport
   retries, about three times the slowest successful plate (42 s). A plate over it is that plate's
   failure, exactly as a provider error is now (the set keeps going); a reader's Stop is still a
   cancellation. The plates as a unit are then at most `n × 120 s` (480 s for four).
3. **Bank the brief, and hand back between units.** `generateIllustrated` takes three optional
   inputs, all absent from the eval and the CLI so they behave as now:
   - `deadlineAt` and `window` (the `StepContext` fields of the same names), and
   - `bank`: `read()` returning a banked brief or nothing, and `write(brief)`.

   Before the brief: if a banked one exists, use it and call no model. Otherwise, if
   `deadlineAt − now < deadlineFor(max_tokens)` and `window.anotherAvailable`, throw
   `NeedsAnotherWindow` (nothing has been bought). After the brief: write it to the bank. Before the
   plates: if `deadlineAt − now < plates × PLATE_CAP_MS` and a window is available, throw
   `NeedsAnotherWindow`; the next window reads the brief back and draws every plate. Without a
   window left it runs on, which is today's behaviour.
4. **The bank is a checkpoint**, namespace `illustrated-brief`, value the brief's raw text. The key
   is a digest of the **job id**, the step's input fingerprint (the Sketch, the figures and the note,
   which already carries `PROMPT_VERSION`) and the brief model. The job id is what keeps a forced
   repaint from getting the previous brief back: a new press is a new job and asks again; only this
   job's later windows reuse it. `StepContext` gains `jobId` for this. The namespace needs one
   migration that widens the `checkpoints_namespace` CHECK (additive). Until production has it, the
   write is refused and logged at `warn`, and the step behaves as today.

**Nothing a reader sees changes.** The prompt is untouched, so `PROMPT_VERSION` does not move and no
painting goes stale; only `max_tokens` changes. A painting that used to need one window may now take
two, and the browser re-drives that on its own (src/web/jobEngine.ts).

**The simpler option passed over**: cap the brief and add the plate clock, with no bank and no
hand-back. Each request would then fit, but the brief and the plates together still would not
(685 + 480 s), so a long brief would be discarded at the deadline and bought again. Splitting the
*brief* per plate was passed over too: it changes the prompt, so every painting would read stale,
and it costs a second article read per plate.

**Tests, red first** (tests/illustrated-run.test.ts, tests/jobs-lease-budget.test.ts):

- the open-defect pin becomes the fit assertion: the brief's token time < the claim, and
  `MAX_PLATES × PLATE_CAP_MS` < the claim. Red at 32,000.
- too little time before the brief, a window left: `NeedsAnotherWindow`, no model call.
- too little time after the brief: the brief is banked, `NeedsAnotherWindow`, no draw.
- a banked brief: no model call, every plate drawn.
- no window left: runs on.
- a plate that outlives `PLATE_CAP_MS`: that plate failed, the next one drawn, the set not cancelled.
- the pipeline step keys the bank by job id (a second job does not read the first's brief).

### What the plan review changed

| | Sol's finding | What was built |
|---|---|---|
| 1 | The brief had an estimate, not a clock | `BRIEF_CAP_MS`, the brief's full-token time, on an `AbortSignal.timeout` composed with the reader's signal over the whole call. Its expiry with the reader's signal live is the *took too long* failure (`providerHttpFailure(504)`), retryable |
| 2 | "No window left: runs on" defeats admission, and the gates left nothing for settling | Each unit starts only with room for its clocks **plus `SETTLE_MARGIN_MS` (20 s)**, window or no window. Short of time it throws `NeedsAnotherWindow` either way; with no window left the walk ends the job *interrupted* (`pauseForDeadline` answers `budget-spent`), the same ending as running on and being killed, less the request. So `generateIllustrated` takes no `window`. src/another-window.ts now says when a step may throw without one |
| 3 | The plate clock would read as a Stop through `wasAborted`, and a provider's own `TimeoutError` already did | `wasAborted` is gone: only the reader's signal stops the set. Any other abort or timeout is that plate's failure and the next is drawn. The two 261007f cases that pinned "a provider timeout returns a cancelled set" now pin the whole set (tests/illustrated-step-registration.test.ts), and `discardOnAbort` no longer has a reachable producer |
| 4 | A failed bank write would hand back a brief nobody saved | `BriefBank.write` answers whether it saved. A brief that could not be saved is not handed back: the step fails instead of buying it again in the next window |
| 5 | The Stop sentence asserted an order the record cannot prove | The sentence no longer says the step had finished (Part 2) |

And one number moved with finding 2: the brief is **50,000 tokens in all** (`ILLUSTRATED_ANSWER_TOKENS`
10,000), 658 s, not 52,000 and 685 s, so that the brief plus the margin (678 s) sits under the step's
700 s reservation and a claim that admitted the step can start the brief without handing straight
back. Production's largest brief, 45,070 tokens, still fits; its visible answer was about 8,000.

**Where the migration stands.** It widens `checkpoints_namespace` by one name and is additive. It is
not applied to the shared local database yet: a peer worktree (`fbtddvg2-guide-agent`) applied its own
unlanded migration there, and `db:migrate` rightly refuses until that lands
([database.md § A watermark is not a ledger](../project/database.md#a-watermark-is-not-a-ledger)). The
step test uses an in-memory checkpoint store. **In production the migration must ship with the code**:
without it every `illustrated-brief` write is refused, and a long brief whose plates must wait then
fails the step instead of handing back.

## Part 2: a Stop that came too late says so

[261007f](261007f-stop-during-the-last-step-keeps-and-publishes.md) made a Stop that lands during the
last step keep and publish the article (Greg, 2026-10-07). The card then goes from *Stopping…* to the
finished state with no word that the Stop was overridden (that plan's *Left*, Sol's C7).

- **Server**: `jobs.cancel_requested_at` is stamped only when a Stop is accepted on an active job and
  is never cleared, so a `done` job carrying it is exactly a Stop that came too late. `toJob`
  (src/store/pg-jobs.ts) sets `stopCameTooLate: true` on such a job; absent otherwise, like
  `cancelling`. `publicJob` passes it through.
- **Client**: `displayJob` (src/job-state.ts) gets a ninth state, `kept`, for a `done` job with the
  flag, and its sentence, under the steps on `JobCard` (the add box and the add page):

  > You pressed Stop during the last step. What it had done by then was kept.

  Plain, and true for an import and for a mode job alike. It was going to say the step *had already
  finished*; Sol's plan review (finding 5) pointed out the record cannot prove that order, and
  `assets` honours a Stop by returning a part-fetched manifest and still ends `done`.

**Tests, red first**: tests/job-state.test.ts (a done job with the flag shows the sentence; without,
nothing), and a `toJob` case in the Postgres jobs suite (Stop accepted on a running job that then
finishes `done` → the flag; a job stopped while queued → `cancelled`, no flag).

## Out of scope

Plate checkpoints (a plate drawn before a hand-back is redrawn; the bank holds only the brief, and the
gate before the plates means a hand-back never lands between plates), the step's 700 s reservation
(unchanged; it accommodates the brief's 658 s clock plus settling), and Sketch.

## What the code review changed

The bank's string check did not establish a usable brief. Cached answers now pass through the same
parser and brief reader as fresh answers and need a surviving plate; corrupt or unusable hits become
misses. Fresh answers are banked only after that validation. Seven new unit cases were observed red
before the fix and green after it. Root cause and prevention are recorded in
[the postmortem](../postmortems/261007p-banked-answers-must-be-validated-before-reuse.md).

The unused `discardOnAbort` field, producer, runner check and synthetic test were removed. Only an
aborted caller signal can now produce a cancelled plate set, and the pipeline throws for that set
before returning a product.

Transport-backed image tests now cover clock expiry and Stop during real retry backoff. Removing
signal forwarding made both tests red. A queue unit case for explicit hand-back on the final window
also went red with the hand-back branch disabled, proving it requires the interruption ending.
All 130 cases across the five available unit files pass. The typecheck script passes via
`node --import tsx scripts/typecheck.ts`; `npm run typecheck` itself cannot open tsx's IPC socket in
the review sandbox. The requested seven-file command was attempted, but Postgres setup fails with
`EPERM` connecting to localhost, so the three database-backed files, including the new pipeline-bank
and persistent final-window cases, remain unverified here. No migration was run.
