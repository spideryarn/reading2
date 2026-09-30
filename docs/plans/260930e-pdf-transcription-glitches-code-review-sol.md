1. **P1 — [src/pdf-read.ts:1792](/home/greg/code/spideryarn2/.claude/worktrees/fb69-transcription-glitches/src/pdf-read.ts:1792): a consumed continuation broke the remaining target chain.** Input: page 8 `"He saw an or"` → page 9 `"ange"` (`continues`) → `"sphere of 15 cm."` (`continues`). Mending emptied `"ange"`, after which production rendered two paragraphs. `renderHtml` now aliases the empty record to its target block. The regression test was red first.

2. **P1 — [src/pdf-authors.ts:295](/home/greg/code/spideryarn2/.claude/worktrees/fb69-transcription-glitches/src/pdf-authors.ts:295): the new names-only arm could omit trailing authors.** With the five-name Frontiers byline, an answer containing only Mei-jun Ou plus a failed affiliation returned `"Mei-jun Ou"` and discarded four printed names. Names-only now requires the entire byline tail to contain only markers/glue; otherwise the printed byline is retained. Tests now cover bad names, skipped middle names, and skipped trailing names after an affiliation failure.

3. **P2 — [src/pdf-read.ts:1456](/home/greg/code/spideryarn2/.claude/worktrees/fb69-transcription-glitches/src/pdf-read.ts:1456): `ENDS_A_SENTENCE` misread non-ASCII sentence endings.** `paragraph("対照分析は完了した。】") · figure(...) · paragraph("次の分析では…", continues:true)` was wrongly joined. The guard now recognizes Unicode sentence terminals and closing punctuation. The test was red first.

4. **P1, wider/pre-existing — [src/pdf-authors.ts:271](/home/greg/code/spideryarn2/.claude/worktrees/fb69-transcription-glitches/src/pdf-authors.ts:271): successful structured verdicts can still omit a trailing author.** For byline `"Mei-jun Ou, Xiang-hua Xu"` and answer `[Mei-jun Ou]` with no affiliation failure, the existing arm still stores only Mei. I did not change this because trailing text may instead be an affiliation fused into the byline record; resolving that safely overlaps the deferred stacked-byline work. The new names-only arm no longer inherits this failure.

No further wrong joins, list mis-nesting, text loss/duplication, figure ordinal errors, page off-by-one errors, or unhandled `AuthorsVerdict` callers were found. The behavior-named tests directly assert targets, rendered DOM/markers, and end-to-end byline wiring.

Checks:

- Requested five-file Vitest run: **140 passed**
- Typecheck logic: **passed**, 2,404 source files covered
- `npm run typecheck`: wrapper blocked by sandboxed `tsx` IPC; equivalent `node --import tsx scripts/typecheck.ts` passed
- Scoped lint: no errors; advisory complexity notices only
- Full `npm test`: could not start because local Postgres/Supabase was unavailable
- Changes remain uncommitted because the sandbox cannot write the worktree’s Git index outside the workspace

**Verdict:** The scoped change is ready after three fixes; the pre-existing trailing-author ambiguity remains for a separate decision.