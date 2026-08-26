/**
 * The two stores must answer identically. This is the test the whole migration
 * rests on.
 *
 * **It compares the API-shaped result, not SQL rows.** That distinction is the
 * point: a row-level comparison passes happily while the `Article` the client
 * receives has changed shape, and the client is the only thing that matters. So
 * every assertion here goes through `JSON.parse(JSON.stringify(…))` — the wire
 * form, exactly what `src/routes.ts` would send.
 *
 * **What serialising does and does not buy.** It asserts what the client
 * actually receives, which is the point. It does NOT catch the
 * `exactOptionalPropertyTypes` distinction, and an earlier version of this
 * comment claimed it did — `JSON.stringify` deletes an `undefined` value
 * outright, so `{ byline: undefined }` and `{}` are the same string and no
 * assertion here can tell them apart. `toEqual` already separates
 * `{ byline: null }` from `{}` without any help, so serialising adds nothing on
 * that front either. GPT Sol caught the overclaim in review, 2026-08-26;
 * docs/plans/postgres-storage-review-sol.md. The absent-versus-undefined
 * distinction is checked by `toStrictEqual` and by explicit `in` assertions,
 * not by this.
 *
 * **These import into the local database as part of the run.** That is
 * deliberate: a parity test that needed someone to have run the importer first
 * would silently pass on stale rows, comparing today's files against last
 * week's import. The importer is idempotent, so this is cheap.
 *
 * Skips loudly when there is no database, for the reason
 * tests/db-schema.test.ts explains at length: a skipped test protects nothing,
 * so the run must say "skipped" rather than "passed".
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { desc, eq, inArray } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { currentOwnerId } from "../src/owner.js";
import { ADDED_AT } from "../src/store/pg.js";
import { loadEnvLocal } from "../src/env.js";
import { isSpideryarnId } from "../src/ids.js";
import { fsArticleReader, fsCommentStore } from "../src/store/fs.js";
import { importArticle } from "../src/store/import.js";
import { pgArticleReader } from "../src/store/pg.js";
import type { LibraryEntry } from "../src/types.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");

/** Thrown to roll a transaction back once its assertions have run. */
class RollBack extends Error {}

/** The wire form: what the client actually receives. */
function wire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Every `data/` directory with both artefacts an article needs.
 *
 * **`data/` is shared mutable state during a test run, and that is not a bug in
 * the other tests.** `tests/parse-json.test.ts` builds a real article directory
 * called `test-parse-json-article` to prove a parse failure names its file, and
 * removes it afterwards. Vitest runs files concurrently, so a scan here can see
 * that directory half-built or catch it on the way out — and the first version
 * of this test duly failed in the full suite while passing on its own, which is
 * the least useful kind of red.
 *
 * So the scan happens once, in `beforeAll`, after the probe — not at module
 * load — and it skips any directory whose name begins with `test-`, which is
 * the naming every fixture here follows. A fixture that appears or vanishes
 * mid-run is therefore never in the list to begin with. The count is asserted
 * afterwards so that "everything vanished" cannot pass as "nothing to do".
 *
 * (An earlier version of this comment said the list was taken twice, once at
 * module load and once before importing. It never was. GPT Sol caught it in
 * review, 2026-08-26.)
 */
async function importableSlugs(): Promise<string[]> {
  const entries = await readdir(path.join(ROOT, "data"), { withFileTypes: true });
  const slugs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    /* Another test file's fixture, not an article. `tests/parse-json.test.ts`
       builds `test-parse-json-article` DELIBERATELY without the `_` prefix,
       because its whole point is that `listArticles` should see an ordinary
       article. That is right for it and wrong for us: vitest runs files
       concurrently, so scanning `data/` here catches the directory half-built
       or on its way out, and this suite failed in the full run while passing
       alone — the least useful kind of red. Excluded by name, the same way
       `_jobs` is, rather than left to fail the artefact check by luck. */
    if (entry.name.startsWith("test-")) continue;
    const files: string[] = await readdir(path.join(ROOT, "data", entry.name)).catch(
      () => [] as string[],
    );
    if (files.includes("blocks.json") && files.includes("tree.json")) slugs.push(entry.name);
  }
  return slugs;
}

/**
 * The probe runs at MODULE LOAD so the skip is a real vitest skip, and the run
 * reports "skipped" rather than a green tick for having checked nothing.
 */
let reachable = false;
let slugs: readonly string[] = [];

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  /* 10 seconds, not 2. At 2s this probe timed out under nothing worse than a
     dev server holding connections, and the whole suite skipped — inside a run
     that still printed a green "1103 passed". A parity suite that opts itself
     out when the machine is busy is worse than one that fails, because the
     signal it gives is indistinguishable from success. */
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.revision_blocks') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();

  /* Said out loud. DATABASE_URL being SET and the database being unreachable is
     a different situation from having no database at all, and only the first
     one means somebody's Docker is off while they believe these ran. */
  if (!reachable) {
    console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
  }
  if (reachable) slugs = await importableSlugs();
}

const when = reachable ? describe : describe.skip;

afterAll(async () => {
  await closeDb();
});

when("the filesystem and Postgres stores agree", () => {
  beforeAll(async () => {
    for (const slug of slugs) await importArticle(slug);
  }, 60_000);

  it("has something to compare", () => {
    // A parity suite over zero articles passes perfectly and proves nothing.
    expect(slugs.length).toBeGreaterThan(0);
  });

  describe.each(slugs)("%s", (slug) => {
    it("returns an identical Article", async () => {
      const [fromFiles, fromPg] = await Promise.all([
        fsArticleReader.loadArticle(slug),
        pgArticleReader.loadArticle(slug),
      ]);
      expect(wire(fromPg)).toEqual(wire(fromFiles));
      /* And again WITHOUT serialising, because the two assertions catch
         different things. `toStrictEqual` is the only one that separates
         `{ byline: undefined }` from `{}` — `JSON.stringify` deletes the key
         and `toEqual` ignores it — and that difference is the whole reason
         `exactOptionalPropertyTypes` is on: src/store/pg.ts spreads
         conditionally so that a null column becomes an absent property rather
         than an explicit `undefined` one, and nothing was checking that it
         had. Added after GPT Sol's review, 2026-08-26. */
      expect(fromPg).toStrictEqual(fromFiles);
    });

    it("returns the blocks in the same order, by id", async () => {
      // Asserted separately from the deep equality above, because block ORDER
      // is the one thing that cannot be recovered if it is lost: ids are random
      // and carry no position. A deep-equal failure on a 360-block article is
      // also unreadable; this one names the first id that moved.
      const [fromFiles, fromPg] = await Promise.all([
        fsArticleReader.loadArticle(slug),
        pgArticleReader.loadArticle(slug),
      ]);
      expect(fromPg.blocks.map((b) => b.id)).toEqual(fromFiles.blocks.map((b) => b.id));
    });

    for (const [name, read] of [
      ["tweets", (r: typeof fsArticleReader) => r.loadTweets(slug)],
      ["glossary", (r: typeof fsArticleReader) => r.loadGlossary(slug)],
      ["summaries", (r: typeof fsArticleReader) => r.loadSummaries(slug)],
    ] as const) {
      it(`agrees about ${name}, present or absent`, async () => {
        const fromFiles = await read(fsArticleReader).catch((err: unknown) => err);
        const fromPg = await read(pgArticleReader as typeof fsArticleReader).catch(
          (err: unknown) => err,
        );

        if (fromFiles instanceof Error) {
          /* Absence has to match too, and match as a STATUS. routes.ts turns
             `status: 404` into a 404 and an untagged throw into a 500, so a
             store that threw the right message with the wrong tag would turn
             "no thread yet" — the ordinary case the page's button is for —
             into a server error. */
          expect(fromPg).toBeInstanceOf(Error);
          expect((fromPg as { status?: number }).status).toBe(
            (fromFiles as { status?: number }).status,
          );
          return;
        }

        expect(fromPg).not.toBeInstanceOf(Error);
        expect(wire(fromPg)).toEqual(wire(fromFiles));
        // See the note on `toStrictEqual` above: absent is not `undefined`.
        expect(fromPg).toStrictEqual(fromFiles);
      });
    }
  });

  it("lists the same articles, with the same derived counts", async () => {
    const [fromFiles, fromPg] = await Promise.all([
      fsArticleReader.listArticles(),
      pgArticleReader.listArticles(),
    ]);

    /* The committed `example/` fixture is the ONE known difference, and it is
       an open question rather than a bug: src/api.ts appends it to the shelf
       explicitly, and it does not live under `data/`, so nothing imported it.
       See docs/plans/postgres-migration.md open question 8. Asserting that it
       is the *only* difference is what stops this exclusion quietly growing to
       cover a real one. */
    const realOnly = (entries: LibraryEntry[]) => entries.filter((e) => !e.fixture);
    const fixtures = fromFiles.filter((e) => e.fixture).map((e) => e.slug);
    /* Whether the shelf shows the fixture at all is src/api.ts's call, and it
       has already changed once under this test — which asserted `["example"]`
       and went red the afternoon the fixture stopped being listed. So the
       assertion is the invariant rather than the count: any fixture the
       filesystem store shows can only be `example`, and Postgres shows none,
       because nothing imported `example/` and it does not live under `data/`.
       A second fixture appearing from anywhere still fails this. */
    expect(fixtures.filter((slug) => slug !== "example")).toEqual([]);
    expect(fromPg.some((e) => e.fixture)).toBe(false);

    const bySlug = (entries: LibraryEntry[]) =>
      [...entries].sort((a, b) => a.slug.localeCompare(b.slug));

    /* **An article whose directory has been deleted is out of scope here.**

       `importArticle` imports one article and has no way to notice that a
       DIFFERENT one has gone: nothing prunes, so a `data/<slug>/` removed after
       an import leaves a row behind, with a current revision, and the Postgres
       library goes on listing an article the filesystem no longer has. It is a
       real gap — `npm run db:import` does not make Postgres match `data/` —
       and it is written up in docs/plans/postgres-storage-implementation.md
       rather than papered over.

       It is not, however, a parity failure, and letting it read as one cost an
       afternoon: `labels-checkpoint-check` was left in the database by somebody
       else's checkpoint run, and this test failed in full runs and passed alone
       for a reason that had nothing to do with either store. So the comparison
       is scoped to articles that exist on disk right now. An extra article that
       DOES have a directory still fails, which is the property worth keeping. */
    const onDisk = new Set(await importableSlugs());
    const present = (entries: LibraryEntry[]) => entries.filter((e) => onDisk.has(e.slug));

    /* **A comment whose anchor is not a block id is counted by the files and
       cannot exist in Postgres.**

       `block_identities` has a format check; `comments.json` has none, and
       something wrote a comment on `data/writes` anchored to `zzzz00`. The
       importer skips it and says so (src/store/import.ts), so the filesystem
       count is one higher. That is a permitted difference and it is the ONLY
       permitted one, so it is subtracted here by the same rule the importer
       applies rather than by a hardcoded number — the day the corrupt row is
       deleted, this becomes a no-op instead of becoming wrong. */
    const skipped = new Map<string, number>();
    for (const slug of onDisk) {
      const bad = (await fsCommentStore.load(slug)).filter((c) => !isSpideryarnId(c.blockId));
      if (bad.length) skipped.set(slug, bad.length);
    }
    const anchored = (entries: LibraryEntry[]) =>
      entries.map((e) =>
        skipped.has(e.slug) ? { ...e, comments: e.comments - (skipped.get(e.slug) ?? 0) } : e,
      );

    expect(wire(bySlug(present(realOnly(fromPg))))).toEqual(
      wire(bySlug(anchored(present(realOnly(fromFiles))))),
    );
  });

  it("sorts an article with no fetchedAt by its createdAt, not to the top", async () => {
    /* **This test is built around data that is deliberately unlucky.**
       The query used to be `order by fetched_at desc`, which puts every article
       that never got a `fetched_at` at the TOP, because Postgres sorts NULLs
       first under DESC. Parity passed anyway — the one real article with a null
       `fetched_at` happens to be the newest, so both stores agreed by accident.
       Asserting the ordering property against the articles we happen to have
       could not fail, and a test that cannot go red proves nothing.

       So: three rows inside a transaction that is rolled back, with the null
       one in the MIDDLE by date, ordered by the real exported expression. */
    const db = getDb();
    let order: string[] = [];

    /* The assertion happens OUTSIDE the transaction. Asserting inside means the
       failure is a thrown AssertionError that the rollback then masks — the
       test reports "expected ... to be an instance of RollBack", which says
       nothing about the ordering. Collect, roll back, then assert. */
    try {
      await db.transaction(async (tx) => {
        const owner = currentOwnerId();
        const mk = async (n: number, slug: string, fetchedAt: Date | null, createdAt: Date) => {
          const articleId = `00000000-0000-4000-8000-00000000000${n}`;
          const revisionId = `00000000-0000-4000-8000-00000000010${n}`;
          await tx.insert(articles).values({ id: articleId, ownerId: owner, slug });
          await tx
            .insert(articleRevisions)
            .values({ id: revisionId, articleId, status: "published", fetchedAt, createdAt });
          await tx
            .update(articles)
            .set({ currentRevisionId: revisionId })
            .where(eq(articles.id, articleId));
        };
        await mk(1, "order-newest", new Date("2026-03-03T00:00:00Z"), new Date("2020-01-01Z"));
        // The unlucky one: no fetchedAt, and NOT the newest.
        await mk(2, "order-middle", null, new Date("2026-02-02T00:00:00Z"));
        await mk(3, "order-oldest", new Date("2026-01-01T00:00:00Z"), new Date("2020-01-01Z"));

        const rows = await tx
          .select({ slug: articles.slug })
          .from(articles)
          .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
          .where(inArray(articles.slug, ["order-newest", "order-middle", "order-oldest"]))
          .orderBy(desc(ADDED_AT));
        order = rows.map((r) => r.slug);

        // Roll back: these rows must not outlive the test, or the library
        // parity comparison below starts failing for an unrelated reason.
        throw new RollBack();
      });
    } catch (err) {
      if (!(err instanceof RollBack)) throw err;
    }

    expect(order).toEqual(["order-newest", "order-middle", "order-oldest"]);
  });

  it("orders the library the same way", async () => {
    // Order is a separate assertion from content because `addedAt` falls back
    // to the mtime of blocks.json when meta.json has no `fetchedAt` — the noema
    // article's meta.json says so in its own note. The importer seeds the
    // revision's created_at from that same mtime so the fallback lands on the
    // identical value; without that the shelf silently reorders on import.
    const [fromFiles, fromPg] = await Promise.all([
      fsArticleReader.listArticles(),
      pgArticleReader.listArticles(),
    ]);
    /* Scoped to what is on disk, for the reason spelled out in the test above:
       an orphaned row from a deleted directory is a gap in the importer, not a
       disagreement between the stores. Order is still compared across every
       article both of them do have. */
    const onDisk = new Set(await importableSlugs());
    expect(fromPg.map((e) => e.slug).filter((slug) => onDisk.has(slug))).toEqual(
      fromFiles.filter((e) => !e.fixture && onDisk.has(e.slug)).map((e) => e.slug),
    );
  });

  it("refuses a traversal slug the same way, and before it reaches a query", async () => {
    // The confirmed path traversal in the read API (docs/project/security.md)
    // was disguised as a refusal by the fixture fallback. Postgres has no
    // directories to walk out of, but the guard must still be there and still
    // be a 400 rather than a 404 — otherwise the day someone joins a slug onto
    // a path again, this store has no opinion about it.
    await expect(pgArticleReader.loadArticle("../../etc/passwd")).rejects.toMatchObject({
      status: 400,
    });
  });
});
