# Feedback button on the logged-in homepage

`SPIDERYARN-READING2-2C` · 2026-09-07 17:32 UTC · greg@gregdetre.com (admin, checked with
`scripts/feedback-reporter.ts`, exit 0) · filed from
`/read/after-work-we-ll-have-each-other-spya-rqztkp` on production at `c0fb04a4`.

> Show the Feedback button in the top right of the logged in Homepage

**Ending: shipped**, on `dev`.

## What was actually wrong

**The button was already there**, at every width, with nothing painted over it — measured in a real
browser signed in, and asserted by `tests/feedback-button-visibility.test.tsx` since 2026-08-31.
`git show c0fb04a4:src/web/App.tsx` still carries the line that drew it, so this was neither a
regression nor a device-specific disappearance.

**So we read it as a placement request, not a defect report.** The button was a 15px `--ink-faint`
glyph fixed to the *window's* corner, dropping its label entirely below the 731px query, while the
shelf's own `Profile`/`Admin` links sat in a cluster of identically-coloured icon-and-label controls
about 130px to its left. Two top-rights, and the one a reader looks at is the page's. That the
separation is *why* Greg could not find it is our inference rather than something he said — GPT Sol
was right to insist the distinction be written down.

## What we did

The same trigger gets a third shape, in the shelf's own masthead row beside `Profile` and `Admin`,
and the corner one stops being drawn on that route — so there is still exactly one per page. Fable
arbitrated the placement.

Its `<main>` also gained `+ var(--safe-top)`, and that is a precondition rather than a tidy-up: the
shelf was the one signed-in page omitting the inset, so on an installed iPhone its `<h1>` sat at
y=40 inside a 59px notch. The corner button cleared the notch under its own power; a control in the
header row inherits whatever `<main>` says.

[260908e-feedback-button-in-the-shelf-masthead.md](../plans/260908e-feedback-button-in-the-shelf-masthead.md)
has the reasoning, the measurements, and the option it passed over.
