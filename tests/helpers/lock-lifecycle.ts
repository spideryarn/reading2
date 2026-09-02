/**
 * Making the release unconditional, in the two places a caller can lose it.
 *
 * `./run-lock.ts` and `./corpus-lock.ts` clean up every failure *inside*
 * themselves, so a take that does not return leaves nothing behind. What
 * neither can govern is what the caller does once the key is in hand, and the
 * callers have two shapes that leak — both of them found by GPT Sol on
 * 2026-09-02, docs/plans/260902c-make-the-test-suite-pass-reliably-review2-sol.md
 * finding 1:
 *
 * 1. **Setup at module scope, after acquisition.** Four suites take the run
 *    lock at the top level of the file and then sweep their rubble and seed
 *    their owner on the lock's own connection. A statement that throws there
 *    rejects the *import*, and at that point no teardown hook exists: the
 *    `describe` bodies have not run, so there is no `afterAll` to fire. The key
 *    is then held until the vitest worker exits, and every peer suite waiting on
 *    it spends its whole deadline finding that out. The ten-second
 *    `query_timeout` that connection now carries is one more way for that
 *    statement to throw, which is what turned this from latent into urgent.
 * 2. **Teardown that does fallible work before releasing.** The same suites'
 *    `afterAll` deletes rows, closes the store and removes directories, and
 *    releases last. One failed cleanup step and the release never runs.
 *
 * So: `takeRunLockAndSetUp` releases if the setup throws, and
 * `cleanUpThenRelease` releases whatever the cleanup did. Between them the rule
 * is the one Sol asked for — **every acquired global lock is released whether
 * the work around it succeeds or throws, and the release goes last.**
 *
 * These live here rather than in the two lock helpers because they are about
 * the *caller's* lifecycle: they compose the helpers, and neither helper needs
 * to know they exist. `tests/lock-lifecycle.test.ts` drives both against
 * `pg_locks`, on keys minted per run.
 *
 * Nine other run-lock callers do not need either of these: they take the lock
 * and register `afterAll(() => lock?.release())` on the very next line, with no
 * statement in between and nothing else in the hook. That shape is already
 * unconditional, and wrapping it would only add words.
 */
import type { PoolClient } from "pg";

import { type HeldRunLock, type RunLockOptions, takeRunLock } from "./run-lock.js";

/**
 * Take the run lock, do the setup that has to happen while it is held, and hand
 * back the lock — or release it and rethrow if the setup fails.
 *
 * `setUp` is given the lock's own connection, which is the point: a sweep that
 * ran on any other connection would not be covered by the key this just took.
 * That connection carries `query_timeout` (see `HeldRunLock.client`), so a
 * statement that hangs becomes a throw — which is exactly the case this
 * function exists to survive.
 *
 * Call it at module scope, after `pgReady` and only when reachable, the same as
 * the bare `takeRunLock` it wraps.
 */
export async function takeRunLockAndSetUp(
  suite: string,
  setUp: (client: PoolClient) => Promise<void>,
  options: RunLockOptions = {},
): Promise<HeldRunLock> {
  const lock = await takeRunLock(suite, options);
  try {
    await setUp(lock.client);
  } catch (err) {
    /* Swallowed deliberately, and only here. `release()` cleans up before it
       throws, so the key is gone either way; what the reader needs is the
       statement that actually failed, not the news that a `pg_advisory_unlock`
       on a connection we already know is unhappy failed too. */
    await lock.release().catch(() => {});
    throw err;
  }
  return lock;
}

/**
 * Do the teardown, then release — whatever the teardown did.
 *
 * The lock goes last because a suite's cleanup wants the key while it runs, and
 * it goes *unconditionally* because a failed cleanup is not a reason to hold the
 * key for the rest of the worker's life. `cleanUp` throwing is still news, so
 * its error is the one that comes out; a release that also fails is appended
 * rather than allowed to replace it, since a `finally`-thrown error would hide
 * the more interesting half.
 *
 * `release` is a thunk rather than a lock, so the one shape serves both keys:
 * `() => runLock.release()` and `() => releaseCorpusLock()`.
 */
export async function cleanUpThenRelease(
  cleanUp: () => Promise<void>,
  release: () => Promise<void>,
): Promise<void> {
  let failure: unknown;
  try {
    await cleanUp();
  } catch (err) {
    failure = err;
  }

  try {
    await release();
  } catch (err) {
    if (failure === undefined) throw err;
    throw new Error(
      `Teardown failed, and so did letting the advisory lock go: ${(err as Error).message}. ` +
        "The lock helper closes its connection regardless, so the key is free.",
      { cause: failure },
    );
  }

  if (failure !== undefined) throw failure;
}
