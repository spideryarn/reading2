F1 — medium — CRLF duplicated the browser text newline (`\r<br>\n`), shifting annotation and cross-reference offsets; CR and Unicode separators were ignored. Fixed by matching each separator atomically and retaining it after `<br>` ([src/pdf-read.ts:2007](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/pdf-read.ts:2007), [tests/pdf-quote-line-breaks.test.ts:137](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/tests/pdf-quote-line-breaks.test.ts:137)). Tests cover CRLF, CR, Unicode separators, punctuation-only and indented lines, note markup, escaped entities, and `pdf-uncertain`/`⟦illegible⟧`.

F2 — medium — Plan-review F2 was only partly addressed: three lines with one free break out of two were classified as verse, despite the recommendation for at least three breaks and substantially more than half free. A realistic three-line prose fixture failed before the fix. Tightened to three breaks and a two-thirds threshold ([src/pdf-read.ts:2031](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/src/pdf-read.ts:2031), [tests/pdf-quote-line-breaks.test.ts:112](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/tests/pdf-quote-line-breaks.test.ts:112)); Saadi and Horace still pass.

Downstream checks now cover cross-line server anchoring and cross-references ([tests/pdf-quote-line-breaks.test.ts:168](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/tests/pdf-quote-line-breaks.test.ts:168)), sanitisation, id/hash stability, and `blocksAreWhatTheirHtmlProduces` ([tests/pdf-quote-line-breaks.test.ts:191](/var/tmp/spideryarn-worktrees/fbdktkem-quote-line-breaks/tests/pdf-quote-line-breaks.test.ts:191)). Search, maths, export, and reading-view rendering showed no additional defect.

Verification:

- Disabling `withLines` made 8 regression assertions fail, including the original poem cases; it was restored.
- Unit equivalent of requested suite: 14 files, 294 tests passed.
- Exact Vitest command was blocked by unavailable sandboxed Postgres.
- Typecheck: all source projects pass; only the allowed pre-existing `tests/matter.test.ts:342` error remains.
- Biome exits 0 with seven pre-existing complexity advisories.
- No commit made.

APPROVE WITH CHANGES (made)