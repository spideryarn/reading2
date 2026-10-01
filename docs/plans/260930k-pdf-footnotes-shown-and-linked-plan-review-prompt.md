You are reviewing a plan, read-only. Repo: the current directory (Spideryarn, TypeScript).

Plan: docs/plans/260930k-pdf-footnotes-shown-and-linked.md. Read it first. Context: its parent plan
docs/plans/260930e-pdf-transcription-glitches.md (§ Deferred and named, Stage 3).

The code it touches: src/pdf-read.ts (`renderHtml`, `continuationTargets`, `runPdfExtract` around
line 2960–3060), src/pdf.ts (`RENDERED`, `RecordType`), src/notes.ts (the canonical footnote shape
the web path writes, `mintNoteId`), src/blocks.ts (`noteFieldsFor`, `withoutNoteControls`,
`splitIntoBlocks`, `stampAuthorAnchors`/`retargetAnchors`), src/reserved.ts, src/sanitize-policy.ts,
src/web/notes-view.ts (how the reading view labels and previews notes), src/pdf-frontmatter.ts
(`withFrontMatterHidden`), src/pdf-score.ts (what the check gates on).

Questions, answer each with file:line evidence:

1. Will HTML written by `renderHtml` in the canonical note shape actually survive stage 3 and reach
   the reading view as notes — sanitiser, `scrubReserved` calls, `retargetAnchors`, the note-carry-over
   key — given that a PDF article never passes through `canonicaliseNotes`? Anything in stage 3 or the
   client that assumes notes only come from the web path?
2. Is there a security problem with writing these stamps from model-transcribed (escaped) text? The
   stamp values are ids we mint.
3. The marker-matching rules (plan § "The one new piece"): false positives or negatives you can
   construct from realistic academic PDF prose that the rules as written would get wrong in a way
   worse than the plan admits. Is the cursor rule sound for mixed footnotes + endnotes?
4. The claim that no prompt/schema change means cached chunks stay valid and per-import cost is
   zero: true? Anything else keyed on the rendered HTML that would re-run or re-mint?
5. Anything the plan should do more simply, or a simpler option it missed.

Output: a verdict line (build / revise before build), then numbered findings, most severe first,
each with evidence and a suggested fix. Be concrete; skip praise.
