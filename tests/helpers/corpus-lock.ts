/**
 * One suite at a time may load `data/`'s real articles into Postgres.
 *
 * ## Why this exists
 *
 * `tests/store-parity.test.ts` and `tests/store-roundtrip.test.ts` both take
 * every complete article in `data/`, delete its revisions, and load it again
 * through the real write path. Vitest runs test *files* concurrently, and two
 * processes can run them at once — a peer's `npm test` beside yours. So:
 *
 * 1. parity deletes `writes`'s revisions;
 * 2. roundtrip loads `writes` and publishes it;
 * 3. parity loads `writes` and finds `basedOn` pointing at roundtrip's revision.
 *
 * The assertion that fires is *"built every article from nothing, rather than
 * carrying one forward"*, which is exactly right and says nothing useful, and
 * the run before it was green. Five clean runs then fourteen meaningless
 * failures is the shape this repo keeps meeting.
 *
 * `jobs_only_one_running` already stops two *loads* overlapping. What it cannot
 * cover is the window between one suite's wipe and its assertions, which is
 * most of the suite.
 *
 * ## Why a session lock and its own connection
 *
 * `pg_advisory_lock` is held by a **session**, so it has to be taken on a
 * connection nobody else can be handed. Borrowing one from the pool means the
 * unlock may run on a different backend and quietly do nothing, leaving the
 * lock held until the process exits — which looks exactly like a deadlock to
 * whoever runs the suite next.
 *
 * The number is arbitrary and only has to be unique among whatever else takes
 * advisory locks here, which today is nothing.
 */
const CORPUS_LOCK = 823_117_001;

/** The lock's connection, or null when this process is not holding it. */
let held: { query: (sql: string, values: unknown[]) => Promise<unknown>; end: () => Promise<void> } | null =
  null;

/**
 * Block until nothing else is loading the corpus, then hold the lock.
 *
 * Call it first in `beforeAll`, and give that hook a timeout generous enough to
 * wait for the other suite — a minute of waiting is normal on a busy machine.
 */
export async function takeCorpusLock(): Promise<void> {
  if (held) throw new Error("this process already holds the corpus lock");
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("select pg_advisory_lock($1)", [CORPUS_LOCK]);
  held = client;
}

/**
 * Give it back. Safe to call when it was never taken, because `afterAll` runs
 * even when `beforeAll` threw.
 */
export async function releaseCorpusLock(): Promise<void> {
  if (!held) return;
  const client = held;
  held = null;
  await client.query("select pg_advisory_unlock($1)", [CORPUS_LOCK]);
  await client.end();
}
