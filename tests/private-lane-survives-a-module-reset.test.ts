/**
 * **A test that resets its modules must not quietly change database.**
 *
 * The private lane mints a database per run and points `DATABASE_URL` at it
 * ([`tests/setup/private-db.ts`](setup/private-db.ts)). A file that then calls
 * `vi.resetModules()` — several do, to re-run a module's top-level effects the
 * way a server restart would — reloads [`src/env.ts`](../src/env.ts), which
 * takes a **fresh `INHERITED` snapshot** and re-reads `.env.local` against it.
 * At that point the minted URL is *in* the snapshot, so nothing "differs from
 * what was inherited", and `.env.local`'s `DATABASE_URL` wins.
 *
 * The reloaded copy then opens a pool against **the shared development
 * database**, which every other agent on this box is using. A suite that only
 * reads sees somebody else's rows; a suite that **writes, writes into it and
 * passes**. Found on 2026-09-04 while converting `tests/jobs-walk.test.ts`,
 * where it surfaced as a job reading `gone` instead of `busy`.
 *
 * `src/env.ts` § `PINNED` exists for exactly this — a variable this process set
 * on purpose, *named*, rather than inferred by comparing against a snapshot
 * that a reload invalidates. [`tests/setup/unit-no-database.ts`](setup/unit-no-database.ts)
 * has always pinned `DATABASE_URL,SUPABASE_URL`; the private lane never did.
 *
 * This file is the negative control for that fix. **It was watched failing**
 * before the pin was added: `current_database()` came back as the shared
 * development database rather than the run's own `spideryarn_test_…`.
 *
 * It asks Postgres which database it is in rather than comparing strings,
 * because the string is the thing under suspicion.
 */
import { Client } from "pg";
import { afterAll, expect, it, vi } from "vitest";

/** The database this worker is supposed to be in, read before anything resets. */
const MINTED = process.env.DATABASE_URL ?? "";

const clients: Client[] = [];

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
});

/** Where a connection opened *now*, the way the suite would, actually lands. */
async function whichDatabase(): Promise<string> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
  });
  clients.push(client);
  await client.connect();
  const seen = await client.query<{ db: string }>("select current_database() as db");
  return seen.rows[0]?.db ?? "";
}

it("stays in the run's own database across vi.resetModules()", async () => {
  const before = await whichDatabase();
  expect(before, "the private lane did not point this worker at a minted database").toMatch(
    /^spideryarn_test_/,
  );

  /* What a suite does to re-run a module's top-level effects.
     **Importing `src/env.ts` is not enough** — `loadEnvLocal()` is a function,
     not a top-level effect, so a reset-and-import leaves `process.env` alone and
     this control passed while the hole was open. The reload has to reach a
     caller: `src/db/client.ts` § `databaseUrl` calls it before every pool it
     opens, which is precisely the path a suite takes after a reset. Getting that
     wrong the first time is the point of running the control before the fix. */
  vi.resetModules();
  const { getDb, closeDb } = await import("../src/db/client.js");
  await getDb().execute("select 1");
  await closeDb();

  const after = await whichDatabase();
  expect(
    after,
    `after vi.resetModules() this worker is in ${after}, not the ${before} it minted — ` +
      "`.env.local` won the reload, so anything this file writes goes into the shared " +
      "development database. See src/env.ts § PINNED.",
  ).toBe(before);

  expect(process.env.DATABASE_URL, "DATABASE_URL was rewritten by the reload").toBe(MINTED);
});
