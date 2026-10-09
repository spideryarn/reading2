**Verdict: land with my fixes, after the focused checks pass outside this sandbox.** No P0 or P1 findings.

- **P3 — Incorrect cleanup promise. Fixed.** [testing.md](/var/tmp/spideryarn-worktrees/qi-4b5598e2-test-tmp-cleanup/docs/project/testing.md:173) still promised that subsequent runs sweep killed-run leftovers. It now describes orderly-exit cleanup and explicitly says there is no sweep.
- **P3 — Inherited ownership lacked regression coverage. Fixed.** [run-temp-root.test.ts](/var/tmp/spideryarn-worktrees/qi-4b5598e2-test-tmp-cleanup/tests/run-temp-root.test.ts:91) now checks that a child reuses the root, adds no cleanup listener, and leaves the owner’s files intact when it exits. Subprocess assertions now check spawn errors and exit status; listener assertions measure the added count.

Wider findings, left unchanged for you to decide:

- **P2 — A child drops `TMPDIR`.** [skim-cue-pairs.test.ts](/var/tmp/spideryarn-worktrees/qi-4b5598e2-test-tmp-cleanup/tests/skim-cue-pairs.test.ts:38) supplies only `PATH` and `NODE_ENV` while running `tsx`, whose transform cache escapes the run root. Pass `TMPDIR` explicitly.
- **P3 — Another literal `/tmp` allocation.** [fleet-receipt-journal.test.ts](/var/tmp/spideryarn-worktrees/qi-4b5598e2-test-tmp-cleanup/tests/fleet-receipt-journal.test.ts:38) bypasses the root. Its `afterEach` cleans ordinary runs, so this loses the fallback rather than establishing a normal-run leak.

The reuse guard is correct under repeated config evaluation: it returns before registering cleanup. All three lanes use forks directly from Vitest’s main process, so `process.ppid` is valid. Removing the config call in a temporary config copy made the owner-identity assertion fail as expected. The fleet owner’s dirname check remains consistent with the inherited `TMPDIR`.

The previously identified macOS socket-length risk remains unverified: the fleet helper’s representative tmux path reaches 113 bytes. I found no additional path-comparison regression.

Validation after edits: the requested five-file run finished **153 passed, 69 failed**, with socket/subprocess `EPERM` blockers. `npm run typecheck` also hit a `tsx` socket denial; running the same script with `node --import tsx` passed all projects. Scoped lint and whitespace checks passed.

Changes remain uncommitted.