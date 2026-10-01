You are reviewing code, and you may fix what you find. Repo: the current directory (Spideryarn,
TypeScript). House rules for you: fix defects inside this change's scope, each with a test that is
red before your fix; report anything wider rather than doing it. Never run a git command that
discards work (no checkout --, restore, stash, reset, clean); do not commit. Do not change the PDF
transcription prompt (`SYSTEM`, `SCHEMA`, `PROMPT_VERSION` in src/pdf-read.ts) — that would make
every import pay again, which this change exists to avoid.

The change: PDF footnotes are shown at the end of the article and linked from their markers, by
writing the same canonical note markup the web path writes. Plan, with the measurement and your own
plan review's findings and what was done with each:
docs/plans/260930k-pdf-footnotes-shown-and-linked.md. Your plan review:
docs/plans/260930k-pdf-footnotes-shown-and-linked-plan-review-sol.md.

The diff: `git diff origin/dev...HEAD` (one commit on top of dev), plus any uncommitted edits
(`git diff HEAD`). Main code: src/pdf-read.ts (`renderHtml`, `RenderBlock`, `collectNotes`,
`markerSpellings`, `candidatesIn`, `findMarkers`, `withMarkers`, `renderNotes`), src/notes.ts
(`mintNoteId` exported), src/web/notes-view.ts (`printedNumber`). Tests: tests/pdf-footnotes.test.ts.

Please check, with evidence:

1. Correctness of the matcher against the rules the plan states (§ "The rules as built"): off-by-one
   in piece spans (`end: next.start - 1`), the cursor/claimed logic for footnotes vs endnotes,
   uniqueness counting, what happens with duplicate notes of the same label, continued notes.
2. The HTML written: escaping of every text segment, marker insertion offsets when a block has
   several markers, the `<li value>` only for numeric labels, the notes section after a trailing
   `<ul>`, a note that is `uncertain`.
3. That it survives stage 3 and reaches the reading view correctly: run the new tests, and if
   useful drive `splitIntoBlocks` + `buildNoteIndex` on a case of your own. Does `printedNumber`
   read the `value` from the block html shape stage 3 actually stores? Could the `value` attribute
   break anything else that reads note blocks (citations, carry-over key `withoutNoteControls`,
   the client's rendering of the note region)?
4. Anything that consumed PDF extractedHtml and assumed no notes section (asset collection, figure
   ordinals, title/excerpt extraction, word counts, `pdf-score`), and any other regression.
5. Id stability: re-rendering the same records twice gives identical HTML; a note's id does not
   depend on matching.

Then run `npx vitest run tests/pdf-footnotes.test.ts tests/pdf-continuations.test.ts
tests/pdf-seam-hyphens.test.ts tests/pdf-frontmatter-wiring.test.ts tests/note-carry-over.test.ts
tests/notes-canonical.test.ts tests/note-preview-card.test.tsx` and `npm run typecheck` after any fix.

Output: a verdict line, then numbered findings most severe first, each saying what you fixed (and
the test) or what you are reporting for the author to decide.
