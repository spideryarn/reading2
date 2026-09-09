Verdict: **REFUSE**. Two established P1 issues violate the runner’s core invariants.

### RR2-01 — P1 — Established: inherited Git variables can redirect mutations into the primary checkout

[scripts/readiness-loop.ts](/home/greg/code/spideryarn2/scripts/readiness-loop.ts:166) and [readiness-git.ts](/home/greg/code/spideryarn2/tools/fleet/readiness-git.ts:59) pass `process.env` unchanged to Git. `GIT_DIR`, `GIT_WORK_TREE`, or `GIT_INDEX_FILE` override `cwd`/`git -C`.

(a) Launch with `GIT_DIR=<primary>/.git GIT_WORK_TREE=<primary>`. The tick’s `git merge --ff-only origin/dev` at [readiness-loop.ts](/home/greg/code/spideryarn2/scripts/readiness-loop.ts:451) operates on the primary checkout, while the subsequent readiness check still executes in the runner worktree. Its stamps can therefore describe the primary while it tests different files. I confirmed the premise: with `GIT_DIR` set, `git -C /tmp rev-parse HEAD` successfully read this repository, while the same command without it correctly said `/tmp` was not a repository.

(b) Strip all Git repository-location variables in one shared Git environment helper before every Git subprocess: at least `GIT_DIR`, `GIT_COMMON_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES`. Add a test with poisoned values proving commands still address their `cwd`.

### RR2-02 — P1 — Established: a failed change-classification consumes the transition and loses preparation

The fast-forward occurs before `changedPaths()`, but preparation becomes pending only after `changedPaths()` returns successfully at [readiness-loop.ts](/home/greg/code/spideryarn2/scripts/readiness-loop.ts:462).

(a) Start with all preparation flags false. Let dev advance from A to B with a changed `package-lock.json`, then make the single `git diff --name-only` call fail or time out. The tick throws after the branch has already advanced, leaving the flags false. On the next tick, `before === after === B`, so `changedPaths()` returns empty and the runner checks B using A’s `node_modules`. Because `node_modules` is ignored, both tree stamps remain clean. This can create either a sticky false failure or a false pass for B. The same loss occurs if either stamp is temporarily unknown across a successful fast-forward.

(b) Track the SHA whose derived state was successfully prepared, or conservatively latch all preparation flags before any fallible classification whenever the checkout may have advanced. Clear/narrow them only after classification and preparation succeed. Test two ticks: successful fast-forward, injected diff failure, then recovery on the unchanged second tick.

### RR2-03 — P2 — Reasoned: the refusal nonce is recoverable by deliberately hostile test-suite code

[vitest.config.ts](/home/greg/code/spideryarn2/vitest.config.ts:108) deletes the nonce from JavaScript’s `process.env`, but Linux retains the process’s initial environment in `/proc/<pid>/environ`. I directly confirmed that the token remains in `/proc/self/environ` after `delete process.env[...]`.

(a) A mutated Vitest global setup can read the nonce from `/proc/self/environ`, print the exact refusal sentence plus `READINESS_ADMISSION_REFUSAL=<nonce>`, then fail. [readiness-parse.ts](/home/greg/code/spideryarn2/tools/fleet/readiness-parse.ts:67) accepts it and can turn that genuine failure into `void`. Ordinary tests cannot forge it accidentally; this requires deliberate same-user code, which caps the severity.

(b) If literal unforgeability is required, use a one-shot out-of-band channel that the config closes before global setup/workers run, rather than an initial environment secret authenticated through stdout. Otherwise narrow the documented claim to protection against accidental output collisions.

The other suspicions checked out:

- A failure on SHA A does not remain sticky after a fix lands as SHA B; all voting and settled-record filtering is SHA-specific.
- The `vitest.config.ts` diff does not change admission arithmetic or thresholds for other agents. It only consumes the optional readiness nonce and decorates an actual refusal.
- Explicit migration, database-check, and readiness-check subprocesses replace inherited `DATABASE_URL` with the validated loopback URL from `.env.local`.
- No literal `-B`, reset, checkout, clean, rebase, or branch switch appears in the runner.

Verification: `npx vitest run tests/readiness-loop.test.ts` passed, 28/28. No files were changed.