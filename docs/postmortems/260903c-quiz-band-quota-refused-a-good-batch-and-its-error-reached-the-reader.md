# A quota refused a good batch, and its error message was the reader's

**2026-09-03.** Greg opened Quiz mode on `nagel-bat` in production. The quiz did not exist yet, so
the band built one. It failed after 36 seconds and $0.0613, and what appeared under the button, in
red, was this:

> The batch does not use both ends of the band scale, so the reader would meet 9 questions in an
> order that means nothing. wanted 2 "hard", got 1. A batch of this size has to carry both ends —
> src/quiz.ts § bandQuota. Run it again; if it keeps landing here, the prompt's spread rule is the
> thing to change.

He pressed the button again. The second run cost another $0.0675 and worked. Then he filed a bug
report — which is itself unreadable, because the Sentry mirror silently dropped it, so this
postmortem is written from the Vercel logs of the same session.

Plan and fixes: [260903c](../plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md).

## What actually happened

`bandQuota` was `min(3, floor(kept / 4))` and demanded that many questions at **each** end of the
band scale. Nine questions survived validation; `floor(9/4)` is 2; the model had produced one `hard`.
So `buildQuiz` threw, the job failed, and the paid call was discarded.

The batch was fine. Ordering sorts by band, then value, then document position
([`src/quiz.ts`](../../src/quiz.ts)), so nine questions carrying one `hard` run from one end of the
scale to the other — an abrupt progression, not a meaningless one. Nothing the ordering needs was
missing.

## Root cause, and it is not the boundary

The number was wrong, but *that a number was there at all* is the cause.

The check's own error message said the batch **"has to carry both ends"** — a floor of one. The
arithmetic demanded a proportion. Both were written in the same commit, by the same author, minutes
apart, and **both looked right**. Nothing could tell them apart, because a sentence and an
expression are two artefacts and no mechanism holds them to each other.

That is why the fix deletes the number rather than retuning it.
[`missingBandEnds`](../../src/quiz.ts) returns *which ends are missing*; there is no quantity left to
get quietly wrong, and a helper of that shape cannot grow back into a quota while still sounding
like a presence check. `SPREAD_FROM = 4` names the short-batch boundary that used to fall out of
`floor()` — which is precisely how it came to sit somewhere nobody could see, and so nobody
challenged.

**Introduced by `5253ee32`** (2026-09-01, stage 1 of
[260831al](../plans/260831al-review-quiz-sub-mode.md)), with `min(3, floor(n/4))` in its first line,
never changed.

**It was reviewed.** The plan-stage review *recommended* a band quota, and the implementation had a
full-file review afterwards. What no review challenged was the boundary — reviewers agreed with the
idea of a quota and never asked what `floor(9/4)` does to a batch of nine. An earlier draft of the
plan claimed this was never cross-family reviewed; that was false, and the truth is more useful.
**A review that endorses a mechanism does not thereby check its arithmetic**, and neither the plan
review nor the code review is shaped to.

## The class, named

### 1. A rule stated in prose and enforced in arithmetic, with nothing binding them

The general shape: **a validation whose failure message is a second, independent statement of the
rule.** The message is what everyone reads — in review, in the log, on the screen — and the code is
what runs. They agree on the day they are written and nothing keeps them agreeing.

The tell is a check whose message paraphrases rather than quotes. *"Has to carry both ends"* is a
paraphrase of `min(3, floor(kept/4))`, and a wrong one.

### 2. One string with two audiences

The thrown message travelled unchanged to the screen: `src/jobs.ts` copied `(err as Error).message`
onto `step.error` and `job.error`, the store round-tripped it, and `JobProgress` rendered it. So a
reader was handed a source-file path, band arithmetic, and an instruction addressed to whoever tunes
the prompt.

The seam dates to **`12081b0d`** (2026-08-25). It has leaked at least eight times before this:
[`src/messages.ts`](../../src/messages.ts) records six pipeline stages sending provider prose to the
screen, closed on 2026-08-26 with the lesson *"grep the genre, not the list"*; and
[copy.md](../project/copy.md) recorded `truncatedMessage` in
[`src/token-budget.ts`](../../src/token-budget.ts) as the same shape.

### 3. The one worth the most: a defect recorded instead of fixed will recur, and the record will not stop it

This is the finding I would want a reader of forty postmortems to take.

`truncatedMessage` was **correctly diagnosed, correctly written down, and deliberately not fixed**.
copy.md said so plainly — *"recorded rather than fixed… because the awkwardness is structural rather
than a wording slip: the same string has two audiences… which is a bigger change than a reword."*

Every word of that was right, including the judgement that it was a big change. And then the band
spread message was written **eight days later, by an author with access to that note**, and made the
identical mistake. The documentation did not prevent the recurrence. It could not: a note tells you
what to avoid, and the default still leads you into it.

**A written-down defect with an unchanged default is a defect with a paper trail, not a mitigation.**
The record is worth having — it is how stage 2 was scoped in an afternoon — but its value is as
evidence for the eventual fix, not as a substitute for it. When the deferral is made, the honest form
is "this will happen again and we accept that", not "this is recorded".

## The fix that is right for the long term

Both are built, in this run, rather than filed.

**Stage 1** — the number is gone; presence at each end, a named boundary, and a thrown message that
is reader copy. On `dev` at `e560757d`.

**Stage 2** — the seam is split so the class cannot recur by default. A step's failure carries two
strings: `Error.message` stays the diagnostic for the log and Sentry, and a declared
`ReaderFacingFailure` is what `src/jobs.ts` persists onto `step.error` and `job.error`. **An
undeclared failure gets generic copy** rather than falling through to `err.message` — that fallback
direction is the whole fix, because the leaks were all defaults, never decisions. `stepGaveUp` is a
total map over `FailureKind`, so a fifth kind is a type error.

Type-level enforcement was considered and is **not available**: TypeScript has no checked throws, so
a step's signature cannot constrain what it throws. Recorded in the code so nobody re-derives it.

### The near-miss stage 2 produced, which is the same class again

`authored` in [`src/monitoring-scrub.ts`](../../src/monitoring-scrub.ts) forwards an `Error.message`
to Sentry **only** if it ends in a registered bracketed code. Moving the reader's sentence off
`Error.message` moved the code off it too — so every migrated failure's diagnostic would have
stopped reaching Sentry, while the logs still looked correct and every test still passed.

Caught during implementation, not by a test. It is
[silent-success](../reusable/silent-success.md) exactly: a safety mechanism keyed on an incidental
property of the thing it protects. Worth noting that **the fix for one instance of a class created a
near-instance of another**.

## What would have caught it — ranked by ease and value

1. **A test for the near-miss, not just the miss.** Cheapest thing here, and it would have caught the
   original outright. `tests/quiz.test.ts` asserted `bandQuota(8) === 2` — the arithmetic — and never
   asked what happens to a batch one short. **Test the boundary from the product rule's side, not the
   function's.** Now done, table-driven across every gated size.
2. **A guard at the seam rather than per string.** `tests/step-failure-seam.test.ts` asserts that an
   undeclared error's raw text reaches neither persisted field. One test retires a class that eight
   greps did not. Note it must check `job.error` **and** `step.error`: the band renders one and the
   shelf card the other, so a DOM-only test passes while the leak lives on the other surface.
3. **Prefer a categorical type to a number wherever the rule is categorical.** `QuizBand[]` cannot
   drift from "carries both ends" the way `min(3, floor(n/4))` drifted. Worth a habit: when a check's
   message paraphrases its arithmetic, one of the two is wrong, and the arithmetic is usually the
   one that should not exist.
4. **Name boundaries.** `SPREAD_FROM = 4` is reviewable; `floor(n / 4)` hides its boundary in an
   operator. A constant with a comment is a thing a reviewer can disagree with.
5. **When a review endorses a mechanism, someone still has to check its arithmetic.** Not a process
   to add — an expectation to lower. Both reviews here did their job and neither was shaped to catch
   this.
6. **Make the model's spread a target and the gate's a floor, and never let the prompt describe our
   machinery.** The prompt claimed a failing batch meant *"the article is asked again"*, which was
   never true. A prompt that describes the pipeline goes stale when the pipeline moves, and this one
   went stale within a day.

## Still open

- **The cap can manufacture a spread failure.** `toQuestions` keeps the first twelve survivors *in
  the model's order*, so a thirteenth-position lone `hard` is lost to the cap and the gate then
  refuses the batch for missing an end the model did supply. Reproduced in review. Deferred with a
  comment: the fix needs cap selection that preserves both ends, and nothing has shown it is needed.
  Watch for `dropped.overCap` non-zero on a run that also failed on bands.
- **The Sentry mirror silently dropped the feedback report** that started this
  (`feedback report was not acknowledged by sentry`, `status: null`), so Greg's own words about the
  bug are gone. Unfiled, and not this postmortem's subject, but it is why the evidence here is logs
  rather than a reader's account. [feedback.md](../project/feedback.md).
- **Retry still does not exist anywhere in the pipeline.** Stage 2 gives the reader a Retry button;
  no step retries itself. `src/labels.ts` is the only stage that does, and the generic version has
  been said to belong in `src/jobs.ts` twice without being built.
