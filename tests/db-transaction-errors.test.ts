/**
 * A domain error thrown inside `db.transaction` must arrive at the caller as
 * itself.
 *
 * This exists because the answer decides an HTTP status. `src/routes.ts` maps
 * `ChatConflict` to **409** and anything it does not recognise to **500**, so
 * if Drizzle wrapped or replaced the error on its way out, a stale second tab
 * would be told the server had broken rather than that its view was out of
 * date. The Postgres chat store is built on the assumption that a plain
 * `throw` inside the callback rolls the transaction back AND reaches the route
 * unchanged, and an assumption that decides a status code is worth one test.
 *
 * **`tx.rollback()` is the trap, and it is asserted here too.** It is the
 * obvious way to say "undo this", and it throws `TransactionRollbackError` —
 * which Drizzle then swallows to end the transaction, so the caller sees
 * *success with no rows written*, or, at best, an error that is not the one the
 * code threw. Either way the 409 is gone. The rule is: throw the domain error
 * and let it roll back; never call `tx.rollback()` to signal a conflict.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ChatConflict } from "../src/chat.js";
import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* No table named: this suite wants a live connection and nothing else, and
   `pgReady` runs `select 1` before it asks about anything. */
await pgReady({ suite: "tests/db-transaction-errors.test.ts" });

describe("a domain error thrown inside a transaction", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("reaches the caller as itself, so the route can still answer 409", async () => {
    const db = getDb();
    const thrown = await db
      .transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        throw new ChatConflict("Only the most recent answer can be retried.");
      })
      .catch((err: unknown) => err);

    // `instanceof`, not a name or a message match: `src/routes.ts` decides the
    // status with `err instanceof ChatConflict`, so that is the property.
    expect(thrown).toBeInstanceOf(ChatConflict);
    expect((thrown as Error).message).toBe("Only the most recent answer can be retried.");
  });

  it("rolls the transaction back on the way out", async () => {
    /* The error propagating is only half of it. If the write survived, a
       conflict would leave the article half-changed — and the reader would be
       told nothing happened while something had. */
    const db = getDb();
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`create temporary table conflict_probe (n int) on commit drop`);
        throw new ChatConflict("no");
      })
      .catch(() => {});

    const after = await db.execute(sql`select to_regclass('pg_temp.conflict_probe') is null as gone`);
    expect((after.rows[0] as { gone: boolean }).gone).toBe(true);
  });

  it("does NOT survive tx.rollback(), which is why nothing here calls it", async () => {
    /* Recorded as an executable warning rather than a comment. `tx.rollback()`
       throws Drizzle's own `TransactionRollbackError`, which replaces whatever
       the code was trying to say — so a conflict signalled this way arrives at
       src/routes.ts unrecognised and becomes a 500. */
    const db = getDb();
    const thrown = await db
      .transaction(async (tx) => {
        tx.rollback();
      })
      .catch((err: unknown) => err);

    expect(thrown).not.toBeInstanceOf(ChatConflict);
  });
});
