Verdict: **REFUSE**. F1, F2, F4, and F5 are established P1s. The plan fixes the original failed-diff sequence, but it does not yet guarantee either stated invariant.

## Findings

### F1 — P1 — established: the actual readiness check bypasses the proposed environment scrub

(a) The plan applies `gitEnv()` to `run()`, but the expensive check is launched by a separate raw `spawn()` at [scripts/readiness-loop.ts:398](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/scripts/readiness-loop.ts:398). `runnerLocalDatabaseEnv()` copies `process.env`, so inherited `GIT_*` variables reach `readiness-run.ts`, whose own npm child again copies them at [scripts/readiness-run.ts:253](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/scripts/readiness-run.ts:253).

That can produce a false green. For example, B adds a tracked documentation file containing unresolved conflict markers, while poisoned `GIT_DIR`/`GIT_WORK_TREE` point to clean checkout A. The outer stamps, after the proposed change, correctly say B. But `scripts/conflict-markers.ts` inherits the poison and gets its tracked-file inventory from A at [scripts/conflict-markers.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/scripts/conflict-markers.ts:154), omitting B’s new file. The check can pass and be recorded for B although a clean-environment check of B fails.

(b) Scrub the direct check spawn too, preferably at both boundaries:

```ts
const child = spawn("npx", ["tsx", "scripts/readiness-run.ts", "check"], {
  cwd: runner,
  env: gitEnv(runnerLocalDatabaseEnv(runner)),
  // ...
});
```

And in `readiness-run.ts`:

```ts
env: {
  ...gitEnv(process.env),
  [READINESS_ADMISSION_TOKEN_ENV]: admissionToken,
},
```

Add a test over this spawn boundary; testing only `gitEnv()` does not catch an omitted caller.

### F2 — P1 — established: clean environment does not make `cwd` authoritative

(a) Repository-local `core.worktree` redirects Git despite all seven proposed variables being absent. With Git 2.43.0, I created repository A, configured:

```sh
git -C A config core.worktree B
```

Then, with the seven variables explicitly unset:

```text
git -C A rev-parse --show-toplevel
→ B

git -C A merge --ff-only dev
→ updated A's branch metadata and created the new tracked file in B, not A
```

Adding `--work-tree=A` changed `--show-toplevel` back to A.

Therefore the assertion at [the plan:98](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/docs/plans/260909g-readiness-runner-git-env-and-preparation-latch.md:98) is too strong. A repository’s `.git` `gitdir:` pointer can likewise select another metadata directory; the current linked worktree uses exactly such a pointer.

I also checked the named alternatives:

- `GIT_CONFIG_COUNT`, `GIT_CONFIG_PARAMETERS`, and `GIT_CONFIG_GLOBAL` did not redirect `core.worktree` during repository setup in this installed Git; direct local config did.
- `safe.directory` changes whether Git trusts a repository, not which worktree it selects.
- Removing `GIT_COMMON_DIR` does not break this linked worktree: Git discovers the common directory from its per-worktree `commondir` file.
- `GIT_CEILING_DIRECTORIES` cannot exclude the current directory. Since these Git calls use the repository root as `cwd`, it has no effect there. From a child directory it made discovery fail, not select another repository. Leaving it is sound.

(b) Before every mutating Git operation, reject a checkout whose clean-environment `rev-parse --show-toplevel` does not canonicalise to the requested `cwd`; then pass an explicit `--work-tree=<cwd>`. Validate the linked-worktree `.git` pointer/backlink when the runner worktree is accepted.

Replace the plan’s claim with:

> `gitEnv()` removes inherited Git path overrides, so those environment variables cannot replace Git’s normal repository discovery from `cwd`. It does not make `cwd` authoritative over repository metadata or repository-local configuration: `core.worktree` and a linked worktree’s `.git` `gitdir:` pointer remain trusted inputs and are validated separately before mutation.

The “simpler option passed over” should also acknowledge that `--work-tree` overrides `core.worktree`; its limitation is that it does not pin the Git directory, index, object store, or inherited npm children.

### F3 — P1 — reasoned: a SHA alone does not identify preparation performed from a dirty tree

(a) The plan latches after commands succeed, but does not require the files used by those commands to equal the SHA before and after preparation.

Concrete sequence:

1. Runner is at B with `preparedFor = null`.
2. `package.json` and `package-lock.json` have consistent uncommitted changes.
3. The tick runs `npm ci` against those dirty files and then sets `preparedFor = B`.
4. The final tree stamp sees dirtiness, so no check runs.
5. Between ticks, a person restores both files to clean B.
6. Next tick sees `preparedFor === B`, skips `npm ci`, and checks B with modules installed from the removed dirty manifests.

The same race exists if a manual Git operation happens during preparation. Because no implementation exists yet, whether assignment accidentally lands before or after the final stamp remains inferred, hence “reasoned.”

(b) Make cleanliness part of the preparation identity:

```ts
const target = stampTree(runner);
if (
  target.kind !== "known" ||
  target.dirty ||
  target.sha !== dev.devSha
) {
  // skip; do not prepare or alter preparedFor
}

// Run preparation.

const preparedTree = stampTree(runner);
if (
  preparedTree.kind !== "known" ||
  preparedTree.dirty ||
  preparedTree.sha !== target.sha
) {
  preparation.preparedFor = null;
  throw new Error("runner tree changed while it was being prepared");
}
preparation.preparedFor = target.sha;
```

Also invalidate the latch before attempting a self-repair rebuild whose failure could leave a partial artifact.

### F4 — P1 — established: `package.json` is an omitted dependency-state input

(a) `changedPaths()` currently considers `package-lock.json` but not `package.json` at [scripts/readiness-loop.ts:300](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/scripts/readiness-loop.ts:300), and the plan does not add it.

A B commit can change dependencies in `package.json` without updating the lock. A correct `npm ci` refuses or tries to resolve the mismatch; I confirmed npm 11.19.0 did not accept such a manifest/lock pair. With the proposed classifier, no install runs, so B can use A’s already-present module and pass. An invalid fresh checkout is then recorded green.

This is not merely hypothetical repository style: the history contains many commits changing `package.json` without `package-lock.json`, generally for scripts.

(b) Treat both root manifests as dependency and fleet-build inputs:

```ts
const dependencyInputs = new Set(["package.json", "package-lock.json"]);

dependencies:
  current.dependencies ||
  changedPaths.some((name) => dependencyInputs.has(name)),

fleetClient:
  current.fleetClient ||
  changedPaths.some((name) => dependencyInputs.has(name)) ||
  // existing fleet paths
```

Include `package.json` in the scoped Git diff and add a red-first case specifically for it.

### F5 — P1 — established: the shared database can be ahead of B, and migration reports success

(a) Every worktree uses one shared local Supabase. The runner’s `db:migrate` permits unknown migration rows locally once B has nothing pending: [scripts/migration-ledger.ts:257](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/scripts/migration-ledger.ts:257).

I invoked that pure reconciliation path with B’s complete journal plus one C-only ledger row. It returned:

```json
{
  "pending": [],
  "unknown": [{"hash":"migration-only-in-c","created_at":200}],
  "problems": []
}
```

Concrete false-green sequence:

1. `origin/dev` is B. B’s code declares a new column but accidentally omitted its migration.
2. Another worktree C adds and locally applies the missing migration, but C has not reached `origin/dev`.
3. Runner prepares B. B’s migrator treats C’s ledger row as tolerated local history.
4. `db:check` sees the column and passes.
5. B’s tests pass against C’s corrected schema, and the runner records B green.

That is exactly “a verdict about B not produced against B’s schema.”

(b) The runner needs a stricter database boundary than an ordinary developer worktree. The smallest safe shared-database version is:

- require the ledger to match B’s journal exactly—no unknown rows;
- acquire the existing migration advisory lock;
- perform that exact-ledger check while holding it;
- retain the lock through the full readiness check.

A dedicated readiness schema/database would be cleaner, but is larger. Without one of these, the stated exact-schema invariant must be weakened explicitly.

### F6 — P2 — reasoned: conservative diff fallback must remain noisy

(a) Treating a failed diff as “prepare everything” is correctness-preserving, but the plan specifies no warning. A permanently broken classifier would therefore run `npm ci` and migration preparation on every new SHA while every readiness verdict remained apparently healthy. That contradicts the repository’s silent-success discipline operationally, though it does not create a false verdict.

(b) Log the failure and the conservative action:

```ts
console.warn(
  `${nowIso} could not classify preparation changes ${preparedFor ?? "<none>"}..${targetSha}; ` +
  `preparing everything: ${usefulOutput(diff)}`
);
```

Test both outputs: all preparation requested, and one warning containing both SHAs and the Git failure.

### F7 — P3 — established: the nonce wording remains an over-claim in a third file

(a) The security decision is correct: deliberate same-user test code is not an untrusted party in [security-map.md](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/docs/project/security-map.md). I also reconfirmed that deleting a Node environment entry leaves its exec-time value in `/proc/self/environ`.

However, the plan says [readiness-parse.ts](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/tools/fleet/readiness-parse.ts:62) needs no change, while that file still calls the marker “authenticated” and later says “the authenticated sentence proves.” Those remain stronger than collision resistance.

(b) Use this wording in `vitest.config.ts`:

> The random per-run token distinguishes this config-time refusal from an accidental copy of the same text in later test, fixture, or quoted-log output. Delete it from `process.env` before workers spawn so it is absent from their ordinary inherited environment. This is not authentication against deliberate same-user code: Linux retains the exec-time value in `/proc/self/environ`.

In `vitest-admission.ts`:

> A readiness wrapper gives Vitest a random per-run collision marker. It prevents accidental identical output from being mistaken for this config’s refusal; it is not secret from deliberate same-user code on Linux.

In `readiness-parse.ts`, replace “authenticated” with “token-matched” in all three comments.

### F8 — P3 — established: the fleet prerequisite explanation is factually inaccurate

(a) [scripts/readiness-loop.ts:315](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/scripts/readiness-loop.ts:315) says `tests/fleet-decisions-route.test.ts` reads `tools/fleet/web/dist`. It does not read the built content. It imports `tools/fleet/server.ts`, whose module startup checks only whether `dist/index.html` exists at [tools/fleet/server.ts:109](/home/greg/code/spideryarn2/.claude/worktrees/readiness-runner/tools/fleet/server.ts:109).

(b) Replace that sentence with:

> `tests/fleet-decisions-route.test.ts` imports `tools/fleet/server.ts`, and that module refuses at startup unless `tools/fleet/web/dist/index.html` exists.

## Checks that did hold

- The `preparedFor` design repairs the original failed-diff A→B sequence.
- An unresolvable or garbage-collected `preparedFor` SHA safely falls into full preparation, provided classification failure is caught.
- Killing the process between `npm ci` and migration is safe because a restart begins unprepared.
- A partial or timed-out `npm ci` is non-success and must not latch. I found no normal Node/npm path where the real `npm ci` exits zero after interruption.
- Deleting the old `before = stampTree(runner)` is correct once classification is based on `preparedFor`; its only current consumers are the transition guard and `changedPaths`.
- Keeping `ensureFleetClient` outside the incremental block is useful for missing-file self-repair, but it does not remove the need for the clean post-preparation stamp in F3.

Verification: `tests/readiness-loop.test.ts` passed, 28/28, using Vite’s runner config loader because the sandbox would not create the default `.vite-temp` directory. No repository file was changed.