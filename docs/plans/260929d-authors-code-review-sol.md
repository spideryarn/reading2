No P0 findings.

1. **P1 — [src/pdf-authors.ts:167](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/pdf-authors.ts:167) — a real surname can still be truncated. Reported for decision.**  
   A proposal of `Ana Cost` matches printed `Ana Costa` because any one-letter suffix is accepted as a marker. The stored span becomes `Ana Cost`. `trimName` itself preserves letters, but `findName` cuts the span first, so the plan’s “cannot truncate” claim is false. Fixing this requires the product trade-off the plan made: disallow letter-marker omission and lose the measured `Rukhsara → Rukhsar` case, or retain the ambiguity.

2. **P1 — [src/pdf-authors.ts:227](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/pdf-authors.ts:227), [src/pdf-read.ts:2853](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/pdf-read.ts:2853) — a PDF answer may omit printed authors and replace the full byline with the shorter list. Reported for decision.**  
   For `Jane Doe; John Roe`, an answer containing only Jane passes and becomes the new byline. I fixed reordered and duplicated proposals by requiring distinct matches in printed order, but completeness cannot be established safely from arbitrary fused byline-and-affiliation records without a broader design change.

3. **P1 — [src/pdf-authors.ts:123](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/pdf-authors.ts:123) — UTF-16 offset mapping could extend a matched name. Fixed.**  
   Astral letters occupy two UTF-16 units but previously received one offset entry. A one-letter proposal could therefore slice through the rest of the byline. Offset maps now follow UTF-16 units; tests cover astral letters, decomposed combining marks, and `ﬁ` compatibility folding. Name matching also now consumes matches in order, preventing reordered or repeated authors.

4. **P1 — [src/pdf-authors.ts:91](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/pdf-authors.ts:91) — affiliation trimming corrupted legitimate leading numbers. Fixed.**  
   `3M Company` became `M Company`, and `123 Main Street` became `Main Street`. A leading number is now removed only when the same numeric marker was found on that author’s name.

5. **P2 — [src/authors.ts:39](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/authors.ts:39), [src/store/artifacts-pg.ts:207](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/store/artifacts-pg.ts:207), [src/store/export.ts:369](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/store/export.ts:369) — defensive decoding covered only the reading-view path. Fixed.**  
   Pipeline reads, writes, and rollback export could pass malformed or over-limit JSONB through. They now use `decodeAuthors`, which also enforces `AUTHOR_LIMITS` and rejects empty affiliations.

6. **P2 — [src/meta-authors.ts:217](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/meta-authors.ts:217) — the web completeness guard conservatively rejects some correct common bylines. Reported for decision.**  
   `By Jane Doe and John Smith` passes, but `Jane Doe, PhD and John Smith` or `Written by Jane Doe and John Smith` loses structured authors because `PhD`/`written` remain. It does not ordinarily store fewer people; broadening the accepted glue would slightly weaken that guarantee.

7. **P2 — [evals/pdf/titles.mts:599](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/evals/pdf/titles.mts:599) — comma splitting could score differently segmented names as the same byline. Fixed.**  
   Structured arms now compare structured author names against the structured golds. `authorsVerdict` correctly checks ordered names and each author’s affiliation set.

8. **P2 — [src/web/AuthorNames.tsx:66](/home/greg/code/spideryarn2/.claude/worktrees/authors-metadata-import/src/web/AuthorNames.tsx:66) — expanding “+ N more” removed the focused control. Fixed.**  
   The button now remains mounted, exposes an explicit accessible name and `aria-expanded`, and toggles to “Show fewer.” Owner links and visitor focus triggers are keyboard-accessible. The direct-child `.facts` selector is safe: only `Masthead` uses that class.

9. **P2 — store tests pass structurally but do not directly prove an authors-bearing round trip. Reported.**  
   `store-revision-policy` and `store-revision-columns` should pass because `authors` is classified as `carry`, selected only by `article`, and present in that projection. Bundle export carries the whole revision row, and rollback export names `authors`, so `store-export-covers-tables` should pass. Existing parity/roundtrip fixtures contain no authors, however, so they do not exercise this value end to end.

Checks: 151 targeted tests passed; all four TypeScript projects passed directly; Biome and `git diff --check` passed. The paid eval and database-backed tests were not run. The normal typecheck wrapper was blocked by sandbox IPC and additionally sees the supplied untracked Vitest config as uncovered.

Files changed:

- `evals/pdf/titles.mts`
- `src/authors.ts`
- `src/pdf-authors.ts`
- `src/store/artifacts-pg.ts`
- `src/store/export.ts`
- `src/web/AuthorNames.tsx`
- `tests/masthead-authors.test.tsx`
- `tests/meta-authors.test.ts`
- `tests/pdf-authors.test.ts`
- `tests/pdf-frontmatter-wiring.test.ts`
- `tests/pdf-titles-eval.test.ts`