---
reports: spya-whq0j0
ending: shipped
---
# Chat knows your other conversations about the article, and builds on them

Report `spya-whq0j0` (SPIDERYARN-READING2-ET), a suggestion from Greg (an admin, proven by
`scripts/feedback-reporter.ts` exit 0), filed 2026-10-08 07:39 UTC from Chat on
`2608-13566v1-spya-yurten`. Overseer queue item `qi-7ap877jx`.

> It would be nice if the chat had tools to access my comments, e.g. in bookmarks, and also perhaps
> other chat threads. […] I've just had a really interesting chat thread where the model pointed
> out some deficiencies in the paper, potential confounds. Now, if I was to start a new chat thread
> and say, Are there any potential confounds? I would be disappointed if the model sort of didn't
> make reference to points it had already made. […] Perhaps we auto-generate a descriptive title for
> each chat thread with a small model after each response, and then the model can easily consult
> those chat titles. […] when it starts a new— Chat, it would be told, by the way, here are some
> titles for other chat threads, and you have a tool to read them individually if you want to.

(Abridged; the whole report is quoted in the plan.)

**Ending: shipped**, on `dev`. Plan:
[261008e](../plans/261008e-chat-knows-the-reader-s-other-conversations.md).

- **Your comments, highlights and bookmarks were already readable** by Chat, through its
  `reader_notes` tool, since 2026-10-03. So was any earlier conversation on the same article. What
  was missing is that the model never knew an earlier conversation was worth opening.
- **Built, your lean as you described it**: after each answer, a small model (DeepSeek V4.1 Flash,
  zero-retention) writes one line on what the conversation covered and the points it reached. Every
  new Chat question now comes with the list of your other conversations on the article, each with
  that line, and the model is told to open one that took up the same question and to build on it
  rather than repeat it. The line is for the model and is not shown on screen; your titles are
  untouched.
- **Cost**: about $0.0001–$0.0003 per answer for the line, measured, and a few hundred tokens per
  Chat question for the list.
- **Checked** on a fixture article: asked "where is his argument weakest?" in a new conversation, the
  model opened the earlier one that had covered it every time (3/3) and answered "The earlier
  conversation on this already named three weak spots — … A few more worth adding:". An unrelated
  question opened nothing (3/3).
- **One honest caveat**: the same check run with no lines at all, just each conversation's latest
  question, did as well (3/3), even when the weak points were only in an answer to "what did you
  make of it overall?". What made the difference is the list. The line should matter more once
  you have many conversations on one paper, but that is not shown yet. If it never earns its
  keep, it comes out with a one-line change and the list keeps working.
- **The web research** (how ChatGPT and Claude do it) is in the plan: ChatGPT puts a list of recent
  conversations in every turn, and Claude has search tools for them. This is both, kept to one
  article.
- **Not built**: showing the line in Chat's list; lines for spoken (Live) conversations; filling in
  lines for conversations from before today — until one gets its next answer, the list shows its
  latest question instead.
