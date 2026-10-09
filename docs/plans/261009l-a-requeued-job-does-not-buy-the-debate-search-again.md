# A requeued job does not buy the Debate search again

Bug fix under Greg's standing rule (2026-10-09: *"You are definitely authorised to fix bugs any time
you notice them"*). Left open by
[261009e § Plan review, finding 3](261009e-paid-web-search-not-retried-after-it-was-sent.md#plan-review-gpt-sol-and-what-changed):
*"A requeued pipeline step buys the searches again. Documented, not fixed: that is the job lease's
behaviour, not the gateway's."* This is that fix. Postmortem:
[261009g](../postmortems/261009g-a-resume-rule-sized-for-checkpointed-work-rebuys-a-purchase.md).

## The problem

A job walks its steps under one claim. Two things hand an unfinished step to a later window of the
same job, and the later window runs the step from the start:

- **a lapsed lease** — the process was killed, frozen or deployed over mid-step; `settleExpired`
  (src/store/pg-jobs.ts) puts the job back to `queued` while `requeues < REQUEUE_BUDGET`;
- **the claimant's own deadline** (740 s) — it aborts the step and `pauseForDeadline` puts the job
  back the same way.

`REQUEUE_BUDGET` is 2, so a step can be begun three times. For most steps that is the accepted
price (src/jobs.ts § `REQUEUE_BUDGET` says so, and says to revisit "if a third un-checkpointed paid
step ever appears"). For **`debate`** it is not: its Reception call carries `openrouter:web_search`,
15–20 cents a call, and the provider may already have run and billed the searches when the first
window died or aborted. There is no idempotency key and no way to fetch a non-streamed answer back
by generation id, so the second window cannot reuse what the first bought; it can only buy it again.

## Options

1. **Renew the lease while a paid call is in flight.** Rejected: a lease here lapses only when the
   claimant is gone — it sets its own deadline inside the lease and unwinds before it (src/jobs.ts §
   `LEASE_MS`, "That ordering is the whole point and it is why there is no heartbeat"). A renewed
   lease would not save a killed process, and would turn "lapsed means dead" into "lapsed means
   probably dead", which is what `settleExpired` is not safe to act on.
2. **Reuse a finished result.** Not possible: the answer of a call whose process died is gone, and
   `ai_calls` holds the cost, not the body.
3. **Don't requeue at all while such a step is running** (`settleExpired` and `pauseForDeadline`
   end the job instead). Needs a marker cleared when the step commits, so a later step of the same
   job keeps its budget, and two places to consult it. More parts than 4.
4. **Chosen: a step that must not be bought twice says so, and a later window of the same job
   refuses to begin it again.** The requeue machinery is untouched; the next window walks to the
   step, finds it was begun by this job before, and fails it with a sentence. The reader presses
   *Search again* — an explicit purchase — if they want it.

## The fix

- `PipelineStep` gets `oncePerJob?: true`, set on `debate` only (src/pipeline.ts).
- The job row gets **`paid_step_begun text`** and **`paid_step_begun_at timestamptz`** (an additive
  migration). Per job, by construction: a reader's Retry is a new job with a clean row.
- `JobStore.beginPaidStep(id, attempt, step)`, in one transaction that locks the row on the whole
  `liveAttempt` fence (the `pauseForDeadline` shape): a lost claim throws `StaleAttemptError`; a row
  whose `paid_step_begun` already names this step answers `"begun-before"`; otherwise it writes the
  step and `clock_timestamp()` and answers `"begun"`.
- `runStep` (src/jobs.ts) calls it **after** the freshness check and the other refusals and
  **before** `session.beginStep`, only for a `oncePerJob` step. `"begun-before"` throws
  `stageFailure(PAID_STEP_NOT_REPEATED)` — so the step fails the way every step failure does and the
  job settles; nothing is bought.
- The requeue statements do not touch the two columns (they list what they set), so the marker
  survives both kinds of hand-back. Nothing ever clears it: a `oncePerJob` step that committed is
  `done` and is skipped by the freshness check before the marker is consulted.

The reader-facing sentence (`PAID_STEP_NOT_REPEATED`, src/messages.ts, kind `retry`, code
`jb-paid-once`): *"This search may already have started when the job stopped, so it may already have
been paid for. It was not started again by itself. Press Retry to run it."* The Debate panel shows a
failed job through `JobProgress`, whose button is **Retry**; a Retry normally makes a fresh job
(`retryJob`), and an equivalent job already active stays single-flight, as it does today.

## The trade-off, named

- **A Debate a deploy interrupts now fails and waits for a press**, where before it re-ran by
  itself — at the price of a second (and third) search the reader never asked for. A failure on
  screen is the cost; 15–40 cents per interrupted run is what it saves.
- **Conservative at the edges.** The marker is written before `beginStep` and before dispatch, so a
  window that died after the marker and before the request left is also refused. That is the safe
  direction: the case that bills is indistinguishable from the case that did not.
- **Two transactions, not one**: marker, then `beginStep`. A crash between them leaves a marker with
  no step row, which refuses — the same safe direction.

## Other paid steps (the class)

Swept on 2026-10-09 (every request carrying `openrouter:web_search`, and what can send it again
without a press):

| path | re-sent with nobody pressing? |
|---|---|
| **`debate` pipeline step** (src/debate.ts, src/pipeline.ts § `debate`) | **Yes** — the requeue after a lapse or a pause. This fix. |
| Debate claim check (`generateClaimCheck`) | No: its sweep marks an abandoned row `error` (src/store/pg-debate-claim-checks.ts). |
| Dig deeper, citation Investigate, Explain, chat search, referee criteria | No: request paths; their sweeps only end rows. |
| Upload source guess (`findWorkPage`, src/source-guess-run.ts) | **On a page open**, not a press: a failed first attempt releases the claim and the next owner open searches again, capped at `SOURCE_GUESS_MAX_ATTEMPTS` = 2. Bounded and visible; left as it is, noted in the postmortem. |
| The gateway's transport retry, all of the above | Covered by [261009e](261009e-paid-web-search-not-retried-after-it-was-sent.md). |

No browser code re-POSTs any of them on failure. Among requeueable steps without web search,
`illustrated` (~$0.30) banks its brief in a checkpoint and the expensive fan-outs are checkpointed
(src/jobs.ts § `REQUEUE_BUDGET`); the rest cost cents and keep today's rule. `oncePerJob` is the
place to put any later step that cannot be bought twice.

## Tests (red first)

`tests/jobs-paid-step-once.test.ts`, real Postgres, through `advanceJobWith` with a stub `debate`
step that counts runs:

- a first window that begins the step and lapses (lease forced into the past, then
  `settleExpired` requeues) → the second window does **not** call the step's `run`, and the job ends
  with `PAID_STEP_NOT_REPEATED`'s code — **red before the fix** (the step runs twice);
- the same through the deadline pause;
- a step without `oncePerJob` in the same position still re-runs (today's behaviour kept);
- a forced fresh job for the same article (the shape Retry creates) runs the step;
- an equivalent active enqueue stays on the marked job rather than creating a way around it;
- the store refuses a wrong or expired attempt, and two concurrent beginnings yield exactly one
  `"begun"` and one `"begun-before"`.

Between the windows each case asserts the row: `queued`, `requeues = 1`, `paid_step_begun = 'debate'`
and a timestamp. No exception from the walk is swallowed.

**Watched red on 2026-10-09**, before any production change: the lapse and the pause cases ran the
step twice (`expected [ 'debate', 'debate' ] to deeply equal [ 'debate' ]`), the flag case found
`undefined`, and the Retry case counted three runs over two jobs. The unmarked-step case is a
control and was green throughout, as it should be.

**What the tests do not reach.** The pause case calls the store's `pauseForDeadline` from inside the
step rather than letting the claimant's own 740 s clock fire. What it proves is the part that
matters to the marker — the pause keeps the job row's columns, so the next window sees them — and
the walk's own deadline path is covered by tests/job-hands-back-for-another-window.test.ts.

## Plan review (GPT Sol) and what changed

[Review](261009l-a-requeued-job-does-not-buy-the-debate-search-again-plan-review-sol.md): *APPROVE
WITH CHANGES*.

1–2. *Use the existing `revision_step_runs` row as the marker, inside `beginStepRun`, rather than new
   job columns and a second transaction.* Sol confirmed the worry about copied rows is answered (a
   new draft copies step runs without `attempt_id`). **Not taken**, weighed: `beginStep` has some
   forty callers and fakes across src and tests, and a draft's step-run rows are also rewritten by
   the draft-remint repair and the sharing rebase, each a path where a per-draft marker could be
   lost or carried. A job column is per job by construction and touched by nothing else. The split
   Sol names — marker written, then `beginStep` fails — refuses the next window, which is the safe
   direction, and is said so in `runStep`.
3. *Say "Retry normally creates a fresh job; equivalent active work stays single-flight."* Taken
   (above).
4. *Test that an explicit request is not refused.* The fresh-job case is that test for this design:
   the marker is on the job row, so nothing published or copied can carry it.
5. *Keep the stage failure; the panel's button is Retry, not Search again.* Taken; the sentence
   says "Press Retry".
6. *Illustrated's plates are the other dear un-checkpointed purchase, and whole-step `oncePerJob`
   would break its intended second window.* **Agreed, and left open**: it needs a marker at the
   plate phase or a checkpoint per plate, which is its own piece of work. Named in the
   `REQUEUE_BUDGET` comment and the postmortem. Since closed by
   [261009o](261009o-a-requeued-job-does-not-buy-the-illustrated-plates-again.md), a marker at the
   plate phase.
7. *Update the comment that calls `REQUEUE_BUDGET` the whole protection.* Taken (src/jobs.ts).
8. *Tests: a broad catch, `s.job` on `settleExpired`'s answer, assert the intermediate state, drive
   the real deadline.* The first three taken; the fourth is above under *What the tests do not
   reach*. The earlier-step-pause control is not added: the marker is written only at the
   `oncePerJob` step's own begin, so a pause before it cannot reach it.

Gates: `npm test`, `npm run typecheck`, lint on touched files.

## Code review (GPT Sol)

[Review](261009l-a-requeued-job-does-not-buy-the-debate-search-again-code-review-sol.md): *APPROVE
WITH CHANGES (made)*. It made the sentence honest about what we cannot know ("may already have
started", since the marker goes down before the request can leave), and added cases for the fence
(another attempt and a lapsed one both get `StaleAttemptError`), for two beginnings arriving at once
(one `begun`, one `begun-before`), for a forced fresh job, and for an equivalent enqueue that joins
the marked job rather than buying around it. Checked by mutation: with `for update` taken off
`beginPaidStep`'s read, the concurrent case answers `['begun', 'begun']` and goes red.
