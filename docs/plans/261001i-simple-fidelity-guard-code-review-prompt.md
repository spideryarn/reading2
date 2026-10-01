# Code review: Simple's fidelity guard, built (261001i)

You are reviewing and, where it is inside this stage, FIXING the code built from
docs/plans/261001i-simple-fidelity-guard-built.md. Read the plan first, including § Reviews (your own
plan review is docs/plans/261001i-simple-fidelity-guard-plan-review-sol.md — check each P1/P2 was
actually done in code, and judge whether declining P1-2's events table is reasonable as argued).

The scoped diff is docs/plans/261001i-simple-fidelity-guard-code-review.diff (commit 93d0a91d against
596653d0). The heart of it: src/simple-check.ts, `writeLevel` in src/simple-summary.ts, the types and
`isSimpleCheck` in src/types.ts, scripts/simple-check-report.ts, tests/simple-check.test.ts and the
new describe blocks at the end of tests/simple-summary.test.ts. The evidence the guard rests on is
docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md § Measuring the guard
and scripts/probes/261001h-fidelity-guard-probe.ts.

Look hardest for:
1. Any path where the guard loses a press that would have been stored without it, spends more than
   two writer and two checker calls a level, stores an unchecked level on a job abort, or treats an
   unreadable/failed check as a pass (silent success: a guard that never really checks).
2. Whether the request production sends really is the measured one (prompt bytes, effort, token
   ceiling, provider policy, model), and whether the tests could fail if it drifted.
3. The `check` record: is it right, validated, absent when off, never reaching a visitor, never
   logged with prose? Any read boundary, export, client or type that breaks on it?
4. The report script: is its SQL right (dedupe of copied-forward artefacts, cost columns including
   BYOK, read-only), and does it claim anything it cannot see?
5. Accounting: checker usage beside, not inside, the writer's totals; the step's log line.
6. Anything else wrong or worse than it needs to be.

Gates: `npx vitest run tests/simple-check.test.ts tests/simple-summary.test.ts tests/public-dto.test.ts
tests/models.test.ts tests/chat-reasoning.test.ts tests/cost-categories.test.ts
tests/plain-words-coverage.test.ts tests/env-names-are-inventoried.test.ts` and `npm run typecheck`
(judge by exit code). Do not make any paid model call. Do not commit.

Fix what you find inside this stage, with a failing test first where it is a behaviour. Report
anything wider for me to decide. Finish with: findings as P0/P1/P2 with file:line, what you changed,
the gate results, and a verdict.
