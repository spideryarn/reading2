# A ceiling sized for one model, inherited by the next

**2026-10-18.** A Quiz mark on Rovelli's *The Order of Time* failed with `[ai-mark-cut-off]`. It
reached a reader: Greg, who reported it (spya-ag4hsu):

> Why are we hitting size limits? This seems like a bug ... why are we truncating so aggressively
>
> — Greg, 2026-10-18

The retry worked. The fix is stage 1 of
[261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat.md](../plans/261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat.md),
which has the measurements.

## What happened

`MARK_MAX_TOKENS` in [src/quiz-mark.ts](../../src/quiz-mark.ts) was 1,200. On the chat wire
`max_tokens` covers the model's thinking as well as its reply (`CHAT_REASONING` in
[src/ai-call.ts](../../src/ai-call.ts) says so), and `quiz-mark` sends the provider default, so the
model thinks as much as it likes. Production `ai_calls`, `purpose = 'quiz-mark'`:

| when | model | output tokens | of which thinking | input tokens |
|---|---|---|---|---|
| 09-03 | sonnet-5 | 65 | 0 | 12,237 |
| 10-03 (×2) | sonnet-5 | 312 | 0 | ~21,450 |
| 10-18 00:07, cut off | sonnet-5.5 | **1,200** | 832 | 90,126 |
| 10-18 00:09, the retry | sonnet-5.5 | 980 | 545 | 90,126 |

The cut-off mark had 368 tokens left for its reply. The one that worked still spent more than half
its allowance thinking. (The rows do not separate the model from the input length: the Sonnet 5.5
calls are also on a much longer piece. Either way, the 1,200 had stopped meaning what its comment
said.)

## A budget sized against one model's behaviour, inherited silently when the model changes

The number was sized on 2026-09-01, when every mark it had seen did no thinking at all, so 1,200 was
all reply. Its comment said so: *"The ceiling on the reply … a guard rather than a budget."* Then
`ffb1d8ddf` moved the capable tier to Sonnet 5.5, which thinks on this call. The line did not change,
but what it meant did: a reply ceiling became a ceiling on thinking plus reply, and nobody re-read it.

That is the class. **A budget is a claim about how a particular model behaves on a particular call.**
Written as a bare constant, it does not say which model it was measured against, so changing the
model cannot tell it is breaking an assumption. Nothing that changes the model visits the line that
depends on it.

How it differs from its two neighbours:

- [260826a](260826a-toc-max-tokens.md) is *a fixed number for a quantity that grows with the input*:
  the answer scaled with the article. Here the answer is small and bounded. What grew was the
  thinking, because the model changed.
- [260928b](260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md) is *a lesson kept in
  a helper does not reach the other wire*: a new caller, on a fixed model, that never saw the lesson.
  Here the caller is old and the lesson had already reached it. `CHAT_REASONING` exists because of
  260928b, `quiz-mark` has a row in it, and the row said "Not measured". The new thing is the model
  under an existing budget, not the caller.

The same commit already had a sibling. `ffb1d8ddf` found that GPT-6 Luna spent `quiz-verdict`'s
8-token ceiling on thinking, and fixed it with `reasoning: none`. That is this bug on the quick
tier, caught by a smoke test. The capable tier got no such test.

## Which commit

- **The number:** `5253ee321` (2026-09-01, *"Set the questions before building anywhere to put
  them"*), correct for what it measured then.
- **What made it wrong:** `ffb1d8ddf` (2026-10-09, plan 261009a, *"every model on its family's
  latest version"*): Sonnet 5 to Sonnet 5.5. It shipped quietly. Nothing failed until a long enough
  piece arrived nine days later.

## Why nothing went red

- **260928b named this risk and left it open.** Its "Left open" section lists `quiz-mark` among the
  unmeasured `providerDefault` rows: *"None has failed that we know of. The warning will say if one
  does."* It was written down, so it looked handled.
- **The model upgrade's review asked the right question about the wrong tier.** The 261009a code
  review prompt asked for *"any other quick-tier job with a tiny ceiling and provider-default
  reasoning that GPT-6 Luna would starve"*, because the quick tier is where a failure had been seen.
  It did not ask the same about the capable tier, whose model changed in the same commit.
- **The warning fired and was not read.** `warnIfThinkingAteTheCeiling` in `src/ai-call.ts` would
  have logged *"quiz-mark stopped at its token ceiling after 832 tokens of thinking"*. That is the
  whole diagnosis in one line, and nothing reads it unless somebody goes looking.
- **Every test stubs `fetch`**, so no test could see how much a real model thinks. This is the same
  gap as 260928b: the failure lives between a short fixture and a long article.

The cut-off guard did its job. `MARK_CUT_OFF` refused the truncated mark rather than show it
mid-sentence, so the failure was loud. It was correct, just too late.

## What would have caught it, ranked by ease against value

1. **Record each measurement in the row, with the model it was taken on.** `CHAT_REASONING
   ["quiz-mark"]` now reads *"Measured 2026-10-18 on Sonnet 5.5: 545–832 thinking tokens …"*. Once
   a row names a model, a model change has something to go stale against. Done for this row. It is
   a habit for the rest until item 3 makes it mechanical.
2. **A model change re-checks every ceiling against measured `reasoning_tokens`.** One read-only
   query of `ai_calls` per tier, grouped by purpose: the largest output and reasoning since the
   switch, against the ceiling. It costs minutes and would have shown this at 832 of 1,200. It
   belongs in the model-change step of [setup-dev.md](../project/setup-dev.md) as a rule. The sweep
   of the other small chat-wire ceilings that inherited the same change (`citation-find` 1,200,
   `citation-influence` 1,000, `citation-paper-passages` 1,500, `help-chat` 800, explain 1,500) is
   queued as qi-vva8v98m.
3. **Write a ceiling as an answer budget plus a reasoning allowance, per model.** Make the
   allowance a lookup keyed on the model, so a new model id does not compile until it has an entry.
   That is 260928b's table taken one step further: the decision cannot be absent *per model*, not
   just per job. This is the right long-term shape. Not done here, because it touches every chat job.
4. **Surface the thinking-ate-the-ceiling warning**, for example as a count on `/admin/costs` or in
   the Overseer's standing checks. It is cheap and catches every instance of the class after the
   first reader hits it, not before. Worth doing alongside item 2, not instead of it.
5. A paid live eval of every job on a long article for each model change. Rejected as a gate: the
   production rows in item 2 are already this measurement, made for free on real inputs.

## The fix, and the right one for the long term

Shipped: `MARK_MAX_TOKENS` 4,000, chat's own figure (`CHAT_ANSWER_TOKENS`), with thinking left on.
That leaves room for the 832 seen plus the whole 1,200 reply the old number was sized for, about a
3× margin. The comment now says what the number covers, the `CHAT_REASONING` row records the
measurement, and `tests/quiz-mark-stream.test.tsx` *"leaves room for the model's thinking as well as
a whole reply"* was red at 1,200. Lowering the effort and keeping 1,200 was passed over: it changes
the quality of a mark on a hunch, while a bigger ceiling only costs what is used.

That is a patch at the right size for this call. It is still a bare constant measured against one
model, so the next model change can break it the same way. The long-term fix is item 3.

## The thing I would tell myself

When you change a model, you change the meaning of every number sized against it. The upgrade
commit swept the tier where a failure had already been seen and treated the other tier as safe
because nothing had gone wrong there yet. A row that says "Not measured" is not a decision to wait.
It is a prediction that the next model will behave like the last one.
