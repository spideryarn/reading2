---
reports: spya-dktkem
ending: shipped
comment: Poems quoted in a PDF now keep their lines. The Order of Time needs a Refresh to pick it up (the chunk reads are reused, so it costs nothing). Verse the PDF reader typed as paragraphs is queued.
---
# Poem quotes in a PDF keep their line breaks

[SPIDERYARN-READING2-JK](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-JK), report #597,
from Greg (admin; `feedback-reporter.ts` exit 0), filed as a suggestion, sent from
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug` at block `spya-ht3hns`.

> Have we somehow lost or messed up the line breaks for these quotes?

**Ending: Shipped.** On `dev`, not deployed.

A real bug, in the reading view rather than the data. The quotes are the block quotes in the prose
(the Saadi poem right after `spya-ht3hns`, and the Horace odes through the book). The PDF reader had
kept each line as a newline; the renderer put it into the `<blockquote>` as it was, and HTML draws a
newline as a space, so every poem read as one paragraph. Nothing was lost, and it had never been
shown.

The model also writes newlines where a prose quote merely wrapped at the page width, so drawing all
of them would have broken prose mid-sentence. A PDF quote's newlines become `<br>` only when the
lines look like the author's: the typesetter's test, could the next word have fitted. On 39 real
quotes from Greg's PDFs it caught 22 poems, every one correct; the rest look as they did. Text, ids
and caches do not change. Plan, measurements and both GPT Sol reviews:
[261018d](../plans/261018d-a-poem-quoted-in-a-pdf-keeps-its-line-breaks.md).

**For the existing book:** the fix applies when an article is next extracted. A Refresh of *The Order
of Time* should re-render it, with the paid-for PDF chunk reads replayed from checkpoints rather than
bought again. We did not run that on production ourselves.

**Not done, and queued as `qi-dfkacw59`:** verse the PDF reader typed as *paragraphs* (the
*Dhammapada* on the shelf, addresses, author lists). The same test gives false positives on
paragraphs, so it needs a better one. Quotes mode still shows a chosen quote's words on one line,
because it reads the block's collapsed text by design.
