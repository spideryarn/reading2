---
reports: spya-hyfqkq
ending: shipped
---
# Every conversation shows in Chat, with where it came from

A suggestion from Greg (an admin's report, proved by `scripts/feedback-reporter.ts`, exit 0; the
Sentry event was not matched, so this is from the production row). 2026-10-04 11:33 UTC, sent from
Chat on `openai-huggingface` after a Recall conversation:

> I just had a good chat in remember mode with, in the recall submode, and I know in the past we had
> said that we wanted to keep the recall submode and probably the other remember submodes distinct
> and not visible from the main chat mode, so that they don't show up as threads there. Actually,
> what I'm thinking is the best case would be if they did show up as threads, that any other chats
> that happen also show up in the main chat mode as threads that are visible, but with some kind of
> icon with a tooltip to indicate that they came from somewhere else. So in this case, it would have
> an icon to indicate that it came from the recall submode of remember. And I think this will become
> increasingly relevant because I talked elsewhere about how we want the dig deeper actions and the
> investigate actions and whatever across glossary and citations and debate and anywhere else, and
> even perhaps comments, that they are all, in a sense, customized versions of chats. I think we
> want all of them to be visible from chat, the main chat mode, but perhaps, again, with sort of
> icon annotations and maybe a way in chat to filter to, you know, sort of straight chats only or by
> particular mode or whatever. And that way we get the best of all worlds. I can look at just my
> chats or I can look at comments as well, and it should default to showing them all. And it should
> be easy then to go from, yeah. I think that's the best of all worlds. If you can see sort of
> minimal improvements to this idea, go for it. If it's going to add a lot of complexity, let's
> discuss it.

**Ending: shipped.** On `dev`, not deployed. It rode with the work on chats started from a mode,
[261005i](../plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md), which
has one additive migration.

What we did:

- **Chat's list shows every conversation about the article**: Recall, Tutorial and Explore beside
  the chats. This reverses the 2026-10-01 rule (plan 261001m), as the report asks.
- **Each row from elsewhere has an icon with a tooltip**: Remember and its sub-mode, Debate for a
  chat started from a claim (new in the same plan), and *About a passage* for a chat started on a
  paragraph or from a comment's question, which were already listed but unmarked.
- **A filter above the list**, All by default, then Chats and one choice per source present. It is
  in the URL (`?chatfrom=`).
- **Pressing a Remember row takes you to Remember**, on that sub-mode. It does not open inside
  Chat. Opening it inside Chat is the part that would add a lot of complexity, so it is a question
  for Greg, `[Q-open-where]` in the plan, with this as the default.
- **A comment with no question is not listed**: it is not a conversation.

The rule is written down in
[chat-tools.md § Chat's list shows every conversation about the article](../project/chat-tools.md).
