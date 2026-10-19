---
reports: spya-x9gn3d
ending: shipped
comment: Uncaptioned PDF figures are now kept and say they were not recovered. Recovering their pictures by position is waiting on you (q-jpamyd).
---
# A PDF's uncaptioned diagrams were dropped

Report spya-x9gn3d (#611, `SPIDERYARN-READING2-K2`), 2026-10-18 23:43 UTC, kind problem, from an
admin (Greg; `feedback-reporter.ts` exit 0), on Rovelli's *The Order of Time* imported as a PDF, at
block `spya-k6tf3t`. Queue item qi-kwn2p7gh. No addenda (re-read 2026-10-19).

> The text references a diagram here, but I don't see one. How did we lose it? Was it not in the
> original PDF?
>
> https://www.spideryarn.com/read/rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug?margin=1&at=spya-k6tf3t
>
> Look at the original file yourself. I'm not so fussed about fixing this particular document, but
> rather improving things going forward.

**Ending: shipped** on `dev` (Stage A), with Stage B waiting on Greg: question
[q-jpamyd](questions/q-jpamyd.md), queue item qi-s63n3xxs.

What was wrong, in plain words: the diagram is in the PDF and the reading model saw it, but the book
prints no caption under its diagrams, and our renderer dropped every figure without one — 27 of the
book's 33 figures, silently. Now such a figure is kept and shows *"We couldn't recover this figure"*
with a link to that page of the original. Recovering the picture itself needs proof by position on
the page, which is Stage B.

- Plan, with the production reads and the image survey:
  [261019e](../plans/261019e-uncaptioned-pdf-figures-are-kept.md), with both GPT Sol reviews beside it.
- Postmortem: [261019b](../postmortems/261019b-a-figure-without-the-usual-evidence-was-treated-as-no-figure.md).

This article is not re-extracted: that is a production write, and Greg said he is not fussed. Forward
only: existing PDF articles change when re-extracted.
