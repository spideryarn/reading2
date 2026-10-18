## Findings

1. **Medium — coarse-pointer target overlapped the run button.** [footnotes.css:333](/var/tmp/spideryarn-worktrees/fbxtkv73-glossary-note-more-skim/src/web/styles/footnotes.css:333) — at the supported 12px root, the spacing was 7.8px while the (i)’s target extended 9.5px. **Fixed** with 6px coarse-only clearance and a regression test.

2. **Low — generated Help corpus still described More after Summary.** [help-corpus.generated.json:30](/var/tmp/spideryarn-worktrees/fbxtkv73-glossary-note-more-skim/src/help-corpus.generated.json:30) — `tests/help-corpus.test.ts` failed. **Fixed** by regenerating the corpus.

3. **Low — stale and contradictory Dock comments/tests.** [Dock.tsx:1216](/var/tmp/spideryarn-worktrees/fbxtkv73-glossary-note-more-skim/src/web/Dock.tsx:1216), [dock-groups.test.tsx:133](/var/tmp/spideryarn-worktrees/fbxtkv73-glossary-note-more-skim/tests/dock-groups.test.tsx:133) — wording claimed no separator on either side of More despite the separator immediately after it, and another comment still said More followed Summary. **Fixed**.

4. **Low — regression coverage omitted key plan-review claims.** [glossary-find-more-keeps-the-lists-profile.test.tsx:248](/var/tmp/spideryarn-worktrees/fbxtkv73-glossary-note-more-skim/tests/glossary-find-more-keeps-the-lists-profile.test.tsx:248), [dock-more-leads.test.tsx:290](/var/tmp/spideryarn-worktrees/fbxtkv73-glossary-note-more-skim/tests/dock-more-leads.test.tsx:290) — tests did not verify accessible description association, keyboard focus, state cleanup across row branches, or the exact `[310,354]`/`[354,398]` geometry. **Fixed**. Production hook ordering and state lifecycle were correct.

## Files I edited

- `src/help-corpus.generated.json`
- `src/web/Dock.tsx`
- `src/web/GlossaryPanel.tsx`
- `src/web/styles/footnotes.css`
- `tests/a-second-press-closes-the-mode.test.tsx`
- `tests/dock-groups.test.tsx`
- `tests/dock-more-leads.test.tsx`
- `tests/dock-more.test.tsx`
- `tests/glossary-find-more-keeps-the-lists-profile.test.tsx`

I did not edit the browser agent’s screenshots, `bottom-bar.png`, or `help-images.ts`.

## Checks

- New coarse-target regression: observed failing at `7.8 < 9.5`, then passed after the fix.
- `WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts` — 7 passed.
- Final targeted Vitest run — 8 files passed; 220 passed, 1 skipped.
- `npm run typecheck` — environment blocked `tsx` IPC creation with `listen EPERM`.
- Equivalent `node --import tsx scripts/typecheck.ts` — passed all four projects; all 3,807 source files covered.
- Scoped Biome lint — exit 0; two pre-existing complexity advisories only.
- `git diff --check HEAD` — passed.

**APPROVE WITH CHANGES (made)**