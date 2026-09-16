# Always indicate citations in the main text

**SPIDERYARN-READING2-3M**, 2026-09-12, from Greg (an admin, so trusted input —
[feedback-reports.md § Who sent it](../project/feedback-reports.md)). Standing in Citations mode on
`temporal-context-reinstatement-spya-dhqkf9`.

> And (just as we do with quotes and glossary), once generated, we should always visually indicate
> Citations somehow in the main text (with tooltip/clickable, that pops up a panel for the citation
> with various useful information & actions. Use Fable for product input on this.

## Ending: **shipped**, on `dev`

Fable was consulted, as asked, and its reading is what shaped the result. Its central move: *"a panel
for the citation is not a new hover machine; it is a third section in the card that exists"* —
`ProseHoverCard` already composes a glossary section, a footnote in full and a link described, so a
citation joins the way the footnote did. That removed most of the engineering. Fable also settled two
product questions: mark **every** work rather than only those above the threshold bar, because that
bar is unreachable from the modes the marks are visible in; and close the mentions-past-three gap
with **words** in the card — *cited in 7 paragraphs* — rather than by washing a paragraph we can only
place block-level.

What shipped: every work is marked where the article cites it, in every mode, on the one visual
channel nothing else uses; pointing at one opens the work — title, link with its honest provenance,
authors · year, what the piece uses it for, and where else it is cited; and a finger gets the same
card on the first tap.

One of Fable's recommendations was refused, on a house rule rather than taste: it proposed drawing
the mention in the link colour family, and `.prose a` is already that orange, so it would have made a
citation look like one of the article's own hyperlinks — which go somewhere when pressed. Underneath
that, `mark.cmt` sets `color: inherit` and says why: the verbatim column does not repaint the
author's prose to advertise our annotation.

[citations.md § Marked in the prose](../project/citations.md) is what is built.
[260916b](../plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md) is the
plan, both GPT Sol reviews, and what was deliberately **not** built — `?cite=` and the *In Citations*
foot button, joining the section to the link and note cards, and marking every occurrence rather than
only an unambiguous one.

*(This session runs on a pool account with no Sentry sign-in, so the Sentry status write belongs to
the next feedback sweep — [feedback-reports.md § Into the Overseer's queue](../project/feedback-reports.md).)*
