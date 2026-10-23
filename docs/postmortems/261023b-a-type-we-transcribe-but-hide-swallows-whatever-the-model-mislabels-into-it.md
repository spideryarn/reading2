# A type we transcribe but hide swallows whatever the model mislabels into it

Carlo Rovelli's *The Order of Time*, imported as a PDF on 2026-10-04, lost **seventy-three of its
132 endnotes, about 4,000 words**, and nothing reported it. Its markers 21–93 in the prose linked to
nothing. This reached a reader: it was in production from the first import until a re-extraction,
and was found on 2026-10-23 only because Greg asked for a wider look after an unrelated report
(`spya-rg5kk6`, addendum `spya-zdp62y`). The plan with the production evidence is
[261023b](../plans/261023b-endnotes-typed-as-references-are-kept-as-notes.md).

Parent: [postmortems.md](../project/postmortems.md).

## What happened

The PDF reader asks a model to transcribe every page and to label each record with a type
(`src/pdf.ts` § `RecordType`). Some types are transcribed only so the quality gate can compare like
with like, and then never shown: `RENDERED` leaves out `reference`, `cover` and `publisher`.
Footnotes have been shown, as notes at the end, since 2026-09-30.

Rovelli's notes run 1–132 over pages 127–137, with a chapter heading before each group. Three chunks
read them, and the middle one typed every note on its pages as `reference`:

```
126|127–128   footnote  1 … 20
128|129–134   reference 21 … 93     ← every record, on every page
134|135–137   footnote  94 … 132
```

The chunk passed the gate, the seventy-three notes were dropped at render, and the reader got a
notes list that went from 20 to 94. A census of all 457 stored `pdf-chunk` readings across the 33
production PDFs found no other article with this shape, so it is rare. But books are where endnotes
live, and when it happens it takes a whole run of them.

## The class, named

**A type we transcribe but never show is a silent sink: whatever the model mislabels into it passes
the gate and vanishes.** The gate counts every transcribed word whatever its type, which is exactly
why the hidden types exist (so the gate can be tight). The same property means a record typed
wrongly into a hidden type scores as perfectly read. Nothing downstream compares what the gate
counted with what the reader sees.

It is the third instance in a month at one boundary, the line between the types we show and the
types we hide:

- [261001b](261001b-pdf-tables-and-figures-withheld-by-a-one-thing-rule.md): `tabledata` was in the
  hidden set by default, so every table's cells were transcribed, scored and dropped.
- 261004j ([plan](../plans/261004j-footnote-digits-census-root-cause-and-re-import-measurement.md)):
  the mirror image, where endnotes typed `paragraph` were shown as body prose.
- This one: endnotes typed `reference` were hidden.

It is a case of [silent success](../reusable/silent-success.md): the gate reports a faithful
transcription, and it is right about the transcription.

## Which commits introduced it

- **`1e45f8d0f`** (2026-08-26, *"Tell the baseline the same things we told the model"*) added
  `footnote`, `reference` and `cover` as types that are *"transcribed and then thrown away"*, so the
  check could be tight. That was safe then: footnotes and references were both hidden, so the model
  confusing one with the other cost nothing.
- **`ebee390cd`** (2026-10-01, *"a PDF's footnotes are shown at the end and linked from their
  markers"*, plan 260930k) is where the gap opened. Showing footnotes and still hiding references
  turned the footnote/reference boundary from one between two hidden types into one between
  shown and hidden. A mislabel across it now lost text. The plan measured footnotes the model had
  typed correctly. It did not ask what the model types a note as when it gets it wrong.
- **`8f576723b` / `82f42fac3`** (2026-10-04, 261004j) repaired the `paragraph` direction and
  deliberately left alone any page with a heading or a `reference` on it. That narrowness was right
  for its purpose, since its wrong direction moves the author's prose into a note. But it means
  Rovelli's pages, which have both, were looked at and passed over. Rovelli was read the same
  evening, about ninety minutes after them.

## Why nothing went red

- **The gate is designed not to care about types.** Recall against the text layer counted all 4,000
  words as present. `unshown` faults report only markup or invented values in hidden text, not its
  quantity.
- **`renderHtml` returns HTML and nothing else.** It does not count notes, label gaps or markers
  left unlinked, so a list that jumps from 20 to 94 is not an error anywhere.
- **An unlinked marker looks like text.** `time21` in the prose is a bare digit, which the reader
  takes for a typo, if they notice it at all.
- **The tests were built from correct labels.** The footnote fixtures came from model output where
  notes were typed `footnote`. A test built on the model's usual labelling agrees with code that
  relies on it.
- **The sibling repair was a reviewed, deliberate exclusion, not a miss.** 261004j's reviewers asked
  for it to be narrow, and they were right. Nobody asked what a page it refused would do, because it
  did not depend on the repair: leaving a page alone counted as safe. For a page of hidden records,
  leaving it alone meant losing it.

## What would have caught it, ranked by ease against value

1. **A note-sequence check at render.** After `collectNotes`, the numeric labels of a section should
   go up one at a time. A jump forward of more than one (20 → 94 here, 17 → 33 on 261004j's paper)
   means notes went missing, wherever the model put them. Log it per import, and add it to the import's
   warnings. This is aimed at the class rather than the route, because it watches the output and does
   not care which sink swallowed the notes. Not built in this commit. Worth a queue item.
2. **For any new repair that refuses a case, ask what the refused case becomes.** If the answer is
   "hidden", the refusal is not the safe default it looks like. This costs nothing and would have
   flagged Rovelli's shape on 2026-10-04.
3. **When a type moves from hidden to shown, survey what the model types its neighbours as.** A query
   over the stored readings, counting `reference` records after a `Notes` heading or continuing a
   footnote's numbers, takes minutes. The census for this postmortem was that query, three weeks
   late.
4. A per-import report of words by hidden type, flagged when the share is unusual. Not recommended:
   a book's bibliography is legitimately thousands of `reference` words, so a share threshold cannot
   tell a reference list from mislabelled notes. Item 1 can tell them apart.
5. A prompt change telling the model that endnotes are `footnote` even under chapter headings.
   Rejected for now: it re-keys every stored reading, so every re-import pays, and the model got it
   right in two of Rovelli's three notes chunks. Worth reconsidering if item 1 shows this is not rare.
6. Making the gate type-aware. Rejected: the baseline is the PDF's text layer, which has no types, so
   there is nothing to compare a label against.

## The fix that is right for the long term

**What shipped** (261023b): `endnotesTypedAsReferences` in `src/pdf-read.ts`, beside
`endnotesTypedAsProse`. Inside a `Notes` section not yet closed by a `References` heading, a
`reference` whose label is the last note's plus one, on its page or the next, becomes a note. This
is a render-time repair: no prompt change, no stale checkpoint. It is the right repair for this
route. It is not a fix for the class, because each sink and each direction needs a repair of its own
(`paragraph` in 261004j, `reference` here, and nothing yet for `cover` or `publisher`).

**What would close the class**: the note-sequence check (item 1), so that the next route is reported
the first time it happens rather than found by hand. And, separately, a way to re-render an article
from its stored readings. Every render-side repair so far (tables, 261004j, this one) has left the
articles already in production broken until a paid re-read, because the readings' cache key includes
the prompt and the reader id, and those change for other reasons. Rovelli's 33 stored readings are
still there, and this repair works from the readings alone, but a Refresh will not use them: it
reads all 36 chunks again.

## Two smaller faults, not this class

Found in the same book and fixed in the same commit, recorded so nobody reads them as part of the
class above:

- **A bare marker split out as a footnote became an empty note.** On pages 55–59 the model emitted
  `footnote "53"` … `"57"` as records of their own between paragraphs, and `collectNotes` listed
  five notes whose whole text was a number. A record that is only a label is now held, and joins the
  next record if that is an unlabelled continuation; otherwise it is dropped (`BARE_LABEL`).
- **`continues` was trusted over the label.** Note 122 was labelled but marked `continues: true`,
  and would have been merged into 121. A record whose label is the next number now starts a note
  (`startsNote`). GPT Sol found this in plan review, F1.

Both are the same smaller shape: a structural flag from the model was taken over the evidence in the
text itself.

## The thing I would tell myself

Hidden types were invented so the gate could be tight, and that worked. The price is that the gate
cannot see a mislabel into one, and we paid it the day footnotes were shown and references were not.
When a repair says "leave this page alone, it might not be notes", check what leaving it alone means.
For a page the reader will see, it means no harm done. For a page of hidden records, it means the
page is lost.
