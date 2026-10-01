Reviewed and fixed three P2s. No P0/P1 findings.

- P2 — [ArticleCost.tsx:155](/home/greg/code/spideryarn2/.claude/worktrees/fb7g-metadata-costs-and-export/src/web/ArticleCost.tsx:155): an unreported live conversation made the collapsed summary say “At least …”, while the expanded total appeared complete. Both now use the same floor condition; coverage added at [article-cost-section.test.tsx:172](/home/greg/code/spideryarn2/.claude/worktrees/fb7g-metadata-costs-and-export/tests/article-cost-section.test.tsx:172).

- P2 — [article-cost-section.test.tsx:245](/home/greg/code/spideryarn2/.claude/worktrees/fb7g-metadata-costs-and-export/tests/article-cost-section.test.tsx:245): the admin-only source pin could remain green if a second unguarded `CostSection` mount were added. It now asserts exactly one mount and ties failure detection, forced-open behavior, summary, and body together.

- P2 — [Metadata.tsx:1005](/home/greg/code/spideryarn2/.claude/worktrees/fb7g-metadata-costs-and-export/src/web/Metadata.tsx:1005): several comments still described Export beside Sharing/above machinery, Archive as last, and Re-run immediately below Technical details. Updated those and the stale test description at [metadata-page-order.test.tsx:229](/home/greg/code/spideryarn2/.claude/worktrees/fb7g-metadata-costs-and-export/tests/metadata-page-order.test.tsx:229). No stale placement claims remained in the requested sweep.

Checks:

- Scoped Vitest command: 5 files, 97 tests passed.
- Typecheck: all four projects passed. The literal npm command’s `tsx` launcher hit sandbox IPC `EPERM`; running the same checker via `node --import tsx scripts/typecheck.ts` passed.
- Touched-file Biome lint: clean.
- No full suite run; no commit made.
- Wider work left: none found inside this change.

Verdict: **APPROVE after fixes — 7G/7H are implemented and cost rendering/requesting remains admin-only.**