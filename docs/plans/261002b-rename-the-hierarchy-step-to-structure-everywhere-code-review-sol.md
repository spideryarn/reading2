**Verdict: ready with the fixes applied, pending database validation by the owner.** Five scoped findings fixed; two wider issues remain. No database access, commits or Git state changes.

1. **P1 — `drizzle/20261002123135_structure_step.sql:52`: fixed.** The drain guard could race with enqueue/claim. Added transaction-held locks before the guard, with `NOWAIT` to refuse busy tables.
2. **P2 — `src/store/pg-revisions.ts:2627`, `:2404`: fixed.** Raw publication readers bypassed retired-name translation. Rebase policy and reset successors now translate names.
3. **P2 — `src/web/ArticleCost.tsx:40`: fixed.** Historical ledger rows still displayed `hierarchy`. Display names now translate; ledger facts remain unchanged.
4. **P3 — eval review documents: fixed.** Restored links to renamed live files while preserving historical results paths.
5. **P3 — `src/store/checkpoints.ts:164`: fixed.** Corrected misleading namespace prose, missed step-name comments and a nonexistent test reference.
6. **P2 — `evals/cost/harness.ts:256`: left for decision.** The preexisting cost eval still assumes labels run inside structure. Its measurement scope needs updating.
7. **P3 — `evals/thinking-effort/lineup.ts:115`: left for decision.** The CLI retains `--hierarchy-run`; consider a preferred `--structure-run` alias.

**Validation:** 178 unit tests passed; three regressions failed before their fixes. Typechecking passed through Node’s `tsx` loader. All 201 prompt template literals were unchanged. Lint reported only existing findings. SQL execution and database tests were excluded as instructed.

[Full review and migration analysis](/home/greg/code/spideryarn2/.claude/worktrees/fbwdfb4h-rename-hierarchy-to-structure/docs/plans/261002b-rename-the-hierarchy-step-to-structure-everywhere-code-review-sol.md).