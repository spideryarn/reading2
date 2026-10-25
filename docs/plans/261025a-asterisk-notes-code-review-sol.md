Found and fixed two high-severity wrong-link cases:

- **High — adjacent-page matches could reverse note order.** Source `first.*`, then `second.*`, with the transcription reversed across those pages, passed both uniqueness checks and linked both notes backwards. Symbol matches must now preserve source order; otherwise the series remains unlinked. Regression: [pdf-footnotes.test.ts](/var/tmp/spideryarn-worktrees/fbhrx8z2-asterisk-notes/tests/pdf-footnotes.test.ts:765). Fix: [pdf-read.ts](/var/tmp/spideryarn-worktrees/fbhrx8z2-asterisk-notes/src/pdf-read.ts:2896).

- **High — a line-start text-layer symbol could be silently replaced by an unrelated `word*`.** With two notes, a real marker represented as `\n*`, and an extra `word*`, the count still agreed and the second note linked to the extra. Exact line-start symbol runs now invalidate the series because geometry is required to distinguish a superscript from a bullet. Regression: [pdf-footnotes.test.ts](/var/tmp/spideryarn-worktrees/fbhrx8z2-asterisk-notes/tests/pdf-footnotes.test.ts:780). Fix: [pdf-read.ts](/var/tmp/spideryarn-worktrees/fbhrx8z2-asterisk-notes/src/pdf-read.ts:2647).

Both tests were observed failing before their fixes.

I also corrected the built plan’s stale claims about the earlier Rovelli transcription and note-block IDs, and recorded the code-review changes in [the plan](/var/tmp/spideryarn-worktrees/fbhrx8z2-asterisk-notes/docs/plans/261025a-asterisk-and-dagger-notes-at-the-back-of-a-book-link-to-their-markers.md:96).

No further bugs found in:

- Numeric/no-symbol output: the numeric checks and cursor behavior remain identical.
- Marker IDs and `claimed`: numbered IDs remain first and stable; symbol matching respects already-claimed places.
- Cached re-extraction: the sole production caller supplies the page-numbered text layer after cached chunks are reconstructed.
- NFKC, curly quotes, hyphen mending, and TeX-delimited maths: these either match correctly or fail closed.

Checks:

- `npx vitest run tests/pdf-footnotes.test.ts` — **passed, 69/69**.
- Literal `npm run typecheck` — could not start because this sandbox forbids `tsx`’s IPC socket: `EPERM /tmp/tsx-1000/14.pipe`.
- Equivalent compiler run, `node --import tsx scripts/typecheck.ts` — **passed all five projects; all 4,005 source files covered**.
- Biome — no errors; seven existing complexity notices elsewhere in `src/pdf-read.ts`.
- No production access and no commit.