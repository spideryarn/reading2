/**
 * The `shared-services` lane: assert that this file really is on the stack's own
 * `postgres`, and change nothing else.
 *
 * Four files are here, and each is bound to a Supabase service that reads
 * `postgres` no matter what the SQL does — GoTrue for three of them, and the
 * factory's own suite by contract, because `baseUrl()`'s documented job is to
 * mean *the shared database*. `TEST_LANES` in
 * [`tests/store-migration-registry.ts`](../store-migration-registry.ts) settles
 * each one and says how it was decided.
 *
 * So this setup is the mirror image of [`private-db.ts`](private-db.ts): it must
 * prove the suite did **not** move. If the three projects were ever mis-wired —
 * a glob edited, an entry copied into the wrong lane — a shared-lane file on a
 * private database is green while checking nothing (measured for
 * `admin-store.test.ts`: its accounts come from GoTrue over HTTP and every
 * aggregate beside them is `?? 0` out of the empty clone).
 *
 * ## `postgres` is a name, not an identity — so there are two controls
 *
 * GPT Sol's finding on T-D, 2026-09-04, and it is the one that mattered:
 * **every** Supabase stack has a database called `postgres`, and Greg runs a
 * second one on this laptop (docs/project/supabase-local.md). So the
 * `current_database()` check below cannot tell this stack's `postgres` from the
 * previous app's, and the split brain the shared lane exists to exclude —
 * `DATABASE_URL` on one stack's database while `SUPABASE_URL` still names this
 * stack's GoTrue — walked straight past it. `admin-store.test.ts` then passes
 * vacuously, for the reason its `TEST_LANES` entry already records.
 *
 * The second control is [`projectMismatch`](../../src/store/blobs.ts), which is
 * the repo's existing answer to *"are these two halves the same stack"* and is
 * already relied on at boot. Locally the port **is** the identity — one host,
 * one listener per port — and it pins 54361/54362 against `supabase/config.toml`
 * through `tests/store-project-pair.test.ts`; hosted, it compares the project
 * ref that both strings carry.
 *
 * **`assertSameCluster` in `scripts/db-test-create.ts` is not the machinery to
 * reuse here, despite doing the `system_identifier` comparison this wants.** It
 * finds its container *by the port in `DATABASE_URL`*
 * (`findPostgresContainer`), so pointed at the other stack it would find the
 * other stack's container and agree with itself. It answers "is the container I
 * am about to `docker exec` into the server I connected to", which is a
 * different and, for this purpose, tautological question.
 *
 * **What is still not covered**, said out loud rather than left to be
 * discovered: with `SUPABASE_URL` unset, `projectMismatch` declines to judge —
 * that is its documented rule, and a lane setup is not the place to invent a new
 * failure mode for an incomplete environment. The three GoTrue files cannot work
 * in that state anyway, and they say so themselves.
 *
 * ## Why an unreachable database is not a failure here
 *
 * The first control is about *identity*, not reachability. `pgReady` already
 * decides what an unreachable stack means — a skip, or a failure under
 * `REQUIRE_POSTGRES=1` — and it says so per suite with the command that fixes
 * it. Throwing here would replace that with a stack trace from a setup file.
 * The second control reads two strings and needs no connection at all, so it
 * applies either way.
 */
import { Client } from "pg";

import { loadEnvLocal } from "../../src/env.js";
import { projectMismatch } from "../../src/store/blobs.js";

loadEnvLocal();

/** What the stack's own database is called. `db-test-create.ts` clones from it. */
const SHARED = "postgres";

const url = process.env.DATABASE_URL;
if (url) {
  const control = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  let reached: string | undefined;
  try {
    await control.connect();
    const seen = await control.query<{ db: string }>("select current_database() as db");
    reached = seen.rows[0]?.db;
  } catch {
    /* Unreachable. Not this file's verdict to give — see the header. */
  } finally {
    await control.end().catch(() => {});
  }
  if (reached !== undefined && reached !== SHARED) {
    throw new Error(
      `this file is in the shared-services lane and must run against ${SHARED}, ` +
        `and it reached ${reached}. Something has pointed the shared lane at a private ` +
        "database — see TEST_LANES in tests/store-migration-registry.ts.",
    );
  }

  const elsewhere = projectMismatch(url, process.env.SUPABASE_URL);
  if (elsewhere) {
    throw new Error(
      "this file is in the shared-services lane, which means one stack's database and " +
        `that same stack's Supabase services. ${elsewhere}`,
    );
  }
}
