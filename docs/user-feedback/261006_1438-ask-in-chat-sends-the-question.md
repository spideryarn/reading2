---
reports: spya-x896vu
ending: shipped
---

# Ask in chat sends the question instead of only pre-filling it

A suggestion from Greg (admin; `feedback-reporter.ts` exit 0 on the production row), filed
2026-10-06 14:38 UTC on `2608-13566v1-spya-yurten`, `?mode=chat`. Sentry SPIDERYARN-READING2-E1.
Queue item `qi-av4qxhpb`.

> When I click "ask in Chat" anywhere, automatically submit the input (rather than just prefilling the input box and waiting for me to hit send)

**Shipped**, in [261006j](../plans/261006j-ask-in-chat-sends-the-question.md).

A press now sends the question as a new conversation's first message, once, on each of these:
*Ask in chat* in Glossary (on an entry, and for a word the article does not contain), in Citations
and on Debate's angle box; Debate's *Check this claim in chat*; the follow-up box under an AI
explanation; and the comment box's **Ask AI**. The buttons' tooltips and `/help` say so.

**Ask AI is wider than the report's words**, and it reverses an earlier decision (261003i, D5,
which had it open the conversation and wait). The plan's D6 says why.

**Two buttons still wait in the box, and each is a question for Greg**, in queue item
`qi-w7j56j26`:

- The speech-bubble button on a Summary paragraph. It carries the paragraph and no question, so
  there is nothing to send until the reader types one.
- The command bar's suggested row *Ask chat what the web says about…*. A model words it from the
  reader's profile, and the privacy page promises it is sent only on Send.
