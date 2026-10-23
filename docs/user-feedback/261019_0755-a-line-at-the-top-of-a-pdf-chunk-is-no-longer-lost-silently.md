---
reports: spya-rg5kk6
addenda: spya-zdp62y
ending: shipped
comment: The missing line is from the top of page 43, and future PDFs now catch it. Looking further found notes 21–93 dropped too (fixed on dev) and a passage on page 95. A Refresh after the deploy re-reads the whole book; nothing needs deleting.
---
# A line at the top of a PDF chunk is no longer lost silently

[SPIDERYARN-READING2-K5](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-K5), report #614,
from Greg (admin; `feedback-reporter.ts` exit 0), filed as a problem, sent from
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug` about block `spya-ucb0pc`.

> Somehow this paragraph has been cut off.

And his addendum `spya-zdp62y`, 2026-10-22, written before the fix below was deployed:

> Any news on this? Inspect in production, see if you can figure out whether there's something about
> the import that needs fixing/improving.

**Ending: Shipped.** The seam check is deployed (2026-10-23 00:54); the notes fix is on `dev`, not
deployed. Re-reading the existing book is Greg's call:
[q-qbfjje](questions/q-qbfjje.md).

A real loss. `spya-ucb0pc` ends *"…and the moment at which Einstein"*; the PDF finishes the
sentence on the first line of page 43, *"realized that it was impossible to do so exactly."*, and
that line has been missing in every revision since the first import (2026-10-04). Page 43 is the
first page of a chunk the PDF reader sends with page 42 as context, and the model's reading left
the line out. The quality check let it through: it ignores a missing run whose words all appear
elsewhere in the chunk, and nine common words always do. Fresh reads of that chunk keep the line,
and the rest of the stage handles it correctly.

The fix is a new check. When the context page stops mid-sentence and the transcription does not
open with the next page's first words, the chunk is read again, and a second miss is published with
a quality note. Measured on 44 real seams in five PDFs: it fires on the production shape and on no
correct reading. Plan, measurements and both GPT Sol reviews:
[261022h](../plans/261022h-a-line-at-the-top-of-a-chunk-is-not-lost-at-the-seam.md).

## The addendum: the whole book, in production

Read-only, 2026-10-23: the book's 33 stored chunk readings, its published blocks, and the PDF.
Comparing the published text with the PDF's text page by page, the body is missing only two things:
page 43's line, and **a 51-word passage on page 95** ("It is the law announced by Clausius…") that
the model skipped mid-page. Today's quality check already fails that chunk and asks again, so a
fresh read should bring it back. No other seam fires the new check.

The import bug: **notes 21–93 were gone**. The model typed that chunk's endnotes as `reference`,
which is transcribed and never shown, so they passed the check and vanished; and five markers split
out of their paragraphs became notes reading "53" … "57". Both are fixed in how the book is
assembled, with no prompt change. Across all 33 PDFs in production only this book has either shape:
[261023b](../plans/261023b-endnotes-typed-as-references-are-kept-as-notes.md).

**For the existing book**, the earlier advice here (delete one stored reading, then Refresh) is
out of date, and the delete is unnecessary. The book was read with an older model and prompt, both
part of a stored reading's key, so the first successful Refresh finds none of them and re-reads all
36 chunks (checked: today's code finds 0 of 36, the 2026-10-04 code 33). After the notes fix is
deployed, that one Refresh should mend all three. It is a production write, so it is Greg's.
