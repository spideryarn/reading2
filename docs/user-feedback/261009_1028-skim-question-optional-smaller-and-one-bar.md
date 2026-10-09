---
reports: spya-qpgvq9, spya-zdkqx4, spya-x0rfs2
ending: shipped
comment: spya-x0rfs2: the bar is fixed; the quieter open stop Greg chose in q-u04sye is on dev as an experiment
---
# Skim: the question before a quote is optional, smaller and explained; the bar is one bar

Three admin reports from Greg (`feedback-reporter.ts` exit 0 on each), 2026-10-09 07:50–07:53 UTC,
all from Skim on `arxiv-1706-03762-spya-wyt7j0`: `spya-qpgvq9`, `spya-zdkqx4` and `spya-x0rfs2`.
This session had no Sentry sign-in and did not write the Sentry status. The next feedback sweep
does that.

> I think there's no point in having a question that sort of almost verbatim sets up the quote as
> the answer, because that adds nothing. In that case, we don't need the question.
>
> — Greg, 2026-10-09 (`spya-zdkqx4`)

**Ending: Shipped**, all three. It is on `dev` and not deployed. The wider layout half of
`spya-x0rfs2` was put to Greg as [q-u04sye](questions/q-u04sye.md). He chose option A as an
experiment, and it is on `dev` in [261009m](../plans/261009m-skim-quieter-open-stop.md): the open
stop's heading smaller and grey, the chips outlined, the door's cue upright. The large quote marks
he floated were tried and not kept.

What we did, in [261009j](../plans/261009j-skim-question-optional-and-the-border.md):

- **The question is optional** (`skim/11`). The model writes one only when it says what the
  quote's "this" or "the latter" refers to, names the question the passage settles, or says which
  key idea the quote carries. It never writes one that turns the quote into a question. About a
  third of stops now have one.
  - **Measured on six articles, two of them yours**, with blind judges of two model families:
    [261009b](../investigations/261009b-skim-cue-optional-eval.md). Both judges call most of the
    old questions echoes.
  - Where both prompts wrote a question, the new one usually won.
  - Some of the dropped questions were better than nothing. Overall preference did not clear the
    bar the plan set, in any of three rounds, and the change was built on your request and an
    arbiter's call. The investigation says so plainly.
  - Routes already planned keep their questions until planned again.
- **A line after the quote was looked for and not built.** None of 68 real cases worked only
  there, and it would end each stop on the model's words rather than the author's.
- **The question is smaller than the quote**: 0.78rem monospace against the 0.88rem serif quote.
- **It is explained.** The band's (i) says what the line is, and so does a card when the mouse is
  over the line.
- **The current stop is one box with one straight bar**, on desktop, iPad and phone. Before and
  after: `docs/plans/261009j-shots/before-2-desktop-row-crop.png` and `after-2-desktop-row-crop.png`.
- **The line under "Next stop ›" no longer crosses the rule** at the right edge of the text.
- The Help page and the students' guide no longer promise a question on every stop.
