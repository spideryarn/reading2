1. **should** — [src/messages.ts:289](/var/tmp/spideryarn-worktrees/bug-lease-rebuys-search/src/messages.ts:289): the sentence claimed the search definitely started, although the marker precedes dispatch. Changed it to the truthful “may already have started” wording and updated the plan.

2. **should** — [tests/jobs-paid-step-once.test.ts:182](/var/tmp/spideryarn-worktrees/bug-lease-rebuys-search/tests/jobs-paid-step-once.test.ts:182): the original tests did not pin the live-attempt fence or lock. Added wrong-attempt, expired-attempt, and concurrent-beginning coverage. Also added forced-fresh-job and active-enqueue coalescing cases at [line 264](/var/tmp/spideryarn-worktrees/bug-lease-rebuys-search/tests/jobs-paid-step-once.test.ts:264) and [line 272](/var/tmp/spideryarn-worktrees/bug-lease-rebuys-search/tests/jobs-paid-step-once.test.ts:272).

3. **nit** — [drizzle/meta/20261009132350_snapshot.json:5448](/var/tmp/spideryarn-worktrees/bug-lease-rebuys-search/drizzle/meta/20261009132350_snapshot.json:5448): the generated snapshot is correct but remains untracked and absent from the scoped diff. Include it in the eventual commit alongside the journal entry at [drizzle/meta/_journal.json:1290](/var/tmp/spideryarn-worktrees/bug-lease-rebuys-search/drizzle/meta/_journal.json:1290).

No further correctness issue found in the transaction, lifecycle settlement, row mappings, exports, message registration, cleanup, or private-lane registration.

Checks: the underlying typecheck passed all 3,586 source files; message and migration-registry suites passed 37 tests; Biome and `git diff --check` passed. The exact requested commands could not complete because this sandbox forbids `tsx` IPC sockets and local Postgres TCP, so the two database suites still need running outside this sandbox.

APPROVE WITH CHANGES (made)