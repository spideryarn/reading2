---
reports: spya-hdeye3
ending: shipped
comment: Chat now gives a detailed answer when you ask for one, about twice as long as before, while ordinary answers stay as brief as they were.
---
# Chat gives the long version when you ask for it

An admin report from Greg (`feedback-reporter.ts` exit 0, no addenda), #662,
SPIDERYARN-READING2-MV, sent from Chat on `arxiv-2603-13294-spya-muf4gv`; Overseer queue item
`qi-fstzmdxa`. The time in the file name is when this session picked the report up.

> I think in our chat prompt, we have something about giving brief responses. That's probably right
> for the most part, but the user may sometimes want a really detailed response, in which case, I
> guess we need some flexibility in the system prompt that sort of allows it to flex a bit towards
> their needs or request.
>
> — Greg, 2026-10-20 05:33 UTC

**Ending: Shipped**, to `dev`, not deployed. The [plan](../plans/261020t-chat-length-flexes-when-the-reader-asks-for-detail.md)
has the measurement; its [plan review](../plans/261020t-plan-review-sol.md) and
[code review](../plans/261020t-code-review-sol.md) are beside it.

- **What was there.** Chat's 300-word budget, from the 2026-09-30 "a little briefer" report
  ([260930_1221](260930_1221-chat-and-question-answers-a-little-briefer.md)), already said "unless
  they ask for more", but the line beside the question opened "Keep it brief" and the model aimed at
  the number. A reader asking for depth got about 600 words.
- **What changed.** That line now leads with the exception: when the reader explicitly asks for a
  detailed, in-depth or step-by-step answer, or the long version, the budget does not apply.
  Otherwise most answers stay under 300 words, and a quick summary stays quick. The main prompt
  lost "such as a summary", so asking for a summary is not in itself a licence for length.
- **Measured** on Opus, three articles, five kinds of question. Asked for depth, a walk-through or
  "the long version": about 520–720 words before, 970–1,200 after. Ordinary questions: 330–341
  before, 344 after. Quick summaries: 309–324 before, 283 after. Blind, the new prompt won every
  pair a judge could separate, 11–0 with 4 ties, against a 5–1 control of the old prompt against
  itself.
- **With About you.** A sibling report, `spya-aqnz99`, lets a reader save "prefers brief answers"
  to their profile. That session agreed the order with this one: what you ask for in your latest
  message wins for that answer, then what About you says, then the 300-word default.
- **Not changed.** A comment's answer and a question on a selection (Explain) keep their
  three-paragraph cap; Learn, Explore and the guide keep their own length rules. A "quick summary"
  is still about 280 words with bold labels, as before.
