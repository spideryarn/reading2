# Endnotes typed as references are kept as notes

Addendum `spya-zdp62y` to report `spya-rg5kk6` (#614, SPIDERYARN-READING2-K5, queue item
`qi-h9gv4pf8`), Greg, 2026-10-22, on *The Order of Time* (a PDF):

> Any news on this? Inspect in production, see if you can figure out whether there's something about
> the import that needs fixing/improving.

The report itself (a line lost at the top of page 43) shipped as
[261022h](261022h-a-line-at-the-top-of-a-chunk-is-not-lost-at-the-seam.md). This is the wider look
he asked for: the same book in production, read-only, every page, and what it says about the import.

## What production holds

Read on 2026-10-23 inside `begin read only … rollback`: the article's 33 `pdf-chunk` checkpoint rows
(all written 2026-10-04 20:19–20:21 UTC, the first import), its current revision's 1,046 blocks, and
the source PDF (sha256 `a0f74232…`, checked). Scratch scripts and dumps are in the session's
scratchpad and are not committed.

Two independent passes:

1. **Today's gate over the stored readings** (as `checkChunk` scores them). The seam rule from
   261022h fires on exactly one of the 35 seams, `42|43`, with the line Greg found. Every other
   failure is either `\(` markup (the maths feature) or a stray note number, except `90|91–96`:
   two missing runs, the longest 39 words.
2. **The published article against the PDF's text layer**, page by page, in 6-word shingles,
   independent of the gate. Runs of 8+ words that are nowhere in the article:

| page | what is missing | why |
|---|---|---|
| 43 | "realized that it was impossible to do so exactly" | 261022h's seam; caught by the gate since 2026-10-22 |
| 95 | 51 words, "It is the law announced by Clausius (ΔS ≥ 0) and deciphered by Boltzmann that is guiding us …" | the model dropped it mid-page; today's gate fails the chunk (above), so a fresh read is asked again |
| 129–134 | **endnotes 21–93, about 4,000 words** | the model typed them `reference` (below) |
| 3, 126, 147 | copyright page, image credits, a publisher's advert | dropped by design |
| 127, 137 | short TeX and label fragments | spelt differently, not lost |

And one oddity that is not a loss: the notes list ends with five notes whose whole text is `53`,
`54`, `55`, `56`, `57`.

## The two faults in the import

### 1. A page of endnotes typed `reference` is thrown away

Rovelli's notes run 1–132 over pages 127–137, with a chapter heading before each group. The three
chunks read them as:

```
126|127–128   footnote  1 … 20
128|129–134   reference 21 … 93     ← every record, on every page
134|135–137   footnote  94 … 132
```

`reference` is not in `RENDERED` (src/pdf.ts § RecordType: transcribed so the gate compares like with
like, then dropped, because a reference list is not shown), so seventy-three notes were transcribed,
passed the gate, and vanished. Their markers in the prose (`…time21`) link to nothing. Bibliography
mode is not affected either way: it reads a PDF's reference list from the text layer
(bibliography.md § A PDF's reference list is read from its text layer), not from these records.

The sister case already has a repair: `endnotesTypedAsProse` (261004j) gives back a page of endnotes
the model typed `paragraph`. It deliberately leaves alone a page with a heading or a `reference` on
it, which is both of Rovelli's.

**The class:** text the model labelled with a type we transcribe-then-drop, lost after the gate,
because the gate counts every transcribed word whatever its type. 261004j was the mirror image
(notes shown as prose).

### 2. A note marker split out as a `footnote` record becomes an empty note

On pages 55–59 the model emitted each marker as its own record between two paragraphs:
`paragraph "…is not new."`, `footnote "53"`, `paragraph "The idea probably…"`. `collectNotes` makes a
note of any non-empty `footnote` text, so the reader gets five notes at the end that say only "53"
… "57", and the markers in the prose are gone.

### How common

A census of every `pdf-chunk` checkpoint in production (457 rows, 33 articles): **only Rovelli**
has either shape (73 chained `reference` records; 5 bare-label `footnote` records). Rare, but the
first loses a book's notes silently, and books are where endnotes live.

## The fix

Both in `renderHtml`'s one seam (src/pdf-read.ts), beside `endnotesTypedAsProse`: no prompt or
schema change, so no checkpoint goes stale and no import pays.

1. **`endnotesTypedAsReferences`.** A `reference` record is retyped `footnote` when its numeric label
   is exactly one more than the last note's label, and that last note is on the same page or the
   one before. The last note is a `footnote` record or a reference already retyped, so the chain is
   anchored on something the model itself called a note. An unlabelled `reference` marked
   `continues` right after a retyped note joins it (as a `footnote` continuation). Headings and
   `publisher` furniture between them neither break the chain nor are moved; they stay where they
   are, as they already do on pages 127 and 135–137. Anything else breaks it: a `reference`
   whose label does not follow, or a label-less one that does not continue.

   Why this is safe where 261004j had to be narrow: 261004j's wrong direction moves the author's
   prose out of the body. Here the wrong direction moves a reference entry, which no reader is
   shown, into the notes list. And a real reference list does not continue a note sequence: it
   starts at 1 or `[1]`, so its first entry breaks the chain and nothing after it is touched.

2. **A `footnote` whose text is only a label is not a note.** `collectNotes` skips it. The marker
   is not put back into the paragraph before it: that needs the label to be a marker rather than a
   folio or a stray number, and gluing a wrong digit into the author's sentence is worse than the
   missing link. Passed over, below.

The rule as built is narrower than this first draft (§ Plan review): a `Notes` section must be open,
and a labelled `continues` record and a split label are handled in `collectNotes`. Measured results
are in § Measured.

## What this does not do, and the simpler options passed over

- **A prompt change** ("endnotes are `footnote`, even under chapter headings"). It would re-key every
  checkpoint, and the model gets it right in two of Rovelli's three notes chunks already. A
  deterministic repair on strong evidence is cheaper and is what 261004j chose.
- **Showing every `reference` record as a note.** Simpler, but a real reference list would then
  appear twice, as notes and in Bibliography.
- **Putting a split-out marker back into the paragraph before it.** It would restore the link for
  "53"–"57". Not built: the evidence that a bare number is a marker rather than a folio is weak,
  and five unlinked markers in one book do not justify the risk.
- **Nothing for page 95.** Today's gate already fails that chunk and asks again; that is the
  existing path, not a new one.
- **The existing book is not mended by this commit.** It needs a re-extraction, which is Greg's call.
  The earlier note's advice was to delete chunk `42|43–48`'s checkpoint row and Refresh. That advice
  is now **out of date, and the delete is unnecessary**: the reader id (`openai/gpt-6-luna/pdf-v5`)
  and the prompt text are both in `chunkKey`, and both changed after this book was read
  (`gpt-5.6-luna/pdf-v4`), so the first successful Refresh finds none of the 33 stored readings and
  reads all 36 chunks again (an upload's Refresh forces `extract` from the stored source, Sol F5). Measured: today's code mints 0 of 36 of the stored keys, the code as of 82f42fac3
  (2026-10-04) mints 33 of 36. A full re-read costs roughly 36 chunk calls, about the price of a new
  import. It also serves `qi-vq9rwkyy` (re-import Rovelli to check its uncaptioned figures).

## Plan review, and what changed

GPT Sol, BUILD WITH CHANGES
([plan-review-sol](261023b-endnotes-typed-as-references-plan-review-sol.md)). All seven taken:

- **F1** Rovelli's note 122 is labelled but marked `continues`, so `collectNotes` appended it to 121.
  Now `startsNote`: a `continues` record whose explicit label is the last note's plus one starts a
  note. A plain number and space is not explicit enough—note 39 may continue "40 per cent…"—but
  Rovelli's `122.` and superscript labels are (tested).
- **F2** "anchored on a footnote" was not enough: a page footnote 20 followed by a numbered list
  continuing at 21. The repair now runs only inside a `Notes`/`Endnotes` section, closed by a
  `References`/`Bibliography` heading, and a symbol-labelled footnote ends the run.
- **F3** Runs after `endnotesTypedAsProse`, so a note that repair gave back can anchor a run. The gate
  and `bibliographyPages` see the original types (both run before render); indexes do not move.
- **F4** A bare label followed by an unlabelled `continues` footnote is one note split across two
  records, not a stray: the label is held, and joined to that continuation or dropped. Substantive
  content clears it; only publisher furniture is transparent between the two pieces.
- **F5** Wording: "the first successful Refresh" rather than "a Refresh".
- **F6** The transitions it listed are tests now.
- **F7** A postmortem, and lint on the touched files.

## Code review

GPT Sol, SHIP WITH THE FIXES MADE
([code-review-sol](261023b-endnotes-typed-as-references-code-review-sol.md)). Both of its findings
were fixed by Sol, and I re-checked them:
it narrowed `startsNote` to explicit labels (F1 above), and made a held bare label clear on
substantive content (F4 above). Each has a test that was red before its fix.

## Measured

Rovelli's 33 stored readings replayed through `renderHtml` (data/261023b/replay-notes.mts, records in
page order with each chunk's context page dropped; not the stage's cross-chunk dedup):

| | before | after |
|---|---|---|
| notes listed | 75 | 143 (132 numbered, 1 unnumbered "Grammatical note", 10 `*` footnotes) |
| notes that are only a label | 5 | 0 |
| markers linked | 16 | 37 |

Of notes 21–93, 20 of 73 now link; of the notes typed correctly, 16 of 59 do. The rest of the
unlinked ones are mostly **markers missing from the prose altogether** (30, 4 and 6 appear nowhere in
the published text): the model left them out of the transcription. That is a separate weakness, not
built here.

## Stages

1. Failing tests in tests/pdf-footnotes.test.ts, red before the fix: the Rovelli shape (footnotes,
   a heading, references continuing the numbers, a heading, footnotes again), a continuation, and
   the quiet cases (a reference list after notes that restarts at 1; a reference with no preceding
   note; a label that skips; a page gap); and the bare-label note.
2. `endnotesTypedAsReferences` and the `collectNotes` skip.
3. Replay Rovelli's 33 stored readings through `renderHtml` before and after; count notes, empty
   notes and linked markers. `npm test`, `npm run typecheck`.
4. A line in content-extraction.md beside the 261004j paragraph.
5. GPT Sol code review, push to `dev`; the note's `addenda:` line and comment updated; the question
   to Greg about the Refresh.
