---
reports: spya-jvsv3q
ending: shipped
comment: Shipped: a Chat icon under a finished mark opens a new chat with the question, the mark and your answer quoted, ready for you to type. Since 2026-10-24 the question also remembers that chat and reopens it.
---

# Discuss a quiz mark in chat

Report `spya-jvsv3q` (#603, `SPIDERYARN-READING2-JT`), from Greg (an admin), filed 2026-10-18,
build `614e42c5`, on `rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug`, Learn › Quiz.
A suggestion.

> So there was a quiz question, and I gave an answer, and it gave a response, and it was interesting
> but confusing. I wanted to discuss how. There needs to be a way to turn the discussion so far into
> a chat thread and continue it.

**Ending: Shipped**, on `dev`, simplest version first. Once a mark has finished, the row under it
(← → and the list) gains Chat's two bubbles, *Discuss this in chat*. Pressing it opens a new chat
in Chat with the question, the mark and your answer quoted in the text box. Nothing is sent until
you add what you want to ask, the same as Summary's paragraph button. Plan
[261018b](../plans/261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat.md) stage 2. The
chat is a plain one, so the question does not show its summary or reopen it. That part is queued as
`qi-8bh8r2vg`, and was **built on 2026-10-24** under `qi-t5nvqqen` (Greg's B on `q-nvxfwx`): the
chat records the mark, and the question shows it and reopens it. Plan
[261024i](../plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md) § Stage 2.
