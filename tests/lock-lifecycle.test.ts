/**
 * The two windows in which a caller of `takeRunLock`/`takeCorpusLock` can walk
 * away still holding the key.
 *
 * The helpers themselves clean up every failure *inside* themselves. What they
 * cannot do is govern what the caller does next, and the callers have two
 * shapes that leak:
 *
 * 1. **Module-scope setup after acquisition.** Four suites take the run lock at
 *    module scope and then sweep their rubble and seed their owner on the
 *    lock's own connection, before any teardown hook has been registered. A
 *    failing statement there — and since 2026-09-02 that connection carries a
 *    ten-second `query_timeout`, so there is one more way to fail than there
 *    was — rejects the import with the key still held. Nothing releases it, and
 *    it stays held until the vitest worker exits, blocking every peer suite.
 * 2. **Teardown that does fallible work before releasing.** The same suites'
 *    `afterAll` deletes rows, closes the store and removes directories, and
 *    only then releases. One failed cleanup query skips the release entirely.
 *
 * Both are checked here against **Postgres** rather than against the helper —
 * `pg_locks` is the one witness that cannot share a mistake with the code under
 * test (docs/reusable/silent-success.md).
 *
 * ## This file brings its own keys, and never touches the real ones
 *
 * Same rule as `tests/run-lock.test.ts` and `tests/corpus-lock.test.ts`, and for
 * the same reason: every case here deliberately makes something fail while a
 * key is held, so a case that went wrong on `RUN_LOCK` (918_273_645) or
 * `CORPUS_LOCK` (823_117_001) could walk away holding the key every other suite
 * queues on. The keys are minted per run — two copies of this file cannot
 * contend either — and each case takes one of its own, so a leak in one case
 * cannot make the next one pass or fail for the wrong reason.
 */
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { loadEnvLocal } from "../src/env.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import { releaseCorpusLock, takeCorpusLock } from "./helpers/corpus-lock.js";
import { takeRunLock } from "./helpers/run-lock.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* No table of its own: this file locks and unlocks and never writes a row. */
await pgReady({ suite: "tests/lock-lifecycle.test.ts" });

/**
 * One key per case, all of them this run's own.
 *
 * The band is above both real keys and below 2^31, so `pg_locks.objid` alone
 * identifies them: for a `bigint` key that fits in 32 bits the high half,
 * `classid`, is zero. Ten of headroom is plenty — there are four cases.
 */
const KEY_BASE = 1_000_000_000 + Math.floor(Math.random() * 999_999_000);
let minted = 0;
const nextKey = (): number => KEY_BASE + minted++;

/** Every key this file handed out, so the sweep below can reach all of them. */
const MINTED: number[] = [];
function caseKey(): number {
  const key = nextKey();
  MINTED.push(key);
  return key;
}

/** A connection that never holds a lock, kept for asking about other people's. */
const observer = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

afterAll(async () => {
  /* Belt as well as braces: a case that somehow ended holding one of this run's
     keys gives it up here rather than when the worker exits. Only ever this
     run's keys, so this can reach nothing anybody else is using. */
  for (const key of MINTED) {
    await observer
      ?.query(
        "select pg_terminate_backend(pid) from pg_locks " +
          "where locktype = 'advisory' and objid = $1 and granted",
        [key],
      )
      .catch(() => {});
  }
  await releaseCorpusLock().catch(() => {});
  await observer?.end();
});

/** How many backends hold `key` right now, according to Postgres. */
async function holders(key: number): Promise<number> {
  const rows = await observer!.query<{ n: string }>(
    "select count(*) as n from pg_locks where locktype = 'advisory' and objid = $1 and granted",
    [key],
  );
  return Number(rows.rows[0]!.n);
}

/**
 * Wait for `key` to be free, and report what still holds it.
 *
 * Postgres reaps the backend a moment after the socket closes, so this polls
 * rather than asking once. It returns the count instead of asserting, so the
 * caller's message is about the leak.
 */
async function keyFree(key: number, withinMs = 3000): Promise<number> {
  const until = Date.now() + withinMs;
  for (;;) {
    const n = await holders(key);
    if (n === 0 || Date.now() > until) return n;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The statement the suites' setup and teardown are standing in for when it fails. */
const BAD_SQL = "select 1 / 0";

describe("a suite that takes the run lock", () => {
  it("does not keep the key when its module-scope setup throws", async () => {
    const key = caseKey();

    /* Exactly the shape the four session suites have: take the lock, then do
       the sweep-and-seed on the lock's own connection. The setup fails, as a
       `query_timeout` or a bad statement would, and the rejection reaches
       vitest's import phase — where no teardown hook has been registered yet,
       because the `describe` bodies have not run. */
    await expect(
      takeRunLockAndSetUp(
        "tests/fake-setup-suite.test.ts",
        async (client) => {
          await client.query(BAD_SQL);
        },
        { key },
      ),
    ).rejects.toThrow();

    expect(
      await keyFree(key),
      "a setup that threw must not leave the key held for the rest of the worker's life",
    ).toBe(0);
  });

  it("still hands the lock back when its setup succeeds", async () => {
    const key = caseKey();
    let ran = false;

    const lock = await takeRunLockAndSetUp(
      "tests/fake-setup-suite.test.ts",
      async (client) => {
        /* On the lock's own connection, which is the whole point of the
           callback: the sweep has to happen while the key is held. */
        await client.query("select 1");
        ran = true;
      },
      { key },
    );

    expect(ran, "the setup must actually have run").toBe(true);
    expect(await holders(key), "and the caller must still hold the key").toBe(1);

    await lock.release();
    expect(await keyFree(key)).toBe(0);
  });

  it("releases the key even when an earlier teardown step throws", async () => {
    const key = caseKey();
    const lock = await takeRunLock("tests/fake-teardown-suite.test.ts", { key });

    /* The `afterAll` shape: delete some rows, close the store, remove a
       directory — and only then release. Here the first step throws. */
    await expect(
      cleanUpThenRelease(
        async () => {
          await lock.client.query(BAD_SQL);
        },
        () => lock.release(),
      ),
      "the cleanup failure is still worth hearing about, so it must be rethrown",
    ).rejects.toThrow();

    expect(
      await keyFree(key),
      "a teardown that threw before the release must still have released",
    ).toBe(0);
  });
});

describe("a suite that takes the corpus lock", () => {
  it("releases the key even when an earlier teardown step throws", async () => {
    const key = caseKey();
    await takeCorpusLock("tests/fake-corpus-teardown.test.ts", { key });
    expect(await holders(key), "the premise: this run's key is held").toBe(1);

    /* `tests/store-roundtrip.test.ts` removes its temporary directory first and
       releases second, so an `rm` that fails skips the release. */
    await expect(
      cleanUpThenRelease(
        async () => {
          throw new Error("removing the temporary directory failed");
        },
        () => releaseCorpusLock(),
      ),
    ).rejects.toThrow(/removing the temporary directory failed/);

    expect(await keyFree(key), "the corpus key must be free whatever the `rm` did").toBe(0);
  });
});
