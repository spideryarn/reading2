---
reports: spya-m40r6t
ending: shipped
comment: Figure 12 and six others were lost to our rules, not the model; three showed a small Earth icon instead. Fixed on dev; re-import the article after the next deploy. A check with the real model waits for the 1 Nov credit reset (queued).
---
# A small picture inside a PDF diagram was taken for the figure

Report spya-m40r6t (#718, `SPIDERYARN-READING2-PJ`), 2026-10-27 12:03 UTC, kind problem, from an
admin (Greg; `feedback-reporter.ts` exit 0), on LeCun's *A Path Towards Autonomous Machine
Intelligence*, imported as a PDF, at block `spya-hxvd8y` (Figure 12, `spya-vkb7hp`). No addenda
(re-read 2026-10-27).

> Can we try and figure out why we weren't able to recover this figure? And ideally improve things
> going forwards

**Ending: shipped** on `dev`.

What was wrong, in plain words: LeCun's diagrams are drawings with small pictures inside them (a
photo of the Earth, a "Z" and an "S" icon), and the same small pictures recur across figures. Our
rules treated an embedded picture as if it were the whole figure. So Figures 3, 4 and 5 showed
**the Earth icon instead of the diagram**, and Figures 10, 12, 16 and 17 showed nothing: the model
found the right box for them, and our "one picture can't belong to two figures" rule threw the
answer away because the diagrams shared an icon. Now a picture wired into a larger drawing is not
taken as the figure, the whole drawing is recovered instead, and shared small icons no longer cancel
figures. On this paper, replayed locally with right answers: 18 of 20 figures, up from 14 (three of
those 14 were wrong).

- Plan, production reads, measurements and both GPT Sol reviews:
  [261027e](../plans/261027e-a-picture-inside-a-drawing-is-not-the-figure.md).
- Postmortem: [261027b](../postmortems/261027b-a-part-of-a-figure-was-taken-for-the-whole-figure.md).

**Waiting:** the box's OpenRouter key is over its monthly limit until 1 November, so the real locator
model could not be run. The replay proves our rules now keep right answers; whether the model gives
them for these seven figures is checked after the reset (queued as qi-p95mhwnc). Greg's article is not re-imported
(a production write): after the next deploy, re-importing it will re-decide its figures, since the
figure policy is now `pdf-figures/8`.
