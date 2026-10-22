---
reports: spya-rg5kk6
ending: shipped
comment: The missing line is "realized that it was impossible to do so exactly." from the top of page 43. Future PDFs now catch this and re-read. Your book needs one stored chunk read deleted, then a Refresh: your call.
---
# A line at the top of a PDF chunk is no longer lost silently

[SPIDERYARN-READING2-K5](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-K5), report #614,
from Greg (admin; `feedback-reporter.ts` exit 0, no addenda), filed as a problem, sent from
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug` about block `spya-ucb0pc`.

> Somehow this paragraph has been cut off.

**Ending: Shipped.** On `dev`, not deployed.

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

**For the existing book:** a Refresh alone will not mend it, because a Refresh replays the stored
chunk readings and only re-reads one that fails *structurally*. To mend it, delete that article's
one `pdf-chunk` checkpoint row for chunk `42|43–48` in production and then Refresh, which re-reads
that chunk (about a cent). That is a production write, so it is left for Greg; we did not
re-extract the article.
