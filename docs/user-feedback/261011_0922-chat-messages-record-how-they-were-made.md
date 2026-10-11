---
reports: spya-z30x5n
ending: shipped
comment: Each chat message now records how it was made: a question as typed, dictated, mixed or spoken, an answer as written or spoken. So live-voice answers can be reviewed. The command bar's "Ask the guide" box is still queued (qi-9pknjrsf).
---
# Chat messages record how they were made

**[SPIDERYARN-READING2-HM](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-HM)** · report
#570 `spya-z30x5n`, a suggestion from Greg, 2026-10-11, in Chat. Overseer queue item
`qi-ma5c3n45`, session `fbz30x5n-chat-message-modality`:

> In chat mode, can you annotate internally in your data representatives somehow whether parts of a
> conversation come from typing or voice dictation, or maybe edited voice dictation, or live
> conversation? I'm especially interested for you to know which bits of the AI response came from the
> live, real-time voice, because we may want to kind of look through those and check to see if
> they're doing a good job.

**Ending: Shipped**, to `dev`, not deployed. The plan is
[261011z](../plans/261011z-chat-messages-record-how-they-were-made.md). GPT Sol reviewed the plan
(REWORK; six findings, all taken) and then the code (SHIP AFTER FIXES). The code review found two
composers that dropped the record, and both were fixed.

- **A new column, `chat_messages.modality`.** A question is `typed`, `dictated`, `mixed` (dictated
  and typed in one box) or `spoken`. An answer is `written` or `spoken`. A CHECK holds each value to
  its role.
  - Null means not recorded: messages from before this change, questions a button sent, and drafts
    that began with words already in the box.
- **The live-voice answers are the `spoken` assistant rows.** The query to pull them out for review,
  including older ones found by their model, is in
  [live-conversation.md § What a spoken row carries](../project/live-conversation.md#what-a-spoken-row-carries-that-a-typed-one-does-not).
- **The browser can only say typed, dictated or mixed, and only on a new question.** The server
  decides `spoken` and `written` itself. A retried or edited answer is `written`, and an edit keeps
  the question's modality.
- **Not yet:** the command bar's "Ask the guide" box sends no modality. It is queued as
  `qi-9pknjrsf`.
