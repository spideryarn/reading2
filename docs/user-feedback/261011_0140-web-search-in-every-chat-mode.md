---
reports: spya-drbkvc
ending: shipped
comment: Recall and Tutorial now search the web when you ask where a piece stands. Chat and Learn already opened pasted links. The guide can do neither and now sends you to Chat; whether to fix that is a question for you.
---
# Web search in every chat mode, and reading a given address

`spya-drbkvc` (#560, Sentry SPIDERYARN-READING2-H9, queue `qi-bj329ze3`), a suggestion from Greg
(admin; `feedback-reporter.ts` exit 0 on the production row, no addenda), filed 2026-10-11 01:40 UTC
from the home page. This session had no Sentry sign-in and did not write the Sentry status; the
next feedback sweep does. Plan, reviews and measurements:
[261011t](../plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address.md).

> My understanding is that chat mode has a way to kick off web searches. It should also be able to,
> you know, look at specific URLs as well. Secondly, I think some of our chat sub modes, like maybe
> in the learn mode, perhaps recall or something like explore. I saw a user ask a question that
> would have benefited from a web search because they were trying to sort of situate the current
> article relative to others, and it wouldn't do the web search. I think we should allow web
> searches in all of the chat modes because very often users are going to wanting to be situating
> this article relative to other stuff on the web, and it's too strict and limiting to hobble the
> agent.

**Ending: Shipped**, on `dev` and not deployed, with the guide's half deferred to a question
(`q-w26r6u`) and a queue item (`qi-zvsky2aj`), and web search in spoken conversations to another
(`qi-vcza3y2f`).

What we found:

- **Reading a specific URL was already there.** Chat, Recall, Tutorial and Explore all have
  `read_web_page`, behind the guarded fetcher, and each opened a link the reader pasted every time
  we tried (2 of 2, 4 of 4). Nothing changed for it.
- **Every typed Learn sub-mode already had web search.** What stopped it was the prompt: Recall and
  Tutorial are told to stay in the article, and "where does this piece sit among others?" was not a
  reason to leave. Asked that, they searched the web 0 times in 8 (they searched the reader's
  library instead), which is the behaviour the report describes.
- **The guide had none**, and was the only typed conversation without.

What we did:

- **Recall and Tutorial now search when the reader asks where the piece stands**: how it relates
  to other work, what others have said, what has happened since. Always the web, the library as
  well if useful, never instead. Measured after: Tutorial 4 of 4, Recall 2 of 4 (both misses answered
  from a relevant article already in the reader's library); the questions about the piece itself
  still never searched (0 of 8 in each). **Recall still does not go off on its own to fact-check
  the article**, on purpose: it is testing the reader's memory of this piece, and the new rule is
  about the reader's question, not the model's initiative.
- **The guide was given web search, and it was backed out.** It searched, then called its
  next-steps tool before writing a word; a search's results exist only inside the reply that ran
  it, so they were gone, and it told the reader "I haven't looked this up". Instead, the guide now
  says Chat can look it up, offers Chat as a next step, and points into what the piece says about
  where it stands (6 of 6 such questions in the last measurement, where before it said only "I can't
  search the web from here").

Still open:

- **`q-w26r6u`**: whether to build the fix that makes guide search work (GPT Sol's design, about
  half a day, a special case in the chat loop) and give it page-reading too. Queue item
  `qi-zvsky2aj`.
- **`qi-vcza3y2f`**: spoken conversations (Live) have no web search at all, because OpenAI's
  realtime voice has no provider search; that is its own project.
