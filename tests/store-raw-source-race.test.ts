/**
 * Two writers, one document: `writeRawSource` under real concurrency.
 *
 * `raw_sources` is keyed `(sha256, kind)` — **one row per document**, shared by
 * every article ever made from those bytes. So a first write of a given
 * document is the one place in the artefact store where two unrelated ingests
 * touch the same row: the same URL added by two readers, the same PDF uploaded
 * twice, a refresh racing an add.
 *
 * It used to be `select … for update` and then `insert`, and **a `select … for
 * update` over no rows locks nothing**. Both writers saw nothing, both
 * inserted, and the loser got `duplicate key value violates unique constraint
 * "raw_sources_sha256_kind_pk"` — rolling back its *whole* transaction, so the
 * revision write went with it. src/store/artifacts-pg.ts § `writeRawSource` has
 * the shape of the fix and the numbers from reproducing it.
 *
 * ## Why the cases are shaped the way they are
 *
 * The first case is **deterministic, not a race to lose**. It opens writer A's
 * transaction, lets it write the row, and holds it uncommitted while writer B
 * tries the same document. B blocks on the unique index — asserted, so the
 * overlap is a fact rather than a hope — and only then is A let go. There is no
 * timing window to miss: the interleaving that used to fail is the interleaving
 * this case always produces.
 *
 * The second case is four writers on **a barrier**, which is the same claim
 * without the choreography. It is here because a barrier is the thing that was
 * got wrong once already: an earlier measurement staggered its writers by their
 * own process startup and reported *zero* collisions where a barrier gives
 * fifteen of sixteen (tests/helpers/load-article.ts § `LoadOptions.serialise`).
 * Load that arrives spread out is not the load a race needs.
 *
 * ## It does not take the run lock
 *
 * Every slug here is minted fresh and the document's digest is random bytes, so
 * there is no row a peer's `npm test` could be sharing. Taking `RUN_LOCK` would
 * only queue this suite behind every other one — and the first case deliberately
 * holds a transaction open, which is not a thing to do while holding a key
 * everybody else is waiting for.
 *
 * Skips loudly when there is no database; tests/helpers/pg-ready.ts explains.
 */
import { randomBytes } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs, rawSources } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { RawManifest } from "../src/fetch.js";
import { mintId } from "../src/ids.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import { RawSourceDisagrees, writeArtefacts } from "../src/store/artifacts-pg.js";
import { mintAttempt } from "../src/store/jobs.js";
import { beginStepRun } from "../src/store/pg-revisions.js";
import type { JobStep } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const { reachable } = await pgReady({
  suite: "tests/store-raw-source-race.test.ts",
  tables: ["spideryarn.raw_sources", "spideryarn.article_revisions"],
});
const when = reachable ? describe : describe.skip;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Greg's local `auth.users` row — a foreign key, so it has to be a real one. */
const DEV_OWNER_ID = ADMIN_USER_ID_LOCAL;

const JOB_STEPS: JobStep[] = [{ name: "fetch", label: "Fetching", status: "pending" }];

/** Everything this file made, so teardown removes those rows and nothing else. */
const mine = { slugs: [] as string[], shas: [] as string[] };

afterAll(async () => {
  if (reachable) {
    const db = getDb();
    if (mine.slugs.length) {
      await db.delete(jobs).where(inArray(jobs.slug, mine.slugs));
      const rows = await db
        .select({ id: articles.id })
        .from(articles)
        .where(inArray(articles.slug, mine.slugs));
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        await db
          .update(articles)
          .set({ currentRevisionId: null })
          .where(inArray(articles.id, ids));
        await db.delete(articleRevisions).where(inArray(articleRevisions.articleId, ids));
        await db.delete(articles).where(inArray(articles.id, ids));
      }
    }
    for (const sha of mine.shas) {
      await db.delete(rawSources).where(eq(rawSources.sha256, sha));
    }
    await closeDb();
  }
});

/** A digest nothing in the database can already be holding. */
function freshDigest(): string {
  const sha = randomBytes(32).toString("hex");
  mine.shas.push(sha);
  return sha;
}

/**
 * An article, a draft revision, and a live job holding a `fetch` run on it —
 * **committed**, because the point of this file is transactions that see each
 * other, and rows inside an open transaction are rows nobody else can see.
 */
async function makeWriter(label: string): Promise<JobDraftRef> {
  const db = getDb();
  const slug = `test-raw-race-${label}-${randomBytes(4).toString("hex")}`;
  mine.slugs.push(slug);

  const [article] = await db
    .insert(articles)
    .values({ ownerId: DEV_OWNER_ID, slug })
    .returning();
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
    ownerId: DEV_OWNER_ID,
    slug,
    steps: JOB_STEPS,
    status: "running",
    attemptId,
    leaseExpiresAt: new Date(Date.now() + 600_000),
    workKey: `wk-${jobId}`,
    draftRevisionId: revision.id,
  });

  const ref: JobDraftRef = {
    slug,
    articleId: article.id,
    revisionId: revision.id,
    jobId,
    attemptId,
  };
  await db.transaction(async (tx) => {
    await beginStepRun(
      { revisionId: ref.revisionId, stepName: "fetch", job: { id: jobId, attemptId } },
      tx,
    );
  });
  return ref;
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

/** Did `promise` settle within `ms`? Never throws; the answer is the assertion. */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const pending = Symbol("pending");
  const result = await Promise.race([
    promise.then(
      () => "done",
      () => "threw",
    ),
    new Promise((resolve) => setTimeout(() => resolve(pending), ms)),
  ]);
  return result !== pending;
}

/** How many rows this digest has, asked outside anybody's transaction. */
async function rowsFor(sha: string): Promise<{ bytes: number; contentType: string }[]> {
  return getDb()
    .select({ bytes: rawSources.bytes, contentType: rawSources.contentType })
    .from(rawSources)
    .where(and(eq(rawSources.sha256, sha), eq(rawSources.kind, "html")));
}

when("two writers of one raw document", () => {
  it("lets the second one through while the first still holds the row uncommitted", async () => {
    /* **The interleaving, made to happen rather than waited for.** A holds an
       uncommitted `raw_sources` row for a digest Postgres has never seen; B
       writes the same digest. Under `select … for update` then `insert`, B's
       lock found no row to take, B inserted, B waited on the index, and the
       moment A committed B got a duplicate key and lost its entire revision
       write. Watched red exactly there. */
    const sha = freshDigest();
    expect(await rowsFor(sha), "this document must be one Postgres has never seen").toEqual([]);

    const a = await makeWriter("first");
    const b = await makeWriter("second");

    let letAGo = (): void => {};
    const aMayCommit = new Promise<void>((resolve) => {
      letAGo = resolve;
    });
    let aHasWritten = (): void => {};
    const aWrote = new Promise<void>((resolve) => {
      aHasWritten = resolve;
    });

    const first = getDb().transaction(async (tx: Tx) => {
      await writeArtefacts(a, tx, a.slug, "fetch", { raw: manifestFor(sha) }, {});
      aHasWritten();
      await aMayCommit;
    });

    try {
      await aWrote;

      const second = getDb().transaction(async (tx: Tx) => {
        await writeArtefacts(b, tx, b.slug, "fetch", { raw: manifestFor(sha) }, {});
      });

      /* **The overlap, asserted.** Without this the case would still pass on a
         B that ran entirely after A — which is the ordinary, uninteresting
         ordering and proves nothing about the race. B must be *stuck on A*. */
      expect(
        await settledWithin(second, 700),
        "the second writer must be blocked on the first one's uncommitted row",
      ).toBe(false);

      letAGo();
      await first;

      /* The whole claim: B finishes, rather than losing its transaction to a
         duplicate key. */
      await expect(second).resolves.toBeUndefined();
    } finally {
      letAGo();
      await first.catch(() => {});
    }

    expect(await rowsFor(sha)).toEqual([{ bytes: 4096, contentType: "text/html" }]);

    /* And both revisions really do point at it — a `writeRawSource` that
       swallowed the conflict and then wrote no reference would pass everything
       above. */
    const pointing = await getDb()
      .select({ id: articleRevisions.id })
      .from(articleRevisions)
      .where(
        and(
          eq(articleRevisions.rawSourceSha256, sha),
          eq(articleRevisions.rawSourceKind, "html"),
        ),
      );
    expect(pointing.map((r) => r.id).sort()).toEqual([a.revisionId, b.revisionId].sort());
  }, 60_000);

  it("lets four writers on a barrier all through, and leaves exactly one row", async () => {
    /* **A barrier, not staggered starts.** Every writer opens its transaction,
       says so, and waits; only when all four are inside does any of them write.
       Writers that arrive spread out do not race, and a version of this that
       let them stagger reported zero collisions where a barrier gives fifteen
       of sixteen — the known trap here, not a hypothetical. */
    const sha = freshDigest();
    expect(await rowsFor(sha), "this document must be one Postgres has never seen").toEqual([]);

    const writers = await Promise.all(
      [0, 1, 2, 3].map((i) => makeWriter(`barrier-${String(i)}`)),
    );

    let arrived = 0;
    let openTheGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      openTheGate = resolve;
    });

    const outcomes = await Promise.allSettled(
      writers.map((ref) =>
        getDb().transaction(async (tx: Tx) => {
          /* A statement first, so the transaction is genuinely open on a
             connection of its own before anyone is let through the gate. */
          await tx.execute(sql`select 1`);
          arrived += 1;
          if (arrived === writers.length) openTheGate();
          await gate;
          await writeArtefacts(ref, tx, ref.slug, "fetch", { raw: manifestFor(sha) }, {});
        }),
      ),
    );

    const refused = outcomes.filter((o) => o.status === "rejected");
    expect(
      refused.map((o) => String((o as PromiseRejectedResult).reason)),
      "every concurrent writer of one document must succeed",
    ).toEqual([]);

    expect(await rowsFor(sha), "and there must be exactly one row").toEqual([
      { bytes: 4096, contentType: "text/html" },
    ]);
  }, 60_000);

  it("still refuses a second document claiming the first one's digest", async () => {
    /* **The check the conflict-tolerant insert must not have cost.** Two
       different documents cannot hash to one name, so a manifest whose size
       disagrees with the row already there is corruption rather than a race to
       resolve — and the comparison has to be against **what is in the table**,
       not against what this call tried to insert. Watched red by comparing
       against the manifest's own values instead of the read-back row: the
       second writer's 999 bytes then sailed in uncompared. */
    const sha = freshDigest();
    const a = await makeWriter("agree");
    const b = await makeWriter("disagree");

    await getDb().transaction(async (tx: Tx) => {
      await writeArtefacts(a, tx, a.slug, "fetch", { raw: manifestFor(sha, 4096) }, {});
    });

    await expect(
      getDb().transaction(async (tx: Tx) => {
        await writeArtefacts(b, tx, b.slug, "fetch", { raw: manifestFor(sha, 999) }, {});
      }),
    ).rejects.toThrow(RawSourceDisagrees);

    expect(await rowsFor(sha)).toEqual([{ bytes: 4096, contentType: "text/html" }]);
  }, 60_000);
});
