---
reports: spya-ga6m76
ending: shipped
comment: Shipped on phones and small windows, where the bottom bar slides. One question for you: should it also appear on a full-screen iPad or a laptop, where the bottom bar stays put?
---
# A reminder bar at the top while you scroll back

Report `spya-ga6m76` (#727, Sentry `SPIDERYARN-READING2-PW`), from Greg (`feedback-reporter.ts`
exit 0, no addenda when re-read before acting and again before this note), a suggestion filed
2026-10-28 23:32 UTC on `arxiv-2308-08708-spya-xax6v4` with `?margin=1`, build `a3d0f98e`. Session
`fbga6m76-top-bar-select-to-glossary`, which also took `spya-turkg3`
([its note](261028_2339-add-a-selection-to-the-glossary.md)).

> When I scroll in one direction, it shows the bottom bar, like when I'm on an iPad. That's great. I
> think it might be useful if it also perhaps showed a bunch of stuff about the article at the top,
> like the title and author and publication date and maybe any other metadata you think would be
> useful, how much we read. It could just be useful as a reminder.
>
> And then when I scroll in the opposite direction, it would disappear just like the bottom bar does.

**Ending: Shipped**, on `dev`, not deployed. Plan
[261029d](../plans/261029d-a-reminder-bar-at-the-top-and-add-a-selection-to-the-glossary.md), Part 1,
with GPT Sol reviews of the plan and the code.

## What we did

- **A two-line bar, fixed over the top of the reading column**: the title, then the masthead's
  facts as plain words (authors, journal, site, published, `~N min`) and the owner's read-so-far
  pie. Nothing in it is pressable; it covers the text rather than pushing it down, so nothing moves.
- **It comes back when you scroll back and leaves when you read on**, where the bottom bar slides
  (a phone either way up, any small window). Not at the top of the article, where the masthead is
  showing; not while a mode is open; and a jump to a passage puts it away, so it is never over where
  you landed.

**Asked**: [q-t2p2s7](questions/q-t2p2s7.md), whether it should also appear on a full-screen iPad
or a laptop, where the bottom bar does not slide (recommended: no, unless the iPad is where you
read this).

**On this article it will say little until the article is re-extracted**: its stored revision is
still titled *1Indicator Properties*, with no authors, date or site, as
[261023_2327](261023_2327-import-gets-arxiv-titles-right-not-a-chat-tool.md) recorded. A fresh
import gets them right; re-extracting it is a production write, left for Greg.
