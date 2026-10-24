---
reports: spya-rg5kk6
addenda: spya-zdp62y
ending: shipped
comment: Re-read in production on 23 October: the page 43 line, the page 95 passage and notes 21–93 are back. On 24 October your bookmarks and reading time were moved onto the new paragraphs: 6 bookmarks, all in place.
---
# A line at the top of a PDF chunk is no longer lost silently

[SPIDERYARN-READING2-K5](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-K5), report #614,
from Greg (admin; `feedback-reporter.ts` exit 0), filed as a problem, sent from
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug` about block `spya-ucb0pc`.

> Somehow this paragraph has been cut off.

And his addendum `spya-zdp62y`, 2026-10-22, written before the fix below was deployed:

> Any news on this? Inspect in production, see if you can figure out whether there's something about
> the import that needs fixing/improving.

**Ending: Shipped.** The seam check is deployed (2026-10-23 00:54), and so is the notes fix
(db758ed8). Greg asked for the existing book to be re-read for him
([q-qbfjje](questions/q-qbfjje.md), reply `spya-j4zg9m`), and it was on 2026-10-23 (below).

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

## The re-read, 2026-10-23

Greg's reply to [q-qbfjje](questions/q-qbfjje.md), `spya-j4zg9m`:

> Please reread it for me.

Done in production from 12:52 to 12:59 UTC: the shelf's Refresh from source (`{ slug, force:
["extract"] }`), driven from the box on the deployed code, then its `matter` and `labels`
successors. $0.84 over 111 calls. How it was run, and GPT Sol's two reviews of the driver, are in
[261023c](../plans/261023c-re-read-the-order-of-time-from-its-pdf-in-production.md).

What came back, checked read-only against production and the PDF's text layer:

- **Page 43**: "realized that it was impossible to do so exactly." now ends the paragraph that
  `spya-ucb0pc` was, which has the new id `spya-hfdd9j`.
- **Page 95**: the 51-word passage, "It is the law announced by Clausius…".
- **Notes 21–93**: there were 75 note blocks and are now 143. The five notes reading "53"–"57" are gone.
- **No body text lost**: 6-word shingles of the PDF not found in the book fell from 3,490 words to
  347, and what remains is the copyright page, a publisher's advert and formula fragments spelt
  differently.
- **Figures** (`qi-vq9rwkyy`): 30 of 40 shown, including the cones after "Those of Leonidas are shown
  below" (p.33). 8 uncaptioned ones are refused safely (pp.14, 18, 30, 31, 42, 66, 67 ×2). The two on
  p.57 are "ambiguous", because this reading made two body paragraphs into their captions, so that
  text now shows as a caption.

**What it cost the reader.** Ids are kept only for unchanged or nearly unchanged paragraphs
([block-ids.md](../project/block-ids.md) § Two honest limits). This reading changed 289 paragraphs
(lines gained, paragraphs joined or split at page seams, 24 headings and quotes whose tag changed),
so 834 ids were kept and 289 minted. Greg's 7 bookmarks and 319 reading-time rows are unchanged
row for row, but 5 bookmarks and 85 reading-time places now point at ids not in the current
revision. The question said ids would be kept, and that was wrong; it was not measured before the
run. Moving them is a write to his rows, so it is asked:
[q-xns4gt](questions/q-xns4gt.md).

Greg chose to move them, and on 2026-10-24 they were moved
([261024g](../plans/261024g-repoint-greg-s-bookmarks-and-reading-time-on-the-re-read-order-of-time.md)).
He now has 6 bookmarks on the book, all on current paragraphs, because two had landed on one.
Reading time moved for 77 of the 85 places; the other 8 had no successor and were removed, 33.5
seconds in all.
