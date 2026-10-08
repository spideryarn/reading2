---
reports: spya-pd9fnc
ending: shipped
parts: 2
comment: The Chat half is on dev: a "‹ Chats" button back to the list, and the (i) now names the model and its thinking. The other half, double-tap to stop dictation and send, is a separate piece of work.
---
# On a phone there was no visible way back to Chat's list, and the (i) did not say which model answered

Report `spya-pd9fnc` (SPIDERYARN-READING2-ER), a suggestion from Greg (an admin, proven by
`scripts/feedback-reporter.ts` exit 0), filed 2026-10-08 07:32 UTC from Chat on
`2608-13566v1-spya-yurten`. Overseer queue item `qi-aft7nhv9`, session
`fbpd9fnc-chat-phone-nav-and-model-info`, batched with `spya-qd2agx`
([its note](261008_0733-chat-up-and-down-between-messages.md)).

**This note is part 1 of 2**: the Chat half. Part 2, dictation's double-tap to stop and send, is
another session's (`fbbtjtbb`), and this work did not touch the dictation component.

> On mobile, I'd opened a chat, and I was in the middle of a chat, and I couldn't see a way to get
> back to the main chat mode that would let me choose other threads.
>
> Also, in the information icon for the chat thread, I was hoping it would show me which model it
> had been using, and perhaps even thinking level.

**Ending: shipped**, on `dev`. Plan:
[261008c](../plans/261008c-chat-back-to-the-list-on-a-phone-the-model-in-the-thread-s-i-and-step-between-messages.md).

- **The way back was there, and nobody could tell.** On an iPhone-sized screen, a browser pass
  found the × at the far end of the header on screen, working, and never pushed off by a long
  title. But it was a faint 14px ×, between the trash can and the (i). It read as "close", and its
  only words were a tooltip, which a phone cannot show.
  **Built**: "‹ Chats" at the start of the conversation's header, where you look for "back", and the
  × removed. Learn has no list, so it has no button.
- **Built: the (i) names the model and how hard it was asked to think.** Each answer now stores the
  thinking level that was actually sent (a new column), so the card says, for example, *"answered
  by claude-sonnet-5, thinking as much as the model chooses"*. If High-powered AI was switched on
  partway through, the card lists each model with how many answers it gave. Answers from before
  today say "thinking level not recorded" rather than guess.
- **Left alone**: pressing Chat in the bottom bar while in a conversation leaves Chat, as that
  button does in every mode.

Checked in WebKit at iPhone size and in Chromium at 1440px, with screenshots in the plan. **Not
tried on a real iPhone.** Production needs the migration `20261008102903_chat_message_effort`,
which deploy applies.
