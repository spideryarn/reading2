---
reports: spya-y4yhnp
addenda: spya-byxz0r
ending: shipped
comment: Under a finger, each web source is now one block (its button under its own title, a line between sources), and nearly everything you can press is 40px. Left for you: whether the gutter's bar may cover two lines.
---
# Phone sizes, part two: the citations' spacing, and the rest of the targets

Report `spya-y4yhnp` (#667, SPIDERYARN-READING2-N0), Greg (admin, provenance proved by
`feedback-reporter.ts`). Its first part shipped in
[261020_2201](261020_2201-minimum-text-and-touch-target-sizes-on-a-phone.md). This is the
follow-up, Overseer item `qi-c4nmmq5m`, and the addendum Greg wrote afterwards:

> I think this font size issue was specific to the citations that it was providing, by the way. I
> mean, actually, it was as much about sort of line spacing or paragraph spacing being quite close
> as font size.
>
> — Greg, 2026-10-21 05:25 UTC (addendum `spya-byxz0r`)

**Shipped**, to `dev`. Both changes apply only under a finger; desktop is unchanged.

- **The citations.** On Greg's own Investigate answer, copied locally, "From the web" was still
  ragged after part one: *Bring into this chat* sat beside a short title and under a long one, so
  it was nearer the next title than its own. Titles ran 12 to 68px apart. Now each source is one
  block: the title, its button always under it, and a hairline before the next source. One-line
  sources are evenly spaced, and the text keeps its 1.5 line height.
- **The rest of the 40px targets.** That covers every shadcn button, the band's (i) and badge,
  the top bar's icons and its facts line, Quiz, Dictate, the References stub, Glossary, the footer,
  the dock, and the shelf card's Tag and date. It also found a class of near-miss: a finger size
  written as 2.5rem (or Tailwind's `size-10`) is 38.4px on an iPhone. Eighteen of those are fixed,
  and a test now refuses new ones.

**Left, and written down** in controls.md § The numbers: the gutter's bar (at 40px it would cover
about two lines of the paragraph above; Greg's call), the shelf's sort and topic chips, Skim's
place button, the fold toggle, a figure's zoom button, links inside a footnote card, Structure's
rows and the threshold slider. Also offered, not done: Chat answers' paragraph spacing (9.6px
between paragraphs on a 23px line), which is the same on every screen.

Plan, measurements and three GPT Sol reviews:
[261021g](../plans/261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md).
