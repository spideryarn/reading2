/**
 * The run lock, checked from outside itself.
 *
 * `tests/helpers/run-lock.ts` is the thing twelve suites now depend on to keep
 * out of each other's way, and its failure mode is the quiet one: a lock that
 * is not actually held looks exactly like a lock that is, right up until two
 * suites run at once and the failures land in whichever file lost. So none of
 * these cases asks the helper whether it got the lock. They ask **Postgres**,
 * through `pg_locks`, which is the one witness that cannot share a mistake with
 * the code under test — docs/reusable/silent-success.md.
 *
 * The `objid` of a session advisory lock taken with a single `bigint` key is
 * that key's low 32 bits, with `classid` holding the high ones; for a key this
 * size the high half is zero. `locktype = 'advisory'` and `objid = RUN_LOCK` is
 * therefore the whole test of "is it held".
 */
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { loadEnvLocal } from "../src/env.js";
import { RUN_LOCK, takeRunLock, withRunLock } from "./helpers/run-lock.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* No table of its own: this file locks and unlocks and never writes a row, so
   a live connection is all "ready enough" means here. */
const { reachable } = await pgReady({ suite: "tests/run-lock.test.ts" });

const when = reachable ? describe : describe.skip;

/**
 * **This file must NOT take the run lock**, which is why it has no
 * `takeRunLock` at module scope like its twelve callers do.
 *
 * It takes and releases the lock inside individual cases instead. Holding it
 * for the file *and* taking it in a case would be the nested take the helper's
 * header warns about: two connections, one key, and the inner one polling until
 * the deadline. That the suite under test is the one place this rule is easiest
 * to break is exactly why it is written down here.
 */

/** A connection that never holds the lock, kept for asking about other people's. */
const observer = reachable
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  : undefined;

afterAll(async () => {
  await observer?.end();
});

/** How many backends hold `RUN_LOCK` right now, according to Postgres. */
async function holders(): Promise<number> {
  const rows = await observer!.query<{ n: string }>(
    "select count(*) as n from pg_locks where locktype = 'advisory' and objid = $1",
    [RUN_LOCK],
  );
  return Number(rows.rows[0]!.n);
}

when("the run lock", () => {
  it("is held, according to Postgres, between take and release", async () => {
    /* The precondition is part of the case. If something else is already
       holding the key, "held" would read true no matter what `takeRunLock`
       did, and this test would pass on a helper that does nothing at all. */
    expect(await holders(), "nothing may hold the key when this case starts").toBe(0);

    const lock = await takeRunLock("tests/run-lock.test.ts (held)");
    try {
      expect(await holders(), "Postgres must see the lock while it is held").toBe(1);
    } finally {
      await lock.release();
    }

    expect(await holders(), "and must see it gone once released").toBe(0);
  });

  it("actually excludes a second holder, rather than handing out two", async () => {
    const lock = await takeRunLock("tests/run-lock.test.ts (exclusion)");
    try {
      /* The real question, asked the way a rival suite asks it: a *different*
         session tries for the key and must be told no. Calling `takeRunLock`
         again here would be right too, and would take 120 seconds to say so —
         a branch nobody can afford to run is a branch nobody has seen work. */
      const rival = await observer!.query<{ got: boolean }>(
        "select pg_try_advisory_lock($1) as got",
        [RUN_LOCK],
      );
      expect(rival.rows[0]?.got, "a second session must not get the same key").toBe(false);
    } finally {
      await lock.release();
    }

    /* And the key is genuinely free afterwards — the same rival now succeeds.
       Without this half, a `release()` that quietly did nothing would still
       pass the case above. */
    const after = await observer!.query<{ got: boolean }>("select pg_try_advisory_lock($1) as got", [
      RUN_LOCK,
    ]);
    expect(after.rows[0]?.got, "and must get it once the holder lets go").toBe(true);
    await observer!.query("select pg_advisory_unlock($1)", [RUN_LOCK]);
  });

  it("survives being released twice, because afterAll runs when beforeAll threw", async () => {
    const lock = await takeRunLock("tests/run-lock.test.ts (idempotent)");
    await lock.release();
    /* The second call must not throw on an ended pool. A suite whose setup
       failed releases in `afterAll` after having released explicitly, and a
       teardown that throws buries the real failure under its own. */
    await expect(lock.release()).resolves.toBeUndefined();
    expect(await holders()).toBe(0);
  });

  it("lets a nested withRunLock through instead of deadlocking on its own key", async () => {
    /* **The branch every claim about it was a claim about, and nothing drove.**
       `withRunLock` returns early when this process already holds the key, and
       run-lock.ts's own header said "tests/run-lock.test.ts drives exactly that
       path" for two days while no such case existed. Without the early return
       this is a second connection asking for what the first one holds — two
       sessions, so no re-entrancy — and it polls for the full deadline and then
       throws, blaming a sibling that is not there.

       `waitMs: 1000` so that a regression costs a second rather than two
       minutes: at the real number this case could not be afforded, and a branch
       nobody can afford to run is one nobody has seen work. */
    const lock = await takeRunLock("tests/run-lock.test.ts (nested)");
    try {
      let ran = false;
      await withRunLock(
        "tests/run-lock.test.ts (nested body)",
        async () => {
          ran = true;
          /* And the key really is held while the body runs — the early return
             is only correct because that is true. One holder, not two. */
          expect(await holders()).toBe(1);
        },
        { waitMs: 1000 },
      );
      expect(ran, "the body must run").toBe(true);
    } finally {
      await lock.release();
    }

    /* The nested call must not have released the outer lock on its way out.
       It did not take it, so it has nothing to give back — and a `finally`
       that unlocked anyway would leave the file it is nested inside
       unprotected for the rest of its run. */
    expect(await holders()).toBe(0);
  });

  it("refuses to pretend when there is no DATABASE_URL", async () => {
    /* The ordering rule the helper documents — pgReady first, lock only when
       reachable — is only enforceable if getting it wrong is loud. Handing back
       a lock object that locks nothing is the silent alternative. */
    const real = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(takeRunLock("tests/fake-suite.test.ts")).rejects.toThrow(/pgReady/);
    } finally {
      if (real === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = real;
    }
  });
});
