---
reports: spya-sb0c7e
ending: shipped
---
# Jump to a piece's figures, tables and media: a Figures part in Skim, and a mark on Structure's rows

Admin suggestion from Greg (`feedback-reporter.ts` exit 0), `spya-sb0c7e` (#544,
`SPIDERYARN-READING2-GS`), filed 2026-10-10 08:03 UTC from Summary on
`lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz` (build `29220e7d`). Overseer queue
item `qi-wh7c3862`.

> I would quite like to be able to jump to all the tables and figures and media easily. I can't
> decide whether it makes more sense to put that in structure or in skim. Maybe in skim. And perhaps
> we can have an icon for each diagram or table contained in a section within structure so that you
> could easily see which parts of the piece do have diagrams or tables and then use structure to
> jump to them. Use your judgment about how to add it to skim. Maybe it's a separate fourth submode.
>
> — Greg, 2026-10-10 (`spya-sb0c7e`)

**Ending: Shipped**, both halves. On `dev` and not deployed. Plan
[261011b](../plans/261011b-skim-figures-walk-and-structure-figure-marks.md), with GPT Sol's plan
and code reviews beside it.

- **Skim has a fourth part, *Figures***, after Gist · More · Most: every figure, table and video
  in reading order, with the same stepper, rows, door (*Next figure ›*, the caption under it) and
  ← / → keys as the route. `?depth=figures`. It is read off the article's own blocks, so it costs no
  model call and works before a route has been planned; a *Route* chip leads back.
- **Structure's rows carry a small mark** (image, table, film, with a count above one) for what
  their section holds, in both faces and in Expanded, so a part with figures shows before you open it.
- What counts as a figure, and what does not (equations LaTeXML sets as tables, pull-quotes,
  a title set as a tiny image), is in the plan § What counts as a figure.
- Not built, and not part of the ask: thumbnails in the Figures rows, code blocks and display maths
  as stops, and a Figures walk for a visitor to a public article with no stored route. All three
  are in the plan § Not in this change.

Sentry: `SPIDERYARN-READING2-GS` set to resolved by this session, 2026-10-11.
