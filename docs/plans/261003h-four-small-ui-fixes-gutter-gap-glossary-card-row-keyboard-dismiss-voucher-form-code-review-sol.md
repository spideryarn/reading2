Four findings, all fixed in the working tree:

- **F1 · P1 — [SearchPanel.tsx:579](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/src/web/SearchPanel.tsx:579):** “find” sent the search but kept the keyboard up. Dismissal now lives in the shared guarded action. **Red:** quick and meaning button-focus cases in `quick-search-panel.test.tsx`.

- **F2 · P1 — [GlossaryPanel.tsx:1650](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/src/web/GlossaryPanel.tsx:1650):** a locally refused term lost focus while still needing correction. Dismissal now checks shared validation and busy state. **Red:** malformed-term focus case in `glossary-ask-adds-term-band.test.tsx`.

- **F3 · P1 — [ChatPanel.tsx:2162](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/src/web/ChatPanel.tsx:2162):** completing `live.stop()` dismissed the keyboard from a second draft typed during the wait. The guard now preserves that draft’s focus. **Red:** deferred-handoff case in `the-enter-key-really-sends.test.tsx`.

- **F4 · P2 — [glossary-card-actions.test.tsx:193](/home/greg/code/spideryarn2/.claude/worktrees/fb-four-small-ui-fixes/tests/glossary-card-actions.test.tsx:193):** all 12 original tests passed with the entire card CSS change removed. Added a CSS contract guard. **Red:** CSS-removal and `inline-flex → block` mutations; restored CSS passes.

Final checks: **318 tests across 17 files passed**. Typechecking passed through `node --import tsx scripts/typecheck.ts`; the npm invocation hit sandbox IPC `EPERM`. Lint returned four existing informational diagnostics. No Postgres or physical-keyboard checks ran.

The glossary test initially failed on my incorrect expected error wording; I corrected it and reproduced the focus failure separately. Changes remain uncommitted.

**Verdict: PASS after these fixes.**