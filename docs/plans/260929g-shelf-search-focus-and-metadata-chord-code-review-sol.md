Found and fixed one in-stage issue.

- **F7 — P1:** “Wholly on screen” only checked vertical bounds, so a horizontally clipped search box still took focus. Evidence: regression test failed at [shelf-search-focus.test.tsx:168](/home/greg/code/spideryarn2/.claude/worktrees/shelf-focus-and-metadata-chord/tests/shelf-search-focus.test.tsx:168). Fixed by checking all four viewport edges in [Library.tsx:934](/home/greg/code/spideryarn2/.claude/worktrees/shelf-focus-and-metadata-chord/src/web/Library.tsx:934). The test was observed red, then green.

The suspicions otherwise check out: owner and visitor reading views both mount `Dock` with `view="article"`; metadata pages use `"metadata"`. The tooltip is clear enough. The search box follows a compact header and add card; a genuinely short viewport intentionally suppresses focus when it is below the fold.

Verification:

- Relevant suite: 9 files, 141 tests passed.
- Regression test: 6/6 passed.
- Typecheck: all 2,344 source files covered and passed via `node --import tsx scripts/typecheck.ts`; the npm wrapper itself hit a sandbox IPC restriction.
- Touched-file lint: no new errors, only three pre-existing complexity notices.
- Full `npm test`: admission guard refused to start due machine memory pressure; no tests ran.

**Verdict: approve after F7’s applied fix.**