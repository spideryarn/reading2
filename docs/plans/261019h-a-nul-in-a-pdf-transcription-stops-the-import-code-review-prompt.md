Code review of the change for docs/plans/261019h-a-nul-in-a-pdf-transcription-stops-the-import.md (read it first, including "What GPT Sol's plan review changed"). The working tree in the current directory holds the change, uncommitted; `git diff HEAD` shows it (src/control-characters.ts is new). Your earlier plan review is docs/plans/261019h-a-nul-in-a-pdf-transcription-stops-the-import-plan-review-sol.md.

The house workflow: fix what you find inside this change's scope directly in the working tree (keep edits small and in the surrounding style; add or adjust tests where needed), and report anything wider for me to decide. Do not commit, do not touch git state, do not write to any database other than the local test database the suite uses.

Check in particular:
1. validateChunkReading (src/pdf-integrity.ts) now returns a cleaned copy when records hold controls. Does anything rely on the returned reading being the same object as the input (identity checks such as `reading !== item.reading` in src/pdf-read.ts runPdfExtract phase 2, the keepChunk decision, usage accounting, recovery), and could the copy cause an extra checkpoint write or a double-counted `stripped`?
2. Is pass0's baseline (src/pdf.ts itemText in pass0, firstPagesText, frontPageRecord, metaTitle) consistent with the cleaned transcription for scoring (src/pdf-score.ts) — any place that compares raw pdf.js text with cleaned text?
3. checkpointJson's NUL regex (src/store/checkpoints.ts): correct for every JSON.stringify output, no false positives or negatives?
4. Any remaining path from foreign text to a Postgres text/jsonb column in a PDF import that is still open to U+0000.
5. Tests: do they prove the fix (would they fail without it)?

Run: npx vitest run tests/pdf-read.test.ts tests/pdf-front-pages.test.ts tests/pdf.test.ts tests/pdf-score.test.ts tests/pdf-integrity.test.ts tests/paper-metadata.test.ts tests/bibliographic.test.ts tests/store-checkpoints.test.ts, and npm run typecheck.

Report: numbered findings with severity and file:line, what you changed for each (or why not), then a final line VERDICT: SHIP, SHIP AFTER MY FIXES, or DO NOT SHIP.
