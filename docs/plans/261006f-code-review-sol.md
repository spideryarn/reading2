No established P0/P1 in this stage. The classification changes are sound; I fixed five test/prose findings without committing.

- **F33 — P3, established; fixed.** [ai-spend.ts](/var/tmp/spideryarn-worktrees/job-deadline-class/src/ai-spend.ts:553) still excluded Realtime from aborted rows carrying failure fields. The gateway doc also stated the phase/status contract without qualification. Smallest fix: document Realtime’s `abort` class with null phase/status and scope the gateway contract. New prose test observed red, then green.

- **F34 — P3, established; fixed.** [FAILURE_NOTES](/var/tmp/spideryarn-worktrees/job-deadline-class/src/cost-cube.ts:682) described an entire closed conversation as usually leaving no row. Earlier responses can already have rows, and shutdown allows terminal events during grace. Smallest fix: describe the unfinished response without a terminal usage report. Updated the note, comments and docs; new test observed red, then green.

- **F35 — P2, established; fixed, timing risk reduced.** The deadline test could pass when the job signal was already aborted before the request started. An offline gateway probe reproduced its exact ledger and reason assertions in that state. Smallest fix: require an unaborted signal before dispatch. Added that assertion and increased setup allowance from 1.5 to 10 seconds. The fixture probe failed before the fix and passed afterwards. A sufficiently slow database can still exceed the finite allowance; the revised database test needs rerunning.

- **F36 — P2, established; fixed.** An exception before `callsOf()`, or the Stop test’s earlier status assertion failing, bypassed ledger cleanup. Suite teardown removed jobs/articles but not `ai_calls`; `job_id` has no cascading foreign key. Smallest fix: sweep ledger rows belonging to the suite’s fixture slugs during teardown. An offline probe executing the actual teardown failed before the fix and passed afterwards, preserving a peer fixture.

- **F37 — P3, established; fixed.** [ai-gateway.md](/var/tmp/spideryarn-worktrees/job-deadline-class/docs/project/ai-gateway.md:824) said every earlier job-deadline row carried `abort`; rows predating classification can have null class. Qualified the historical statement. New test observed red, then green.

Without the job deadline firing, the hanging call would not settle; an ordinary Stop would fail the deadline assertions. I found no incorrect downstream treatment in the timeout counts, causes table, clock logging or eval budget. Realtime `abort` rows with null phase are handled correctly. Successful-path timers are cleared.

Validation: **231 tests passed across seven database-free files**, typechecking passed via `node --import tsx scripts/typecheck.ts`, and touched-file Biome lint passed. The database suite was unavailable here. F30 remains outside scope.

Changed repository files, all uncommitted:

- [docs/project/admin-costs.md](/var/tmp/spideryarn-worktrees/job-deadline-class/docs/project/admin-costs.md)
- [docs/project/ai-gateway.md](/var/tmp/spideryarn-worktrees/job-deadline-class/docs/project/ai-gateway.md)
- [src/ai-spend.ts](/var/tmp/spideryarn-worktrees/job-deadline-class/src/ai-spend.ts)
- [src/cost-cube.ts](/var/tmp/spideryarn-worktrees/job-deadline-class/src/cost-cube.ts)
- [src/live.ts](/var/tmp/spideryarn-worktrees/job-deadline-class/src/live.ts)
- [tests/admin-costs-page.test.tsx](/var/tmp/spideryarn-worktrees/job-deadline-class/tests/admin-costs-page.test.tsx)
- [tests/claim-session-postgres.test.ts](/var/tmp/spideryarn-worktrees/job-deadline-class/tests/claim-session-postgres.test.ts)
- [tests/cost-cube.test.ts](/var/tmp/spideryarn-worktrees/job-deadline-class/tests/cost-cube.test.ts)
- [tests/cost-failure-docs.test.ts](/var/tmp/spideryarn-worktrees/job-deadline-class/tests/cost-failure-docs.test.ts)

Created offline probes: [start guard](/tmp/job-deadline-start-review-test.mjs), [cleanup](/tmp/job-deadline-cleanup-review-test.mjs).

VERDICT: land it