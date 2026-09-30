No P0/P1 findings remain. I found and fixed two P2 issues.

## Findings

- **F1 — P2 — fixed:** Cache eligibility used Sonnet’s 1,024-token floor even when sending Opus, whose floor is 512. For label prefixes between those limits, high-power runs skipped cache warm-up and could pay repeatedly for the shared prefix. Hierarchy expansion had the same model-blind calculation, although its current system prompt already exceeds both floors. Both estimators now use the selected model’s floor: [labels.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/src/labels.ts:1162), [hierarchy-expand.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/src/hierarchy-expand.ts:601), with propagation from [hierarchy-deepen.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/src/hierarchy-deepen.ts:1313). The new label regression test failed before the fix and passes now: [labels-batching.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/tests/labels-batching.test.ts:1258).

- **F2 — P2 — fixed:** `generationKey()` returned the mutable `CAPABLE_MODEL_OPENROUTER` constant. It preserves hashes today, but the next capable-model upgrade would change the canonical token and detach stored citation lookup/investigation rows even if the new model joined the same freshness generation. The canonical fingerprint token is now an explicit durable literal: [models.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/src/models.ts:290), guarded byte-for-byte by [high-power-models.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb6c-high-powered-ai/tests/high-power-models.test.ts:100).

Files I touched:

- `src/models.ts`
- `src/labels.ts`
- `src/hierarchy-expand.ts`
- `src/hierarchy-deepen.ts`
- `tests/high-power-models.test.ts`
- `tests/labels-batching.test.ts`
- `tests/hierarchy-expand.test.ts`
- `tests/hierarchy-deepen.test.ts`

I found no remaining defect in model routing, freshness equivalence, exact checkpoint separation, effort parity, spend attribution, route authorization/ownership/body validation, public DTO privacy, or the migration. `buildTree`’s temporary Sonnet stamp is overwritten before `generateHierarchy` returns. The migration’s `ADD COLUMN IF NOT EXISTS` is production-safe, and its snapshot change is limited to the new nullable column.

Validation:

- 12 pure test files passed, 759 tests total.
- Direct TypeScript check passed all four projects and covered all 2,420 source files.
- `npm run typecheck` itself was attempted but `tsx` could not create its IPC socket in this sandbox (`EPERM`); `node --import tsx scripts/typecheck.ts` passed.
- Touched-file lint reported no errors; one pre-existing complexity advisory remains in `src/labels.ts`.
- PostgreSQL-backed `high-power-routes`, `high-power-step`, and `jobs-walk` could not run because the sandbox cannot connect to `127.0.0.1:54362`.
- No commit made. Unrelated concurrent Stage 3/UI changes were left untouched.

VERDICT: ship