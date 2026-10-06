The diagnosis is right, and the proposed builds preserve all five failure checks. I found no established P0 or P1. Three nonblocking findings:

1. **F1 — P2, established: the proposed red-first sequence can run the suite recursively.** At the base, [check.ts](/var/tmp/spideryarn-worktrees/fresh-worktree-build-reds/scripts/check.ts:50) recognises only `--fast` and `--offline`; `--list` falls through to the execution loop, including `npm test`. Adding the proposed test before implementing `--list` therefore starts another full check, potentially collecting that same test again. Implement the listing branch first, then demonstrate the ordering test going red because the fleet step is absent. Add a subprocess timeout as containment.

2. **F2 — P2, established: the readiness runner already owns another fleet-build path.** [prepareRunner](/var/tmp/spideryarn-worktrees/fresh-worktree-build-reds/scripts/readiness-loop.ts:604) calls `ensureFleetClient` before running `check`. With the proposed change, ticks requiring preparation build the fleet client twice. The existing mitigation’s comment explicitly identifies adding a step to `check.ts` as the real repair. Decide whether to remove that mitigation or retain its distinct failure handling, and update its explanation.

   The caller inventory also misses two direct suite entry points: [readiness-run.ts test](/var/tmp/spideryarn-worktrees/fresh-worktree-build-reds/scripts/readiness-run.ts:266) runs bare `npm run test`, and [store-migration-witness.ts --full](/var/tmp/spideryarn-worktrees/fresh-worktree-build-reds/scripts/store-migration-witness.ts:427) runs the instrumented suite without building. Neither necessarily needs changing, but the plan should state their prerequisite rather than claim an exhaustive three-place inventory.

3. **F3 — P2, reasoned: moving builds outside Vitest does not eliminate concurrent-build races.** The plan says its chosen approach avoids that problem. Both setup and check remain uncoordinated writers; the API and fleet configurations empty their output directories. Two checks in one tree, or setup overlapping a test run, can still remove files another process is inspecting. This is partly an existing risk, so I would narrow the claim and explicitly keep the deletion control in the disposable worktree. Separate fresh worktrees do have separate output directories.

The remaining choices look sound:

- `--fast` should retain fleet builds while preserving its existing API-only product build. It still requires an earlier client build.
- `--offline` currently **does not skip the test gate**; preserve that behaviour and correct the stale documentation while touching it.
- The bootstrap stays dependency-free; builds belong after installation in the TypeScript setup. The primary-checkout refusal still precedes them.
- Nonfatal setup build failures are defensible with explicit `FAIL` output and rerun instructions. Setup is preparation, not an authoritative test verdict.
- `--list` is reasonable if it prints the actual execution steps. Keeping `SUITE_BUILDS` beside `GATE_TOOLING_BUILDS` also avoids another module without adding a new dependency to setup.
- I found no new Knip dependency on build output. The timing remains one measurement at load 17, not a high-load guarantee.

No files changed; this was a code-inspection review.

VERDICT: approve