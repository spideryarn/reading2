/**
 * The commit transaction's **actual** isolation level, asked of the transaction.
 *
 * `writeRawSource` (src/store/artifacts-pg.ts) inserts `on conflict do nothing`
 * and then reads the row back to compare it. That is only correct at `read
 * committed`: at `repeatable read` the insert itself raises `40001 could not
 * serialize access due to concurrent update` the moment it meets a conflicting
 * row from outside its snapshot, nothing in `src/` retries `40001`, and the
 * whole revision commit is lost — which is
 * docs/postmortems/260901f-a-for-update-that-locks-nothing.md arriving through a
 * different door. `lockOrCreateArticle` (src/store/pg-revisions.ts) has the same
 * shape for the `articles` row.
 *
 * (GPT Sol predicted a different mechanism — an invisible row on the read back.
 * Measured here, Postgres never lets you get that far: `do nothing` stops being
 * an escape from a concurrent writer above `read committed`. Same verdict, same
 * fix, worse failure.)
 *
 * Until 2026-09-01 that dependency was **written down and not enforced**: the
 * production caller opened its transaction with no options and inherited
 * `default_transaction_isolation` from the role or the database. GPT Sol's final
 * review, finding 3, docs/plans/260901d-final-review-sol.md. It is now pinned —
 * src/store/pg-session.ts § `READ_COMMITTED` — and this file is the check.
 *
 * ## The rig, and why it has to exist
 *
 * A test that simply asserts `read committed` against a laptop's database is a
 * check that agrees with the bug: PostgreSQL's default *is* `read committed`, so
 * deleting the pin leaves it green. docs/reusable/silent-success.md, in its
 * ordinary shape.
 *
 * So the rig makes the ambient default **wrong**. The connection string carries
 * `options=-c default_transaction_isolation=repeatable\ read`, which `pg` sends
 * as a startup parameter, so every connection in this pool defaults to
 * `repeatable read`. `pgStoreSession` already accepts the handle to use
 * (`PgStoreSessionOptions.db`), so production code runs unchanged over it.
 *
 * The first case asserts the rig — an unpinned transaction on this pool really
 * does report `repeatable read`. Without that, everything below could be
 * passing because the rig quietly did nothing.
 *
 * ## The claims
 *
 * 2. **The honest check.** The handle handed to `pgStoreSession` is wrapped so
 *    that the first statement inside whatever transaction production opens is
 *    `select current_setting('transaction_isolation')`. That is the transaction
 *    asked what it got — not a mock asked what it was told, which is the
 *    assertion that does not survive a refactor.
 * 3. **The other two transactions.** `beginStep` is covered by case 2 — it is
 *    the first of the two levels it records — and `settleJob` gets a case of its
 *    own, because it reaches `lockOrCreateArticle` and nothing else here does.
 * 4. **The interleaving, at the production call site.** Somebody else holds an
 *    uncommitted `raw_sources` row for a document Postgres has never seen; the
 *    real `commit` writes the same document, blocks on the unique index, and
 *    goes through once the other transaction lands. On this pool that is the
 *    exact failure Sol described, and only the pin prevents it.
 *
 * ## Watched red, 2026-09-01
 *
 * With `READ_COMMITTED` removed from `commit` in src/store/pg-session.ts:
 *
 * - case 2 → `expected [ 'read committed', 'repeatable read' ] to deeply equal
 *   [ 'read committed', 'read committed' ]` — the second entry is `commit`'s own
 *   transaction, naming the level it actually got;
 * - case 4 → `40001` out of `writeRawSource`'s insert, reaching the assertion as
 *   `StoreFailure … [db-busy]` because `guardDbStore` translates it, with the
 *   whole commit rolled back;
 * - case 1 stayed green, which is what a rig assertion is for.
 *
 * ## It does not take the run lock
 *
 * Every slug is minted fresh and every digest is random bytes, for the reasons
 * tests/store-raw-source-race.test.ts sets out — and case 3 deliberately holds a
 * transaction open, which is not a thing to do while holding a key every other
 * suite is waiting for.
 *
 * Skips loudly when there is no database; tests/helpers/pg-ready.ts explains.
 */
import { randomBytes } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { articleRevisions, articles, jobs, rawSources } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { RawManifest } from "../src/fetch.js";
import { mintId } from "../src/ids.js";
import { environmentOwnerId } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import { mintAttempt } from "../src/store/jobs.js";
import { pgStoreSession } from "../src/store/pg-session.js";
import type { JobTransition } from "../src/store/session.js";
import type { JobStep } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

await pgReady({
  suite: "tests/store-session-isolation.test.ts",
  tables: ["spideryarn.raw_sources", "spideryarn.article_revisions", "spideryarn.jobs"],
});
/**
 * **The owner `currentOwnerId()` will answer with**, and it has to be that one.
 *
 * `lockOrCreateArticle` reads the article row through `ownedSlug`, so a fixture
 * written under any other id is invisible to it: the insert conflicts on the
 * globally-unique slug, the owner-filtered re-read finds nothing, and the commit
 * dies on *"the slug already belongs to another reader"* — which is true, and
 * has nothing to do with what this file is testing. Nothing here runs inside a
 * request, so `currentOwnerId()` is `environmentOwnerId()`.
 */
const OWNER_ID = environmentOwnerId();

const JOB_STEPS: JobStep[] = [{ name: "fetch", label: "Fetching", status: "pending" }];

/** Everything this file made, so teardown removes those rows and nothing else. */
const mine = { slugs: [] as string[], shas: [] as string[] };

/**
 * A pool whose connections default to `repeatable read`.
 *
 * `options` is a libpq startup parameter that `pg` passes straight through
 * (node_modules/pg/lib/client.js), and the space in `repeatable read` has to be
 * backslash-escaped or the server splits the setting in two and refuses the
 * connection with *"invalid value for parameter … : \"repeatable\""*. Asked for
 * on the connection rather than with `alter role`, which would be a change to
 * the shared local database that every other agent's test run would inherit.
 */
function repeatableReadPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set, and pgReady said the database was reachable");
  const parsed = new URL(url);
  parsed.searchParams.set("options", "-c default_transaction_isolation=repeatable\\ read");
  return new Pool({ connectionString: parsed.toString(), max: 4 });
}

let rrPool: Pool | undefined;
let rrDb: Db | undefined;

rrPool = repeatableReadPool();
rrDb = drizzle(rrPool, { schema });

afterAll(async () => {
  const db = getDb();
  if (mine.slugs.length) {
    await db.delete(jobs).where(inArray(jobs.slug, mine.slugs));
    const rows = await db
      .select({ id: articles.id })
      .from(articles)
      .where(inArray(articles.slug, mine.slugs));
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await db.update(articles).set({ currentRevisionId: null }).where(inArray(articles.id, ids));
      await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, ids));
      await db.delete(articles).where(inArray(articles.id, ids));
    }
  }
  for (const sha of mine.shas) {
    await db.delete(rawSources).where(eq(rawSources.sha256, sha));
  }
  await rrPool?.end();
  await closeDb();
});

/** A digest nothing in the database can already be holding. */
function freshDigest(): string {
  const sha = randomBytes(32).toString("hex");
  mine.shas.push(sha);
  return sha;
}

/**
 * An article, a draft revision, and a live job holding a claim on it —
 * **committed**, because everything below is about transactions that have to
 * see each other, and rows inside an open transaction are rows nobody else can
 * see. The same fixture as tests/store-raw-source-race.test.ts, minus the step
 * run: here `session.beginStep` opens it, through the production path.
 */
async function makeClaim(label: string): Promise<JobDraftRef> {
  const db = getDb();
  const slug = `test-session-iso-${label}-${randomBytes(4).toString("hex")}`;
  mine.slugs.push(slug);

  const [article] = await db.insert(articles).values({ ownerId: OWNER_ID, slug }).returning();
  if (!article) throw new Error(`could not create the article for ${slug}`);

  const [revision] = await db
    .insert(articleRevisions)
    .values({ articleId: article.id, status: "draft" })
    .returning();
  if (!revision) throw new Error(`could not create the revision for ${slug}`);

  const jobId = mintId();
  const attemptId = mintAttempt();
  await db.insert(jobs).values({
    id: jobId,
    ownerId: OWNER_ID,
    slug,
    steps: JOB_STEPS,
    status: "running",
    attemptId,
    leaseExpiresAt: new Date(Date.now() + 600_000),
    workKey: `wk-${jobId}`,
    draftRevisionId: revision.id,
  });

  return { slug, articleId: article.id, revisionId: revision.id, jobId, attemptId };
}

/** The manifest of one document, as stage 1 hands it over. */
function manifestFor(storedSha256: string, storedBytes = 4096): RawManifest {
  return {
    kind: "html",
    file: "raw.html",
    url: "https://example.test/shared",
    contentType: "text/html; charset=utf-8",
    encoding: "utf-8",
    bytes: storedBytes,
    sha256: "b2".repeat(32),
    storedSha256,
    storedBytes,
    fetchedAt: "2026-09-01T00:00:00.000Z",
  };
}

/** The context `runStep` would have built. */
function contextFor(slug: string): StepContext {
  return {
    slug,
    report: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/** The release `runStep` hands `commit` between the steps of a walk. */
function releaseOf(ref: JobDraftRef): JobTransition {
  return {
    kind: "release",
    jobId: ref.jobId,
    attempt: ref.attemptId,
    steps: JOB_STEPS,
    fields: {},
  };
}

/** What level is this transaction actually running at? */
async function levelOf(tx: Tx): Promise<string> {
  const got = await tx.execute<{ level: string }>(
    sql`select current_setting('transaction_isolation') as level`,
  );
  return got.rows[0]?.level ?? "(the database would not say)";
}

/**
 * The same handle, with a probe as the first statement of every transaction.
 *
 * The config is passed through untouched — this asks the transaction production
 * opened what level it got, and changes nothing about it.
 */
function watchingIsolation(real: Db, seen: string[]): Db {
  return new Proxy(real, {
    get(target, prop, receiver): unknown {
      if (prop !== "transaction") return Reflect.get(target, prop, receiver) as unknown;
      return (body: (tx: Tx) => Promise<unknown>, config?: unknown) =>
        target.transaction(async (tx) => {
          seen.push(await levelOf(tx));
          return body(tx);
        }, config as Parameters<Db["transaction"]>[1]);
    },
  }) as Db;
}

describe("the transaction the pipeline commits in", () => {
  it("is opened on a connection that defaults to repeatable read", async () => {
    /* **The rig, asserted.** Everything below is about a pin overriding a wrong
       ambient default; if the pool were an ordinary one, `read committed` would
       be what a transaction reported whether or not anything pinned it, and the
       cases would pass on the bug they exist to catch. */
    if (!rrDb) throw new Error("unreachable: the suite skips without a database");
    const inherited = await rrDb.transaction((tx) => levelOf(tx));
    expect(inherited, "this pool's connections must default to repeatable read").toBe(
      "repeatable read",
    );
  }, 60_000);

  it("runs at read committed even so", async () => {
    if (!rrDb) throw new Error("unreachable: the suite skips without a database");
    const ref = await makeClaim("pinned");
    const seen: string[] = [];
    const session = pgStoreSession({ ref, db: watchingIsolation(rrDb, seen) });

    await session.beginStep(ref.slug, "fetch");
    await session.commit(
      contextFor(ref.slug),
      STEPS.fetch,
      ref.attemptId,
      { detail: "one document", parts: { raw: manifestFor(freshDigest()) } },
      releaseOf(ref),
    );

    /* Asked of the transaction, not of a spy on its options: `current_setting`
       is what the server is actually doing, and it would still be right if the
       pin moved, changed shape, or arrived from somewhere else entirely. */
    expect(seen.length, "beginStep and commit each open one").toBe(2);
    expect(seen, "every transaction this session opens is pinned").toEqual([
      "read committed",
      "read committed",
    ]);
  }, 60_000);

  it("is not the only one — `settleJob` is pinned too", async () => {
    /* The third transaction this file opens. It reaches `lockOrCreateArticle`
       exactly as `commit` does, and `on conflict do nothing` then re-read has
       the same dependency there as it has in `raw_sources`. A pin on two of the
       three would be a pin nobody could rely on. */
    if (!rrDb) throw new Error("unreachable: the suite skips without a database");
    const ref = await makeClaim("settling");
    const seen: string[] = [];
    const session = pgStoreSession({ ref, db: watchingIsolation(rrDb, seen) });

    await session.beginStep(ref.slug, "fetch");
    const settled = await session.settleJob({
      kind: "end",
      jobId: ref.jobId,
      attempt: ref.attemptId,
      ending: { status: "error", steps: JOB_STEPS, error: "the stage threw" },
    });

    expect(settled.kind).toBe("ended");
    expect(seen, "beginStep and settleJob, both pinned").toEqual([
      "read committed",
      "read committed",
    ]);
  }, 60_000);

  it("commits a first write of a document while another writer holds it", async () => {
    /* **Sol's interleaving, at the production call site, on a connection that
       defaults to repeatable read.** Under that default the conflict-tolerant
       insert is not tolerant of anything: it raises `40001`, which nothing
       retries, and the abort takes the artefacts, the step and the job
       transition with it. The pin is the only thing standing between this and
       that. */
    if (!rrDb) throw new Error("unreachable: the suite skips without a database");
    const sha = freshDigest();
    const ref = await makeClaim("racing");
    const session = pgStoreSession({ ref, db: rrDb });
    await session.beginStep(ref.slug, "fetch");

    let letTheOtherGo = (): void => {};
    const mayCommit = new Promise<void>((resolve) => {
      letTheOtherGo = resolve;
    });
    let hasWritten = (): void => {};
    const written = new Promise<void>((resolve) => {
      hasWritten = resolve;
    });

    /* Somebody else's ingest of the same document, one statement into its own
       transaction and holding. Written by hand rather than through a second
       session, because the claim here is about *this* commit and a second
       session would only add another thing that could be at fault. */
    const other = getDb().transaction(async (tx: Tx) => {
      await tx.insert(rawSources).values({
        sha256: sha,
        kind: "html",
        bytes: 4096,
        contentType: "text/html",
        verifiedAt: new Date("2026-09-01T00:00:00.000Z"),
      });
      hasWritten();
      await mayCommit;
    });

    try {
      await written;

      const committing = session.commit(
        contextFor(ref.slug),
        STEPS.fetch,
        ref.attemptId,
        { detail: "one document", parts: { raw: manifestFor(sha) } },
        releaseOf(ref),
      );

      /* **The overlap, asserted.** Without this the case would pass on a commit
         that ran entirely after the other writer — the ordinary ordering, which
         proves nothing about either the race or the isolation level. */
      const settled = await Promise.race([
        committing.then(
          () => "settled",
          () => "settled",
        ),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 700)),
      ]);
      expect(settled, "the commit must be blocked on the other writer's row").toBe("waiting");

      letTheOtherGo();
      await other;

      const settlement = await committing;
      expect(settlement.kind, "the commit goes through, rather than losing the revision").toBe(
        "released",
      );
    } finally {
      letTheOtherGo();
      await other.catch(() => {});
    }

    /* One row for the document, and this revision pointing at it — a commit
       that swallowed the conflict and wrote no reference would pass everything
       above. */
    const [row] = await getDb()
      .select({ bytes: rawSources.bytes, contentType: rawSources.contentType })
      .from(rawSources)
      .where(eq(rawSources.sha256, sha));
    expect(row).toEqual({ bytes: 4096, contentType: "text/html" });

    const [revision] = await getDb()
      .select({ sha: articleRevisions.rawSourceSha256 })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, ref.revisionId));
    expect(revision?.sha, "the revision really does point at the shared row").toBe(sha);
  }, 60_000);
});
