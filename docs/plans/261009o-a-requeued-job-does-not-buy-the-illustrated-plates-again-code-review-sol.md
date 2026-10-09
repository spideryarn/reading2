No correctness blockers found. The marker is placed after hand-back decisions and before any plate request, and lost claims surface as `busy`, not as reader-facing failures.

### Must

- None.

### Should

- [tests/illustrated-step-registration.test.ts:898](/var/tmp/spideryarn-worktrees/bug-illustrated-rebuys-plates/tests/illustrated-step-registration.test.ts:898) — no direct test covered `beginPaidWork` throwing `StaleAttemptError`. Fixed: the test now proves the original error propagates and no plate is sent.
- [src/db/schema.ts:2984](/var/tmp/spideryarn-worktrees/bug-illustrated-rebuys-plates/src/db/schema.ts:2984) and [src/jobs.ts:424](/var/tmp/spideryarn-worktrees/bug-illustrated-rebuys-plates/src/jobs.ts:424) — comments still described only whole-step protection. Fixed to cover both Debate and Illustrated’s internal purchase.

### Could

- [tests/illustrated-step-registration.test.ts:359](/var/tmp/spideryarn-worktrees/bug-illustrated-rebuys-plates/tests/illustrated-step-registration.test.ts:359) — the hanging promise itself cannot resume or mutate later cases, and its flag already had `finally` cleanup. Fixed defensively by resetting `plateHangs` and `briefTakesMs` in `beforeEach`.

Checks:

- Offline targeted tests: 125 passed.
- Typecheck: all four projects passed; all 3,595 source files covered. The npm wrapper itself hit sandbox IPC permissions, so I ran the same script directly with Node.
- Mutation: removing `beginPlates` made the red-first test fail because the second window painted two plates.
- `git diff --check`: passed.
- Lint: no new errors; existing complexity notices and the unrelated optional-chain warning remain.
- The Postgres test and full `npm test` could not start because this sandbox cannot reach Docker/Postgres on `127.0.0.1:54362`.

VERDICT: APPROVE WITH CHANGES (made)