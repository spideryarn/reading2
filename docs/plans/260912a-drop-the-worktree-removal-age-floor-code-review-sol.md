The headline claim does not hold universally.

Findings:

1. **High — not fixed (wider):** A private PID namespace hides live host processes. [worktree-inuse.ts](/home/greg/code/spideryarn2/.claude/worktrees/drop-worktree-age-floor/scripts/worktree-inuse.ts:263) interprets an invisible lock PID as dead. In this Codex sandbox, the live host PID from this worktree’s lock was absent from `/proc`; `liveness()` returned `stale` and `idle`. Both sweep and removal can therefore accept a live peer tree. I documented the limitation in [worktrees.md](/home/greg/code/spideryarn2/.claude/worktrees/drop-worktree-age-floor/docs/project/worktrees.md:320) and the [plan](/home/greg/code/spideryarn2/.claude/worktrees/drop-worktree-age-floor/docs/plans/260912a-drop-the-worktree-removal-age-floor.md:81). A real fix needs a positive control proving `/proc` is host-wide.

2. **Medium — not fixed (pre-existing/wider):** A live worktree whose directory was renamed becomes a “ghost.” Sweep returns `ghost` before considering liveness at [worktree-sweep.ts](/home/greg/code/spideryarn2/.claude/worktrees/drop-worktree-age-floor/scripts/worktree-sweep.ts:165), and removal bypasses liveness at [worktree-remove.ts](/home/greg/code/spideryarn2/.claude/worktrees/drop-worktree-age-floor/scripts/worktree-remove.ts:624). Unregistering it deletes the Git administration directory beneath the live moved tree. This predates the age-floor change.

3. **Medium — fixed:** An existing owner PID with an unparseable `/proc/<pid>/stat` was classified `stale`, allowing removal. It now becomes `unreadable` → `unknown` → refusal in [worktree-inuse.ts](/home/greg/code/spideryarn2/.claude/worktrees/drop-worktree-age-floor/scripts/worktree-inuse.ts:246), with a red-then-green regression test at [worktree-inuse.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/drop-worktree-age-floor/tests/worktree-inuse.test.ts:166).

4. **Low — fixed:** The real-process fixtures could race startup; `hiddenProcess` also accepted any readlink error and could pass because of an unrelated opaque process. They now wait for the requested cwd and distinct process group, require `EACCES`/`EPERM`, and assert the exact Python PID caused the refusal in [worktree-remove.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/drop-worktree-age-floor/tests/worktree-remove.test.ts:82) and [worktree-sweep.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/drop-worktree-age-floor/tests/worktree-sweep.test.ts:50).

5. **Low — fixed:** Removed the obsolete `ownerIsAsking` helper and corrected comments/docs that still described `asking` as a grant or omitted unknown-liveness refusal.

Within a complete host `/proc`, the reviewed paths hold: `asking` only exempts signal A, `inUse: null` cannot become removable, and explicit `unknown` refuses in both report and removal.

Validation:

- Liveness tests: **31 passed**.
- Requested three-file command: exit **1** because this sandbox denies test-created Git subprocesses (`spawnSync git EPERM`); the 31 process-only tests passed, while 71 Git-backed tests failed in setup.
- `npm run typecheck`: exit **1** because tsx cannot create its IPC socket here. Equivalent `node --import tsx scripts/typecheck.ts`: exit **0**, all projects green.
- Scoped lint and `git diff --check`: exit **0**.
- No commit or push.

**Verdict: REFUSE until host-wide process-table visibility is proved or failure is made closed.**