---
reports: spya-twsm7t
ending: shipped
comment: Chat's list now says Investigate (or Claims, Glossary, Quiz…) under each chat started there. A chat from a Quiz mark goes back to its question, and the question shows it.
---
# Chat's list says which sub-mode a chat came from

Report `spya-twsm7t` (#690, SPIDERYARN-READING2-NN), Greg (admin, provenance proved by
`feedback-reporter.ts`), 2026-10-23 23:07 UTC, from Chat on `arxiv-2308-08708-spya-xax6v4`, chat
`spya-xaq7f9`. Queue item `qi-gyhtebmf`. Addenda: none, checked before starting and again before
writing this.

> This chat came out from, I think, sources investigate submode chat, and so it should be annotated
> as being that kind of thing, and I should be able to see it again within the investigate submode.
> And if I look at it in the chat list of threads, it should be clear that it came from the
> investigate submode. I think we already do this for, you know, recall and explore submodes, and
> indeed any submodes that trigger chat, we should offer this ability to annotate those kinds of
> chats as coming from that submode and for that submode to list them or whatever.

**What was already true.** In production the chat is stored as an Investigate question (read-only
query). Investigate lists it under *Your questions* and reopens it on arrival (plan 261021b). The
open chat has *Back to your question in Investigate* above it.

**What was missing, and is now shipped, to `dev`.** The list said it only with Sources' icon, and
the word *Investigate* appeared only on hover. Now every row started from a mode or sub-mode says
the place under its title, in the chip's own words: *Investigate*, *Claims*, *Bibliography*,
*Glossary* or *Ideas*. Recall and Explore rows were already titled that way. One function,
`originPlace`, names each origin's place, and the way back reads it too.

**Not yet: the other sub-modes that start a chat with no origin.**

- **Quiz's *Discuss this in chat***: queue item `qi-g3neq83r`, waiting on question `q-nvxfwx`. A
  Quiz question's id repeats across batches, so this needs a database column and a choice about
  what the mark on the question means. **Built on 2026-10-24** after Greg chose B
  (`spya-yq6h67`, queue item `qi-t5nvqqen`): the chat is tied to one mark, Chat's list says
  *Quiz*, the chat goes back to its question, and the question shows that mark's chat. Plan
  261024i § Stage 2.
- **Summary's *Ask about a paragraph***: already queued, `qi-vj7p4sbh`, waiting on Greg's earlier
  question.

Plan, reviews and evidence:
[261024i](../plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md).
