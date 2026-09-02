I would not merge as-is. The production blob change and auth helper are sound, but the new lock and job-file tests introduce fresh intermittent-failure paths.

## Findings

1. **High — the corpus-lock timeout test can acquire and leak the real lock.**  
   In [corpus-lock.test.ts](/home/greg/code/spideryarn2/tests/corpus-lock.test.ts:40), `rival` is allowed to fail to acquire because a real suite owns the key. If that suite releases during the following 300–500 ms, `takeCorpusLock()` succeeds instead of rejecting. The assertion fails, and the `finally` neither unlocks nor closes that newly held client. Other corpus suites can then wait until this worker exits. Use a distinct injectable test key that the rival always owns, and release `takeCorpusLock` in `finally` defensively.

2. **High — the advertised 600-second deadline is not a hard deadline.**  
   [corpus-lock.ts](/home/greg/code/spideryarn2/tests/helpers/corpus-lock.ts:150) applies no timeout to `client.connect()` or each `client.query()`. The deadline starts only after connecting and is checked only after a query returns. A stalled connection/query can therefore hang module collection forever—the exact failure the polling change claims to prevent. The check also occurs after each new attempt, so a lock can be acquired after its deadline.

   Exceptional paths leak too: a polling query error never calls `client.end()`, while [releaseCorpusLock](/home/greg/code/spideryarn2/tests/helpers/corpus-lock.ts:183) clears `held` before unlocking and does not close the client if the unlock query throws. Add connection/query timeouts and `try`/`finally` cleanup. Normal double-release is safely idempotent, but failed release is not.

3. **Medium — `jobFilesOnDisk()` converts every filesystem error into “nothing there.”**  
   Both `readdir(...).catch(() => [])` and `readFile(...).catch(() => "{}")` in [job-files.ts](/home/greg/code/spideryarn2/tests/helpers/job-files.ts:32) swallow `EACCES`, `EIO`, and other real failures, not merely `ENOENT`. A “money assertion” can consequently report zero jobs and pass because the directory was unreadable. Catch only `ENOENT`; propagate everything else. This also makes the claim that the helper reads “the way production does” false—production distinguishes an absent directory from other `readdir` failures.

4. **Medium — the new job-file test collides with another copy of itself.**  
   [job-files-on-disk.test.ts](/home/greg/code/spideryarn2/tests/job-files-on-disk.test.ts:17) uses fixed shared paths. Two concurrent `npm test` runs can overwrite the same `REAL` file, then one teardown deletes it before the other assertion. This is precisely the same-file/two-process fixture race documented elsewhere in the repo. Mint the ID per run.

5. **Low — the auth guard proves only one SQL spelling.**  
   [auth-user-seeding.test.ts](/home/greg/code/spideryarn2/tests/auth-user-seeding.test.ts:127) misses valid forms such as `insert into "auth"."users"` or `insert into auth . users`. The test is useful, but its “only place” guarantee is stronger than the regex. Supporting optional whitespace and quoted identifiers would close the likely accidental bypasses.

## Requested conclusions

- The `head` fast path preserves create-only semantics. A miss followed by a competing create is resolved by `putIfAbsent → already-there → get/hash`; a hit followed by deletion becomes `CorruptObject`. There is no new integrity TOCTOU. It does add a liveness difference: deletion between `head` and `get` now fails instead of possibly recreating, but canonical-object deletion is already outside the ordinary contract.
- Failing on a `head` 503 is acceptable and preferable to falling through to POST. A fallback cannot distinguish absence from outage and could reintroduce the poisoned-connection path. A bounded retry of `head` would be reasonable, but is not required for correctness.
- `"execute" in target` correctly distinguishes the two current driver families. `pg` has no `execute`; the Drizzle handle does. Values are parameterized, while both `sql.raw` fragments derive solely from fixed internal column names and a boolean, so there is no SQL-injection path.
- Top-level `await` itself is sound under this Vitest configuration: the installed runner awaits module import during collection, outside `hookTimeout`, then runs the file; `afterAll` also runs after a failing `beforeAll`. The unbounded database operations above are the problem, not top-level await itself. [Vitest documents `hookTimeout` as applying to setup and teardown hooks.](https://vitest.dev/config/hooktimeout)
- The four diagnoses are coherent. Cause 1 is deliberately an application-side avoidance of Kong’s underlying bug; cause 2 fixes test-owned poisoning while leaving the vendor-schema hazard explicit; causes 3 and 4 address their direct mechanisms.
- Both deferrals are reasonable. Changing Supabase’s owned `auth` schema deserves an owner decision, and merging the corpus suites is an optimization/restructure rather than necessary for correctness once the lock is robust.

Two comments should be corrected: four holders imply at most three preceding 150-second holds, and polling `pg_try_advisory_lock` is not a FIFO queue; also, the production and test `.json` filters remain two copies and can still drift.

I ran `git diff --check` and Biome over the reviewed files; both were clean. I did not run the database/filesystem-writing suites during this read-only review.