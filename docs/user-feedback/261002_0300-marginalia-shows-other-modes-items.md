---
reports: spya-h6rrhv, spya-rczgjb
ending: shipped
---
# Marginalia shows FAQ, Debate, Citations and comments, shut; and a rule under its head

Two suggestions from Greg about the same right-hand column, both checked as his with
`feedback-reporter.ts` (exit 0), so both built. Overseer queue item qi-a844m5nr.

**spya-h6rrhv** (Sentry SPIDERYARN-READING2-82), 2026-10-01, sent from Annotations (now Marginalia)
on `9689-full-spya-m43th2`:

> Perhaps include FAQ, Citations, Debate items, Comments etc (if generated) in Annotations.
>
> And make a note in new-mode.md and/or docs for Annotation mode that we should keep an eye out for
> where new mode-items might be useful to include/display in Annotations mode.
>
> Rather than showing the full item, maybe show them default-collapsed.

**spya-rczgjb**, 2026-10-01, sent from Summary with the margin open on
`jco-2005-01-libre-spya-hk9cc7`:

> I really like the rail at the top of the annotation marginalia mode that tells you where you are,
> both in terms of the structure and the arc. Can we make it visually look slightly different from
> the rest of the annotations? Perhaps put a box around it or a line under it or something to show
> that it's not just a regular margin-annotation?

## What we did

- **Other modes' items in the margin, shut.** Beside a block, at most one line per kind: an FAQ
  question the block answers, a page on the web that answers a claim made there (Debate), a work
  first cited there, and the reader's own comments (a bookmark with no words stays a mark in the gutter). One item shows its title; several
  show a count. Pressing the line opens the rest underneath. Nothing is generated: each list is read
  only if it already exists, through read-only hooks that cannot start a run. Citations stay
  owner-only, as their prose marks are. Plan:
  [261002b](../plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md).
- **A thin line under the head**, the quieter of the two things Greg offered. No note in the column
  has a horizontal line, so it reads as "not a note".
- **The note he asked for**: Marginalia now has a doc of its own,
  [marginalia.md](../project/marginalia.md), with a section on keeping an eye out for new kinds of
  item. [mode.md](../project/mode.md) points to it from its list of patterns, because there is no
  `new-mode.md`.

Worth knowing: citations are the busiest kind. Gwern's *The Scaling Hypothesis* (12,646 words) gets
24 citation lines. Shut, that still reads as a sparse column, so they stayed in. If a denser paper
proves otherwise, taking citations out is one loop in `src/web/marginalia/notes.ts`.

One question for Greg is left in [interface-vision.md](../project/interface-vision.md) (open
question 2, now narrower). Should Debate show every row in the margin, as built, or only the rows
that dispute a claim? It does not hold this report up.

Commits: (filled in at commit).
