# Local evidence cannot prove an article-wide classification

Review of `8f576723ba0d8d37cb9a74462e297332c168d3d3` on 2026-10-04 reproduced three
classification errors offline. No production write was made and no reader impact was established.
The commit repairs mistyped endnotes and accepts superscript reference numbers; both repairs spend
weaker evidence as though it established the stronger distinction they need.

## The class: a lossy observation becomes permission to infer

`endnotesTypedAsProse` treats a real preceding `footnote` as evidence that the following page is
endnotes. That record may instead be an ordinary page-footnote. The following sequence moves two
body instructions into Notes:

```text
page 5 paragraph: The claim has a qualification5.
page 5 footnote:  5 A qualification.
page 6 listitem:  6 Apply the treatment to every patient.
page 6 listitem:  7 Measure the outcome.
```

The renderer emits both instructions with `role: "footnote"` and removes their leading labels.
Consecutive numbering establishes an ordered sequence, but does not establish what the sequence
is. The candidate introduced this inference in `8f576723b`.

The first repair required a preceding page with no body prose. A second counterexample still
passed: an article-title heading and affiliation note 1, followed by body instructions 2 and 3.
The regression failed with only the title left in the body
(the regression is the title-page case in `tests/pdf-footnotes.test.ts`). Lack of body paragraphs was weaker evidence than
the required notes-section context.

The sibling is `toDrafts` licensing glued citation numbers through `!hasNotes(blocks)`.
`hasNotes` observes canonical blocks and attributes, after extraction has discarded some source
evidence. On page 1, a body paragraph containing `Studies of memory2` twice, followed by
`footnote: 2 A methodological qualification, not a reference.`, has two possible marker locations.
The renderer links neither and `renderNotes` omits the uncited first-page note. The resulting
blocks give `hasNotes === false` despite the source's real note.

With a model claim for entry 2, title `Memory Effects`, author `Smith`, year `2020`, and mention
`Studies of memory`, a reference list containing `Smith. Memory Effects. 2020.` passes `toDrafts`:
the entry, identity, author and year are accepted with every drop counter zero. The title check
proves the proposed entry contains the proposed title; it cannot prove the body marker cites it.
Copying the wrong entry consistently therefore defeats this mitigation.

The durable [offline source-note probe](../../evals/footnote-digits/source-notes-absence.ts) asserts
both the PDF and unsupported-web reproductions using synthetic inputs. Run it with
`node --import tsx evals/footnote-digits/source-notes-absence.ts`; it reproduced both cases
with zero drop counters on 2026-10-04. Its assertions document the current defect, not desired
behaviour.

The new inference license also dates to `8f576723b`. The earlier omission in `renderNotes` dates
to `ebee390cd7` and is outside this stage. Unsupported web notes give the same missing evidence:
a `role="doc-noteref"` marker and note without a backlink produce zero canonical notes and
`hasNotes === false`. `tests/notes-canonical.test.ts` already recognises this limitation, including
real LaTeXML notes. This is not proof that those sources have no notes.

A third instance discarded context at the quote boundary. A verified quote ending `studies1`
inside the block's `studies15` supplied entry 1; `dose5` inside `dose5mg` supplied entry 5. Reading
the quote alone removed the rest of the number or the unit that would have disqualified it. The
new regression failed with `[1]` where `[15]` was expected. These quote-only reads also came from
`8f576723b`; the repair reads glued numbers in the full block, restricted to the mention's span
and immediately following marker position.

## Why existing checks agreed

The endnote tests supplied a Notes heading before their real anchor, but the implementation did
not require that distinction. Their numbered-body negatives removed the anchor, inserted a heading,
or used an unnumbered continuation. None kept an ordinary page-footnote followed by consecutive
body items. Citation tests supplied canonical note blocks or stamped markers; none passed a real
note through a renderer that intentionally omits it. The upstream unsupported-note tests and the
downstream inference license were individually exercised without crossing their boundary.
The glued-number tests covered whole tokens, not verified quotes ending within a token.

## Countermeasures, ranked by ease against value

1. **Keep competing explanations in the regression fixtures.** A page-footnote followed by a
   numbered body list must remain prose; a source note omitted by rendering must not become proof
   of absence. These are small, offline boundary tests suitable for this stage.
2. **Require section and page context before reclassifying body prose.** The narrow recovery now
   requires a `Notes` or `Endnotes` heading, an adjacent preceding page with notes and no body
   prose, and a candidate page containing only notes, their prose and publisher furniture.
   A later heading changes the section. Accepted recovery and note continuations survive page
   turns. The title-page negative prevents weakening section evidence back to page evidence.
3. **Validate an extracted token against its complete source context.** The citation repair reads
   inside and immediately after the quote from the full block. Regression cases retain the
   suffix that changes `1` into `15` or `5` into a quantity; they failed on the candidate.
4. **Preserve note-presence provenance independently of displayed notes.** The long-term citation
   boundary needs separate known-present, known-absent and unknown states; rendered blocks alone
   cannot recover discarded source evidence. This spans extraction and stored article metadata,
   so it is reported as wider work, not repaired by this review.
5. **Infer note absence with a larger number-pattern heuristic.** Rejected: more glyph exclusions
   cannot recover a note that a prior stage discarded. The independent title check remains useful
   defence, but is not a substitute for citation-to-mention evidence.

The narrow fixes add section evidence for endnotes and keep source context for glued citation
numbers. They cannot recover note evidence that extraction discarded. The source-note absence
gap remains unresolved and belongs beside these regressions until it has a checkable representation.

## What was done after the review

Countermeasure 4 is the long-term one and is not built. What closed the demonstrated consequence
the same day is a sixth, which the class itself suggests: **when one place cannot decide an
article-wide question, ask the whole article.** `citesMostOfListGlued` in `src/citations.ts` lets a
glued number count as a reference number only when the body cites at least half of the numbered
list that way. A paper that cites by superscript does (69 of 69 and 26 of 27 entries on the two
real papers); a paper whose stray glued numbers are footnotes does not (53 of 292 on the paper
whose 62 endnotes started this). The probe now asserts the wrong entry is refused against a
ten-entry list. It still passes against a one-entry list, and a paper with as many unrecognised
numbered footnotes as half its references would pass too. That residue is stated in the function's
comment.
