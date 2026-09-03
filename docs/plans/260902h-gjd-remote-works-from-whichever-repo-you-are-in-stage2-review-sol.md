REFUSE TO MERGE. The targeted suites pass—115/115—but I found seven blockers.

I independently checked two Stage 1 fixes:

- `remoteSlug()` now validates through `isRepoValue`; malformed GitHub-looking origins cannot poison metadata.
- `inventory()` checks the SSH status before parsing stdout. That fix is real, although `cloneFacts()` still has the old weakness.

## Findings

1. **Blocker — `scripts/gjd-remote.ts:moveIntoPlaceScript` / `cloneIntoPlace`: the clone transaction is not serialized or atomically no-clobber.**  
   `test -e` followed by `mv -T` is a TOCTOU check. Two normal clones will produce one winner and one retained staging checkout because the winner is non-empty, but `mv -T` may replace an empty directory or symlink that appears after the check. An inventory racing the rename can also miss both names and initiate a redundant clone.  
   **Change:** take a per-repository/destination `flock` before the initial resolution, re-resolve after acquiring it, and use an atomic no-replace move such as `mv -T --no-clobber`. Stage 3 must use this same locked helper.

2. **Blocker — `scripts/gjd-remote.ts:sweepStaging`: it can delete a directory it did not create.**  
   A pre-existing non-git directory at the random staging name is recursively removed after `git clone` refuses it. The guard checks only the pathname. Its pattern also matches an innocent child beneath an ancestor named with the staging prefix.  
   **Change:** reserve the staging name atomically and track ownership; on failure, use `rmdir` for an empty directory rather than `rm -rf`. The guard must inspect the basename exactly.

3. **Blocker — `scripts/gjd-remote.ts:cloneFacts`: clone decisions still accept incomplete/non-zero SSH replies.**  
   It calls `ssh(..., {check:false})`, has no sentinel or row count, and silently defaults missing fields. A reply cut after `token=yes` can omit siblings yet authorize a duplicate clone. This is the same failure class fixed in `inventory()`.  
   **Change:** replace `cloneFacts` with the strict inventory protocol plus a separately tagged token probe, both checking SSH status and terminal sentinels.

4. **Blocker — `scripts/gjd-remote.ts:authoritativeConfig`: comparing resolved command strings is insufficient.**  
   A `check` present only on one side is correctly caught. These are not:

   - Different `.gjd-remote/setup` contents—the command remains `./.gjd-remote/setup`.
   - Different `package.json#scripts.setup` bodies—the command remains `npm ci && npm run setup`.
   - Different source or warnings, including an ignored executable/non-executable script.

   Raw TOML equality would be too strict because comments and formatting are irrelevant.  
   **Change:** compare a normalized execution specification containing setup/check commands, source, warnings, selected script hash, and package setup body/hash. Stage 3 should re-confirm whenever this displayed specification changes.

5. **Blocker — `scripts/gjd-remote.ts:boxReadLines` / `decodeBoxField`: the box read is not fully fail-closed.**  
   `GJDBOXERR` and non-zero SSH are handled. Invalid base64 and non-UTF-8 are also rejected by the re-encode comparison. But there is no terminal sentinel, exact line count, or duplicate-field rejection. A complete-looking prefix ending after a valid `config` or `status` line passes.  
   **Change:** add a final sentinel, require it last, require each field exactly once, and reject trailing or duplicate lines.

6. **Blocker — `scripts/gjd-remote-setup.ts:setupJobScript/run_step`: the repository command inherits fd 9 and can release the setup lock.**  
   `flock -u 9` inside setup releases the shared open-file-description lock, allowing `--force` or another invocation to run concurrently. `tee` inherits it too.  
   **Change:** close fd 9 inside the `run_step` subshell before starting either pipeline process, while the supervising shell retains its descriptor. Add a red test where a long-running command executes `flock -u 9` and a second observer must still find the lock held.

7. **Blocker — `scripts/gjd-remote-setup.ts:SetupExpectation/setupVerdict`: readiness is not bound to the checkout being judged.**  
   Only attempt and command hash are compared. The status’s slug and directory are not checked. More importantly, deleting and recloning the same repo at the same path leaves an old success applicable to a checkout that has never run setup. Stage 3’s fresh clone could therefore skip setup.  
   **Change:** verify slug and directory and invalidate/archive the old status as part of every successful fresh clone, under the same clone/setup transaction. A checkout-incarnation identifier would be stronger.

8. **Should-fix — `scripts/gjd-remote-setup.ts:run_step`: `pipefail` does not always preserve the command’s exact exit code.**  
   It returns the command’s status when `tee` succeeds. If both fail, Bash returns the rightmost failure—`tee`—not necessarily the command.  
   **Change:** capture `PIPESTATUS[0]` and `PIPESTATUS[1]` separately. Record the command status; treat logging failure as a distinct tool failure. Test command exit 3 plus failing `tee`.

9. **Should-fix — `scripts/gjd-remote.ts:setupReadScript/setupGate`: the `noflock` cells are wrong.**  
   The read checks whether the lock file exists before checking whether `flock` exists, so `none` can conceal a missing binary. Most `noflock` states start a pane only to die with exit 78.  
   **Change:** probe `flock` first and make the gate refuse any requested run immediately.

10. **Should-fix — `scripts/gjd-remote.ts:reportAfterAttach`: eventual outcomes are not always logged.**  
    Detaching while `started`, or using `--no-attach`, leaves only the laptop’s `started` record. A later `setup --status` prints the terminal verdict but does not append it. Nothing normal is falsely logged as success, but successful attempts can remain permanently unclosed in the laptop log.  
    **Change:** reconcile a settled status into the log idempotently by attempt.

11. **Should-fix — orchestration and transaction tests cannot reach the important code.**  
    `cloneIntoPlace`, `sweepStaging`, `authoritativeConfig`, `readSetupState`, `setupGate`, and `reportAfterAttach` live in an entrypoint that calls `main()` on import. None is directly tested.  
    **Change:** extract these into importable modules or add a proper entrypoint guard.

## Setup verdict × lock matrix

| Status verdict | `none` / `free` | `held` | `noflock` |
|---|---|---|---|
| never-run / config-changed / failed | start | refuse, including `--force` | currently starts then dies — wrong |
| in-progress | refuse; `--force` starts | refuse, including `--force` | refusal has an unusable `--force` remedy; forced run dies — wrong |
| success | skip; `--force` starts | refuse, including `--force` | skip is fine; forced run dies — wrong |
| stale-attempt | unreachable in the initial `attempt:null` gate; code starts | refuse | starts then dies — wrong |

Under ordinary code, `--force` cannot bypass a held lock. It can overlap genuine work after that work’s setup command executes `flock -u 9`, which is finding 6.

## Setup-job adversarial reading

- The setup command’s ordinary exit status reaches the status file when `tee` succeeds.
- `env -i` deliberately loses `~/.local/bin`. Current required binaries remain reachable: node/npm through `/usr/bin`, Claude through `/usr/local/bin`. A future repo depending directly on a user-local binary will fail visibly.
- A nested `tmux` command loses `$TMUX` but can still reach the same user’s server/socket.
- Because setup runs as the same Unix user, a deliberately hostile command can overwrite the deterministic status path or manipulate tmux. The current trust model already accepts that repo code is unsandboxed; “tool-owned status” is therefore an orchestration convention, not a security boundary.
- During a run, `setup --status` sees `started`, reports `in-progress`, prints whether the lock is held, and exits 1. `setupVerdict` derives `in-progress` from the file; `setupGate` uses the lock to decide whether work is genuinely live.

## `reportAfterAttach`

- Same attempt, `success`: logs success, prints green, exits 0.
- Same attempt, `started`: prints “still running”; no terminal log record.
- Absent status: logs this attempt failed, prints `never-run`, exits 1.
- Another attempt’s status, including `started` or `success`: logs this attempt failed and prints `stale-attempt`.
- Unreadable/transport failure: prints red and exits 1, but appends no terminal record.

No generated status is falsely logged as success. A forged or stale matching status can be, because of finding 7 and the same-user trust boundary.

## Doctor

Yes: a found checkout with no setup status makes `doctor` exit non-zero. For the hand-prepared Spideryarn checkout, that is the honest answer—the tool possesses no durable evidence of setup.

I would not add an unconditional `--mark-set-up`; it would manufacture the evidence the design is meant to require. A defensible adoption command would require a configured read-only `check`, run it successfully, and record that the status was adopted rather than run.

## Exact Stage 3 seams

Stage 3 should reshape these before adding workflow code:

1. `resolveTarget` / `onNotFound` → return a `target | unresolved` union; an async session-only resolver handles `absent`.
2. `cloneIntoPlace` → `ensureRemoteCheckout`, owning the clone lock, re-resolution, move, status invalidation, and verified `Target` return.
3. `authoritativeConfig` → separate `readSetupSpec`, `diffSetupSpec`, and presentation/re-confirmation.
4. `setupGate` → return `already-ready | start | refuse`, rather than printing/dying.
5. `cmdSetup` → extract `startSetupAttempt`, returning attempt/session/path metadata.
6. `reportAfterAttach` / `saySetupVerdict` → return a verdict/result; CLI presentation may print or exit around it.
7. `cmdNewClaude` / `cmdNewShell` → split “ensure ready target” from “create session”, so session creation receives an already-successful target.

Without those changes, Stage 3 will copy `cmdSetup` or inherit its `process.exit`-based control flow.

## Tests that cannot prove their stated claim

- Both staging tests in `gjd-remote-repo.test.ts` construct names using the same exported `STAGING_PREFIX` and never call `cloneIntoPlace`; changing the clone producer to another prefix leaves them green.
- “mints nothing `isRepoValue` would refuse” checks the same validator production now calls over the same finite table. The explicit malformed URL rows are the actual red tests; the property adds little independent evidence.
- The truncated-status JSON test cannot detect truncation of the surrounding `GJDBOXOK` protocol.
- No setup-job test has the command unlock fd 9.
- No pipeline test makes both the command and `tee` fail.
- There is no red test for config/script-content disagreement, checkout recreation with an old success, the gate matrix, or `reportAfterAttach`.

## First three fixes

1. Make clone one locked, strict, non-destructive transaction: findings 1–3.
2. Close the setup command’s access to fd 9 and bind readiness to the fresh checkout: findings 6–7.
3. Introduce the normalized execution fingerprint and strict terminal-sentinel box protocol: findings 4–5.

I changed no files or remote state. The targeted tests passed; a concurrent uncommitted Stage 3 edit appeared in `scripts/gjd-remote.ts` during the review, so this verdict is against the supplied Stage 2 diff/snapshot.