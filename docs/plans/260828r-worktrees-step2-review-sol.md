## Findings

1. **High — [scripts/worktree-port.ts](/home/greg/code/spideryarn2/scripts/worktree-port.ts:109): the lease dies before the server uses it.**

   `claimPort` holds a process-scoped `takeLockFile`; [lockfile.ts](/home/greg/code/spideryarn2/scripts/lockfile.ts:213) releases it on process exit. But the plan says the one-shot `worktree:setup` command claims the port, records it, then exits. At that moment the lease disappears. Two sequential setups can therefore both record 5273.

   The tests keep leases alive in one Vitest process, so they cannot expose this boundary. Either:

   - claim and hold the lease in the Vite process/a `worktree:dev` wrapper for the server’s lifetime; or
   - create a separate persistent worktree reservation, released during worktree removal.

   The current lock cannot be used by setup as planned.

2. **High — [vite.config.ts](/home/greg/code/spideryarn2/vite.config.ts:225): `strictPort` is the wrong call for this shared-tree slice.**

   It is the right final backstop, but today it prevents every second agent from starting a server. A fallback server on 5274 remains useful for non-auth work, especially server code: the API middleware is imported at server boot, so an agent cannot assume somebody else’s existing 5273 process reflects their changes.

   Defer `strictPort: true` until allocation is wired. For now, keep fallback and add a conspicuous post-`listening` warning based on `httpServer.address()`:

   > Running on 5274; Google sign-in will fail because this port is not allow-listed.

   A `configureServer` hook that throws is not better—it trades the same limp for the same stop, only later and with more machinery.

3. **Medium — [vite.config.ts](/home/greg/code/spideryarn2/vite.config.ts:224): the environment variable bypasses the allocator’s range guarantee.**

   `Number(value) || 5273` silently converts malformed, empty, and zero values to 5273, while a truthy out-of-range integer goes directly to Vite. Thus:

   - `SPIDERYARN_DEV_PORT=oops` silently collides with the primary;
   - `SPIDERYARN_DEV_PORT=6000` starts outside the auth allow-list;
   - the allocator’s refusal protects nothing at this seam.

   A set value should be parsed strictly after `loadEnvLocal()`, required to be an integer, and checked with `portInRange`; otherwise startup should fail. `portInRange` is right to reject non-integers.

4. **Medium — [scripts/worktree-port.ts](/home/greg/code/spideryarn2/scripts/worktree-port.ts:61): nothing actually reserves 5273 for the primary.**

   A worktree calling `claimPort()` first receives 5273. The primary does not lease its fixed port, and the file claim does not notice an existing listener. Consequently:

   - if the primary is running, the worktree claims an unusable lease and then fails at Vite;
   - if it is not running, the worktree can take 5273 and later block the primary.

   Either reserve 5273 exclusively for the primary and allocate worktrees from 5274, or make every server—including the primary—participate in the same runtime lease protocol and stop promising that the primary always keeps 5273.

5. **Low — [scripts/worktree-port.ts](/home/greg/code/spideryarn2/scripts/worktree-port.ts:104): the test seam defeats the stated range invariant.**

   `claimPort({ ports: [9999] })` succeeds because only `want` is validated. Since `ClaimPortOptions` is exported, “claimPort refuses ports outside the range” is not true. Remove `ports`, make it private, or validate every candidate.

6. **Low — [scripts/worktree-port.ts](/home/greg/code/spideryarn2/scripts/worktree-port.ts:163): `leasedPorts` accepts numeric names that are not lease files.**

   A file or directory named `5273` is reported as a lease. Filter with an exact `^(\d+)\.lock$` match and preferably `portInRange`. Its error policy is otherwise right: `ENOENT` means none; every other read failure should propagate.

7. **Low — [scripts/typecheck.ts](/home/greg/code/spideryarn2/scripts/typecheck.ts:58): skipping all of `.claude` creates a future silent typecheck hole.**

   `.claude` contains tracked project hooks and settings; a future TypeScript hook would be checked by nothing. Skip only the root `.claude/worktrees` path rather than every directory whose basename is `.claude`.

## Direct answers

- **`strictPort`: wrong now, right in the completed port system.** I would remove it from this slice.
- **Biome, Knip and jscpd:** the “no change needed” conclusion is correct. Biome’s allowlist is root-scoped and Git ignore adds another barrier; Knip’s project globs are root-scoped with no workspace discovery here; jscpd receives only the root `src api scripts evals` directories.
- **Vite watcher:** correct; its local implementation appends the supplied ignores to `.git`, `node_modules`, and other defaults.
- **Shared git directory:** `--git-common-dir` is correct. I verified that the existing linked worktree here resolves to the primary’s `.git`. Location outside `.claude/worktrees` does not matter; a worktree created from a worktree still shares it. A submodule correctly has a separate repository and therefore separate leases.
- **Range literals:** no remaining realistic test literal is invalidated merely by widening `count`. The computed `justPast` fixes the real mistake. The `ports` injection bypass is the more important range weakness.
- **Partial step 3:** with no current `SPIDERYARN_DEV_PORT`, omitting the expanded Supabase allow-list does not create an auth mismatch today. The partial landing’s immediate problem is `strictPort`, and its future blocker is the lease lifetime.
- **`.gitignore` / `.worktreeinclude`:** both match the official Claude Code contract: root `.worktreeinclude`, gitignore syntax, and only gitignored matching files copied. [Claude Code worktree documentation](https://code.claude.com/docs/en/worktrees)

Checks: Biome passed on the four touched TypeScript files. Root and web TypeScript projects passed; the tests project has three unrelated shared-tree errors. The focused Vitest suite could not run in this read-only review sandbox because Vite/Vitest attempted to create temporary files; no test assertions ran.