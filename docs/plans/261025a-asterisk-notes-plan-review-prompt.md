You are reviewing a plan, read-only, before it is built. Repo: Spideryarn (TypeScript). Read:

- docs/plans/261025a-asterisk-and-dagger-notes-at-the-back-of-a-book-link-to-their-markers.md (the plan)
- src/pdf-read.ts: `collectNotes`, `markerSpellings`, `GLUED_TO`, `candidatesIn`, `findMarkers`,
  `withMarkers`, `renderNotes`, `renderHtml` and its single caller (search `renderHtml(mended`)
- src/pdf.ts `Pass0` / `pass0` (the text layer: `pass.pages[i].text`, page i+1)
- tests/pdf-footnotes.test.ts (existing cases, which must stay green)
- docs/project/content-extraction.md § Footnotes are shown (around line 269)
- docs/project/block-ids.md (the id contract: block ids recovered by tag+text)

Evidence already gathered (production, read-only): the text layer of the source PDF prints `*`
glued to prose on pages 15, 19, 24, 24, 28, 38 ("began.*32"), 49, 50, 58, 58, 119, and the 11 notes
start their own lines on pages 148–158 ("* Grammatical note: …"). The model's transcription has the
same markers except the second on page 24. The 143 numbered endnotes precede the `*` notes in note
order. Today zero `*` markers link.

Questions to answer, concretely, with file:line where you can:
1. Is the root cause right (the shared endnote cursor), and is anything else also stopping these
   links?
2. Is the per-page count gate sound? Find inputs where it links a note to the wrong place
   (e.g. running headers/footers containing `*`, a `*` in a figure caption or heading on a body page,
   a symbol used for emphasis or in maths, `\(…\)` spans, footnote-kind and endnote-kind notes of the
   same symbol in one document, notes split over pages, chunk context pages, the page numbering of
   `pass.pages` vs `record.page`, pages where the text layer is empty but the PDF is not a scan).
3. Should the symbol-series grouping be by symbol, by symbol+kind, or something else? What about
   `**` / `††` doubled labels (LABEL allows up to three)?
4. Is the `*32` adjacency change safe for numeric markers elsewhere (tests on digits not markers)?
5. Anything that changes block text or marker ids for articles that have no symbol notes
   (re-extraction must keep ids)?
6. A simpler design that is as safe, if you see one.

Answer as a numbered list of findings, each with severity (high/medium/low), the concrete failing
input, and the fix you would make. Do not edit files.
