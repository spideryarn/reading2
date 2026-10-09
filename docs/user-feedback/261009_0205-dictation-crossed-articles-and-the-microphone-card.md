---
reports: spya-vzj8fc, spya-xdvnrg
ending: shipped
comment: A recording left on one article is no longer offered on another; Chat, passage chat and the command bar had the same gap, all fixed. The microphone now has a card: why talk, the 15-minute limit, and press Stop twice.
---
# A dictation crossed articles, and the microphone gets a card

Two admin reports from Greg (`scripts/feedback-reporter.ts` exit 0 on both), filed 2026-10-09 at
02:05 and 02:07 UTC, and the Overseer's addendum about Chat. Session
`fbvzj8fc-dictation-cross-article`. Plan, the trawl's table, both GPT Sol reviews and the browser
check: [261009g](../plans/261009g-dictation-stays-with-its-article-and-the-button-says-its-tricks.md).

> I was in the guide chat for a previous article. The attention is all you need one, and I guess
> there was some kind of error, maybe with voice dictation. […] And so I said, try again. And so it
> pasted in the voice dictation that I had written for the previous article. […] Let's do a kind of
> careful trawl of any place we're using voice dictation and check that we aren't going to be
> accidentally pasting in stuff across articles or in other ways that are inappropriate.
>
> — `spya-vzj8fc`

> I think we've set it up so that most of the voice dictation buttons actually allow you to double
> click. That should be in a tooltip (see `tooltips.md`). And any time there's a keyboard shortcut or
> a hard-to-discover trick like double-clicking, it should be in the tooltip. […] there's a 15 minute
> limit […] And just to encourage people to use it because […] they talk more and provide more
> context to the agents. Maybe we should say that somewhere in the Help documentation as well.
>
> — `spya-xdvnrg`

## What we did

- **The cause**: a dictation that never reached its box is kept on the device and offered back in
  the box with the same name. The four *Why you're reading this one* boxes used one name for every
  article, so the guide's box on the new article recovered the recording from *Attention is all you
  need*. Their names now carry the article.
- **The trawl**, every box with a microphone: Chat was shared across conversations on one article
  (the Overseer's addendum), the passage chat box across passages, the command bar across articles,
  and Annotate in theory across copied articles — all now named for what the words are about.
  Comments, Quiz, Illustrated, Feedback, Help's Ask box and About you were already right. Readers,
  tabs and the server were checked and are safe.
- **The card** on every reader's microphone, while idle: talking says more than typing and helps the
  AI, the fifteen-minute limit, and on the boxes that take it, *Press Stop twice quickly to send*
  (*to press Enter* in the command bar, *to save* when annotating). There is no keyboard shortcut
  for the microphone to name. A finger does not see a hover card; Help's Chat page carries the same.
- **The rule**, in [tooltips.md § A shortcut is named on its card](../project/tooltips.md#a-shortcut-is-named-on-its-card):
  a hard-to-discover gesture goes on the card too, quoting Greg.

Recordings already kept under the old names are no longer offered and are swept after a week.

Sentry: this session had no Sentry sign-in; the next sweep marks it.
