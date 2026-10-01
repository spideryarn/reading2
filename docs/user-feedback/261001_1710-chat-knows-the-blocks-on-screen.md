---
reports: spya-ybnas5
ending: shipped
---
# Chat knows the blocks on screen, and is told not to lean on it

Greg's suggestion from the Feedback dialog, filed 2026-10-01 17:10 UTC from Chat mode on *What If
We Had Bigger Brains?*. Admin, proved by `scripts/feedback-reporter.ts --report-id spya-ybnas5`
(exit 0; the row, not the event — no event id was recorded). No Sentry issue was found for it: not
among the feedback issues first seen in the six hours after, and no text match.

> I think we might have added something to the chat functionality that it knows which block or
> blocks are visible on the screen. Is that the case? If we haven't, that might be a nice thing to
> add.
>
> But let's not overemphasize it. So maybe the prompt would include the information along with a
> bit of a caveat, e.g. "by the way, here's what's visible on the page, but it may or may not
> relate to the user's messages...".

**The answer to the question: half.** Chat was told one block, the `?at=` position, as *"The
reader is currently at block …"* — stated as fact, with no caveat, and not what was on screen.

**Ending: Shipped**, in `b7c12dfe9` and `5105fd019` on `dev`; the plan is
[261001q](../plans/261001q-chat-knows-the-blocks-on-screen.md). Not deployed: the Overseer deploys.

- A question typed in **Chat mode** now carries the blocks on screen when Send (or Save, on an
  edit) is pressed, and the prompt gets one hedged line in place of the position line: *"For
  context only: when they sent this, the reader's screen showed blocks … If their message refers
  to what is on screen, these may help; otherwise ignore them."* Below the cache breakpoint, so it
  costs nothing on the cached article.
- **Not sent:** in Remember (its prompt is not to guess how far the reader has got, and the server
  refuses it there); on a phone while the chat band covers the prose (the old position line goes,
  as before); on a retry; in the passage Chat dialog or Live voice. All in
  [chat-tools.md § What chat is told is on screen](../project/chat-tools.md).
- GPT Sol reviewed the plan (read-only) and the code (it fixed a race past the chat-only rule, made
  the Reader wiring a type error to drop, and sharpened the eval).

**Not done: the measurement of "not overemphasised".** `evals/chat-visible/run.ts` asks questions
about elsewhere in the piece with and without the line and counts how often answers cite the
screen. Its first run got **402 from OpenRouter — the box's dev key is out of credit** — so there
is no number yet and nothing was spent. The command is at the end of the plan.
