No P0–P2 defects found.

1. **P3 — stale privacy comment.** [Reader.tsx:893](/home/greg/code/spideryarn2/.claude/worktrees/fu-citations-already-in-spideryarn/src/web/reader/Reader.tsx:893) still falsely said citations had no public projection. Fixed to describe the owner-only prose path and explicit hover-card lock accurately. The plan review log’s “stale comments fixed” conclusion is now correct.

2. **P3 — SQL privacy checks depended on the Postgres suite.** Added [cited-in-spideryarn-sql.test.ts:18](/home/greg/code/spideryarn2/.claude/worktrees/fu-citations-already-in-spideryarn/tests/cited-in-spideryarn-sql.test.ts:18), which checks the grouped `WHERE`, public archive exclusion, readability bars, left join, and owner-only requested URL, rename, and canonical-guess `CASE`s without a database. Mutations removing ownership or archive guards failed. Existing tests also failed when identifier tiering, ownership/archive ranking, real-ID tie-breaking, or the hover-card gate were reversed.

3. **P3 — Postgres execution remains unverified here.** The requested combined command failed before running tests because the sandbox cannot connect to `127.0.0.1:54362`; this is not counted as a pass. The four connection-free suites pass: **112 tests**. The underlying typecheck passes for all four TypeScript projects and all 2,526 source files.

Verdict: **Ship after rerunning the Postgres suite outside the sandbox; the reviewed privacy and ranking logic is correct.**