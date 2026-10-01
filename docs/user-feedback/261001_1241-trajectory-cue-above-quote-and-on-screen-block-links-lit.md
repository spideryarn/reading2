---
reports: spya-jq5db6, spya-rqch7a
ending: shipped
---
# Trajectory's question above its quote, and a band's block links lit when their paragraph is on screen

Two of Greg's suggestions from the Feedback dialog, filed two minutes apart on 2026-10-01 from the
same article. Admin, proved by `scripts/feedback-reporter.ts` (exit 0, run by the Overseer).
SPIDERYARN-READING2-8J and SPIDERYARN-READING2-8K. Neither had been built: checked against
`git log origin/dev`, `docs/plans/`, this directory and `gjd-remote ls` on 2026-10-01.

`spya-jq5db6` (8J), with a screenshot of Trajectory's current row:

> In Trajectory mode, show the question *above* the quote. see screenshot

`spya-rqch7a` (8K):

> In Summary and Tweet-threads mode (and a bunch of others), we include block-links.
>
> In such modes, highlight any block-links whose blocks are currently visible on the screen.
>
> Ideally do this with reusable machinery.

**Ending: Shipped**, both, in `a686acdb` and `41f0e4fa` on `dev`; the plan is
[261001n](../plans/261001n-trajectory-question-above-quote-and-highlight-on-screen-block-links.md).
Not deployed: the Overseer deploys.

- **8J.** The current row now reads section path, then the cue, then the quote.
- **8K.** In every mode at once, with no panel changed: one generated `<style>` element lights
  every block link in the band whose paragraph is on screen, keyed on the `data-block-link`
  attribute every block link already carries. It samples on scroll, sharing the row measurement
  with reading time. It is off when the band lies over the prose (a phone), since then no
  paragraph is visible beside it.
- **Not built, for Greg:** the Overseer's related finding, that on a landscape iPhone Trajectory's
  *"What do you want from this piece?"* form takes 137px of a ~338px band above an existing route.
  Collapsing it changes how findable the purpose question is, which was a deliberate choice in
  260930e, so it is in the plan's § Also raised rather than built.
