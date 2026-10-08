---
reports: spya-qd2agx
ending: shipped
---
# Chat gets up and down buttons, and Top, to step between messages

Report `spya-qd2agx` (SPIDERYARN-READING2-ES), a suggestion from Greg (an admin, proven by
`scripts/feedback-reporter.ts` exit 0), filed 2026-10-08 07:33 UTC from Chat on
`2608-13566v1-spya-yurten`. Overseer queue item `qi-aft7nhv9`, batched with `spya-pd9fnc`
([its note](261008_0732-chat-back-to-the-list-on-a-phone-and-the-model-in-the-i.md)).

> In the chat interface, we have a button to scroll to the latest. It would be nice to have up and
> down buttons somehow, and maybe even top to make it easier, especially on mobile, to scroll
> between individual messages within the chat.

**Ending: shipped**, on `dev`. Plan:
[261008c](../plans/261008c-chat-back-to-the-list-on-a-phone-the-model-in-the-thread-s-i-and-step-between-messages.md)
§ 3.

- **Built**: when a conversation is taller than its panel, a row under it has three buttons: ⇈ to
  the first message, ↑ to the previous one, ↓ to the next. **Latest** sits beside them while you are
  away from the end. Each question and each answer is one stop. They behave like the article's ↑
  and ↓: inside a long answer, ↑ first goes to where that answer began.
- The row is the same in Chat, the paragraph chat dialog and the card in the margin. On a touch
  screen each button is a full 40px. The row costs about 46px of a phone's height.
- An answer still arriving stays where you put it: stepping up while it streams does not pull you
  back down (the hold from plan 261005f).
- **Not built**: keyboard keys for these. The article already uses ↑ and ↓.

Checked in WebKit at iPhone size and in Chromium at 1440px, stepping through a ten-turn
conversation in both directions and during a streamed answer. **Not tried on a real iPhone.**
