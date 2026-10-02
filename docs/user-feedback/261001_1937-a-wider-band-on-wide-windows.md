---
reports: spya-xebdgz
ending: shipped
---
# A wider left-hand column when the window has room

Report `spya-xebdgz`, a suggestion, from Greg (admin), 2026-10-01, dispatched by the Overseer on
2026-10-02 with no Sentry mirror, on
`/read/melnikoff-bargh-2018-mythical-number-2-0-spya-bucuzj?…&mode=remember…`:

> I often find that the left-hand column could be just a touch wider. For example, with a chat. I
> think we've done research somewhere about the optimal column width for reading, and indeed that's
> what we've used for the text. And so I think if the window is really wide and there's space, the
> left-hand column should expand up to that sort of width.
>
> So stuff like chat or summary or basically anything that involves reading text would benefit from
> being up to that wide.
>
> Of course, we don't want to... I think the way it works right now for slightly narrow windows is
> pretty good, so we don't want to screw that up. So you might need multiple gradations.
>
> More importantly though, let's not introduce too much complexity.

**Ending: Shipped**, on `dev`. Plan
[261002a](../plans/261002a-horizontal-scrollbar-wider-band-on-wide-windows-archive-button-on-the-masthead.md)
§ 2.

What changed: the band (chat, summary, glossary and the rest — not Structure, which has its own
sizing) now also takes any room the article column has beyond what the text can use, up to a
reading column's width (34rem, 544px). One added rule and no new numbers. Below a 1220px window
nothing moves; it grows smoothly from there and reaches 544px at about 1364px. The text keeps its
full width throughout. Measured in the browser: chat's band is 400 at 1100, 445 at 1280 and 544 at
1440 and 1920.
