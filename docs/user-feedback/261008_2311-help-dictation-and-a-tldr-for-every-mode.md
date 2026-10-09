---
reports: spya-y5gfpf, spya-xcmg2d
ending: shipped
comment: Help's Ask box has the same microphone as every other box. Every mode's Help page now opens with a short "why care, what for, how it works", then a picture of it in use. Annotated pictures skipped, as you suggested.
---
# A microphone on Help's Ask box, and a TL;DR at the top of every mode's page

Two admin reports from Greg (`scripts/feedback-reporter.ts` exit 0 on both), about `/help`, filed
2026-10-08 at 23:11 and 23:15 UTC. Session `fby5gfpf-help-dictate-and-tldr`. Plan, both GPT Sol
reviews and the reasoning: [261009a](../plans/261009a-help-dictation-and-mode-tldrs.md).

> Add a voice dictate button to the help chat.
>
> — `spya-y5gfpf`

> In the help pages from mode, start with just like a bit more of a TLDR about why the reader should
> care and just broadly what the intent is. […] So in other words, you know, motivate each mode.
> Why does it exist and what's it for, and roughly how does it work? Start with that. And then
> maybe ideally a screenshot or an animated GIF showing it in use would be good as well. If there's
> a way in which we can annotate those, that would be even better, but maybe that's overkill.
>
> — `spya-xcmg2d` (the whole of it is quoted in the plan)

**Ending: shipped**, both. On `dev`, not deployed. The next feedback sweep should mark both Sentry
issues `resolved`; this session has no Sentry sign-in.

## What changed

- **The microphone.** *Ask about Spideryarn* has the shared dictation button left of **Ask**, wired
  as every other box that sends: a double press on Stop sends, nothing goes while the microphone is
  on or the words are on their way, and a transcript longer than the 1,000 characters a question may
  be is kept whole and refused, with the count shown. The recording carries on when you follow a
  link from `/help` to a page (GPT Sol's plan review caught that a microphone in the box itself
  would have been cut off there).
- **The TL;DR.** Each of the 17 mode pages opens, with no heading, on two to four sentences — why a
  reader would care, what the mode is for, roughly how it works — then the mode's main picture
  (moved up; for Skim, the GIF of stepping through stops). *How it works* follows, with the
  catalog's two lines as before. A mode's Help file without this opening no longer draws, so a new
  mode cannot ship without one. GPT Sol's code review checked every sentence against the mode and
  corrected eleven that promised more than the mode does.
- **Not done: annotated pictures.** Greg called it maybe overkill, and each picture already has a
  caption saying what to look at. No new pictures were needed: every mode already had one.
