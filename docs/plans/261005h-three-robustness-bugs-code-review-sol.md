Found and fixed three in-scope gaps, red-first. **Nothing committed; all fixes remain in the working tree.**

- **C-1 — P0, established, fixed:** [maths recovery](/home/greg/code/spideryarn2/.claude/worktrees/qi-three-robustness-bugs/src/web/maths.ts:265) released the article immediately after requesting reload, exposing editable drafts before document replacement. It now shares LazyPage’s five-second grace. Actual browser timing and data loss were not observed.
- **C-2 — P1, established, fixed:** [pending recovery](/home/greg/code/spideryarn2/.claude/worktrees/qi-three-robustness-bugs/src/web/stale-shell.ts:243) could reload an abandoned load when its URL stayed unchanged. The load’s abort signal now vetoes recovery before the session reload is claimed.
- **C-3 — P1, established, fixed:** [settled navigation aims](/home/greg/code/spideryarn2/.claude/worktrees/qi-three-robustness-bugs/src/web/keynav.ts:150) survived fixed-position reflow; Diagram also retained numeric aims after block reordering. Later presses now validate target geometry, and mapping changes replace the chain. Tests also caught and fixed stale button appearance when invalidation left the measured row unchanged.
- **C-4 — P1, established, only reported; wider scope:** [the public server DTO](/home/greg/code/spideryarn2/.claude/worktrees/qi-three-robustness-bugs/src/public/dto.ts:315) spreads missing `children` before client normalization. Real `publicArticle` probes threw for both root and inner nodes; the public route converts this to HTTP 500. Stage B’s visitor tests prove safety for a **delivered payload**, not malformed storage end to end.
- **C-5 — P2, established by tracing, only reported; wider scope:** [server Skim’s walker](/home/greg/code/spideryarn2/.claude/worktrees/qi-three-robustness-bugs/src/section-path.ts:47) still reads `children.length` directly. Already noted in the plan; unchanged.

P-1/P-2 were incomplete and are now corrected. P-3 through P-8 were built as accepted. Client normalization survives sanitization and subsequent article processing. The static maths import introduced no new eager-graph or cycle issue. Reader forwards Diagram completion correctly, including already-there and missing-target branches.

Validation passed:

- Stage A: **369 tests / 15 files**.
- Stage B: **43 new tests**, plus **153 nearby tests**.
- Stage C: **438-test regression run**; final chain/button tests **42/42**.
- Final navigation/doc-link run: **58/58**.
- All four TypeScript projects passed through the same typecheck script using `node --import tsx`; the normal launcher’s socket was prohibited.
- Scoped lint passed with existing warnings; `git diff --check` passed. Mutation checks produced failures and were restored.

Docs and two postmortems record the fixes and limits. Remaining checks for your environment: full `npm test`, plus desktop/iPad/phone browser checks for delayed maths recovery, same-URL cancellation, rapid taps, reduced motion, clamped ends and reflow.

| Stage | Verdict |
|---|---|
| B | **ship** within its client scope; C-4/C-5 remain reported |
| A | **ship with your fixes** |
| C | **ship with your fixes** |