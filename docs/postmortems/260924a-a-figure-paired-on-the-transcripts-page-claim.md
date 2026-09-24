# A figure paired on the transcript's page claim

**Cost: a reader's article showing pictures under the wrong captions, found only because one of
its other figures was missing.** Greg asked why *Thorpe's "Local Code" Example* could not be
recovered. The answer was that the figure after it had been given its picture.

## What broke

Chris Olah's essay, printed to PDF from a browser and uploaded, has four captioned figures. Each is
a PNG with its title drawn inside the image, and Chrome's print pushed each one onto the page after
the paragraph that introduces it. The transcriber gave each figure record the page where that
paragraph ends, one page early. The bitmap route then did what it was designed to do. Page 1 had
no picture, so "Local Code" was caption-only. Page 2 had one marker ("Semi-Local") and one picture
(the *Local* diagram), so it attached them. Page 3 did the same with the Semi-Local diagram under
"Highly Distributed". Nothing reported an error, and the two swaps look exactly like success.

Reproduced from a rebuilt PDF, since this session has no production access;
[260924e](../plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md) has the table.

## The real root cause

`pairPageFigures` ([`src/pdf-figures.ts`](../../src/pdf-figures.ts)) used the page as a **join
key** between two sources: the transcript's figure records and pdf.js's decoded images. One side
of that key is a measurement: pdf.js knows which page an image is painted on. The other side is a
**model's claim**: the schema asks for "which page of the attached PDF file this came from", and
nothing checks the answer. The gate's strictness, one marker and one picture or nothing, guarded
against ambiguity *within* a page. It had no defence against the page itself being wrong, because
the page was treated as a fact.

The Fable ruling that set the policy, *a wrong figure is worse than no figure*, was right, and it
was applied to the wrong unit. It made the pairing strict and left the key it pairs on unchecked.

## The class

**An unverified model claim used as a join key.** A value the model produced goes into an
equality join with a value we measured, and the join's output is shown as fact. The join works
exactly as well as the claim, and a wrong claim gives a confident wrong join, not an error. It is
a cousin of [silent-success.md](../reusable/silent-success.md): the pairing reports success because
the check (one of each) shares its assumption (the page is right) with the code.

Other places this shape exists or could: anything that joins transcript records to the PDF by
page (seam-hyphen mending already *checks* the claim against pass 0's text layer, which is the
right pattern); and any feature where a model names the block or passage its answer came from.

## Which commit introduced it

`0297784f` (2026-09-06, *The rule that decides whether a reader sees a figure, with no threshold in
it*), stage A of
[260906a](../plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md). The `page` field
it relies on dates from `f68a6016` (2026-08-26). The plan's corpus was academic papers, where the
caption is printed beside the figure on the same page, so the model's page and the picture's page
always agreed and the assumption never showed.

## The fix, and the one that is right for the long term

Shipped: the join now needs corroboration from the measured side. A picture attaches only if its
page's text layer contains the caption (`captionPrintedOn`); otherwise the marker is refused
`caption-not-in-page-text`. It lost none of the 12 correct figures measured locally and refused
both swaps.

That is a patch on the key, and it does not settle the question. A page can print the caption and
still hold an unrelated picture while the real figure is on the next page. The right long-term fix
is to join on **position** rather than page number: record where each image is painted, and
require the picture to sit next to the caption located on the page, or, where there is no printed
caption, have a model look at the rendered pages and say which picture, then check that answer
against the paint boxes. That is stage 2 of the plan, left for Greg because it adds a paid call.

## What would have caught it, ranked by ease against value

1. **Before joining on a model-produced field, name which side is measured and check the claimed
   side against it.** A habit that costs nothing, and the seam-hyphen code already follows it.
   The drawn-figure route, written a week later, did check: it refuses a caption it cannot find on
   the page. The bitmap route was never brought up to that standard.
2. **A corpus document whose layout differs from the plan's corpus** — a browser-printed web page,
   in this case. The eval PDFs are all academic papers. One printed web essay with a figure pushed
   past a page break would have shown the swap on the first run. Cheap: this session's rebuilt
   essay is ~450 KB and could become an eval fixture, licence permitting (the essay is © Anthropic,
   so this is not done here).
3. A model call to verify every pairing (stage 2 run on successes too): catches the residual case
   as well, at about $0.002 per figure on every PDF. Left to Greg; not rejected, but it is the
   expensive end.
4. Asking the transcriber for the figure's page more carefully (a prompt change): rejected as the
   fix. It lowers how often the claim is wrong, and it would still be an unchecked claim.
