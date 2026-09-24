# A malformed label pair kills the step without a retry

**2026-09-24.** Greg's imported PDF,
`entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`, stopped at **Labelling the paragraphs**.
He pressed Retry and it worked, and asked why. Sentry:
[SPIDERYARN-READING2-43](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-43), one event at
03:36:42Z, release `493615a4`, tags `step=labels`, `jobId=spya-d57ur4`, `message_withheld=True`. The
whole title was `Error: Error`. The top frame was `readPairs` in src/labels.ts. The fix is
[260924e](../plans/260924e-a-malformed-label-pair-kills-the-step-without-a-retry.md).

## What happened

The labels step asks the model for `{"labels": [[n, "label"], …]}`, one pair per paragraph, in
batches of up to about sixty. `readPairs` checks each pair. It found a fault in one pair — an empty
label, an ordinal given twice, an ordinal that is not an integer, or an entry that is not a pair —
and threw a plain `Error`. The retry loop in `generateLabels` retries only a `BatchIncomplete`. So
the step died on its **first** draw, with no re-ask and no re-draw.

**Why Retry worked:** the fault was in one sample of the model's output, not in the article. Retry
re-ran the step, the model drew again, and that draw wrote every pair properly. The same retry
would have happened inside the step, automatically, if the fault had been classed as retryable.

**Which of the four faults it was, we cannot say** from what Sentry holds, and that is the second
half of this postmortem. The likeliest is an empty label: a PDF throws up fragments — a running
header, a lone equation, a figure's leftover caption — that the prompt's "a CLAIM or a MOVE, 6–20
words" makes unlabellable. It is the same event as the Wolfram outage in
tests/labels-shortfall.test.ts, answered with `""` instead of by leaving the pair out. The omission
had been made survivable on 2026-08-30. The empty string had not.

## Root cause

The labels stage split failures into "a model slip, worth one more ask" and "a malformed answer,
which does not get better on a second ask". That rule was written on 2026-08-26 in `051bc0a0`
("Split the nav labels out of the tree, and take headings from the block"). It was pinned by a
test that asserted a duplicate was **not** a `BatchIncomplete`, on the reasoning that "a retry loop
over it would just spend money slowly".

Both halves of the reasoning were wrong, and neither was ever measured:

- **A malformed pair is as much a sampling accident as a missing one.** Greg's Retry is the
  counter-example.
- **There was no loop to fear.** The retry is one re-ask or one re-draw, bounded by `acceptGap`.

Beneath that sits the arrangement that made it costly: **the check worked answer by answer while
the fault was pair by pair.** One bad pair in fifty-eight condemned the other fifty-seven. The
shortfall path already had the right answer for a single absent pair, and a malformed pair is just
an absent pair with extra noise.

## The class

**An item-level fault escalated to an answer-level failure.** A validator for a list of independent
items throws on the first bad item, and so turns one bad item into the loss of the whole list. The
caller had a graded response ready — repair the item, forgive a bounded gap — and never got the
chance to use it. The inverse mistake sits right beside it, and the first draft of the fix made it:
treating *every* bad item as the graded case, when only some bad items carry the meaning that case
depends on.

And the logging half: **a failure whose only diagnostic is free text reaches Sentry blank.** Sentry
withholds any message we cannot prove we wrote (`authored` in src/monitoring-scrub.ts). That is
correct and deliberate. The consequence is that an error with nothing but a message — no name, no
`code` — arrives as `Error: Error`. The stack says where it was thrown but not which of five throws
in that function it was.

## The fix

1. **An empty label is a missing pair.** A label that is empty or not text is the model declining a
   paragraph, so its ordinal falls into `missing`. The re-ask names it, `acceptGap` bounds what may
   be dropped, and `detectShift` still votes on the merged set.
2. **A broken format is a re-draw.** A pair of the wrong shape, a non-integer or repeated ordinal,
   unparseable text, or `labels` not a list is a `BatchIncomplete` with no shortfall. The caller
   already re-draws that at double headroom. It is never forgiven as a drop, because it says
   nothing about any paragraph — GPT Sol's plan review caught the first draft doing exactly that.
3. **Sentry can tell failures apart.** A batch that fails twice throws `LabelsFailed`, whose `code`
   is `<first fault>+<second fault>`. Each part comes from a closed set, or is a registered bracket
   code. `sanitise` forwards `code` as a tag, following `MalformedJson`'s precedent. The message
   stays the diagnostic, for the log. The log message now also counts skipped pairs by kind, never
   by content.

This is the long-term design for this stage, not a patch.

## What would have caught it, ranked by ease against value

1. **Give every terminal error a name and a closed-set `code`.** Done here for labels. It is cheap,
   it is the difference between `Error: Error` and `LabelsFailed` with `code=short+short`, and it
   needs no argument about what counts as authored. It should be the rule for every stage's
   terminal error. It belongs in [logging.md](../project/logging.md) as a line, and is recorded for
   Greg rather than swept here.
2. **When a validator walks a list of independent items, ask what one bad item should cost.** Ask it
   in review, of any `throw` inside a `for` over model output. Free, and it would have caught this
   on 2026-08-26.
3. **A test for a "not retryable" rule must name the evidence that it does not get better.** The
   rule here was asserted, not observed. A comment citing the run where a second ask failed
   identically — as the Wolfram shortfall's did — would have made the missing evidence visible.
4. **Sweep the other stages for the same shape.** Rejected for now as a separate project: each
   stage's retry machinery differs, and it is worth doing only where a stage has a graded response
   to lose. Offered to Greg.
5. **Forward free-text diagnostics to Sentry after scrubbing them.** Rejected. It reopens the
   article-in-Sentry leak that `authored` exists to close. See `stageFailure` in
   src/job-failure.ts for the six hours that went wrong that way.

## What is still unknown

Which of the four pair faults fired. The Vercel runtime log has the full message — it starts
`Nav labels:` — and nobody on the box can read it. The query, for whoever has Vercel access: runtime
logs for the production deployment of `493615a4`, 2026-09-24 03:30–03:40Z, filter `Nav labels`.
