Verdict: **revise before building**. The locked-worktree fix is sound for deploy, but the lock is not mutually exclusive under stale takeover.

## Blocking findings

1. **Critical — stale takeover can produce two holders.** In [code-evidence.txt:148](</private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/56f38049-6bb5-4cfa-98f1-2bf8c77a8fcd/scratchpad/code-evidence.txt:148>):

   1. A and B both fail `wx`, read stale S, and decide S is dead.
   2. A removes S and creates A’s lock.
   3. B then removes the pathname—which now names A’s lock—and creates B’s.
   4. Both have returned success.

   The same deletion happens if the old holder releases and a new live holder claims between `readLockHolder()` and `rmSync()`. The bounded retry does not help; the dangerous operation is the unconditional remove before that retry.

   There is also a publication race: `openSync("wx")` makes the file visible before `writeSync()`. A contender can read an empty file, classify PID 0 as dead, unlink it, and claim while the first process writes to the now-unlinked inode. Again, both return success.

   Do not auto-steal using read–unlink–create. Either fail closed on stale locks and require explicit cleanup, or use a kernel-held/advisory lock whose lifetime ends with the process.

2. **High — the exit hook can delete a later owner’s lock.** [The release function is unconditional and never unregistered](</private/tmp/claude-501/-Users-greg-Dropbox-dev-experim/spideryarn2/56f38049-6bb5-4cfa-98f1-2bf8c77a8fcd/scratchpad/code-evidence.txt:140>).

   Claim A → release A → claim B at the same path → process exits: A’s old hook deletes B. Repeated `release()` has the same flaw after another owner appears. Separate paths merely leak listeners; repeated use eventually causes Node’s listener warning.

   The minimum fix is an active flag and `process.off("exit", release)` on first release. A token is useful defensively, but read-token-then-unlink is not itself an atomic compare-and-delete.

3. **High — corrupt files are deliberately failed open.** The garbled-file test blesses takeover. Corruption can be a live claimant whose metadata is not written yet, so “invalid PID means dead” is unsafe. Treat malformed or unreadable metadata as held/error, not stale. `readLockHolder()` also catches every read failure, not only `ENOENT`.

PID reuse mostly causes the opposite error: a genuinely stale lock is mistaken for live because an unrelated process now owns that PID. That harms liveness, not exclusivity. The recorded timestamp is not checked against the process start time.

## Worktree administration

4. **`removeWorktree` is safe here but dangerously named for later reuse.** Double force is exactly what Git requires for a locked worktree, and the real locked-worktree test is good. But it also bypasses Git’s dirty-tree protection and can delete tracked modifications and untracked files. [Git documents both effects](https://git-scm.com/docs/git-worktree).

   Keep the deploy helper explicitly destructive—something like `forceRemoveThrowawayWorktree`—and give `worktree:rm` a guarded, non-force path. The plan’s checks help, but the primitive should not silently encode permission to discard work.

   Also, the claimed “exit code returned” is not implemented: [only `ok` and output are returned](</private/tmp/claude-501/-Users-greg-Dropbox-dev-experim/spideryarn2/56f38049-6bb5-4cfa-98f1-2bf8c77a8fcd/scratchpad/code-evidence.txt:215>). Preserve `status`, `signal`, and `error`; `spawnSync` can return `status: null` and an empty stdout/stderr on spawn failure.

5. **The parser is incomplete.** It handles ordinary branch, detached, and space-containing lock reasons, but:

   - It ignores `bare` and `prunable`.
   - Newlines in reasons are quoted and escaped without `-z`; the parser returns the quoted encoding, not the reason.
   - `trimEnd()` changes trailing spaces in paths or reasons.
   - `ghosts()` does not actually exclude the first/main entry, despite its comment.
   - A bare or main entry is harmless only while its path exists. If marked absent, it is returned as though it were a removable linked registration.
   - An existing path can still be `prunable`, so `existsSync(path)` is insufficient for `doctor`.

   Git provides `--porcelain -z` specifically to preserve unusual characters. Parse `bare`, `detached`, `locked`, and `prunable`, and represent main/bare entries explicitly. [Official porcelain format](https://git-scm.com/docs/git-worktree).

## `deploy.ts`

6. **`record()` itself is correct:** it appends teardown failure, so it neither replaces nor hides earlier recorded failures. Main stops immediately afterward when `failures.length` is non-zero.

   Two surrounding problems remain:

   - If `git worktree add` fails, `finally` still attempts removal and records a false second claim that “a stale entry is left behind.” Track whether registration succeeded.
   - `removeWorktree(wt)` does not pass `ROOT`; unlike the old `run()` helper, it inherits the caller’s working directory. Running deploy from outside the repository makes cleanup fail.
   - A later `rmSync(dir)` exception can mask an earlier thrown failure.
   - If unregistering fails, `rmSync` deliberately turns the entry into a ghost. It is reported, so no longer silent.

The removed `closeSync`, `openSync`, and `writeSync` imports have no remaining uses in `deploy.ts`.

## Tests

All 14 submitted lock tests pass with the broken stale-takeover algorithm. They prove the original sequential `wx` bug was fixed, but not that this is a lock.

Specific weak tests:

- The idempotence test repeats release while nobody else owns the path.
- The garbled-file test has no acquisition postcondition and endorses unsafe fail-open behavior.
- The `ENOENT` test accepts any thrown error; capture one error and assert `code === "ENOENT"`.
- No test forces two stale readers past the read before either removes.
- No test pauses between `openSync` and metadata writing.
- No child-process test checks exit-hook behavior.
- Parser tests omit `HEAD` assertions, `bare`, `prunable`, escaped reasons, and real `-z` output.
- The single-force test proves Git’s behavior, not the helper’s correctness.

The strongest test is the real locked-worktree removal: it checks the exit result, registration disappearance, and directory disappearance.

The live files changed during my review and the focused run was 28/28, so I used the frozen 25-test evidence for this verdict. I made no edits.