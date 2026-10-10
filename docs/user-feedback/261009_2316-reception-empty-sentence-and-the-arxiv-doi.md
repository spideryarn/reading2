---
reports: spya-qtk3q2, spya-sbj3yk
ending: shipped
comment: Both sentences rewritten to say what happened, and arXiv papers now find their DOI, so Attention gets its Cited by list. Typing a DOI in, or searching by title without one, is a question to you (q-hbg65m).
---
# Reception's empty sentence, and the arXiv paper with "no DOI"

Two admin reports from Greg (`scripts/feedback-reporter.ts` exit 0), filed 2026-10-09 from Sources ›
Reception on `arxiv-1706-03762-spya-wyt7j0` (build `5f6d3d5f`): `spya-qtk3q2`
(SPIDERYARN-READING2-GA, 23:16:36 UTC) and `spya-sbj3yk` (SPIDERYARN-READING2-GB, 23:17:37 UTC).
Queue item `qi-wtq7c6e8`, session `fbqtk3q2-sources-reception-messages`. The plan and both GPT Sol
reviews: [261010n](../plans/261010n-reception-says-plainly-why-it-is-empty-and-finds-an-arxiv-paper-s-doi.md).

> I have no idea what this means.
>
> "The search found 12 pages that might respond to this piece, but none could be checked against
> the words it returned."

> "This piece has no DOI on record, so we cannot look up who cites it."
>
> I can't tell if that means that we tried to find the DOI and failed, or we never tried. If we
> never tried, then we should. Perhaps there's a button, or perhaps it does it automatically. I
> mean, I thought it did that as part of the import process. If we tried and failed, then I suppose
> there should be a way to input it? And is there no way to sort of continue without the DOI?

**Ending: shipped**, on `dev`.

- The empty Reception sentence was one sentence for two cases. It is now three, off counts already
  stored: no pages; pages, and the AI suggested none; the AI suggested some and none passed our
  checks, each check named. The same for an older Claims search.
- An arXiv paper's DOI (`10.48550/arxiv.<id>`) was confirmed at import and then dropped. It is now
  kept, and an article with no DOI whose own address is an arXiv page is asked about by that DOI,
  so the Attention paper's Cited by lists its citers with no change to production data.
- The no-DOI sentence now says we looked, and where.

What stays a question to Greg ([q-hbg65m](questions/q-hbg65m.md), question 2): a way to type a DOI in,
or a title search when a piece has none.
