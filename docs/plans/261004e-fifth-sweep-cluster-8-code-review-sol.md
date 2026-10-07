No P0 or P1 findings. Three narrow findings, all fixed:

- **F5 — P2, established:** removed the unused `CITATION_FIND_*` messages and `cite-resting` registration; corrected their remaining descriptions. Kept the database bucket, documenting that removal needs a migration.
- **F6 — P3, established:** corrected the attribution test’s stale claim that every spending route still wraps itself.
- **F7 — P3, reasoned:** clarified that the lookup model returns JSON while Investigate delivers the checked link and reading through SSE.

The migrated Postgres assertions retain the key read-back guarantees. The Investigate comparison is useful: mutating its yielded response made that exact test fail. R10’s ten callers are correctly classified; the registry labels describe historical import reach. `setup-dev.md` matches the code, and `security-map.md` changes pointers without changing its rules.

Validation: **671 offline tests passed**, all four typecheck projects passed, lint and diff checks passed. Registry completeness passed through an alternate invocation. Full `npm test` stopped at the missing-Postgres preflight.

[Full review and evidence](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c8-routes-deletions/docs/plans/261004e-fifth-sweep-cluster-8-code-review-sol.md). No git-changing commands ran; your existing prompt edit was untouched.

**Verdict: ready with these fixes.**