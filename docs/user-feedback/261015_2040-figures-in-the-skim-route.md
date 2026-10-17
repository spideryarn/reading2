---
reports: spya-c8z66b
ending: shipped
comment: Built as Greg chose (1B, 2A to q-z27hq2): the model may put a figure between quotes in Gist, More and Most, with a cue. skim/14, commits 27d0c289d, 18765fa34, d008d8cb6. Visitors' routes stay quote-only until q-gq0f4k (qi-at6acbtb).
---
# Figures inside Skim's Gist · More · Most route: shipped

Admin suggestion from Greg (`feedback-reporter.ts` exit 0, no addenda), `spya-c8z66b` (#584,
`SPIDERYARN-READING2-J5`), filed 2026-10-15 20:40 UTC from Skim on his
`mental-imagery-functional-mechanisms-and-clinica-spya-fw5zrb` (build `f84dc434`). Overseer queue
items `qi-647czja2`, then `qi-r4rvhyqw` (dropped), then `qi-77vvdcac`.

> It's good that we have a "Figures" sub-mode in Skim now.
>
> Perhaps we should also have the option to include some figures along with quotes in the main
> Gist/More/Most Skim trajectories (as the LLM sees fit)
>
> — Greg, 2026-10-15 (`spya-c8z66b`)

It had two decisions in it, asked in [q-z27hq2](questions/q-z27hq2.md) on 2026-10-15:

> I was thinking 1B, perhaps with some kind of commentary or cue to make it easier to see why the
> figure is being included. Use your judgment. / 2A
>
> — Greg, 2026-10-17 (`spya-zrfpc0`)

**Ending: Shipped** on `dev`, as `skim/14`
([plan 261017d](../plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md); commits
`27d0c289d` (the walk), `18765fa34` (the step, measured), `d008d8cb6` (the code review's fixes)).

- **The model chooses the figures** (2A), from their captions, sections and the quotes whose
  paragraphs name them. Each **figure is a stop of its own** (1B), straight after the quote it goes
  with and in that quote's pass, with **a cue on every figure** saying what to look at and why,
  never what it shows. At most 1 figure in Gist, 2 in More, 3 in Most; a figure counts in its pass's
  length, and the passes still grow.
- **Measured before it shipped**, in four rounds on eight articles with figures (this one among
  them) and two without
  ([261017b](../investigations/261017b-skim-figures-as-stops-measured.md)). The first design let a
  figure choose its own pass and it landed beside the wrong stops half the time; it now takes its
  quote's. The quote route held: as many Ideas in Gist as before, and a blind judge preferred the
  new Gist walks 8 to 4. On Greg's paper the route chose Figure 1 (imagery as weak perception) and
  Figure 2 (the visual hierarchy), each after the quote about it.
- **Not built: figure stops for visitors.** What a shared article sends a stranger is a listed
  defence (`src/public/dto.ts`), so a visitor's route stays quotes-only and the pass intros never
  mention a figure. Asked in [q-gq0f4k](questions/q-gq0f4k.md), queued as `qi-at6acbtb`.
- A route planned before this has no figures until it is planned again (Metadata's *AI processing*,
  or *Plan it again*); the older version is not announced.

The other two reports from the same minute shipped on 2026-10-15:
[261015_2040-structure-figure-marks-louder-and-tables-drawn-as-pictures.md](261015_2040-structure-figure-marks-louder-and-tables-drawn-as-pictures.md).

Sentry: `SPIDERYARN-READING2-J5` was set to ignored (forever) on 2026-10-15 while this awaited
Greg. This session runs on a pool account with no Sentry sign-in, so setting it to resolved is left
to the next sweep.
