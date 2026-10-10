---
reports: spya-q3pzyn
ending: shipped
comment: An empty command bar on your own article now starts with Guide chat, marked with a compass, and the compass marks the guide everywhere it appears. The home page has no guide: it belongs to an article.
---
# Guide chat at the top of the command bar, with one icon for the guide

An admin suggestion from Greg (`scripts/feedback-reporter.ts` exit 0), filed 2026-10-09 at 23:53
UTC from the home page (SPIDERYARN-READING2-GJ, #537, build 5f6d3d5f). Session
`fbq3pzyn-guide-in-command-bar`, queue item `qi-dp2tphkd`. Plan, both GPT Sol reviews and the
browser check:
[261010g](../plans/261010g-guide-chat-at-the-top-of-the-command-bar-with-one-icon.md).

> Add a way to open the guide chat at the top of the command bar. Find a way to name and/or
> describe it that will be clear to new users, and make sure that we're using an icon for the guide
> chat applied everywhere.
>
> — `spya-q3pzyn`

## What we did

- **First on an empty bar.** On your own article's reading view, the command bar opens with
  **Guide chat** as its first row, above *Suggest what to do here*, with a rule beneath it. It is
  the highlighted row, so a bare Enter opens the guide; that is free, since opening it sends
  nothing. Once you type, it ranks like any other row.
- **The name chosen: "Guide chat"**, described *"Talk through how to read this piece: why you're
  reading it, where to start, which modes would help."* It was "Guide", which is also Help's word
  for its reader guides; *chat* tells a new reader that the press opens a conversation. It is what
  Greg calls it in all three of his reports. Inside Chat, where the band already says chat, it stays
  **Guide**.
- **One icon, the compass**, on every place the guide is named: the bar's *Guide chat* and *Ask
  the guide: “…”* rows (the bar's only icons), Chat's header while the guide is open, its pinned
  row in Chat's list, and its greeting. [icons.md](../project/icons.md) now records it.
- Help's Chat and Keyboard pages say where the row is.

**Not here.** The report came from the home page, which has no article and so no guide: the guide
is one conversation per article, its owner's. A guide without an article is the larger idea already
queued as `qi-263b6cpp`. The second half of `spya-xasbd3` (*"an easy way to get to the guide chat,
somewhere near the top of the command bar"*) is this same change; its own session,
`fbyf23zk-bar-suggestions-and-guide` (`qi-na7p6xy4`), is told to end that half against this commit.
