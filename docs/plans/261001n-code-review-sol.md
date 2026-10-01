No P0 or P1 findings remain. I found and fixed three P2 issues.

- **P2 — unsafe ID serialization could bypass filtering.** [OnScreenLinksStyle.tsx:34](/home/greg/code/spideryarn2/.claude/worktrees/fb-trajectory-question-and-visible-block-links/src/web/OnScreenLinksStyle.tsx:34) joined IDs with spaces and later split them, so an invalid ID containing whitespace could become multiple valid selectors after the safety check. The component now stores the already-filtered CSS string directly. Added a regression test.

- **P2 — a queued observer callback could schedule work after cleanup.** [OnScreenLinksStyle.tsx:49](/home/greg/code/spideryarn2/.claude/worktrees/fb-trajectory-question-and-visible-block-links/src/web/OnScreenLinksStyle.tsx:49) now guards both observer callbacks and measurements with a lifecycle flag. The test exercises callback delivery after unmount.

- **P2 — the runtime rule could override missing-reference styling.** [on-screen.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/fb-trajectory-question-and-visible-block-links/src/web/on-screen.ts:108) now explicitly excludes `.block-ref-missing`. This matters because the runtime style is unlayered and therefore outranks the application’s layered CSS.

The requested areas otherwise check out:

- The `rowsOnScreen`/cache move preserved the original 10-second `>` staleness boundary and first/last `isConnected` checks exactly. Regression coverage is now at [on-screen.test.ts:19](/home/greg/code/spideryarn2/.claude/worktrees/fb-trajectory-question-and-visible-block-links/tests/on-screen.test.ts:19).
- `bandOpen && fit.modeW > 0` correctly means band and prose are painted side by side.
- `table.zoom` exists when the passive effect runs: `Reader` renders only with an article, and React commits `TableView` before effects. Mode switches retain the table. Both `layoutKey` and the observed table cover later reflow.
- The generated wash wins against the named per-mode backgrounds. `opacity: 1` is compatible with hover rules; Summary’s parent `.summ-range` intentionally remains dimmed.
- The Trajectory DOM order and its regression test are correct.

Validation:

- Requested five-file Vitest run: **157 passed**.
- Typecheck: all four projects passed and all 2,560 source files were covered using `node --import tsx scripts/typecheck.ts`. The literal `npm run typecheck` wrapper could not create its `tsx` IPC socket in this sandbox (`EPERM`).
- Touched-file lint and `git diff --check`: passed.
- Full `npm test` was attempted but could not reach the required local Postgres service.
- No commit made. The pre-existing untracked review prompt was left untouched.

**Verdict: approve after the in-worktree P2 fixes. No wider findings requiring a decision.**