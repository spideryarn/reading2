---
reports: spya-tv6wn5
ending: shipped
comment: Dig deeper is gone and Ask in chat stands in its place, on the hover cards too, and now on Ideas. A chat started from an item has a "Back to …" line that opens the mode on that item.
---
# Ask in chat replaces Dig deeper, and a chat goes back to its item

Report `spya-tv6wn5` (#504), SPIDERYARN-READING2-FF, Greg (admin, provenance proved by
`feedback-reporter.ts`), 2026-10-09 01:14 UTC, a suggestion, filed from
`/read/arxiv-1706-03762-spya-wyt7j0?mode=chat…`:

> I'm tempted to get rid of the dig deeper button and just replace it with the ask in chat button.
> So, in other words, you know, if I'm in a citation or perhaps even the glossary or the ideas or
> anything like that, there's just a button say ask in chat that kicks off a chat thread about that
> particular topic, perhaps prompted differently depending on the mode. I think we already do this
> with citations, and I'm just suggesting we do it elsewhere, and that we don't need the dig deeper
> button. The only way to improve this, though, would be if such chats had a way to go back to the
> mode that generated them. So, for example, if I'm in citations mode, if I choose dig deeper, then I
> want to be able to go, and now I'm in a chat thread, I want to be able to go back to the citations
> mode, and also sort of highlight the, you know, block or whatever that the chat is relevant to. I
> guess that's slightly less important if there's an easy way to go back to the citation mode entry,
> because that probably has a way to highlight the block. But it might still be nice.

**Shipped**, to `dev`, in three parts:

- **Dig deeper is gone** from a Glossary entry, a Citations row, both hover cards in the prose,
  Skim's term chip and a comment. **Ask in chat** stands where it stood, and is new on the two hover
  cards and the chip. Answers Dig deeper already kept still show. Each mode's chat already opens with
  its own question (a term, a cited work, a claim), so "prompted differently" was there.
- **Ideas has Ask in chat**, with the same mark that reopens the chat beside the mode.
- **The way back.** A chat started from an item shows *Back to "…" in Citations* (or Glossary,
  Debate, Ideas) above the conversation. A press opens that mode with the item's row scrolled into
  view. The row's own passage link highlights the block. On arrival the prose does not move by
  itself, because on a phone the mode covers it and the highlight would be missed.

**What went with Dig deeper.** On Citations it could also give a row a real link, judge influence
from the web and read the cited paper. A chat finds the same things but does not write them back
onto the row. The server half is kept, unused, and that choice is Greg's: delete it, or turn it into
a tool a chat can use to fill the row in (`qi-ccxkybft`).

**Still queued**: Ask in chat on Timeline, Quotes and FAQ (`qi-bd6h2fnd`). FAQ's questions get new
ids on every run, so a chat could never find its question again.

The plan, both GPT Sol reviews and the checks:
[261009k](../plans/261009k-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md).
