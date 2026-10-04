---
reports: spya-r9nbkt
ending: shipped
---
# Ask about a summary paragraph in chat

Report `spya-r9nbkt`, from Greg (admin, the row checked with `feedback-reporter.ts`), 2026-10-03
19:26, relayed by the Overseer:

> Often when I read the summary, I want to talk about it or ask questions. I'm not sure what the
> best way to do that is with the UI. Maybe start with something simple. I suppose the simplest
> thing would be a button that, in the summary mode, that takes us to chat mode. Maybe slightly
> better would be a button that I could press that would be next to each summary paragraph or
> something that would kick off the chat with regard to that summary paragraph as well, with a sort
> of brief intro, you know, the user has kicked off a chat about this summary paragraph. I don't
> know. If you can think of a better way that isn't too complex, then go for it.
>
> I guess in an ideal world, if we do have a chat about a summary, then it would be easy to get back
> to that chat from the summary. Perhaps, well, maybe it's too much to be able to click a button and
> see the chat in a tooltip, but something like that would be cool. Maybe that's too messy. Use your
> judgment.

**Ending: Shipped**, on `dev`. Plan
[261004a](../plans/261004a-ask-about-a-summary-paragraph-in-chat.md).

## What changed

- **Every Brief and Fuller paragraph has a small speech-bubble button** at the end of its row of
  passage links. Press it and you are in Chat, in a new conversation, with that paragraph quoted in
  the box and the caret on the line below it. Type your question and press Send. Nothing is sent,
  and nothing is spent, until you do.
- The quoted paragraph is marked as quoted, so the model reads it as something to discuss.
- Only on your own article. A visitor has no chat, so no button.

## What is not built: the way back

Nothing on the paragraph leads back to the conversation it started. Once sent, the conversation is
in Chat's list, under the same heading as every other one started this way.

It is deferred, not dropped: queue entry `qi-vj7p4sbh`, waiting on Greg. The plan's
[§ Deferred](../plans/261004a-ask-about-a-summary-paragraph-in-chat.md#deferred-a-way-back-from-the-paragraph-to-its-chat)
has the four options and why it was not cheap: a conversation stores nothing about where it
started, and *Write it again* replaces every paragraph.
