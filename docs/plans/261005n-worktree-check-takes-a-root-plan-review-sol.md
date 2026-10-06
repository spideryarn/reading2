**Verdict: revise the plan before building it.** The three conditions are necessary, but they do not fully establish which worktree’s Git state is being inspected. Stage 2 also misses a setup dependency.

I reviewed the plan against `origin/dev` (`a0f5a2b`); concurrent implementation edits were excluded. Source line numbers below refer to that baseline. I changed no files.

1. **F1 — P1: inherited Git variables can satisfy the guards while selecting another tree’s metadata.**  
   Evidence: `scripts/worktree-check.ts:593` inherits `process.env`; `scripts/worktree-port.ts:147` and `:183` also inherit it.

   I confirmed this with a read-only probe: setting `GIT_DIR` to the readiness worktree’s administration directory and `GIT_WORK_TREE` to this worktree made Git report this worktree’s top-level and the expected common directory, but branch `readiness-checks`.

   A clean target with an unlanded empty commit could therefore pass all three proposed conditions while ancestry, index flags and operation state come from a landed sibling.

   **Change the plan:** require a consistent scrubbed environment for validation **and every Git call reached by `gather`**, including the port helpers. Scrubbing only the new CLI probes is insufficient. Add poisoned-environment tests. Sweep and remove share this existing weakness.

2. **F2 — P1: matching top-level and common directory does not prove the `.git` pointer belongs to that registration.**  
   Evidence: `scripts/worktree-port.ts:170` considers differing Git directories sufficient for “linked”; `scripts/worktree-check.ts:945` then reads branch and status through that pointer. The existing defence is documented and implemented in `scripts/readiness-loop.ts:271` and `:354`.

   Copying sibling B’s `.git` pointer into directory A can leave `--show-toplevel` reporting A and `--git-common-dir` reporting this repository. All three proposed conditions pass, while the check reads B’s HEAD and index. Even requiring A to appear in `worktree list` would not detect a mismatched pointer in an existing registration.

   **Change the plan:** verify that the canonical root is registered to this repository and that its administration directory’s `gitdir` backlink resolves to this root’s `.git` file. Add copied-pointer tests, including a pointer borrowed from a sibling of the same repository.

3. **F3 — P2: canonicalisation must determine the root passed to `gather`, not just the comparison.**  
   Evidence: `scripts/worktree-check.ts:898` and `:916` compare the supplied root literally with `/proc/<pid>/cwd`.

   The plan permits a symlink alias because it compares real directories. Passing that alias onward would miss listeners whose cwd uses the real path. Passing `/tree/` unchanged also misses a listener standing exactly at `/tree`.

   **Change the plan:** explicitly return the canonical real root from validation and use it throughout gathering and reporting. Add listener regressions for a symlink alias and a trailing slash. Alternatively, refuse aliases explicitly.

4. **F4 — P1: a fresh external readiness runner bypasses the dependency bootstrap.**  
   Evidence: `scripts/readiness-loop.ts:429` runs `npx tsx scripts/worktree-setup.ts`; creation calls it at `:482` and treats failure as fatal at `:483`. Setup imports `deploy-checks.ts`, whose line 15 imports `smol-toml`.

   In a fresh external tree, `npx` obtaining `tsx` does not supply the package imported by the setup script. The bootstrap introduced by the preceding plan is specifically what installs those dependencies before loading TypeScript. Changing only the runner path therefore leaves fresh creation unable to finish setup.

   **Change Stage 2:** invoke `npm run worktree:setup` through the bootstrap. Add a creation-path check for an external runner without dependencies; the three existence-selector tests cannot catch this failure.

5. **F5 — P1: choosing an existing directory does not establish that it is the dedicated runner.**  
   Evidence: `scripts/readiness-loop.ts:449` reuses an existing path; `runnerWorktreeProblem` checks directory identity and repository membership, but not branch ownership. At `:761`, `tick` validates it and then fast-forwards it before deciding whether to run checks.

   If both locations exist, the old location wins even when it is a clean worktree on another branch and the external location holds `readiness-checks`. The loop can then fast-forward that other branch. This is an existing hole that the new selector would preserve.

   **Change Stage 2:** require a reused runner to be on `readiness-checks` before any merge or preparation. Refuse an ambiguous or unsuitable selected path without moving anything automatically. Test both paths existing with the dedicated branch at each location.

The remaining checks came out as follows:

- **Script-relative reads:** I found no filesystem comparison mistakenly anchored to the executing script. `corpusStrays` uses the target’s fixture corpus; copied environment files use the target repository’s primary. Running the primary’s newer classifier is already the sweep/remove policy.
- **Other step-3 dependencies:** explicitly include `tests/fleet-actions-route.test.ts:154` and `tests/fleet-enacted-receipts.test.ts:296`, whose failure injectors recognise the old argv. Route tests also assert the complete argv. Production receipt handling records step indices and verdicts, so I found no production parser tied to the old command.
- **Runner location:** old-first is reasonable for a valid existing runner, including when both paths exist. It avoids asking Git to check out `readiness-checks` twice. I found no second code path computing its location.
- **Deleting step 3:** I prefer this for the dashboard-only fix. `worktree-remove.ts:671` repeats the check and refuses before unlocking or deleting anything; its later guards are stronger. Both refusals become `plan-stopped` receipts. Keeping a separate inspection step can improve presentation, but it adds no deletion protection. The standalone `--root` feature remains useful independently.