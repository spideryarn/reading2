---
reports: spya-tsd470
ending: shipped
comment: Hovering a reference entry now lists every paragraph that cites it, each a jump. A work cited directly in the text more than three times is found only three times so far; that fix is queued.
---
# From a reference entry, jump back to where it is cited

Report `spya-tsd470` (#503), SPIDERYARN-READING2-FE, Greg (admin, provenance proved by
`feedback-reporter.ts`), 2026-10-09 01:11 UTC, a suggestion, filed from
`/read/arxiv-1706-03762-spya-wyt7j0?mode=citations…`:

> When it comes to citations, I often want to be able to jump back from the list of references to
> the places where it's cited. Do we already have this information if Citations mode has been run?
> If so, could we somehow add or annotate (maybe in the Marginalia next to a citation in the
> references section, or with an underline-hover-tooltip) to enable us to jump back to the place
> where it's referenced?

**Shipped**, to `dev`. Yes, we already had it: each work stores the paragraphs that cite it, and
the reference entry was already underlined and already opened the citation card, which said only
*cited in N paragraphs*. Now that count is followed by numbered jumps, 1 to N in document order.
Each number previews its paragraph on hover. A press flashes the citing words, or the paragraph
where it has none, and Back returns to the entry. The underline-and-card route was taken. A line
in Marginalia beside every reference entry was passed over for the margin's density.

**The half still queued**: a work cited directly in the text (an arXiv `[12]`, or an author–year
citation) keeps at most three mentions, so its fourth citing paragraph onwards is missing. The card
then says *cited in at least 3 paragraphs* rather than overclaim. Works cited through footnotes
(Wikipedia) are complete. Queue item `qi-5j4zezve`.

The plan, both GPT Sol reviews and the browser checks:
[261009e](../plans/261009e-citation-card-jumps-back-to-every-passage-that-cites-the-work.md).
