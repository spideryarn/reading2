# A figure without the usual evidence was treated as no figure

Report spya-x9gn3d (#611), Greg, 2026-10-18, on Rovelli's *The Order of Time* imported as a PDF:

> The text references a diagram here, but I don't see one. How did we lose it? Was it not in the
> original PDF?

The plan and the measurements are in
[261019e](../plans/261019e-uncaptioned-pdf-figures-are-kept.md).

## What happened

The diagram is an embedded bitmap on page 32 of the PDF, and the model reading the PDF emitted a
`figure` record for it, with an empty caption because the book prints none. `renderHtml` in
`src/pdf-read.ts` skipped every record with empty text, figures included. Across the book, the
model emitted 33 figure records, 27 of them uncaptioned, and all 27 were dropped. Nothing recorded
the loss: no block, no marker, no manifest entry, no log line. The reader saw prose saying *"shown
below:"* over nothing.

## The root cause

Two layers, each reasonable alone, combined so that a whole kind of figure fell out silently.

- **The evidence layer.** Every route that attaches a picture to a PDF figure uses the caption as
  its proof of ownership: the bitmap route checks that the page prints it (260924e), and the drawn
  route and the model locator look for it. A caption was the only evidence the design knew how to
  check.
- **The existence layer.** Because nothing downstream could do anything with a figure that had no
  caption, the renderer did not create one. The empty-text skip was the generic one for prose
  records (`if (!text) continue`, since `f68a6016f`, 2026-08-26), and it was later recognised and
  written down as *"v1's boundary rather than an oversight; giving those a media block of their own
  is a separate decision"* (`87359bca9`, 2026-09-06, from a GPT Sol review). Recognised, written
  down, and not given a queue entry or a test that would show the cost.

So **the question "can we prove which picture this is?" was answered at the point where we decide
whether the figure exists at all**, and a "no" there deletes the figure instead of recording an
unrecovered one. Every corpus the PDF work was measured on was papers, which caption their figures,
so the cost of the boundary was zero until the first book.

## The class

**A thing that lacks the evidence a later step needs is dropped at an earlier step, instead of being
kept and reported as unresolved.** An absence then looks like nothing happened, because the step that
would have reported the failure never sees the thing. It is the same shape as
[article-images.md § An image the step never sees](../project/article-images.md#an-image-the-step-never-sees),
where Readability deleted a picture's wrapper before the asset step could count it, and a cousin of
[silent-success.md](../reusable/silent-success.md): the manifest's coverage was perfect over the
markers that existed.

## The fix

**Built (Stage A):** the renderer keeps an uncaptioned figure as a marked, empty `<figure>`; its ref
folds in the page's figure count and the prose either side so its block id cannot move onto another
figure; the pairing gate refuses it as `uncaptioned` by name; and the reader sees the existing *"We
couldn't recover this figure"* note with a link to that page of the original.

**Right for the long term (Stage B, queued for Greg):** recover the picture by position. Keep each
image's paint box and the page's positioned text, and pair an uncaptioned figure only when the prose
before it sits above the picture and the prose after it sits below. The first draft paired by "the
prose either side is on the page", and GPT Sol showed it would have passed 260924e's real wrong
pairing, where the introducing paragraph ends on the claimed page and the picture there belongs to
the previous figure. Position is the evidence that separates the two.

## What would have caught it, ranked by ease against value

1. **Keep the thing, mark it unresolved, and let the step that cannot resolve it say so.** A rule for
   any pipeline step that filters: it may drop what is not the article (furniture, running headers);
   it may not drop what *is* the article because a later step will not know what to do with it. Done
   here for PDF figures. It belongs in
   [article-images.md](../project/article-images.md), where the PDF figure routes are described, and is
   written there.
2. **A known boundary gets a queue entry or a test that measures it, not only a comment.** The
   comment named this exact gap a month and a half before a reader hit it. A test asserting *"a
   captionless figure produces nothing"* existed and passed; it defended the boundary rather than
   counting its cost. [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) is
   the rule, and this is one more instance of it.
3. **Compare the model's figure records with the figures that reached the article**, per import, and
   log the difference. Cheap, and it would have shown 33 against 6 on the first book. Not built here:
   with Stage A the two counts are equal by construction, and the difference that still matters
   (markers against stored pictures) is already in the manifest.
4. A corpus of books for the PDF evals — rejected for now. It would have found this, but it is a large
   piece of work for one class, and rule 1 removes the class rather than detecting it.
