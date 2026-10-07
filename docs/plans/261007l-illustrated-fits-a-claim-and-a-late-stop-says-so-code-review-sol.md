1. **Medium — unusable checkpoints were trusted.** Corrupt JSON failed the step; parseable junk yielded an empty set. Fresh malformed answers were also saved before validation. [illustrated.ts:1342](/var/tmp/spideryarn-worktrees/illustrated-split-and-late-stop/src/illustrated.ts:1342) now validates cached answers through the existing reader, regenerates unusable hits, and banks fresh answers only after validation. **Seven tests observed red before the fix, then green.**

2. **Low — unreachable cancellation machinery.** Removed `discardOnAbort` from [pipeline.ts:823](/var/tmp/spideryarn-worktrees/illustrated-split-and-late-stop/src/pipeline.ts:823), its producer, the consumer in [jobs.ts:1524](/var/tmp/spideryarn-worktrees/illustrated-split-and-late-stop/src/jobs.ts:1524), and the synthetic test. This is cleanup: cancelled sets already throw before returning a product. Unit checks pass.

3. **Low — tests missed cancellation wiring and exhausted-window handling.** Added real image retry tests in [illustrated-run.test.ts:1030](/var/tmp/spideryarn-worktrees/illustrated-split-and-late-stop/tests/illustrated-run.test.ts:1030) and a final-window case in [jobs-tier0-offline.test.ts:116](/var/tmp/spideryarn-worktrees/illustrated-split-and-late-stop/tests/jobs-tier0-offline.test.ts:116). **Removing signal forwarding made both image cases red; disabling hand-back handling made the queue case red. All pass after restoration.**

No further defect found in the clocks, checkpoint key, or Part 2. Retry waits honour cancellation; native timeout signals don’t keep Node alive. Both add surfaces share `JobCard`, which renders the late-Stop sentence.

Validation: **130 unit tests pass**. The full typecheck script passes through `node --import tsx scripts/typecheck.ts`. Scoped lint has warnings/info only.

Left for you:

- Rerun the requested seven-file command with local sockets available. It was attempted but database setup failed with `EPERM`; the three database-backed suites remain unverified.
- The exact `npm run typecheck` command also fails with `EPERM` creating tsx’s IPC socket.
- Ship the namespace migration with Part 1 once the migration blocker is resolved.

Nothing committed, pushed, or migrated. No wider findings.