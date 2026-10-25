The root cause is correct, but the plan’s count gate does not prove that the counted symbols are note markers. I would revise the plan before building.

Line references below are to the pre-build `HEAD`; the shared worktree began changing during this review.

1. **High — The shared endnote cursor is the main cause, with `*32` as a separate blocker.**

   Concrete input: Rovelli’s 143 numbered endnotes advance the single endnote cursor near the end of the prose; the following `*` notes therefore search only after that point. This follows directly from the two kind-level cursors and their update at `src/pdf-read.ts:2695-2716`.

   Separately, `began.*32` fails in both directions: `*` is rejected because a digit follows it, while `32` is rejected because `*` is not in `GLUED_TO` (`src/pdf-read.ts:2633-2635`).

   Fix: retain separate footnote/endnote matching, then add an independent exact-label series for symbol endnotes. Handle adjacent symbol+number pairs explicitly; a cursor change alone does not fix them.

2. **High — Series must be keyed by kind plus the complete label, not merely “numbers” or a base symbol.**

   Concrete input: the existing case with footnotes 1 and 3 and endnote 2 arrives in note order `1,3,2` but marker order `1,2,3`. A single numeric series would miss 2; this is already pinned at `tests/pdf-footnotes.test.ts:306-320`.

   Likewise, a page footnote `*` and an endnote `*` are independent conventions. A page footnote commonly resets on every page, whereas the endnote series is ordered across the book.

   Fix:

   - Keep numeric cursors separated by kind, as today.
   - Keep symbol footnotes under the existing page-local uniqueness rule.
   - Group symbol endnotes by `{kind: "endnote", exactLabel}`.
   - If the same symbol appears in both kinds and the raw occurrences cannot be separated reliably, leave the endnote series unlinked rather than sharing state.

3. **High — `*`, `**`, `††`, and mixed runs must be treated as maximal, exact labels.**

   Concrete input: `word**` currently qualifies both as a `*` candidate at the first character and as a `**` candidate. If the `*` note is processed first, it claims the start position and prevents the `**` note from linking. `LABEL` explicitly accepts one to three symbol characters at `src/pdf-read.ts:2296`.

   Fix: tokenize maximal runs of `[*†‡§¶]` and accept them only when the whole run exactly equals the note label. Group by the complete spelling—`*`, `**`, and `*†` are different series.

4. **High — Count equality can silently link a note to a non-note symbol.**

   Concrete failing input:

   - One endnote: `* Explanatory note`.
   - Its real marker is printed inside an image-only figure caption, so it is absent from the text layer and excluded from matching because captions are not in `CITING` (`src/pdf-read.ts:2299-2300`).
   - A body paragraph contains a non-note emphasis or wildcard: `The result was significant*`.
   - The text layer and transcription each contain exactly one searchable `*`.

   The proposed gate sees one note, one printed occurrence, and one transcription candidate, then links the note to `significant*`. The counts agree but the link is wrong. The scan fallback has the same problem without even an independent text-layer witness.

   Fix: do not describe count equality as proof. For repeated identical symbol endnotes:

   - Drop the scan fallback; without independent evidence, leave them unlinked.
   - With a text layer, require each source occurrence to align uniquely to the same rendered `CITING` passage using surrounding text.
   - If wrong links must be ruled out rather than merely made unlikely, retain glyph geometry and require marker-like typography, such as a superscript baseline. Counts alone cannot distinguish a note mark from emphasis, a wildcard, or maths.

5. **Medium — The raw-text counter and the renderer search different universes.**

   Concrete inputs:

   - A running header `DRAFT*` is retained in `PageText.text`; furniture is reported separately in `Pass0.furniture` (`src/pdf.ts:245-253`, `1034-1040`). The model is told to omit it.
   - A heading or figure caption contains `*`; raw page text counts it, while `findMarkers` searches only paragraphs, quotes, and list items.
   - Visual maths contains `x*`. The raw PDF text has no `\(...\)` delimiters, while transcription candidates inside `\(...\)` are excluded by `forbiddenSpans` (`src/pdf-read.ts:2616-2620`).

   Usually these produce false negatives by inflating the raw count. Combined with one missing genuine glyph, they can replace it and produce the wrong-link case above.

   Fix: filter known furniture, align raw occurrences to eligible rendered records, and reject unmatched occurrences. Applying `forbiddenSpans` directly to raw PDF text does not solve maths because the delimiters exist only in the transcription.

6. **High — Empty text-layer pages in a non-scan PDF must be “unknown,” not zero or scan fallback.**

   Concrete input: a 100-page hybrid PDF has several ordinary text pages, so `isScan` is false, but the page containing a symbol marker is image-only. `isScan` is document-wide and becomes false once more than one page meets the word threshold (`src/pdf.ts:1034-1039`).

   Treating “the supplied text layer printed no symbol” as equivalent to “no text layer” allows transcription-count fallback and can create a wrong link. Treating the empty page as authoritative zero can shift later ordinal assignments if another false symbol balances the total.

   Fix: distinguish:

   - no text-layer witness because `pass.isScan` is true;
   - a supplied but empty/unreliable individual page;
   - a reliable page with zero occurrences.

   A supplied series with zero raw occurrences must fail closed, not enter the scan fallback. Any unknown marker-bearing page should invalidate the repeated-symbol series unless occurrences are independently aligned.

7. **Medium — Count only before the first endnote page, or track every page occupied by notes.**

   Concrete input: `collectNotes` keeps only the page where a note starts (`src/pdf-read.ts:2552-2578`). A note beginning on page 148 and continuing onto page 149 may contain `word*` in its continuation. Excluding only start pages still counts that star as a body marker.

   Fix: for the specific “notes at the back” feature, search only pages strictly before the first note in that exact series. This is simpler and also excludes note labels and note prose. If interleaved chapter-end series must be supported later, model them as separate contiguous runs and record all pages occupied by every note.

8. **High — The `*32` adjacency rule would change numeric-only articles unless it is conditional.**

   Concrete failing input: body text `The grammar accepts word*3 here.` plus numeric endnote 3, but no symbol note. A rule allowing a number after a symbol whenever that symbol is glued to a word would newly link 3. The proposed `5*3` test does not cover this because the character before `*` is a digit rather than a letter.

   Fix: treat `*32` as an atomic adjacent-marker exception. Permit the numeric marker only when the preceding maximal symbol run is itself accepted for an existing symbol note at that position. Add at least:

   - `began.*32` with both notes → both link;
   - `word*3` with only note 3 → neither links;
   - `5*3` → neither links;
   - a numeric-only article containing `word*3` → byte-for-byte unchanged.

9. **High — The plan’s block-id preservation claim is incomplete.**

   Concrete input: a paragraph currently contains an already-linked numeric marker and an unlinked star:

   ```text
   Claim.1 A qualification follows.*
   ```

   After the change its visible text is identical, but it cites one additional note. Stage 3 deliberately removes note controls and fingerprints the identities of cited notes (`src/blocks.ts:644-678`, `919-964`). Its key therefore changes from `[note-1]` to `[note-1, star-note]`, and the paragraph can receive a new block id.

   The legacy bridge preserves an id when the previous block was entirely unstamped (`src/blocks.ts:1101-1145`), but it does not preserve an already-stamped block whose cited-note set changed. Conversely, a note losing its leading `*` may still carry through the folded-text pass, so it is not necessarily “minted afresh.”

   Fix: remove the blanket statement that wrapping characters preserves marker-block ids. Replay the actual previous blocks through stage 3 and report exactly which ids carry. Do not weaken the note fingerprint casually: it intentionally treats a changed citation target as a semantic change.

10. **Medium — Marker-id stability needs an explicit ordering rule.**

    Concrete input: `markerId` is allocated from `markers.length + 1` during matching (`src/pdf-read.ts:2715`). Processing grouped series in a different order can renumber existing numeric markers even if their links do not change.

    Fix: select matches first, then assign marker ids in the existing note-encounter order. Preserve the current numeric/footnote path unchanged and add a golden before/after HTML comparison for articles with no symbol notes. With that and the adjacency restriction above, no-symbol articles should retain both block text and marker ids.

11. **Low — Page numbering and chunk context are not current blockers, but the type should preserve the contract.**

    Concrete future failure: passing a sliced or sparse page array and interpreting index `i` as page `i+1` assigns occurrences to the wrong page.

    Production is currently consistent: `PageText.page` is 1-based (`src/pdf.ts:206-210`), `pass0` stores `page: n` (`995-1002`), records use file page numbers (`261-268`), and context-page records are removed before rendering (`src/pdf-read.ts:3904-3915`).

    Fix: pass `PageText[]` or a `Map<number,string>` into rendering and key by `page.page`; do not discard the page number into a bare string array.

12. **Medium — There is no equally simple design that both links Rovelli’s 9–10 safe markers and rules out wrong links.**

    The conservative simple design is to leave repeated identical symbol endnotes unlinked. To solve this report automatically, the smallest defensible extension is a separate endnote-symbol pass that:

    - leaves existing numeric and page-footnote matching untouched;
    - uses exact maximal symbol labels;
    - operates only before the first note page;
    - rejects scans and unknown/empty text-layer pages;
    - removes furniture;
    - uniquely aligns source context to a `CITING` transcription candidate;
    - leaves any ambiguous page unlinked.

    That is closer to the plan’s passed-over “words before each printed marker” option. It is more work than page counts, but page counts alone do not establish the claimed safety.

I made no edits. A targeted test run was invalidated by concurrent partial edits in the shared worktree, so I did not treat that result as evidence about the pre-build plan.