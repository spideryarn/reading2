# A resume rule sized for checkpointed work rebuys a purchase

When a pipeline job's window ended mid-step — the process killed or deployed over (its lease lapsed),
or its own 740 s deadline — the job went back in the queue and the next window ran the step from the
start. For `debate` that meant buying its `openrouter:web_search` Reception call again, 15–20 cents
a time, up to three times a job, for a reader who had pressed once. **No reader report and no
measured double charge**: it was found by GPT Sol reading the code (finding 3 of the
[261009e plan review](../plans/261009e-paid-web-search-not-retried-after-it-was-sent.md#plan-review-gpt-sol-and-what-changed)),
and it is bounded by `REQUEUE_BUDGET` = 2. Fix:
[261009l](../plans/261009l-a-requeued-job-does-not-buy-the-debate-search-again.md).

## What happened

`settleExpired` and `pauseForDeadline` (src/store/pg-jobs.ts) put an unfinished job back to `queued`
on the same row while `requeues < REQUEUE_BUDGET`. The next claim walks the steps, finds `debate` not
done, and calls its `run`. Reproduced in `tests/jobs-paid-step-once.test.ts` before the fix:

```
AssertionError: the search was bought once, not again by the next window:
expected [ 'debate', 'debate' ] to deeply equal [ 'debate' ]
```

The first window's answer cannot be reused: the call was not streamed, its process is gone, and
OpenRouter keeps no body to fetch back. Only the cost would have reached `ai_calls`, and not even
that when the process died before its `finally`.

## The class: a resume rule sized for checkpointed work, applied to a purchase that is not

The requeue was justified, in its own comment (src/jobs.ts § `REQUEUE_BUDGET`), by an inventory:
*"the two expensive fan-outs are checkpointed already, so what it would save is the `assets` outline
call and little else … Worth revisiting if a third un-checkpointed paid step ever appears."* That was
true on 2026-09-04 (`92cf93831`, building on `92ff0e83e` the day before). On 2026-09-05 `39701ce73`
added `debate` — dear, un-checkpointed, and impossible to checkpoint — and the inventory was not
revisited, because nothing tied a new step to it.

So the bug is not that the requeue is wrong, nor that Debate is. It is that **a policy granted to
every step was argued from a survey of the steps that existed that week**, and its validity
condition lived in prose beside the constant. A step added later inherits the policy without
inheriting the argument.

**Siblings.** [260902c](260902c-the-truncation-retry-cost-storm.md) — a retry policy multiplying a
paid call nobody was watching; the forced-step receipt fixed on 2026-10-07 (src/jobs.ts § `note`),
where a lapse bought a forced step twice because the "already bought" fact was written in the wrong
transaction; and [261007b](261007b-an-alternate-paid-action-bypasses-the-completion-fence.md). All
three are *a mechanism that repeats work, with no view of whether the work is a purchase*.

## Why nothing went red

- **Every test of the requeue uses steps that are free to repeat**, and the requeue is meant to
  repeat them; "the step ran again" is the passing condition everywhere else.
- **Debate's own budget comment names the bounds on its spend** — a prompt written for restraint,
  the 740 s claim-wide abort, the `webSearches` alarm — and counts them for one window. The
  multiplier is in a different file.
- **261009e's reviewer did see it** and it was documented rather than fixed, correctly: it was not
  the gateway's bug. It went to the queue, which is how it got here.

## What would have caught it, ranked by ease against value

1. **A declaration on the step, read by the runner** — `PipelineStep.oncePerJob`. A step that must
   not be bought twice says so where it is defined, and the walk refuses a second begin by the same
   job. Done (261009l). It turns the prose condition into something a new step opts into on the line
   that defines it, beside `produces` and `stamp`.
2. **When adding a paid step, read the comment on `REQUEUE_BUDGET`.** Free, and would have caught
   this one; it is also exactly the kind of rule that erodes. The comment now names the one kind of
   step it does not cover and why, which is where a reader adding a step will look.
3. **Make every paid step declare `checkpointed | oncePerJob | cheap` as a required field.** The
   strong version of 1: the compiler would ask the question of every new step. Rejected for now —
   thirty-odd steps would have to answer a question that only two have a non-obvious answer to, and
   the answer for most is a guess about cost that goes stale. Worth revisiting if a third appears.
4. **Renew the lease while a paid call is in flight.** Rejected: a lease here lapses only when the
   process is gone (src/jobs.ts § `LEASE_MS`), so a heartbeat saves nothing and weakens what a lapse
   means.

## The fix that is right for the long term

What shipped is a per-job marker on the `jobs` row, written before the paid step begins and checked
by the next window, which fails the step with *"Press Retry to run it"*. That is the right shape for
Debate, whose purchase is the whole step.

It is not yet right for **`illustrated`**, the other dear un-checkpointed purchase (~$0.30 of
plates): it hands itself to a second window *on purpose* after banking its brief, so marking the
whole step would refuse its own design. It wants the marker at the plate phase, or a checkpoint per
plate. Left open and named in `REQUEUE_BUDGET`'s comment.

The upload source guess (src/source-guess-run.ts) also searches again without a press — on the next
page open after a failed attempt, capped at two. Bounded and visible; left as it is.

## The thing I would tell myself

The comment on `REQUEUE_BUDGET` said in plain words when it would stop being true, and nobody adding
the step that made it untrue was ever going to read it. A condition that only holds while a list
stays short belongs on the items of the list, not beside the rule that consumes them.
