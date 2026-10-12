---
reports: spya-mpg67x, spya-ma72mx
ending: shipped
comment: Asked for links, the guide now points straight at places in the article. Asked for searches, it offers buttons that run inside the chat and list the passages as links, without switching to Search mode.
---
# The guide links the article, and runs searches in the chat

Two admin reports from Greg (`scripts/feedback-reporter.ts` exit 0 on both, no addenda), from one
guide thread (`spya-sv7rg7`) on
`/read/rhizome-1000-plateaus-introduction-lambert-says-spya-jc9azw`, build `c5331f8e`: `spya-mpg67x`
(#569, SPIDERYARN-READING2-HK, 09:21 UTC) and `spya-ma72mx` (#572, SPIDERYARN-READING2-HP, 09:25
UTC). Queue item `qi-zwddnfs9`, session `fbmpg67x-guide-block-links-and-searches`.

> Can you have a look at the guide chat for this? As you can see, the response from the Live AI was
> a bit frustrating. It didn't seem to understand what I meant about show me links. I meant links
> within the article, usually. And though, you know, sometimes one might ask for links on the web,
> but I think people will be more explicit. But the main thing is it didn't produce block links to
> the article readily, which is a big part of what we want the guide chat to do, or any other
> tools. I mean, it could have offered to create a search for me or something like that.

> In this guide chat, I asked it to run some searches for me, and it said it couldn't. I want it to
> be able to. In an ideal world, it would rather, yeah, I think I wanted a little bit of UI that
> would show, okay, this is the search text that I'm about to run. Click this button to initiate
> it, or something. I mean, or maybe it would start them automatically and provide a link to them.
> It shouldn't take me to the search mode because that's really disorienting, and I might want to
> search for multiple things, and it should be able to initiate searches.

**Ending: shipped**, on `dev`, not deployed. Plan
[261011aa](../plans/261011aa-guide-and-chat-run-in-article-searches-in-place-and-link-the-article-readily.md).

**What the thread showed** (read at Greg's request, inside a read-only transaction). The spoken
guide asked which kind of links he meant, then took "links within the article" to mean the
article's own hyperlinks and said there were none. The typed guide did give block links, but said
it had "taken you to the first" (it cannot move you). Asked for searches, it said "I can't save
searches for you", and offered buttons that would all have switched the band to Search mode.

**What we did.**

- **A search button in a chat answer now runs where it is**: in the guide, in Chat, in the passage
  chat dialog, and in the guide's suggested next steps. This is Greg's first shape: the button shows
  the words, and he presses it. The button's place becomes a small box listing what was found, as
  block links that jump the article while the chat stays open, with a link to open it in Search.
  Several can run at once. A quick search is saved like any other, so a reload shows it again and
  Search has it in its list. An exact-words *Find* button does the same, for free.
- **The guide's prompt**: asked for "links", it now cites places in this article at once, without
  asking which kind. It reads that as the article's own hyperlinks, or the web, only when the reader
  says so. Asked for searches, it offers up to three buttons, never says it cannot search, and never
  says it has moved you. **The spoken guide** is told the same in a voice's terms.
- Seen working in a browser on this box (Cargo Cult Science): two searches at once, chips jumping
  the article, a reload, *Open in Search*, and a phone-width check. Screenshots are
  `docs/plans/261011aa-shot-*.png`.

**Not done** (queue item `qi-dhy8q2nq`): the automatic thorough search after the quick one, which
Search mode does by itself; one search client shared with Search mode; and marks in the article for
a chat search. Search's toggle folding *quick* into *meaning* on 2026-10-12
([261012_0941](261012_0941-search-one-meaning-button-quick-then-thorough.md)) did not change this:
auto-thorough still lives only in Search mode's band.
