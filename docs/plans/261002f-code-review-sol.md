No P0s. I fixed four findings.

1. **P1 — Diagram scatter excerpts used the AI face.** [scatter.ts:454](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-ai-faces-for-everyone/src/web/scatter.ts:454), [DiagramPanel.tsx:2764](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-ai-faces-for-everyone/src/web/DiagramPanel.tsx:2764)  
   Added typed `gistVoice` provenance through graph/scatter layouts. Drift/Trail excerpts are now author; graph summaries remain AI. Added red-first unit and rendered-card coverage.

2. **P2 — Where’s app-owned `▸` inherited the title’s voice.** [WhereCard.tsx:22](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-ai-faces-for-everyone/src/web/WhereCard.tsx:22)  
   Kept the list item and pseudo-element UI-faced, wrapping only the sourced title. Ellipsis remains on the original parent. Added red-first DOM coverage.

3. **P2 — `/add/upload` rendered “your file” as reader text.** [AddPage.tsx:703](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-ai-faces-for-everyone/src/web/AddPage.tsx:703)  
   Paired the displayed value with its voice: the fallback is UI; an actual filename remains reader. Added red-first coverage.

4. **P2 — Typography documentation still described the former one-face/experimental design.** [typography.md:8](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-ai-faces-for-everyone/docs/project/typography.md:8), [fonts.md:77](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-ai-faces-for-everyone/docs/project/fonts.md:77)  
   Changed “one sans for everything” to “Geist is the base and chrome,” documented the three always-on overrides, and corrected matching token, `/design`, import, prose, TitleEditor, and annotation comments. Also documented that shelf gist equality is a heuristic, not exact provenance.

Wider, not fixed:

5. **P1 — Exact shelf-blurb provenance remains unavailable.** [library-scalars.ts:90](/home/greg/code/spideryarn2/.claude/worktrees/fbpeanctkn-ai-faces-for-everyone/src/library-scalars.ts:90)  
   A model gist identical to the excerpt is still classified author. The exact fix requires the deliberately deferred `root_gist_source` migration/backfill; database work was prohibited here. I left behavior unchanged and made the limitation explicit.

The remaining `titleVoice`/`nodeLabel` paths, nav-label provenance, Quiz/Skim/Marginalia/Where threading, cached old shelf bodies, and new-span layout sites checked out without further findings.

Gates:

- Targeted Vitest run: **8 files, 267 tests passed**.
- Required voice/nav suites: **2 files, 24 tests passed**.
- Added graph/scatter provenance tests: **2 files, 68 tests passed**.
- Direct typecheck runner: **all four projects passed; all 2,703 source files covered**.
- `npm run typecheck` itself could not start because the sandbox denied `tsx`’s `/tmp` IPC socket; `node --import tsx scripts/typecheck.ts` ran the same checker successfully.
- Scoped lint found only existing complexity, hook-dependency, and `dangerouslySetInnerHTML` findings; no new lint finding from these edits.
- `git diff --check`: passed.

Verdict: approve with the fixes applied; only the explicitly deferred shelf-provenance ambiguity remains.