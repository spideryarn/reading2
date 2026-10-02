Verdict: **Stage B is ready after one P1 fix.** No P0s or remaining P1/P2 findings.

### Finding

- **F20 — P1 — Established — fixed:** The command called the reverse archive action “Unarchive this article,” violating the app’s established “Put back” terminology. Changed it to **“Put this article back”** while retaining `unarchive` and `restore` as aliases in [article-commands.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/article-commands.ts:175). Tests failed first, then passed: [command-match-metadata-rows.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/tests/command-match-metadata-rows.test.ts:96) and [command-bar-metadata-rows.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/tests/command-bar-metadata-rows.test.tsx:265).

Cleared attack points:

- Metadata’s early Archive/Export rows cannot reach a production 404: Metadata is mounted only after `OwnedArticle` has established ownership.
- Archive captures an explicit desired boolean, not a toggle; overlapping writes are rejected and state changes rebuild the row.
- Export’s busy guard is per slug and cleared in `finally`.
- Archive and Export result unions are handled exhaustively.
- Ranking remains sound for `share`, `export`, `archive`, `opus`, `settings`, and `details`.
- Failures remain visible in the open or reopened bar.

Checks:

- Relevant suites: **22 files, 449 tests passed**
- Both direct TypeScript checks passed
- Biome lint passed on changed code/tests
- `git diff --check` passed
- Full `npm test` could not start because the local database is unavailable
- `npm run typecheck` hit the sandbox’s `tsx` IPC restriction; the permitted direct `tsc` commands passed
- No commit or index changes made

Files changed:

- [article-commands.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/article-commands.ts)
- [CommandBar.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/src/web/CommandBar.tsx)
- [command-bar-metadata-rows.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/tests/command-bar-metadata-rows.test.tsx)
- [command-match-metadata-rows.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/tests/command-match-metadata-rows.test.ts)
- [reading-view-overview.md](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/project/reading-view-overview.md)
- [261002c plan](/home/greg/code/spideryarn2/.claude/worktrees/fb8d-commands-and-interface-llm/docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md)