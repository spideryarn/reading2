1. **High — a failed parallel task could still lose paid siblings’ ledger rows.** At [answers.ts:158](/var/tmp/spideryarn-worktrees/openrouter-unledgered-spend/evals/plain-words/answers.ts:158) and [spike-parts.ts:376](/var/tmp/spideryarn-worktrees/openrouter-unledgered-spend/evals/long-documents/spike-parts.ts:376), `Promise.all` rejected while other calls continued, closing their collector too early. Fixed this pattern in seven converted evals by draining siblings before rethrowing. Mocked regressions failed before the fixes and passed afterward.

2. **Medium — the closed-collector test exercised the wrong state.** [unrecorded-spend-refused.test.ts:79](/var/tmp/spideryarn-worktrees/openrouter-unledgered-spend/tests/unrecorded-spend-refused.test.ts:79) invoked its callback outside the captured async scope, testing “no collector.” Fixed it to retain that scope. Also added coverage for inner sinkless collectors, structure-slice refusal propagation, and real/fake `evalSpend` sinks.

3. **Low — stale comments contradicted the change.** Examples: [calls.ts:7](/var/tmp/spideryarn-worktrees/openrouter-unledgered-spend/evals/long-structure/calls.ts:7), [guide/run.ts:18](/var/tmp/spideryarn-worktrees/openrouter-unledgered-spend/evals/guide/run.ts:18), and [spend-declarations.ts:295](/var/tmp/spideryarn-worktrees/openrouter-unledgered-spend/src/spend-declarations.ts:295). Corrected the database-write promises, caller count, and claim that dictation benches stop immediately—raw diagnostics can still spend.

No further functional defect found in fake detection, environment ordering, collector nesting, shutdown ordering, symlink classification, or server/test exemptions.

Checks run:

- `npx vitest run` on the eight core/regression files: **237 tests passed**.
- Additional relevant eval/doc suites: **52 tests passed**.
- `npm run typecheck`: blocked by sandbox tsx IPC permissions. Equivalent `node --import tsx scripts/typecheck.ts`: **all four projects and coverage passed**.
- Scoped Biome lint and `git diff --check`: **passed**.
- `no-undeclared-spend` and `plain-words-wiring`: blocked by sandbox `spawnSync git EPERM`.

Added a [root-cause postmortem](/var/tmp/spideryarn-worktrees/openrouter-unledgered-spend/docs/postmortems/261007s-a-failed-parallel-task-closes-accounting-before-its-siblings-finish.md). Changes remain uncommitted; no paid APIs or production databases were accessed.

**Verdict: fixes applied; no remaining blocking finding in the reviewed scope, with two scan checks sandbox-blocked.**