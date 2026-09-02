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
 * docs/plans/260826j-postgres-storage-review-sol.md. The absent-versus-undefined
 * distinction is checked by `toStrictEqual` and by explicit `in` assertions,
 * not by this.
 *
 * ## The corpus is loaded through the real write path, from nothing
 *
 * This used to call `importArticle`, and `db:import` is being deleted
 * (docs/plans/260827aa-delete-the-importer.md § C7). The replacement is not a smaller
 * importer: `loadArticleIntoPg` drives the *production* seam — `storeRawSource`,
 * a fenced `jobs` row, `openOrBeginJobDraft`, `beginStep`/`write`/`finishStep`
 * per step, then `publishRevision` with its guards run rather than routed
 * around. What used to be "the importer and the pipeline agree with each other"
 * is now "the pipeline's own write path and the filesystem agree".
 *
 * **And every revision is deleted first, which is not tidiness — it is the
 * whole claim.** `beginDraftIn` carries a published revision's columns, blocks
 * and step-run rows forward into the new draft, so an article some earlier run
 * put in Postgres reads back *perfectly* through columns this path never wrote.
 * The first sweep of this corpus reported `noema` byte-identical when it could
 * not have been: it has no `raw.json`, nothing writes `final_url`, and the
 * matching value was last week's import showing through. Every load below
 * therefore asserts `basedOn === null` — a load that carried is not a load.
 * GPT Sol, 2026-08-28.
 *
 * **The revisions, and not the article.** `basedOn` is `articles
 * .current_revision_id`, so clearing the pointer and the revisions behind it is
 * all the claim needs — and it leaves the article row, its block identities and
 * everything anchored to them alone. Deleting the article instead cascades
 * through comments, chat, searches and identities, and does it while other test
 * files are running against the same database: vitest runs files concurrently,
 * and an article that vanishes for two seconds fails whoever was reading it for
 * a reason that has nothing to do with them. Scoped to `currentOwnerId()`, so a
 * mis-set `DATABASE_URL` pointing at somebody else's articles takes nothing.
 *
 * ## What the two stores genuinely disagree about, and why it is not a bug
 *
 * Three differences survive a clean load, all of them real and all of them
 * asserted positively rather than normalised away:
 *
 * 1. **`fetchedAt` is stage 1's clock in Postgres and stage 2's on disk.**
 *    `src/extract.ts` writes `new Date().toISOString()` into `meta.json` every
 *    time it runs, so the filesystem's "fetched at" is really "extracted at".
 *    Postgres takes the column from `raw.json`, which is when the document was
 *    actually fetched. Postgres is right — see the note on `META_COLUMNS` in
 *    src/store/artifacts-pg.ts, which is why `extract` is not allowed to write
 *    that column. The importer papered over it by writing `meta.fetchedAt` into
 *    `article_revisions.fetched_at`, which is how this went unnoticed.
 * 2. **An article with no `raw.json` has no `url` and no `fetchedAt` in
 *    Postgres.** Those are stage 1's facts; with no stage 1 there is nothing to
 *    write them from, and `meta.json` having copies of them is stage 2 having
 *    copied what it was handed. `noema-mythology-of-conscious-ai` is that
 *    article and it gets its own test.
 * 3. **A comment anchored to something that is not a block id is counted by the
 *    files and cannot exist in Postgres** — see the note in the library test.
 *
 * `constitution` is a fourth thing, and it is not a disagreement at all: it
 * refuses to publish, correctly, because its `labels.json` predates
 * `sourceHash`. It is out of the corpus with a test of its own.
 *
 * Skips loudly when there is no database, for the reason
 * tests/db-schema.test.ts explains at length: a skipped test protects nothing,
 * so the run must say "skipped" rather than "passed".
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, desc, eq, inArray } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { currentOwnerId } from "../src/owner.js";
import { ADDED_AT } from "../src/store/pg.js";
import { loadEnvLocal } from "../src/env.js";
import { isSpideryarnId } from "../src/ids.js";
import { loadShelf } from "../src/shelf.js";
import { fsArticleReader, fsCommentStore, fsLibrarySearch, fsSearchStore } from "../src/store/fs.js";
import { pgLibrarySearch } from "../src/store/pg-shelf.js";
import { pgSearchStore } from "../src/store/pg-searches.js";
import { pgArticleReader } from "../src/store/pg.js";
import type { Article, LibraryEntry, Meta } from "../src/types.js";
import { releaseCorpusLock, takeCorpusLock } from "./helpers/corpus-lock.js";
import { forgetRevisions } from "./helpers/forget-revisions.js";
import { pgReady } from "./helpers/pg-ready.js";
import { type LoadedArticle, loadArticleIntoPg } from "./helpers/load-article.js";
import {
  seedCommentsFromFiles,
  seedGlossaryLookupsFromFiles,
  seedShelfFromFiles,
} from "./helpers/seed-reader-state.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The article that cannot be published, and is in `data/` on purpose.
 *
 * Its `labels.json` was written before stage 4 recorded a `sourceHash`, so the
 * publication gate has nothing to check the ToC against and refuses. That is
 * the correct answer to real legacy data, and the importer never met it because
 * it stamped every step row `done` with a hash it computed itself. Kept out of
 * the corpus below and given its own test, so the corpus can assert unqualified
 * equality. GPT Sol's decision 1, 2026-08-28.
 */
const LEGACY_SLUG = "constitution";

/**
 * **It is out of the two library comparisons as well, and both stores are
 * right about it.**
 *
 * The filesystem store knows nothing about publication: the article has blocks
 * and a tree on disk, so `src/api.ts` describes it and puts it on the shelf.
 * Postgres refuses to publish it — the `describe` block below — and
 * `onTheShelf` (src/store/pg.ts) drops any article with no current revision, so
 * it is never in that library at all. That is the legacy article being legacy in
 * the one place a library can see it, and it is not a parity failure any more
 * than the refusal itself is.
 *
 * **This did not surface until the committed corpus did, and that is the
 * finding rather than a regression.** On a laptop `data/constitution/shelf.json`
 * says `archivedAt` — Greg archived it on 2026-08-27, after 199 opens — and
 * `src/api.ts` filters the library on `!!e.archivedAt === !!opts.archived`. So
 * the filesystem never listed it, the comparison never met it, and both tests
 * passed on one machine's reader state rather than on their own property. The
 * corpus carries no reader state, deliberately, because it is a real reader's
 * words (tests/fixtures/data-root/README.md) — so there the article is
 * unarchived, the difference appears, and the tests go red for something that
 * was always true. docs/plans/260901b-committed-fixture-corpus.md § Ranked
 * silent failures, 2.
 *
 * Excluded by the same constant that keeps it out of `slugs`, and **asserted
 * rather than merely subtracted** — see `expectPostgresOmitsTheLegacyArticle`.
 */

/**
 * Postgres must have no published revision for the article it refused.
 *
 * The exclusion above removes a known difference, and a subtraction that is
 * never checked is how a real difference hides behind a permitted one. This is
 * the other half, and it enforces what the block below only says in prose: *if
 * this ever gains a stamp, retire the case.* Stamp `labels.json`, and the load
 * publishes, and this goes red at the exclusion site rather than the exclusion
 * quietly covering for it.
 *
 * **Asserted against `articles.current_revision_id`, and deliberately NOT
 * against the library listing, which cannot see this.** The obvious form was
 * written first —
 *
 *     expect(fromPg.map((e) => e.slug)).not.toContain(LEGACY_SLUG)
 *
 * — and it was green for the wrong reason, which is the same wrong reason this
 * whole exclusion exists to document. `src/store/pg.ts:1367` filters the
 * Postgres library on `articles.archived_at` exactly as `src/api.ts` filters
 * the filesystem one, and this laptop's database has `constitution` archived
 * too. Staged with a matching `sourceHash` in a throwaway worktree, the article
 * published, `loadArticle` served it, the three tests below went red — and that
 * assertion still passed. The accident had a mirror image on the other side,
 * and a guard reading the shelf could not have seen either. Measured on
 * 2026-09-01 rather than reasoned; docs/reusable/silent-success.md.
 *
 * The revision pointer is the fact itself, so no filter is in front of it.
 * Scoped to the owner, like every other read here, so a mis-set `DATABASE_URL`
 * cannot answer this question about somebody else's article.
 */
async function expectPostgresRefusedTheLegacyArticle(): Promise<void> {
  const [row] = await getDb()
    .select({ currentRevisionId: articles.currentRevisionId })
    .from(articles)
    .where(and(eq(articles.slug, LEGACY_SLUG), eq(articles.ownerId, currentOwnerId())));

  expect(
    row?.currentRevisionId ?? null,
    `Postgres has a published revision for ${LEGACY_SLUG}, which the gate is supposed to ` +
      "refuse. Either labels.json gained a sourceHash — in which case retire the case, as " +
      "the block below says, rather than restoring the stale file — or the publication gate " +
      "stopped checking. Both are real changes and neither should be absorbed by the " +
      "exclusion at the comparison sites.",
  ).toBeNull();
}

/** The article with no stage 1, and therefore no `url` and no `fetchedAt`. */
const NO_FETCH_SLUG = "noema-mythology-of-conscious-ai";

/** Thrown to roll a transaction back once its assertions have run. */
class RollBack extends Error {}

/** The wire form: what the client actually receives. */
function wire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** One of an article's JSON files, or `null` when it has none. */
async function readArticleJson<T>(slug: string, file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(ROOT, "data", slug, file), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
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
async function completeArticles(): Promise<string[]> {
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
    /* **`ENOENT` only.** A directory listed a millisecond ago can be a peer
       suite's fixture on its way out, and that is the one error worth reading
       as "no files". Every other error — a permission, an I/O fault — means the
       scan is not seeing what is there, and an article silently leaving the
       corpus is how a parity suite quietly stops comparing the thing it was
       written for. Same rule, same reason, in tests/store-artefact-manifest.test.ts. */
    const files: string[] = await readdir(path.join(ROOT, "data", entry.name)).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return [] as string[];
        throw err;
      },
    );
    if (files.includes("blocks.json") && files.includes("tree.json")) slugs.push(entry.name);
  }
  return slugs;
}

/** Everything on disk, the legacy article included. */
let onDiskSlugs: readonly string[] = [];
/** The publishable corpus: everything except the legacy article. */
let slugs: readonly string[] = [];

/* The `await` is at MODULE LOAD so the skip is a real vitest skip, and the run
   reports "skipped" rather than a green tick for having checked nothing. The
   ten-second connect timeout and the warning both live in the helper now; its
   header quotes the paragraph this file used to carry, because this is the
   suite that learned it. */
const { reachable } = await pgReady({
  suite: "tests/store-parity.test.ts",
  tables: ["spideryarn.revision_blocks"],
});

if (reachable) {
  onDiskSlugs = await completeArticles();
  slugs = onDiskSlugs.filter((slug) => slug !== LEGACY_SLUG);
}

/* **At module scope, not in the `beforeAll` below.** This waits for
   tests/store-roundtrip.test.ts to finish with the corpus, and on a bad day that
   is as long as this suite's own work — while the hook it used to sit in has one
   300s timeout covering both. Both files fork at once, so both clocks start
   together and the waiter had about 10% margin; `Hook timed out in 300000ms` was
   the result, on the same tree that had just passed.
   A top-level `await` puts the wait in vitest's *import* phase, which has no
   hook timeout, and leaves the 300s covering only the work.
   tests/helpers/corpus-lock.ts § "Take it at MODULE SCOPE"; the measurements are
   in docs/plans/260902c-make-the-test-suite-pass-reliably.md § "Cause 4". */
if (reachable) await takeCorpusLock("tests/store-parity.test.ts");

const when = reachable ? describe : describe.skip;

afterAll(async () => {
  await releaseCorpusLock();
  await closeDb();
});

when("the filesystem and Postgres stores agree", () => {
  /** What each load reported, so the tests can assert on it rather than assume. */
  const loaded = new Map<string, LoadedArticle>();
  /** What `seedShelfFromFiles` wrote, per slug — the floor for the monotonic
      `opens`/`lastOpenedAt` assertion in "lists the same articles" below. */
  const seededShelf = new Map<string, { opens: number; lastOpenedAt: Date | null }>();

  beforeAll(async () => {
    await forgetRevisions([...onDiskSlugs]);
    for (const slug of slugs) {
      /* **The fixture supplies the history the real path gets from a clock.**
         On an ingest, `articles.created_at` is `now()` and that is honestly
         when the article arrived. A fixture loaded today has to say when it
         arrived *then*, or every card would be dated today and the library
         order would be the order this loop happens to run in.

         The rule mirrors the filesystem's own: `src/api.ts` takes `addedAt`
         from `meta.fetchedAt` where stage 2 recorded one and the mtime of
         `blocks.json` otherwise — the noema article's `meta.json` says so in
         its own `note`, having been hand-written without one. */
      const meta = await readArticleJson<{ fetchedAt?: string }>(slug, "meta.json");
      const mtime = (await stat(path.join(ROOT, "data", slug, "blocks.json"))).mtime;
      const result = await loadArticleIntoPg(slug, {
        createdAt: meta?.fetchedAt ? new Date(meta.fetchedAt) : mtime,
        /* **`root: ROOT` pins this suite to the working `data/`, deliberately.**
           `loadArticleIntoPg` now defaults to the committed corpus
           (tests/helpers/load-article.ts), which is where it should have been
           reading all along. This file cannot follow yet: it also seeds reader
           state, and `seedShelfFromFiles`/`seedCommentsFromFiles` go through
           src/shelf.ts and src/comments.ts, whose `ROOT` is
           `path.resolve(import.meta.dirname, "..")` — the repository root, with
           no `SPIDERYARN_DATA_ROOT` in it. Point the artefacts at the corpus
           and the reader state would still come from `data/`, and the suite
           would compare one article's blocks against another's comments. So
           both halves stay on `data/` until those modules take a root.
           docs/plans/260901b-committed-fixture-corpus.md, stage 4 sub-stage A. */
        root: ROOT,
        /* **This suite is one of the two that need `serialise`**, and the only
           two: it enumerates the corpus under its *own* fixed slugs, so a
           second copy of this file — a peer's `npm test` — reads and deletes
           the same rows. It holds `CORPUS_LOCK` but not `RUN_LOCK`, and the
           two are different resources; the run lock is what excludes the twelve
           file-scope holders that also start jobs. Unconditional inside the
           loader until 2026-09-01, when it became opt-in because it was making
           every unique-slug seed in the run queue behind every other one
           (tests/helpers/load-article.ts § `LoadOptions.serialise`). Taken here
           by the *window* rather than by the file, because this suite is long
           and holding the key across it would dominate the 120s budget —
           tests/helpers/run-lock.ts says which suites take it which way. */
        serialise: true,
      });
      loaded.set(slug, result);
      /* Reader state does not come through the artefact seam and must not be
         made to — see tests/helpers/seed-reader-state.ts. Without it every
         archived article would be on the Postgres shelf and off the filesystem
         one, and every comment count would be zero. */
      const shelf = await seedShelfFromFiles(slug);
      seededShelf.set(slug, { opens: shelf.opens, lastOpenedAt: shelf.lastOpenedAt });
      await seedCommentsFromFiles(slug);
      /* **Seed what you compare.** The glossary comparison below reads
         `loadGlossary`, and both stores hang a `lookup` off an entry — the
         filesystem's from `data/<slug>/glossary-lookups.json`, Postgres's from
         the `glossary_lookups` table. Seeding the shelf and the comments but
         not this one left the table holding whatever the last suite to write it
         had put there: on 2026-09-02 a fixture row from
         `tests/fixtures/data-root/` was sitting on `spya-uup6nt`, so this suite
         failed or passed according to which file vitest had run last. Nothing
         in it was flaky; it was reading state it did not own. */
      await seedGlossaryLookupsFromFiles(slug);
    }
  }, 300_000);

  it("has something to compare", () => {
    // A parity suite over zero articles passes perfectly and proves nothing.
    expect(slugs.length).toBeGreaterThan(0);

    /* **And a count is satisfied by one, which is not what this file needs.**
       Two of the corpus's articles are named up top and carry a `describe` each
       — the legacy one the gate refuses, and the one with no stage 1. Neither
       block says anything useful about an article that is not there: the
       missing-fixture red arrives inside whichever assertion happens to touch
       it first, blaming the store. So the corpus is asked for them by name,
       here, before any of that runs.
       docs/plans/260901b-committed-fixture-corpus.md § "Named slugs are not coverage". */
    expect(
      onDiskSlugs,
      `data/${LEGACY_SLUG} is the article whose labels.json predates sourceHash — the whole ` +
        `case for the publication gate. Without it the block below tests nothing.`,
    ).toContain(LEGACY_SLUG);
    expect(
      slugs,
      `data/${NO_FETCH_SLUG} is the article with no stage 1, and the only one that proves ` +
        `Postgres refuses to write url and fetchedAt from the extract step.`,
    ).toContain(NO_FETCH_SLUG);
  });

  it("built every article from nothing, rather than carrying one forward", () => {
    /* The load's own report, asserted rather than assumed. `basedOn` non-null
       means the draft inherited a published revision's columns, blocks and step
       rows — and then every comparison below would be measuring whatever put
       that revision there, not this write path. An empty `copied` would mean the
       filesystem store had nothing and the article in Postgres is entirely
       inherited. */
    for (const slug of slugs) {
      const result = loaded.get(slug);
      expect(result, `${slug} was never loaded`).toBeDefined();
      expect(result?.basedOn, `${slug} carried a previous revision forward`).toBeNull();
      expect(result?.published, `${slug} did not publish`).toBe(true);
      expect(result?.copied.length, `${slug} copied no steps`).toBeGreaterThan(0);
    }
  });

  describe.each(slugs)("%s", (slug) => {
    /**
     * `meta` without the two fields stage 1 owns and stage 2 merely copied.
     *
     * Both are compared, per slug, in the test below this one — as equalities
     * against the file each store actually reads, not as an exemption that
     * asserts nothing.
     */
    function comparable(article: Article): Omit<Article, "meta"> & { meta: Omit<Meta, "url" | "fetchedAt"> } {
      const { url: _url, fetchedAt: _fetchedAt, ...meta } = article.meta;
      return { ...article, meta };
    }

    it("returns an identical Article", async () => {
      const [fromFiles, fromPg] = await Promise.all([
        fsArticleReader.loadArticle(slug),
        pgArticleReader.loadArticle(slug),
      ]);
      expect(wire(comparable(fromPg))).toEqual(wire(comparable(fromFiles)));
      /* And again WITHOUT serialising, because the two assertions catch
         different things. `toStrictEqual` is the only one that separates
         `{ byline: undefined }` from `{}` — `JSON.stringify` deletes the key
         and `toEqual` ignores it — and that difference is the whole reason
         `exactOptionalPropertyTypes` is on: src/store/pg.ts spreads
         conditionally so that a null column becomes an absent property rather
         than an explicit `undefined` one, and nothing was checking that it
         had. Added after GPT Sol's review, 2026-08-26. */
      expect(comparable(fromPg)).toStrictEqual(comparable(fromFiles));
    });

    it("takes url and fetchedAt from stage 1 in Postgres and from stage 2 on disk", async () => {
      /* **The price of the exemption above, and it is paid in both directions.**
         Dropping two fields from a comparison is only honest if something else
         says where each store's copy came from. Postgres reads the columns
         `fetch` wrote, so its answers must equal `raw.json`; the filesystem
         reads `meta.json`, so its answers must equal that. An article with no
         `raw.json` has nothing to have written them, and Postgres correctly has
         neither — which is the whole of the noema case, asserted here for every
         article rather than only for that one. */
      const [fromFiles, fromPg] = await Promise.all([
        fsArticleReader.loadArticle(slug),
        pgArticleReader.loadArticle(slug),
      ]);
      const raw = await readArticleJson<{ url?: string; fetchedAt: string }>(slug, "raw.json");
      const meta = await readArticleJson<{ url?: string; fetchedAt?: string }>(slug, "meta.json");

      expect(fromFiles.meta.url).toBe(meta?.url);
      expect(fromFiles.meta.fetchedAt).toBe(meta?.fetchedAt);

      expect(fromPg.meta.url).toBe(raw?.url);
      expect(fromPg.meta.fetchedAt).toBe(raw?.fetchedAt);
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

    /* **All four artefact reads, not three.** `loadIdeas` was missing until
       2026-08-27, and it is the one that most needed to be here: alone of the
       four its staleness compares the *tree* as well as the blocks
       (src/ideas.ts § `inputFingerprint`), so it is the one a blocks-only
       change can break while the other three stay green. GPT Sol found the gap
       while reviewing docs/plans/260827am-glossary-read-latency.md — which narrows what
       all four of them read — and it was right that the plan claimed a cover
       this file did not provide. */
    for (const [name, read] of [
      ["tweets", (r: typeof fsArticleReader) => r.loadTweets(slug)],
      ["glossary", (r: typeof fsArticleReader) => r.loadGlossary(slug)],
      ["ideas", (r: typeof fsArticleReader) => r.loadIdeas(slug)],
      /* Without this row the two adapters are never diffed for this artefact,
         and `loadTimeline` is the one read whose staleness compares a fourth
         value — the publication date — so a Postgres projection that forgot
         `published_at` would report every dated timeline stale for ever while
         the filesystem store called the same one current, with nothing red. */
      ["timeline", (r: typeof fsArticleReader) => r.loadTimeline(slug)],
      /* Added the day the stage landed rather than the day somebody noticed —
         `loadIdeas`' own note above is about exactly that gap. No article in
         the corpus has a quiz yet, so today this row only diffs the **404**,
         which is the half that is easiest to get wrong and cheapest to check:
         `routes.ts` turns `status: 404` into a 404 and an untagged throw into a
         500, so a Postgres reader that threw the right sentence with no status
         would turn "nobody has written questions yet" — the ordinary case the
         panel's button is for — into a server error. */
      ["quiz", (r: typeof fsArticleReader) => r.loadQuiz(slug)],
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

  it("has at least one article whose two clocks really differ", async () => {
    /* **So the exemption cannot quietly become dead normalization.** If every
       fixture happened to have `raw.json.fetchedAt === meta.json.fetchedAt` —
       and `writes` does, which is how tempting this is — then dropping the
       field from the comparison would be free, and the day the two stores
       started disagreeing about something real in that field nothing here would
       notice. GPT Sol asked for this by name, 2026-08-28. */
    const differing: string[] = [];
    for (const slug of slugs) {
      const raw = await readArticleJson<{ fetchedAt: string }>(slug, "raw.json");
      const meta = await readArticleJson<{ fetchedAt?: string }>(slug, "meta.json");
      if (raw && meta?.fetchedAt && raw.fetchedAt !== meta.fetchedAt) differing.push(slug);
    }
    expect(differing.length, "every fixture's fetch and extract times agree — the two-clock exemption is checking nothing").toBeGreaterThan(0);
  });

  describe(`${LEGACY_SLUG} — legacy data the gate refuses`, () => {
    /**
     * **This article is not broken and neither is the gate.**
     *
     * `data/constitution/labels.json` was written before stage 4 recorded the
     * `sourceHash` of the blocks it labelled. `publishRevision` requires the
     * `hierarchy` step's `input_hash` to equal `hashBlocks` of the revision's blocks
     * (`reasonsNotToPublish`, src/store/pg-revisions.ts), and an unstamped
     * labels file gives it nothing to compare — so it refuses, which is the
     * right answer to a table of contents that might describe different text.
     *
     * `db:import` never met this, because it wrote `hashBlocks(blocks)` into
     * every step row it created, including ones it had inferred from a file
     * being on disk. So the importer manufactured the very provenance the gate
     * exists to check.
     *
     * **If somebody regenerates the fixture, this test goes red — and the fix
     * is to retire the case, not to restore the stale file.** Move the slug
     * into the corpus above and delete this block.
     */
    it("has a labels file with no sourceHash", async () => {
      const labels = await readArticleJson<{ sourceHash?: string }>(LEGACY_SLUG, "labels.json");
      expect(labels, `data/${LEGACY_SLUG}/labels.json is missing`).not.toBeNull();
      expect(labels?.sourceHash).toBeUndefined();
    });

    it("copies its steps and is then refused publication, saying why", async () => {
      await forgetRevisions([LEGACY_SLUG]);
      /* `serialise` for the same reason as the loop in `beforeAll`: a fixed
         corpus slug, and this file holds the corpus lock but not the run lock.
         `publish: "try"` because the refusal below IS the assertion — the
         article loads (three steps copied) and is then correctly refused. */
      const result = await loadArticleIntoPg(LEGACY_SLUG, {
        publish: "try",
        root: ROOT,
        serialise: true,
      });

      // The copy worked: this is not "nothing happened".
      expect(result.basedOn).toBeNull();
      expect(result.copied).toContain("hierarchy");
      // And then the gate said no, for the one reason it should have.
      expect(result.published).toBe(false);
      /* **`hierarchy`, not `toc`.** `265356b` renamed the step in the database
         and in this message, and this assertion was left naming the old one —
         so it has been failing since, on a string that no longer exists. The
         message is `src/store/pg-revisions.ts` § `reasonsNotToPublish`; matched
         on the two words that carry the meaning rather than the whole sentence,
         which also carries a hash that changes with the fixture. */
      expect(result.refusedBecause.join(" | ")).toMatch(/hierarchy ran against unstamped/);
    });

    it("is therefore not an article either store will serve", async () => {
      /* Both refuse, and both with a 404. The filesystem serves it — it has
         blocks and a tree on disk and knows nothing about publication — so the
         claim here is only about Postgres, and it is the honest one: a revision
         that never published is not an article. */
      await expect(pgArticleReader.loadArticle(LEGACY_SLUG)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe(`${NO_FETCH_SLUG} — an article with no stage 1`, () => {
    /**
     * **The one article whose `meta` legitimately loses two fields.**
     *
     * It has no `raw.json`: it was hand-assembled, and `meta.json` says so in
     * its own `note`. `url` and `fetchedAt` are stage 1's facts, written to the
     * columns by the `fetch` step, and with no fetch step there is nothing to
     * write them from. `meta.json` still carries both because stage 2 copies
     * what it is handed — but Postgres does not let `extract` write those
     * columns, deliberately (src/store/artifacts-pg.ts § `META_COLUMNS`).
     *
     * **This is the case that proved the corpus had to be wiped.** On a
     * database that had been imported into, this article compared byte-identical
     * — the values were the previous import's, carried into the draft by
     * `beginDraftIn` and never written by anything on this path.
     */
    it("copies no fetch step", () => {
      expect(loaded.get(NO_FETCH_SLUG)?.copied).not.toContain("fetch");
    });

    it("keeps url and fetchedAt on disk and has neither in Postgres", async () => {
      const [fromFiles, fromPg] = await Promise.all([
        fsArticleReader.loadArticle(NO_FETCH_SLUG),
        pgArticleReader.loadArticle(NO_FETCH_SLUG),
      ]);
      expect(fromFiles.meta.url).toMatch(/^https:\/\//);
      expect(fromFiles.meta.fetchedAt).toMatch(/^\d{4}-/);
      // Absent, not `undefined` and not `null`: the key is not there at all.
      expect("url" in fromPg.meta).toBe(false);
      expect("fetchedAt" in fromPg.meta).toBe(false);
    });
  });

  it("lists the same articles, with the same derived counts", async () => {
    const [fromFiles, fromPg] = await Promise.all([
      fsArticleReader.listArticles(),
      pgArticleReader.listArticles(),
    ]);

    /* The committed `example/` fixture is the ONE known difference, and it is
       an open question rather than a bug: src/api.ts appends it to the shelf
       explicitly, and it does not live under `data/`, so nothing loaded it.
       See docs/plans/260825f-postgres-migration.md open question 8. Asserting that it
       is the *only* difference is what stops this exclusion quietly growing to
       cover a real one. */
    const realOnly = (entries: LibraryEntry[]) => entries.filter((e) => !e.fixture);
    const fixtures = fromFiles.filter((e) => e.fixture).map((e) => e.slug);
    /* Whether the shelf shows the fixture at all is src/api.ts's call, and it
       has already changed once under this test — which asserted `["example"]`
       and went red the afternoon the fixture stopped being listed. So the
       assertion is the invariant rather than the count: any fixture the
       filesystem store shows can only be `example`, and Postgres shows none,
       because nothing loaded `example/` and it does not live under `data/`.
       A second fixture appearing from anywhere still fails this. */
    expect(fixtures.filter((slug) => slug !== "example")).toEqual([]);
    expect(fromPg.some((e) => e.fixture)).toBe(false);

    const bySlug = (entries: LibraryEntry[]) =>
      [...entries].sort((a, b) => a.slug.localeCompare(b.slug));

    /* **An article whose directory has been deleted is out of scope here.**

       Nothing prunes: a `data/<slug>/` removed after a load leaves a row
       behind, with a current revision, and the Postgres library goes on listing
       an article the filesystem no longer has. It is a real gap — written up in
       docs/plans/260826e-postgres-storage-implementation.md rather than papered over —
       and it is not a parity failure. Letting it read as one cost an afternoon:
       `labels-checkpoint-check` was left in the database by somebody else's
       checkpoint run, and this test failed in full runs and passed alone for a
       reason that had nothing to do with either store. So the comparison is
       scoped to articles that exist on disk right now. An extra article that
       DOES have a directory still fails, which is the property worth keeping. */
    const onDisk = new Set(await completeArticles());
    /* `LEGACY_SLUG` comes out here for the reason written beside its
       declaration: the filesystem lists an article it can serve, Postgres does
       not list one it refused to publish, and both are correct. Asserted on the
       Postgres side rather than left to the filter. */
    await expectPostgresRefusedTheLegacyArticle();
    const present = (entries: LibraryEntry[]) =>
      entries.filter((e) => onDisk.has(e.slug) && e.slug !== LEGACY_SLUG);

    /* **A comment whose anchor is not a block id is counted by the files and
       cannot exist in Postgres.**

       `block_identities` has a format check and `comments_identity_fk` points
       at it; `comments.json` has none, and something wrote a comment on
       `data/writes` anchored to `zzzz00`. The seeder drops it by that rule
       (tests/helpers/seed-reader-state.ts), so the filesystem count is one
       higher. That is a permitted difference and it is the only one *within* a
       card, so it is subtracted here by the same rule rather than by a
       hardcoded number — the day the corrupt row is deleted, this becomes a
       no-op instead of becoming wrong. (The other permitted difference is about
       which cards there are rather than what is on one: `LEGACY_SLUG`, excluded
       just above.) */
    const skipped = new Map<string, number>();
    for (const slug of onDisk) {
      const bad = (await fsCommentStore.load(slug)).filter((c) => !isSpideryarnId(c.blockId));
      if (bad.length) skipped.set(slug, bad.length);
    }

    /* **`addedAt` is the two clocks again**, so it comes out of the comparison
       here for the same reason `meta.fetchedAt` does above, and is asserted
       positively in the test below. Postgres reads
       `coalesce(article_revisions.fetched_at, articles.created_at)`; the
       filesystem reads `meta.fetchedAt ?? mtime(blocks.json)`. The first is
       when the document was fetched and the second is when it was last
       extracted, and they are minutes apart across most of this corpus. */
    /* **`opens` and `lastOpenedAt` cannot be compared for EQUALITY, and this is
       a deliberate trade of coverage rather than an oversight.**

       `seedShelfFromFiles` writes `data/<slug>/shelf.json`'s values onto the
       row in `beforeAll`, and from that moment the two sides are free to drift:
       a dev server running `SPIDERYARN_STORE=postgres` against this same
       database legitimately calls `pgShelfStore.recordOpen`
       (src/store/pg-shelf.ts) on every `POST /api/library/:slug/open`, which
       increments `opens` and stamps `last_opened_at`. The filesystem copy is
       frozen — nothing writes `shelf.json` any more since the Postgres move
       (docs/project/database.md) — so the gap only ever widens, and this suite
       failed with `opens: 169` against `170` for no reason of its own.

       What replaces the equality is the assertion below: whatever the app did
       to the row can only have moved these two forwards from what we seeded.
       Monotonicity is the real invariant on a box where the app writes Postgres
       and the shelf file does not move. It still catches an `opens` that went
       DOWN, a `lastOpenedAt` that went backwards, and a store that lost either
       one — which is what a parity break here would look like. What it no
       longer catches is Postgres reporting a *larger* number than the file, and
       that is exactly the case a live dev server produces honestly. */
    /* **`visibility` comes out because one store cannot hold it at all**, which
       is a different reason from the four above and a weaker exclusion: those
       are two clocks and a live writer, this is a column that exists in
       Postgres and nowhere on disk. `visibilityStore.set` refuses with a 501 on
       the filesystem store (src/store/index.ts), so a shared article is
       `visibility: "public"` on one side and silent on the other, for ever and
       correctly. Without this, sharing one local article through the app —
       which is how anyone checks the shelf badge — turns this suite red with a
       whole-entry diff that says nothing about parity.

       **Something *is* lost, and it is worth naming rather than waving away**:
       this comparison no longer catches Postgres emitting `"private"` where it
       should be silent, or losing a `"public"` altogether. Equality between the
       two stores could never have caught the first of those and cannot express
       the second, so the coverage was never really here — it is in
       tests/store-shelf-pg.test.ts, which asserts the projection against a
       known public and a known private row. GPT Sol, reviewing Cluster E, on an
       earlier draft of this comment that claimed nothing was lost.
       docs/plans/260902j-public-read-only-access-audit-and-improvements.md § Cluster E. */
    const comparable = (entries: LibraryEntry[]) =>
      entries.map((e) => {
        const {
          addedAt: _addedAt,
          url: _url,
          opens: _opens,
          lastOpenedAt: _last,
          visibility: _visibility,
          ...rest
        } = e;
        return rest;
      });

    /* The price of dropping those two, paid positively. Asserted on the
       Postgres side, because Postgres is the side the running app writes. */
    for (const card of present(realOnly(fromPg))) {
      const seeded = seededShelf.get(card.slug);
      expect(seeded, `${card.slug} was never seeded`).toBeDefined();
      if (!seeded) continue;
      expect(card.opens, `${card.slug} opens went backwards`).toBeGreaterThanOrEqual(seeded.opens);
      if (seeded.lastOpenedAt) {
        expect(card.lastOpenedAt, `${card.slug} lost its lastOpenedAt`).toBeDefined();
        expect(
          new Date(card.lastOpenedAt ?? 0).getTime(),
          `${card.slug} lastOpenedAt went backwards`,
        ).toBeGreaterThanOrEqual(seeded.lastOpenedAt.getTime());
      }
    }

    /* **Subtracted from the filesystem side ONLY**, because it is the only side
       that counted it. Applying it to both is a normalisation that cancels out
       and asserts nothing — the first version of this rewrite did exactly that,
       and the resulting red said `9` where it should have said `10`. */
    const anchored = (entries: LibraryEntry[]) =>
      entries.map((e) =>
        skipped.has(e.slug) ? { ...e, comments: e.comments - (skipped.get(e.slug) ?? 0) } : e,
      );

    expect(wire(comparable(bySlug(present(realOnly(fromPg)))))).toEqual(
      wire(comparable(anchored(bySlug(present(realOnly(fromFiles)))))),
    );
  });

  it("dates every card from the file the store actually reads", async () => {
    /* The price of dropping `addedAt` and `url` from the comparison above.
       Whatever each store puts on the card has to be traceable to a file, and
       the two files disagree — which is the finding, not a fault. */
    const [fromFiles, fromPg] = await Promise.all([
      fsArticleReader.listArticles(),
      pgArticleReader.listArticles(),
    ]);
    const onDisk = new Set(slugs);

    for (const entry of fromFiles.filter((e) => onDisk.has(e.slug))) {
      const meta = await readArticleJson<{ url?: string; fetchedAt?: string }>(
        entry.slug,
        "meta.json",
      );
      expect(entry.url, entry.slug).toBe(meta?.url);
      if (meta?.fetchedAt) expect(entry.addedAt, entry.slug).toBe(meta.fetchedAt);
    }

    for (const entry of fromPg.filter((e) => onDisk.has(e.slug))) {
      const raw = await readArticleJson<{ url?: string; fetchedAt: string }>(
        entry.slug,
        "raw.json",
      );
      expect(entry.url, entry.slug).toBe(raw?.url);
      /* With a `raw.json`, the fetch time is the date on the card.

         Without one the column is null and the card falls back to
         `articles.created_at` — which this suite set, from the filesystem's own
         rule. So it is checked against that rule rather than against the clock:
         an earlier version asserted only "older than a minute ago", which a
         stale `created_at` from any previous run passes, and the test's name
         claimed more than that. GPT Sol, 2026-08-28. */
      if (raw) {
        expect(entry.addedAt, entry.slug).toBe(raw.fetchedAt);
      } else {
        const meta = await readArticleJson<{ fetchedAt?: string }>(entry.slug, "meta.json");
        const expected =
          meta?.fetchedAt ??
          (await stat(path.join(ROOT, "data", entry.slug, "blocks.json"))).mtime.toISOString();
        expect(entry.addedAt, entry.slug).toBe(expected);
      }
    }
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
          /* `createdAt` on the ARTICLE, which is the column `ADDED_AT`
             actually coalesces to — `coalesce(article_revisions.fetched_at,
             articles.created_at)` in src/store/pg.ts. Setting it on the
             revision below and not here left all three articles defaulting to
             `now()`, so the null-`fetchedAt` row coalesced to today and sorted
             to the top — the very failure this test exists to catch, staged by
             the fixture rather than by the ordering. It went unnoticed until
             2026-08-26 because a missing migration had this whole file
             skipping rather than failing. */
          await tx.insert(articles).values({ id: articleId, ownerId: owner, slug, createdAt });
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

  it("lists the same articles, each ordered by its own idea of when they arrived", async () => {
    /* **Not "the same order", which is not an invariant and this test used to
       demand.**
     *
       The two stores compute `addedAt` from different clocks — Postgres from
       when the document was fetched, the filesystem from when it was last
       extracted (see the note on `addedAt` above). Over this corpus they happen
       to agree, but two articles fetched and extracted across each other's
       boundary would order differently and **both stores would be right**. A
       test that can go red for a non-bug teaches whoever meets it to distrust
       it. GPT Sol, 2026-08-28.

       What is true of both, always: the same articles, each list newest first
       by whatever that store thinks "newest" means. Neither store specifies a
       tie-break — `src/api.ts` sorts stably and Postgres has no secondary key —
       so ties are compared as ties rather than as an order. A store sorting by
       the wrong column, which is what the old assertion caught in August, still
       fails this on the first pair. */
    const [fromFiles, fromPg] = await Promise.all([
      fsArticleReader.listArticles(),
      pgArticleReader.listArticles(),
    ]);
    const onDisk = new Set(await completeArticles());
    /* Same exclusion, same reason, and the same positive assertion — see
       `expectPostgresOmitsTheLegacyArticle` and the note by `LEGACY_SLUG`. */
    await expectPostgresRefusedTheLegacyArticle();
    const mine = (entries: LibraryEntry[]) =>
      entries.filter((e) => !e.fixture && onDisk.has(e.slug) && e.slug !== LEGACY_SLUG);

    // Same articles. Sorted by slug, because the ORDER is the next assertion
    // and comparing both at once reports either failure as the other.
    const slugsOf = (entries: LibraryEntry[]) => mine(entries).map((e) => e.slug).sort();
    expect(slugsOf(fromPg)).toEqual(slugsOf(fromFiles));

    for (const [name, entries] of [
      ["the filesystem store", fromFiles],
      ["Postgres", fromPg],
    ] as const) {
      const dates = mine(entries).map((e) => e.addedAt);
      // Its own list, newest first. `toEqual` rather than a loop of comparisons
      // so the failure prints the order it actually got.
      expect(dates, `${name} is not newest-first`).toEqual([...dates].sort().reverse());
    }
  });

  /**
   * **One article, one idea of "current".**
   *
   * A saved search records the fingerprint of the blocks it was answered
   * against, and the panel compares it against the article's fingerprint now to
   * say whether the run is out of date (docs/project/search.md § A saved search
   * says which article it answered). Two stores computing that fingerprint two
   * ways is the failure src/source-hash.ts was pulled out of src/tweets.ts to
   * prevent: they can only ever disagree, and the day they do, a run written
   * through one store reports itself current against the other's rule.
   *
   * Both call the same `hashBlocks`, so what this checks is that they feed it
   * the same thing — the same blocks, in the same order, with the same text.
   * **The order is the half that can go wrong quietly.** Block ids carry no
   * position, so a Postgres query missing its `order by ordinal` returns rows
   * in whatever order the planner likes, which for a small table is usually
   * insertion order. That looks perfect in development and reorders in
   * production, where the only symptom is every saved search claiming to be out
   * of date with nothing saying why.
   */
  describe.each(slugs)("%s — the article's fingerprint", (slug) => {
    it("is the same number in both stores", async () => {
      const [fromFiles, fromPg] = await Promise.all([
        fsSearchStore.sourceHash(slug),
        pgSearchStore.sourceHash(slug),
      ]);
      // Not just equal — actually computed. Two `undefined`s are also equal,
      // and would mean neither store could see the article at all.
      expect(fromFiles).toMatch(/^[0-9a-f]{16}$/);
      expect(fromPg).toBe(fromFiles);
    });
  });

  /**
   * **The one thing the two searches must agree about exactly.**
   *
   * `src/store/contracts.ts` is explicit that a parity test may NOT demand the
   * two adapters find the same blocks — Postgres stems and drops stop words,
   * the filesystem adapter matches substrings, and they genuinely disagree on
   * single words. `excludeSlug` is different in kind: it is not a matching rule
   * but a promise that a named article is absent, and a promise one store keeps
   * and the other does not is the exact shape of failure this whole suite is for.
   *
   * So the assertion is per-adapter and matcher-independent: whatever each one
   * finds, excluding an article removes every hit from it and leaves the rest
   * alone. That the exclusion happens *before* the cap rather than after is
   * pinned separately, by tests/library-search.test.ts and
   * tests/store-shelf-pg.test.ts, which each build a corpus rigged for it —
   * real articles cannot be relied on to supply that shape.
   */
  describe.each(slugs)("%s — excluded from a library search", (slug) => {
    /**
     * A long word from this article's own prose.
     *
     * Long, because a short one is a stop word in Postgres and a substring of
     * something else on the filesystem. From the article itself, because a word
     * we invented would be found by neither store and the test would pass for
     * having asked nothing.
     */
    async function distinctiveWord(): Promise<string> {
      const article = await fsArticleReader.loadArticle(slug);
      const words = article.blocks
        .filter((b) => b.gistable)
        .flatMap((b) => b.text.toLowerCase().split(/[^a-z]+/))
        .filter((w) => w.length >= 9);
      const word = words.sort((a, b) => b.length - a.length)[0];
      if (!word) throw new Error(`no word of nine letters or more in ${slug}`);
      return word;
    }

    /* A limit far above anything either store will return for one word, so a
       missing hit means "not found" rather than "pushed off the end". */
    const LOTS = 500;

    it.each([
      ["the filesystem store", fsLibrarySearch],
      ["Postgres", pgLibrarySearch],
    ])("is gone from %s's results, and nothing else is", async (_name, store) => {
      const word = await distinctiveWord();

      const all = await store.searchLibrary(word, LOTS);

      /* **An archived article is already gone**, and both stores mean that on
         purpose — Delete means archive (docs/project/library.md), and
         `readArticle` in src/library-search.ts drops an archived slug before it
         reads a single block. So the precondition below cannot hold for one,
         and asserting it reports a working exclusion as a broken one.

         Found by leaving two archived articles in `data/` and watching four
         parity tests go red, 2026-08-27. The scan that builds `slugs` asks only
         for `blocks.json` and `tree.json`, which an archived article still has,
         so nothing upstream of here can filter it out.

         Assert what is actually true for it rather than skipping: absent with
         the exclusion and absent without it. That is the same claim the rest of
         this test makes, and it is one the archived case can keep. */
      if ((await loadShelf(slug)).archivedAt) {
        expect(all.hits.some((h) => h.slug === slug)).toBe(false);
        const gone = await store.searchLibrary(word, LOTS, { excludeSlug: slug });
        expect(gone.hits).toEqual(all.hits);
        return;
      }

      // The test has to be able to fail: if the store cannot find the article
      // by its own longest word, excluding it proves nothing.
      expect(all.hits.some((h) => h.slug === slug)).toBe(true);

      const without = await store.searchLibrary(word, LOTS, { excludeSlug: slug });
      expect(without.hits.some((h) => h.slug === slug)).toBe(false);
      // Every OTHER hit survives, in the same order. An exclusion that quietly
      // reshuffled or dropped a second article would pass the line above.
      expect(without.hits).toEqual(all.hits.filter((h) => h.slug !== slug));
    });
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
