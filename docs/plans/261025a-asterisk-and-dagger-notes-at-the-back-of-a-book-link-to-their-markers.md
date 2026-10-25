# Asterisk and dagger notes at the back of a book link to their markers

Report `spya-hrx8z2` (#703), Greg as admin, 2026-10-24, on Rovelli's *The Order of Time*:

> There are a lot of asterisks. I assume they're footnotes or endnotes of some kind. We should be
> picking them up and turning them into links and tooltips, bidirectional links, like we do with
> other footnotes and stuff.

## What production holds

Read only, 2026-10-25, revision `0d152e52` (1,123 blocks). The article is a PDF upload, not an
EPUB: sha256 `a0f74232…`, the same file the 261023b session read.

- The book prints two kinds of note. **Numbered endnotes** (143 of them) are listed and linked
  as designed. **Eleven `*` notes** are listed too, at the end of the notes, still carrying their
  `*` (`* Grammatical note: The word "time"…`), and **not one of them is linked**: the eleven `*`
  markers in the prose (in ten paragraphs) are plain text.
- The PDF's text layer prints those eleven markers on pages 15, 19, 24, 24, 28, 38, 49, 50, 58,
  58 and 119. It prints the notes one to a page, on pages 148–158, in the same order.
- The current transcription (the re-read of 23 October, 36 chunks) has all eleven. The first
  transcription (4 October) had eight: it dropped the markers on page 19 and both on page 24.
- One marker is written `began.*32`: a `*` and note 32's marker side by side.

Nothing of Greg's is on the eleven note blocks: no comment, no reading time.

## Why they are missed

`findMarkers` in [`src/pdf-read.ts`](../../src/pdf-read.ts) already takes `*`, `†`, `‡`, `§` and
`¶` as labels. The notes are printed on pages with no prose, so it treats them as **endnotes**:
each one searches forward from a cursor and takes the first match. But **every endnote shares one
cursor**. The 143 numbered notes come first in note order, and they have walked the cursor to
note 143's marker, near the end of the prose, by the time the `*` notes look. Past that point
there is no `*`. And `began.*32` refused the `*`, because a digit follows it.

Giving each series its own cursor is not enough on its own, and this is the subtle part. A number
names its note, so a missing `13` costs one link. A `*` names nothing. Taken in order with one
marker missing, every note after the gap gets the next note's marker. On the 4 October reading,
today's code does exactly that once: it links the grammatical note to "immortal souls.*", the
Reichenbach note's marker. That is the shape [silent-success.md](../reusable/silent-success.md)
warns about.

## The change

All in `findMarkers`, `candidatesIn` and the extract stage's call to `renderHtml`. No prompt
change, so no import pays and no cached chunk goes stale.

1. **A cursor per series.** Numbers stay separated by kind (footnote, endnote), as before. Symbol
   footnotes keep their page-local rule: link only when exactly one place on the note's own page
   reads as its marker.
2. **Symbol endnotes are paired with the markers the text layer prints** (`symbolEndnotes`).
   For each exact label (`*`, `**` and `*†` are different series):
   - The printed markers are the label written as a marker on the pages **before the series'
     first note**, read through `baselineFor`, so running headers and footers are out. There must
     be exactly as many as notes, and the k-th printed marker is the k-th note's.
   - **Each printed marker is found in the transcription by the word it is glued to** (`effect`
     for `“effect.”*`), on its own page or one either side. A link is made only when exactly one
     transcribed place answers to it, no other printed marker answers to that place, and the
     resolved places remain in the text layer's order. The model put "one of these fields.*" on
     page 51, and the text layer prints it on page 50. A dropped marker leaves its own note
     unlinked and moves nothing else.
   - The series is left unlinked **without a text layer** (a scan). It is also left unlinked
     **when the transcription has the symbol on a page whose text layer has no letters**, and
     **when the same symbol also marks a footnote on its own page**. A symbol at the start of a
     text-layer line also leaves the series unlinked: without glyph geometry it may be a
     superscript belonging to the preceding line or an unrelated bullet.
3. **A symbol followed by a digit** (`began.*32`) is a symbol marker. A symbol run must be exactly
   the label, so `*` is not found inside `**`. The `32` stays unlinked, as it was today.
4. A linked symbol note loses its leading `*` in the list. That is the existing rule (the marker
   draws the label), and the view already shows a `*` label as it is (`NUMBERISH` in
   `src/web/notes-view.ts`).

### What GPT Sol's plan review changed

[The review](261025a-asterisk-notes-plan-review-sol.md). The first plan paired each page's
places with that page's printed markers **by count**, and fell back to the transcription's own
count for a scan. Sol showed that counts alone prove nothing (F4). Take one real marker printed
inside an image, missing from both readings, and one emphatic `significant*` that both have: they
balance, and the note links to the emphasis. So:

- the scan fallback is gone;
- the pairing is by the word each marker is glued to;
- the counted pages stop before the first note (F7);
- the run of symbols must equal the label exactly (F3);
- the same symbol used for page footnotes fails closed (F2);
- an image-only page holding a transcribed marker fails closed (F6).

The first plan also let a number follow a symbol, to link `*32`'s `32`. That would newly link
`word*3` in an article with no symbol notes at all (F8), so it was dropped. F9 is below, under
the ids.

F6 as Sol wrote it refused whenever any page before the notes had prose but an empty text layer.
On Rovelli that refused the whole book, because the title page is an image the model transcribed.
So it refuses only when such a page holds a transcribed marker. A marker that both readings miss
falls into the residual below.

### What GPT Sol's code review changed

The built matcher let the one-page tolerance reverse two adjacent markers: source `first.*` then
`second.*`, transcription `second.*` then `first.*`. Both matches were unique in both directions,
but both notes were linked backwards. Resolved transcription places must now remain in source
order, or the series is left unlinked.

It also silently ignored a symbol that began a text-layer line. One missing real marker plus one
unrelated `word*` could then balance the count and link the unrelated symbol. A line-start symbol
now invalidates the series; deciding whether it is a superscript from the preceding line needs the
glyph positions this path deliberately does not carry.

**The residual, named:** a real marker the text layer does not print, and a non-note `word*` with
the same glued-to word on a page next to it, could still swap. Only the glyph's position on the
page could rule it out, and that would be a second reading of the PDF.

### Simpler options passed over

- **Order alone, with separate cursors.** Wrong links whenever one marker is missing, as above.
- **Order, gated on the transcription's count only.** A count can balance a miss with an extra
  (Sol F4). And on the 4 October reading it links nothing.
- **Word overlap between a note and its marker's paragraph**, to find the gap. Measured on
  production's blocks: the signal is far too weak. The "In motion" note scores highest against
  the paragraph of the grammatical note.
- **Writing a dropped marker back into the prose.** That changes the block's text, and so its id
  (`exactKey`, src/blocks.ts).

## Measured

All read-only. The scripts are in this worktree's `data/261025a/` and are not committed.

- **Rovelli, production's current readings (36 chunks), with the PDF's text layer: 11 of 11 `*`
  notes linked**, each checked by eye against the book's order. That includes the teaspoon note
  on "…different from the future.*". The 125 numbered links are unchanged.
- **Rovelli, the 4 October readings: 8 of 11**, all right. The three whose markers the model
  dropped are listed unlinked. Today's code made one wrong link there.
- **Every PDF in production (33 articles, 493 stored chunks), old against new, without a text
  layer: 32 render byte-for-byte the same.** The 33rd is a second copy of *The Order of Time* on
  Greg's shelf, where the change removes the same wrong link.
- Sol's F10, about marker ids for articles without symbol notes, follows from that: identical
  HTML means identical ids.
- Re-run after the code review's two fixes, which touch only the text-layer path: still 11 of 11
  on the current readings, and 8 on the 4 October ones.

## What it does to existing articles

Nothing until an article is extracted again. **The ids are not all kept on re-extraction**, and
Sol's F9 corrects the first plan here. Stage 3 keys a block on its words **and the notes it
cites** (`withoutNoteControls`, src/blocks.ts), so a citation pointing somewhere new is a new
block.

- A paragraph that cited no note before carries its id across the legacy bridge.
- A paragraph that already cited a numbered note and now also cites a `*` note gets a fresh id.

On *The Order of Time*, that is four of the ten marker paragraphs: `spya-zras7z` (46 seconds of
Greg's reading time), `spya-mvnpew` (103 s), `spya-adejvw` (253 s) and `spya-xsqyfm` (none),
about 400 seconds in all. No comments. The eleven note blocks lose their `*` in the extracted
HTML, but the folded-text carry-through may preserve their existing ids; nothing of Greg's is on
them.

So **this book is not re-extracted without Greg's yes**. His bookmarks and reading time were moved
to this revision's ids yesterday (261024g). The question is filed alongside the note.

## Stages

1. Failing tests in `tests/pdf-footnotes.test.ts`, red first (6 red before the fix).
2. The change.
3. The replays above, `npm test` and `npm run typecheck`.
4. A line in [content-extraction.md](../project/content-extraction.md) beside the 261023b
   paragraph.
5. GPT Sol code review, push to `dev`, the note, and the question about re-extracting this book.
