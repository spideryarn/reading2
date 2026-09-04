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
import { beforeEach, onTestFailed } from "vitest";

import { loadEnvLocal } from "../../src/env.js";
import { projectMismatch } from "../../src/store/blobs.js";
import {
  describeSession,
  isClient,
  isSpideryarn,
  isUnattributedApp,
  sessionLabel,
  sessionsIn,
} from "../helpers/db-sessions.js";

/**
 * **Name every connection this worker makes, before it makes one.**
 *
 * `pg` reads `PGAPPNAME` as its default `application_name`
 * (`node_modules/pg/lib/connection-parameters.js`), so one assignment here
 * covers the control client below, the app's own pool
 * ([`src/db/client.ts`](../../src/db/client.ts) § `applicationName`, which
 * prefers this variable exactly so that a test run can label it), and anything
 * else a test opens without saying otherwise.
 *
 * The pid rather than a run id, because vitest forks a worker per file and a pid
 * is the one identifier every one of them already has. Two concurrent runs are
 * still told apart; two files of the same run are not, and do not need to be.
 *
 * It must be assigned above the `Client` below and above any import that
 * connects — `pg` reads the variable when a connection is *configured*, not when
 * the module loads.
 */
process.env.PGAPPNAME = `spideryarn-test-shared-${process.pid}`;

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

/**
 * **On a shared-lane failure, say who else was in the database — as evidence,
 * never as a verdict.**
 *
 * T-E, and it is deliberately not what the spec first asked for. A session
 * *count* taken at file start is useless here: the Supabase platform's own floor
 * moves between 11 and 12 on its own (the Storage API holds between one and four
 * connections), so 12 and 19 are indistinguishable to a reader who does not
 * already know today's number, and a rule whose baseline moves is not a rule.
 * GPT Sol, 2026-09-04, docs/plans/260903f-pollution-verdict-design-sol.md.
 *
 * What is worth having is *identities at the moment something went wrong*. The
 * 19-row sample that first showed this contention had seven **anonymous**
 * sessions running `insert into spideryarn.jobs` while the shared lane ran, and
 * nothing could say whose they were. [`src/db/client.ts`](../../src/db/client.ts)
 * § `applicationName` now names its pool and the assignment at the top of this
 * file names this run's, so the same sample would read as *another worktree's
 * dev server*.
 *
 * ## This proves nothing, and it says so out loud
 *
 * A peer that wrote the row and committed is **gone** by the time the assertion
 * fails, so an empty report does not mean the failure was the product's fault.
 * An idle stranger sitting in `ClientRead` did nothing at all, so a busy report
 * does not mean it was not. It is a place to look, and only that — which is why
 * nothing below can fail anything, and why the group it cannot name is labelled
 * *unattributed probable application sessions* rather than accused.
 *
 * `onTestFailed` registers against the test that is running, so it goes inside a
 * `beforeEach`; at the top level of a setup file there is no test to attach to.
 * **Watched printing on 2026-09-04** by breaking a shared-lane assertion on
 * purpose.
 */
beforeEach(() => {
  onTestFailed(async () => {
    const target = process.env.DATABASE_URL;
    if (!target) return;
    const say = (line: string) => process.stderr.write(`  [shared lane] ${line}\n`);
    const client = new Client({ connectionString: target, connectionTimeoutMillis: 5_000 });
    try {
      await client.connect();
      const here = await client.query<{ db: string }>("select current_database() as db");
      const datname = here.rows[0]?.db ?? SHARED;
      const sessions = await sessionsIn(client, datname);

      /* Postgres's own workers are not anybody's sessions — see
         `DbSession.backend_type`, and the autovacuum worker that read as an
         anonymous intruder in the private lane on the day this was written. */
      const clients = sessions.filter(isClient);
      const background = sessions.filter((s) => !isClient(s));
      const ours = clients.filter(isSpideryarn);
      const anonymous = clients.filter(isUnattributedApp);
      const platform = clients.filter((s) => !isSpideryarn(s) && !isUnattributedApp(s));

      say(`this failed against the shared ${datname}, with ${sessions.length} other session(s)`);
      say("connected. Evidence, not a cause: a writer can commit and disconnect before the");
      say("failure, and an idle stranger can sit there harmlessly.");
      if (ours.length > 0) {
        /* The exact name, not the `spideryarn-test-shared-*` wildcard: every
           concurrent run matches that, so it told a reader nothing about which
           sessions were theirs. Sol's advisory, 2026-09-04. */
        say(`${ours.length} spideryarn session(s) — this worker's are "${process.env.PGAPPNAME}":`);
        for (const s of ours) say(`  ${describeSession(s)}`);
      }
      if (anonymous.length > 0) {
        say(`${anonymous.length} unattributed probable application session(s):`);
        for (const s of anonymous) say(`  ${describeSession(s)}`);
      }
      if (platform.length > 0) {
        const byName = new Map<string, number>();
        for (const s of platform) {
          const label = sessionLabel(s);
          byName.set(label, (byName.get(label) ?? 0) + 1);
        }
        const summary = [...byName]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, n]) => (n > 1 ? `${name} x${n}` : name))
          .join(", ");
        say(`${platform.length} platform session(s): ${summary}`);
      }
      if (background.length > 0) {
        say(`${background.length} of Postgres's own worker(s), which are nobody's session.`);
      }
    } catch (err) {
      /* Never the reader's problem: the test's own failure is the message, and
         a diagnostic that throws would replace it with itself. */
      say(`could not sample the shared database: ${(err as Error).message}`);
    } finally {
      await client.end().catch(() => {});
    }
  });
});
