/**
 * The run lock, checked from outside itself.
 *
 * `tests/helpers/run-lock.ts` is the thing every job-running suite now depends
 * on to keep out of each other's way, and its failure mode is the quiet one: a
 * lock that is not actually held looks exactly like a lock that is, right up
 * until two suites run at once and the failures land in whichever file lost. So
 * none of these cases asks the helper whether it got the lock. They ask **Postgres**,
 * through `pg_locks`, which is the one witness that cannot share a mistake with
 * the code under test — docs/reusable/silent-success.md.
 *
 * The `objid` of a session advisory lock taken with a single `bigint` key is
 * that key's low 32 bits, with `classid` holding the high ones; for a key this
 * size the high half is zero. `locktype = 'advisory'` and `objid = <key>` and
 * `granted` is therefore the whole test of "is it held".
 *
 * ## This file brings its own key, and never touches 918_273_645
 *
 * It used to take the *real* run-lock key, and open by asserting that nobody
 * else held it. Both halves were hazards. A peer's `npm test` holds that key
 * for most of its run, so the precondition was a coin toss; worse, the failure
 * cases added here have to make a take fail and a release throw, and doing
 * either on the production key means a case that can walk away holding the key
 * every job-running suite queues on. The same defect in
 * `tests/corpus-lock.test.ts` was GPT Sol's highest finding on 2026-09-02.
 *
 * So `TEST_LOCK` is minted per run — two copies of this file cannot contend
 * either — and every case that names a key names that one. The exclusion the
 * helper provides is a property of `pg_try_advisory_lock`, not of the number,
 * so nothing is lost by testing it on a key of our own.
 *
 * ## The failure branches are the half nothing else exercises
 *
 * The happy path runs at module scope in every suite that takes the lock, on
 * every `npm test` — `grep -rn takeRunLock tests/` for how many that is today.
 * What never runs is any way this can fail: the deadline is two minutes long,
 * and the connect and query timeouts behind it exist precisely because the wait
 * sits in vitest's import phase with no hook timeout behind it. A branch nobody
 * can afford to run is a branch nobody has seen work, so each of these injects
 * a budget it can afford.
 */
import net from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { loadEnvLocal } from "../src/env.js";
import { takeRunLock, withRunLock } from "./helpers/run-lock.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* No table of its own: this file locks and unlocks and never writes a row, so
   a live connection is all "ready enough" means here. */
const { reachable } = await pgReady({ suite: "tests/run-lock.test.ts" });

const when = reachable ? describe : describe.skip;

/**
 * **This file must NOT take the run lock**, which is why it has no
 * `takeRunLock` at module scope the way its callers do.
 *
 * It takes and releases the lock inside individual cases instead. Holding it
 * for the file *and* taking it in a case would be the nested take the helper's
 * header warns about: two connections, one key, and the inner one polling until
 * the deadline. That the suite under test is the one place this rule is easiest
 * to break is exactly why it is written down here.
 */

/**
 * A key of this run's own.
 *
 * The band is above both real keys (`RUN_LOCK` 918_273_645 and `CORPUS_LOCK`
 * 823_117_001) and below 2^31, so `pg_locks.objid` alone identifies it: for a
 * `bigint` key that fits in 32 bits the high half, `classid`, is zero.
 */
const TEST_LOCK = 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

/** The name the helper connects under, so `pg_stat_activity` can be asked about it. */
const WAITING_SUITE = "tests/fake-run-suite.test.ts";
const WAITING_APP = `run-lock ${WAITING_SUITE}`;

/** A connection that never holds the lock, kept for asking about other people's. */
const observer = reachable
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  : undefined;

afterAll(async () => {
  /* Belt as well as braces: a case that somehow ended holding this run's key
     gives it up here rather than when the worker exits. Only ever this run's
     key, so it can reach nothing anybody else is using. */
  await observer
    ?.query(
      "select pg_terminate_backend(pid) from pg_locks " +
        "where locktype = 'advisory' and objid = $1 and granted",
      [TEST_LOCK],
    )
    .catch(() => {});
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

/** The same, for connections rather than keys. */
async function backendsGone(appName: string, withinMs = 3000): Promise<number> {
  const until = Date.now() + withinMs;
  for (;;) {
    const rows = await observer!.query<{ n: string }>(
      "select count(*) as n from pg_stat_activity where application_name = $1",
      [appName],
    );
    const n = Number(rows.rows[0]!.n);
    if (n === 0 || Date.now() > until) return n;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * The real database, behind a proxy that stops answering once a query arrives.
 *
 * Startup and authentication are forwarded both ways, so `connect()` succeeds
 * for real — this is not the stalled-connection case, which the last test in
 * this file covers separately. The first extended-protocol `Parse` message
 * (type byte `P`, which nothing in startup or authentication uses) is then
 * **dropped rather than forwarded**: the helper is left waiting on a statement
 * the server never received, which is what a database that has gone quiet looks
 * like from this side, and no advisory lock is taken upstream because the query
 * never lands.
 *
 * A parameterised query is what makes `Parse` the tell — `pg` uses the extended
 * protocol whenever there are bind parameters, and the poll query has one.
 */
async function stallingProxy(): Promise<{ url: string; close(): Promise<void> }> {
  const upstream = new URL(process.env.DATABASE_URL!);
  const sockets: net.Socket[] = [];
  const server = net.createServer((down) => {
    const up = net.connect({ host: upstream.hostname, port: Number(upstream.port) });
    sockets.push(down, up);
    let stalled = false;
    const bin = () => {
      down.destroy();
      up.destroy();
    };
    down.on("data", (chunk) => {
      if (chunk[0] === 0x50 /* 'P' */) stalled = true;
      if (!stalled) up.write(chunk);
    });
    up.on("data", (chunk) => {
      if (!stalled) down.write(chunk);
    });
    for (const socket of [down, up]) {
      socket.on("close", bin);
      socket.on("error", bin);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  const url = new URL(upstream.toString());
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return {
    url: url.toString(),
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

when("the run lock", () => {
  it("is held, according to Postgres, between take and release", async () => {
    /* The precondition is part of the case. If something else were already
       holding the key, "held" would read true no matter what `takeRunLock`
       did, and this test would pass on a helper that does nothing at all. */
    expect(await holders(TEST_LOCK), "nothing may hold this run's key when it starts").toBe(0);

    const lock = await takeRunLock("tests/run-lock.test.ts (held)", { key: TEST_LOCK });
    try {
      expect(await holders(TEST_LOCK), "Postgres must see the lock while it is held").toBe(1);
    } finally {
      await lock.release();
    }

    expect(await holders(TEST_LOCK), "and must see it gone once released").toBe(0);
  });

  it("actually excludes a second holder, rather than handing out two", async () => {
    const lock = await takeRunLock("tests/run-lock.test.ts (exclusion)", { key: TEST_LOCK });
    try {
      /* The real question, asked the way a rival suite asks it: a *different*
         session tries for the key and must be told no. Calling `takeRunLock`
         again here would be right too, and would take 120 seconds to say so —
         a branch nobody can afford to run is a branch nobody has seen work. */
      const rival = await observer!.query<{ got: boolean }>(
        "select pg_try_advisory_lock($1) as got",
        [TEST_LOCK],
      );
      expect(rival.rows[0]?.got, "a second session must not get the same key").toBe(false);
    } finally {
      await lock.release();
    }

    /* And the key is genuinely free afterwards — the same rival now succeeds.
       Without this half, a `release()` that quietly did nothing would still
       pass the case above. */
    const after = await observer!.query<{ got: boolean }>("select pg_try_advisory_lock($1) as got", [
      TEST_LOCK,
    ]);
    expect(after.rows[0]?.got, "and must get it once the holder lets go").toBe(true);
    await observer!.query("select pg_advisory_unlock($1)", [TEST_LOCK]);
  });

  it("survives being released twice, because afterAll runs when beforeAll threw", async () => {
    const lock = await takeRunLock("tests/run-lock.test.ts (idempotent)", { key: TEST_LOCK });
    await lock.release();
    /* The second call must not throw on an ended pool. A suite whose setup
       failed releases in `afterAll` after having released explicitly, and a
       teardown that throws buries the real failure under its own. */
    await expect(lock.release()).resolves.toBeUndefined();
    expect(await holders(TEST_LOCK)).toBe(0);
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
    const lock = await takeRunLock("tests/run-lock.test.ts (nested)", { key: TEST_LOCK });
    try {
      let ran = false;
      await withRunLock(
        "tests/run-lock.test.ts (nested body)",
        async () => {
          ran = true;
          /* And the key really is held while the body runs — the early return
             is only correct because that is true. One holder, not two. */
          expect(await holders(TEST_LOCK)).toBe(1);
        },
        { waitMs: 1000, key: TEST_LOCK },
      );
      expect(ran, "the body must run").toBe(true);
    } finally {
      await lock.release();
    }

    /* The nested call must not have released the outer lock on its way out.
       It did not take it, so it has nothing to give back — and a `finally`
       that unlocked anyway would leave the file it is nested inside
       unprotected for the rest of its run. */
    expect(await holders(TEST_LOCK)).toBe(0);
  });

  it("gives up on a deadline, names the file that was waiting, and leaves nothing behind", async () => {
    const rival = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      const got = await rival.query<{ got: boolean }>("select pg_try_advisory_lock($1) as got", [
        TEST_LOCK,
      ]);
      /* Asserted, not hoped for. The key is this run's own, so a rival that
         could not get it means the premise of the case has evaporated rather
         than that a real suite is busy. */
      expect(got.rows[0]?.got, "the rival must own this run's key before we test the wait").toBe(
        true,
      );

      /* 300ms rather than the real 120_000: the point is the branch, not the wait. */
      await expect(
        takeRunLock(WAITING_SUITE, { waitMs: 300, key: TEST_LOCK }),
        /* Both halves matter: `Waited 300ms` says the deadline is the branch
           that fired, and the file name says the message is worth reading. */
      ).rejects.toThrow(/Waited 300ms[\s\S]*tests\/fake-run-suite\.test\.ts/);

      /* Still exactly the rival: the take neither got the key nor left a second
         session sitting on it. */
      expect(await holders(TEST_LOCK), "giving up must not have acquired anything").toBe(1);
      expect(
        await backendsGone(WAITING_APP),
        "the connection it gave up on must be closed, not left holding a backend",
      ).toBe(0);
    } finally {
      await rival.query("select pg_advisory_unlock($1)", [TEST_LOCK]).catch(() => {});
      await rival.end();
    }

    expect(await holders(TEST_LOCK)).toBe(0);
  });

  it("does not acquire the key after its own deadline has passed", async () => {
    /* The deadline used to be checked *after* the attempt, so the loop always
       asked at least once however long it had already spent — and a take with
       no budget left came back holding the key it had just promised to stop
       wanting. With nothing else holding it, the old shape resolved here; the
       fixed one checks before each attempt and throws.

       `waitMs: 0` is the whole budget, and the check is `>=` rather than `>`,
       so this cannot acquire the key however fast the machine is. It used to
       lean on connecting taking at least a millisecond, which is true and is
       not a guarantee: a `>` check with a deadline of exactly now lets an
       attempt through on the tick, which is a coin toss rather than a test. */
    await expect(takeRunLock(WAITING_SUITE, { waitMs: 0, key: TEST_LOCK })).rejects.toThrow(
      /Waited 0ms[\s\S]*tests\/fake-run-suite\.test\.ts/,
    );
    expect(await holders(TEST_LOCK), "a take with no budget must not end up holding the key").toBe(
      0,
    );
    expect(await backendsGone(WAITING_APP)).toBe(0);
  });

  it("closes its connection when the polling query fails, rather than leaking it", async () => {
    /* A key Postgres cannot parse as `bigint`, which is the cheapest honest way
       to make the poll throw. The old shape cleaned up on the deadline and on
       no other path, so a query that errored — a dropped connection, a
       `query_timeout` firing, a database going away mid-wait — left the client
       checked out and the pool un-ended every time. With `max: 1` that is a
       pool nothing can ever end, and a leak that happens *after* the key is in
       hand holds the key until the worker dies. */
    await expect(takeRunLock(WAITING_SUITE, { waitMs: 2000, key: 1.5 })).rejects.toThrow(
      /* And it says whose wait it was. A raw `invalid input syntax for type
         bigint` arriving out of vitest's import phase names no file at all,
         which is the one thing the headers here promise a failed take always
         does. */
      /tests\/fake-run-suite\.test\.ts[\s\S]*polling for advisory lock/,
    );
    expect(await backendsGone(WAITING_APP), "a failed poll must not leak its connection").toBe(0);
  });

  it("gives up on a polling query that never comes back, and says which file was waiting", async () => {
    /* **The `query_timeout` branch, driven for real.** The case above provokes
       an *immediate* SQL error, which is a different thing: it proves the
       cleanup path but not that a query which simply never answers is ever cut
       off. That is the failure the timeout exists for — a database that took
       the statement and went quiet — and until this case nothing exercised it.

       A proxy in front of the real database is how to get it in 300ms rather
       than in ten seconds: forward the startup and the authentication so
       `connect()` genuinely succeeds, then drop the first `Parse` message on
       the floor. The helper is left waiting on a query the server never even
       received, which is exactly the shape being guarded against, and no lock
       is taken upstream because the query never arrives. */
    const proxy = await stallingProxy();
    const real = process.env.DATABASE_URL;
    process.env.DATABASE_URL = proxy.url;
    const started = Date.now();
    try {
      await expect(
        takeRunLock(WAITING_SUITE, { waitMs: 60_000, queryTimeoutMs: 300, key: TEST_LOCK }),
      ).rejects.toThrow(/tests\/fake-run-suite\.test\.ts[\s\S]*polling for advisory lock/);
      /* Well inside `waitMs`: the point is that the *query* was cut off, not
         that the deadline eventually rescued it. */
      expect(Date.now() - started, "the query timeout must be what fired").toBeLessThan(10_000);
    } finally {
      if (real === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = real;
      await proxy.close();
    }
    expect(
      await backendsGone(WAITING_APP),
      "a timed-out poll must not leave its backend behind",
    ).toBe(0);
    expect(await holders(TEST_LOCK), "and must not have acquired anything").toBe(0);
  }, 20_000);

  it("refuses an overlapping second take rather than waiting on its own process", async () => {
    /* A file takes this **once**, and a second take in the same process is two
       connections asking for one key: advisory locks are re-entrant within a
       session and these are two sessions, so the second one polls for the full
       120 seconds and then blames a sibling that does not exist. `withRunLock`
       guards the calls that go through it; a direct `takeRunLock` had nothing.

       `waitMs: 300` so that a regression costs a third of a second rather than
       two minutes — but a regression is the *timeout* message, not this one. */
    const lock = await takeRunLock("tests/run-lock.test.ts (guard outer)", { key: TEST_LOCK });
    try {
      await expect(takeRunLock(WAITING_SUITE, { key: TEST_LOCK, waitMs: 300 })).rejects.toThrow(
        /already holds the run lock in this process/,
      );
      expect(
        await holders(TEST_LOCK),
        "the refused take must not have opened a second session",
      ).toBe(1);
      expect(await backendsGone(WAITING_APP), "nor connected at all").toBe(0);
    } finally {
      await lock.release();
    }

    /* And *sequential* takes stay legal, which is the whole reason this guard
       can be a hard throw: `release()` clears the flag, so only an overlapping
       take is ever refused. Without this half the guard could be a flag that is
       never cleared and every case above it would still pass. */
    const again = await takeRunLock("tests/run-lock.test.ts (guard sequential)", {
      key: TEST_LOCK,
    });
    await again.release();
    expect(await holders(TEST_LOCK)).toBe(0);
  });

  it("still gives the key back when the unlock query throws", async () => {
    /* `release()` used to mark itself released and *then* unlock, with the
       `client.release()` and `pool.end()` after the await — so an unlock that
       threw skipped both, and the connection sat there holding the key for the
       rest of the worker's life. That is the deadlock this helper exists to
       prevent, arriving through its own teardown.

       An aborted transaction is the honest way to make exactly that happen: the
       socket is fine, the session still holds the key, and every further
       statement errors until the block ends. */
    const lock = await takeRunLock(WAITING_SUITE, { key: TEST_LOCK });
    await lock.client.query("begin");
    await lock.client.query("select 1/0").catch(() => {});

    await expect(lock.release(), "a database that cannot unlock is worth hearing about").rejects
      .toThrow(/could not unlock advisory lock/);

    expect(
      await keyFree(TEST_LOCK),
      "but the key must be free anyway: a session lock dies with its session",
    ).toBe(0);
    expect(await backendsGone(WAITING_APP)).toBe(0);
    /* And it is still idempotent afterwards, which is what `afterAll` relies
       on when `beforeAll` was the thing that failed. */
    await expect(lock.release()).resolves.toBeUndefined();
  }, 15000);

  it("gives up rather than hanging when the connection stalls", async () => {
    /* The hole the deadline did not cover: it started *after* `connect()`, and
       `connect()` had no timeout, so a database that accepts the socket and
       never answers hung vitest's import phase for ever — in silence. That is
       worse here than for the corpus lock, because this take runs at module
       scope in every suite that takes it and the import phase has no hook
       timeout behind it.

       A socket that is accepted and then ignored is what that looks like, and a
       stub server is the only way to get it deterministically: an unroutable
       address may fail fast, and a stopped Postgres refuses the connection. */
    const sockets: net.Socket[] = [];
    const stall = net.createServer((socket) => {
      sockets.push(socket);
    });
    await new Promise<void>((resolve) => stall.listen(0, "127.0.0.1", resolve));
    const port = (stall.address() as net.AddressInfo).port;

    const real = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgresql://nobody:nobody@127.0.0.1:${port}/nothing`;
    const started = Date.now();
    try {
      await expect(
        takeRunLock(WAITING_SUITE, { connectTimeoutMs: 500, waitMs: 300, key: TEST_LOCK }),
      ).rejects.toThrow(/tests\/fake-run-suite\.test\.ts could not connect within 500ms/);
      expect(Date.now() - started, "it must give up on the connection, not wait on it").toBeLessThan(
        3000,
      );
    } finally {
      if (real === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = real;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => stall.close(() => resolve()));
    }
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
