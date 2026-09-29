Code review of the built change, with licence to fix. Repo: spideryarn2, this worktree. The change is the commit at HEAD (`git show HEAD`). Plan: docs/plans/260929f-mode-bar-regroup-glossary-ideas-timeline-with-trajectory-search-with-chat.md; your plan review is docs/plans/260929f-sol-plan-review.md — check each of its findings is addressed in the code.

The conclusion I would least like to be wrong about: that every row comment in MODES_UI (src/web/Dock.tsx) now describes the row's actual position and run, and no comment, test or doc still describes the old six runs or the group names `passages`, `dimensions`, `talk`, `contents`, `ask` as current. Read the whole MODES_UI block and the ModeGroup docblock, not just the diff.

Also confirm tests/dock-mode-order.test.ts still fails if a run is split or the order moves (it is hand-written on purpose), and that nothing else in tests/ or docs/project/ asserts the old order as current.

Fix what you find inside this change (edit files; do not commit). `npm run typecheck` is safe; vitest may be refused by the box's memory guard — if so, say so rather than reporting tests as passing. Report each finding with file:line, severity, and whether fixed.
