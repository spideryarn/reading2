/**
 * The corpus lock's failure branches, which are the half nothing else exercises.
 *
 * `tests/helpers/corpus-lock.ts` is taken at module scope by
 * `tests/store-parity.test.ts` and `tests/store-roundtrip.test.ts`, so its happy
 * path runs twice on every `npm test`. What never runs is any of the ways it can
 * fail: the deadline is ten minutes long, and the connect and query timeouts
 * behind it exist precisely because the wait now sits in vitest's import phase
 * with no hook timeout behind it. A branch nobody can afford to run is a branch
 * nobody has seen work — docs/reusable/silent-success.md.
 *
 * ## This file brings its own key, and never touches 823_117_001
 *
 * It used to take the *real* corpus key from a rival session, with a comment
 * explaining that the rival was allowed to fail because a genuine corpus suite
 * might already own it. That made the case a coin toss with a hangover: if the
 * real holder let go during the 300ms window, `takeCorpusLock` **succeeded**,
 * the assertion went red, and the `finally` — which only unlocked when the rival
 * had got the key — walked away holding the production lock on an open client
 * until the worker exited. A test written to remove flakes that can block every
 * corpus suite on the box is worse than no test. Found by GPT Sol's review of
 * docs/plans/260902c-make-the-test-suite-pass-reliably.md, 2026-09-02.
 *
 * So `TEST_LOCK` is minted per run, the rival's ownership of it is *asserted*
 * rather than hoped for, and `releaseCorpusLock()` is called defensively in
 * every `finally`. Nothing here can make a peer's `npm test` wait.
 */
import net from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { loadEnvLocal } from "../src/env.js";
import { releaseCorpusLock, takeCorpusLock } from "./helpers/corpus-lock.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* No table of its own: this file locks and unlocks and never writes a row. */
const { reachable } = await pgReady({ suite: "tests/corpus-lock.test.ts" });

const when = reachable ? describe : describe.skip;

/**
 * A key of this run's own.
 *
 * Minted per run so that two copies of this file — a peer's `npm test` beside
 * yours — cannot contend either, which is the same lesson as the per-run fixture
 * ids elsewhere in `tests/`. The band is above both real keys
 * (`CORPUS_LOCK` 823_117_001 and `RUN_LOCK` 918_273_645) and below 2^31, so
 * `pg_locks.objid` alone identifies it: for a `bigint` key that fits in 32 bits
 * the high half, `classid`, is zero.
 */
const TEST_LOCK = 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

/** The name the helper connects under, so `pg_stat_activity` can be asked about it. */
const WAITING_SUITE = "tests/fake-corpus-suite.test.ts";
const WAITING_APP = `corpus-lock ${WAITING_SUITE}`;

/** A connection that never holds the lock, kept for asking about other people's. */
const observer = reachable
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  : undefined;

afterAll(async () => {
  /* Belt as well as braces: if a case somehow ended holding the key, it goes
     here rather than when the worker exits. */
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
 * Wait for the helper's connection to be gone, and report what is left.
 *
 * Postgres reaps the backend when the socket closes, which is a moment after
 * `client.end()` resolves, so this polls rather than asking once. It returns the
 * count instead of asserting so the caller's message is about the leak.
 */
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

when("the corpus lock", () => {
  it("gives up on a deadline, names the file that was waiting, and leaves nothing behind", async () => {
    const rival = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      const got = await rival.query<{ got: boolean }>("select pg_try_advisory_lock($1) as got", [
        TEST_LOCK,
      ]);
      /* Asserted, not hoped for. The key is this run's own, so a rival that
         could not get it means something is wrong with the premise of the case
         rather than that a real suite is busy — and a case whose premise can
         quietly evaporate is the defect this file was rewritten to remove. */
      expect(got.rows[0]?.got, "the rival must own this run's key before we test the wait").toBe(
        true,
      );
      expect(await holders(TEST_LOCK)).toBe(1);

      /* 300ms rather than the real 600_000: the point is the branch, not the wait. */
      await expect(
        takeCorpusLock(WAITING_SUITE, { waitMs: 300, key: TEST_LOCK }),
        /* Both halves matter: `Waited 300ms` says the deadline is the branch
           that fired, and the file name says the message is worth reading. */
      ).rejects.toThrow(/Waited 300ms[\s\S]*tests\/fake-corpus-suite\.test\.ts/);

      /* Still exactly the rival: the take neither got the key nor left a second
         session sitting on it. */
      expect(await holders(TEST_LOCK), "giving up must not have acquired anything").toBe(1);
      expect(
        await backendsGone(WAITING_APP),
        "the connection it gave up on must be closed, not left holding a backend",
      ).toBe(0);
    } finally {
      await releaseCorpusLock().catch(() => {});
      await rival.query("select pg_advisory_unlock($1)", [TEST_LOCK]).catch(() => {});
      await rival.end();
    }

    /* And the key really is free again — a leaked holder anywhere above shows
       up here rather than in whichever suite runs next. */
    expect(await holders(TEST_LOCK)).toBe(0);
  });

  it("closes its connection when the polling query fails, rather than leaking it", async () => {
    /* A key Postgres cannot parse as `bigint`, which is the cheapest honest way
       to make the poll throw. The old shape closed the client on the deadline
       and on no other path, so a query that errored — a dropped connection, a
       `query_timeout` firing, a database going away mid-wait — leaked a backend
       every time, and a leak that happens *after* the key is in hand holds the
       key until the worker dies. */
    await expect(takeCorpusLock(WAITING_SUITE, { waitMs: 2000, key: 1.5 })).rejects.toThrow(
      /* And it says whose wait it was. A raw `invalid input syntax for type
         bigint` arriving out of vitest's import phase names no file at all,
         which is the one thing this helper's header promises a failed take
         always does. */
      /tests\/fake-corpus-suite\.test\.ts[\s\S]*polling for advisory lock/,
    );
    expect(await backendsGone(WAITING_APP), "a failed poll must not leak its connection").toBe(0);
  });

  it("gives up rather than hanging when the connection stalls", async () => {
    /* The hole the deadline did not cover: it started *after* `connect()`, and
       `connect()` had no timeout, so a database that accepts the socket and
       never answers hung vitest's import phase for ever — in silence, which is
       the exact failure the polling change was written to prevent.

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
        takeCorpusLock(WAITING_SUITE, { connectTimeoutMs: 500, waitMs: 300 }),
      ).rejects.toThrow(/tests\/fake-corpus-suite\.test\.ts could not connect within 500ms/);
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
       reachable — is enforceable only if getting it wrong is loud. Carrying on
       without a lock is the silent alternative, and this suite is the one whose
       failures look like product bugs. */
    const real = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(takeCorpusLock(WAITING_SUITE)).rejects.toThrow(/pgReady/);
    } finally {
      if (real === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = real;
    }
  });
});
