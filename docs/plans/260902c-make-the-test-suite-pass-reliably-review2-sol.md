I still would not merge as-is. The original five findings are substantially fixed, but the lock lifecycle still has one high-risk hole.

## Findings

1. **High — callers can still leak `RUN_LOCK` after acquisition.**

   `takeRunLock()` cleans up every failure inside the helper, but once it returns, several callers can throw before reaching `release()`:

   - Four suites acquire the lock, then run module-scope setup queries before registering teardown. For example, [all-skipped-publication-refusal.test.ts](/home/greg/code/spideryarn2/tests/all-skipped-publication-refusal.test.ts:164). A SQL error or the new 10-second `query_timeout` rejects the import while leaving the checked-out session holding the lock.
   - Their teardown also performs several fallible operations before release; one failed cleanup query skips [the release entirely](/home/greg/code/spideryarn2/tests/all-skipped-publication-refusal.test.ts:495). The three session suites have the same shape.
   - [store-jobs-parity.test.ts](/home/greg/code/spideryarn2/tests/store-jobs-parity.test.ts:172) similarly acquires the lock and then rethrows setup failures before either `pool.end()` or `runLock.release()`.
   - The corpus equivalent remains in [store-roundtrip.test.ts](/home/greg/code/spideryarn2/tests/store-roundtrip.test.ts:384): if removing the temporary directory fails, `releaseCorpusLock()` is skipped.

   Every acquired global lock needs an outer `try/finally` whose final action is release. Module-scope setup also needs to release in its `catch`, because the teardown hook has not yet been registered.

   This makes the connection-wide `query_timeout` unsafe as currently integrated. After those lifecycle fixes, keeping the 10-second inherited timeout is reasonable and preferable to returning setup queries to unbounded import-phase hangs.

2. **Medium — the advertised deadline is bounded, but still not hard.**

   Both helpers check `Date.now() > deadline`, not `>=`, and accept `got === true` without checking the clock after the query returns: [run-lock.ts](/home/greg/code/spideryarn2/tests/helpers/run-lock.ts:404), [corpus-lock.ts](/home/greg/code/spideryarn2/tests/helpers/corpus-lock.ts:263).

   Consequently:

   - A poll may begin exactly at the deadline.
   - A poll begun just before the deadline may return up to ten seconds later and still be accepted.
   - The `waitMs: 0` test can theoretically acquire the free key if connecting completes within the same `Date.now()` tick.
   - A short injected `waitMs` does not constrain the longer connection timeout.

   The old infinite hang is closed, but a 600-second limit is currently a roughly 610-second bound, and successful acquisition after the nominal deadline remains possible. Either enforce the remaining budget on connect/query and reject a late success, or describe this as a bounded wait rather than a hard deadline.

   The tests also provoke an ordinary immediate SQL error with key `1.5`; they never exercise an actual polling-query timeout.

3. **Medium — `corpus-lock.ts` documents the opposite lock order from the code.**

   [corpus-lock.ts](/home/greg/code/spideryarn2/tests/helpers/corpus-lock.ts:35) still says no file takes both locks and instructs future callers to take run first, corpus second. Today parity, roundtrip, and `db-seed-dev` do exactly the reverse: corpus outside, run inside. [run-lock.ts](/home/greg/code/spideryarn2/tests/helpers/run-lock.ts:222) correctly documents the actual order.

   This is not cosmetic: following the corpus helper’s instruction would introduce the lock-order cycle both helpers warn about.

4. **Low — I do not agree with omitting the already-held guard.**

   Sequential repeated takes remain valid with a guard because `release()` clears `heldByThisProcess`. The guard would only reject an overlapping direct `takeRunLock()` that currently waits 120 seconds for its own process. `withRunLock` protects only calls through that wrapper.

   I do agree that `pool.on("error")` is not the answer. Errors from this continuously checked-out client are client events, not idle-pool errors. A no-op client handler would be worse because it could let tests continue after silently losing the lock.

5. **Low — several statements will mislead a future reader.**

   - There are currently fourteen module-scope production callers of `takeRunLock`, not twelve.
   - The corpus timeout says the holder must be one of two tests, but [db-seed-dev.ts](/home/greg/code/spideryarn2/scripts/db-seed-dev.ts:290) also takes it.
   - Poll-query errors are rethrown raw, so they do not always name the waiting file as the headers claim.
   - [job-files.ts](/home/greg/code/spideryarn2/tests/helpers/job-files.ts:8) still says the production and test filters “cannot drift”; they remain two implementations and can drift. This was also noted in the first review.

## Requested conclusions

- **Same backend:** yes. The exact checked-out `PoolClient` that acquired the session lock performs the unlock. `max: 1` helps explain ownership, although retaining and querying the same client is the decisive fact.
- **Destruction:** helper-internal failures call `release(true)`, but the overall lifecycle is not airtight because of the caller paths above. Also, `release(true)` removes the client from the pool and initiates `client.end()`; `pool.end()` does not itself prove the backend has already disappeared. The tests correctly poll for eventual disappearance, so comments saying it is necessarily free at return are stronger than the implementation.
- **Corpus finding 1:** closed. The per-run key, asserted rival ownership, and defensive cleanup cannot interfere with the real corpus key.
- **Corpus finding 2:** the infinite-hang and helper-local leaks are closed; the exact deadline and roundtrip teardown leak are not.
- **Store parity:** the monotonic assertion is the right trade on a database a live server may update. Dedicated shelf tests retain the stronger mapping and increment coverage. A small optional strengthening would require `lastOpenedAt` whenever `opens > seeded.opens`, including when the seeded timestamp was null.
- **Deferrals:** the auth-schema migration and corpus-suite merge can remain deferred. Do not scope the production job count merely to quiet `store-jobs-parity`; database isolation is the honest fix. However, that known contention still prevents claiming the suite is reliable under concurrent worktrees.
- **`REQUIRE_POSTGRES=1`:** I would not defer this from the command whose green result is quoted as evidence. Otherwise `npm run check` can still succeed while the database suites decline to run—the exact silent-success class this change addresses. An explicit offline check command would preserve no-Docker use without weakening the real gate.

Static checks: `git diff --check` passed; all three TypeScript projects passed `tsc --noEmit`; focused Biome lint passed. The `npm run typecheck` wrapper itself could not start because the sandbox forbids `tsx`’s IPC socket, so I ran its three TypeScript projects directly. I did not run the database/filesystem-writing suites.