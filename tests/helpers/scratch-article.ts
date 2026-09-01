/**
 * One throwaway article, in Postgres, made out of the committed corpus.
 *
 * ## What it replaces
 *
 * About twenty suites open with the same four lines: `cp(example/ →
 * data/<test-slug>/)`, exercise a route, `rm` it again. They want *an* article
 * to exist under a name nobody else is using — somewhere to hang a comment, a
 * conversation, a quiz answer — and `example/` was simply the smallest complete
 * one lying around. They are not tests *of* `example/`.
 *
 * Stage 4 takes the filesystem store away
 * (docs/plans/260831b-finish-the-database-move.md), so `data/<test-slug>/` stops
 * being a place an article can be. This is where those four lines go instead.
 *
 * ## Why it clones rather than loading a corpus slug directly
 *
 * `loadArticleIntoPg` puts `tests/fixtures/data-root/data/writes` into Postgres
 * *as* `writes`. That is right for a suite whose subject is the corpus, and
 * wrong for these: they write reader state under the slug they read, so two
 * files sharing one slug would see each other's comments and each other's
 * conversations. A throwaway name is the whole point, and the filesystem store
 * derives the slug from the directory name — so the copy is how a corpus
 * article gets a different one.
 *
 * The copy is cheap and is not the cost. Measured 2026-09-01 on `writes`:
 * **~30ms to clone, ~280ms to load**, of which ~180ms is `copyArtefacts` doing
 * three round trips per pipeline step.
 *
 * ## Why it is not a direct-SQL seeder
 *
 * It would be quicker. It would also be a second files → Postgres
 * implementation, exercised only by tests and free to drift from the path
 * production runs — which is the thing `db:import` was deleted for
 * (docs/plans/260827aa-delete-the-importer.md), and the reason
 * `./load-article.ts` is shaped the way it is. Everything below goes through
 * that loader, so the zero-copy refusal, the raw-source check and the publish
 * guards all still run. There is no second path here to keep honest.
 *
 * ## The lock, and what it costs
 *
 * `loadArticleIntoPg` takes `RUN_LOCK` (./run-lock.ts) around its load window,
 * which serialises every seed in the whole test run. Measured 2026-09-01, 16
 * concurrent processes each seeding one *uniquely named* article:
 *
 * ```
 * with the lock     max seed 4.9–6.1s   (the last one waits for fifteen turns)
 * without the lock  max seed 1.0–2.0s   (five runs, no failures)
 * ```
 *
 * The lock is there for suites that share **fixed** fixture slugs with copies of
 * themselves (./run-lock.ts § cause 2). Nothing here shares a slug with
 * anything, and the global one-running-job index that would have been the other
 * reason was dropped on 2026-08-30.
 *
 * **A unique slug is not the same as a private set of rows**, and this is where
 * that used to bite. Every clone here carries the *same* `raw.html`, so N clones
 * of one corpus article write one `raw_sources` row — that table is keyed
 * `(sha256, kind)`, one row per document rather than per article. Until
 * 2026-09-01 `writeRawSource` did `select … for update` and then `insert`, and a
 * `for update` over no rows locks nothing, so N unserialised clones of a
 * document Postgres had never seen all inserted and all but one lost their whole
 * transaction to a duplicate key. It was invisible on a laptop only because the
 * corpus's row is already there.
 *
 * That is fixed at the source: the insert is conflict-tolerant and the row is
 * read back and compared (src/store/artifacts-pg.ts § `writeRawSource`,
 * tests/store-raw-source-race.test.ts). So the shared row is now genuinely safe
 * unserialised, and for these suites the lock really is pure queue. It is kept
 * anyway for now, because removing it is a change to `loadArticleIntoPg`'s
 * contract and belongs in one deliberate commit rather than as a side effect of
 * converting a test file.
 */
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";

import { getDb } from "../../src/db/client.js";
import { articles } from "../../src/db/schema.js";
import type { OwnerId } from "../../src/owner.js";
import { hashBlocks } from "../../src/source-hash.js";
import type { Block, StepName } from "../../src/types.js";
import { loadArticleIntoPg } from "./load-article.js";
import { FIXTURE_ROOT, requireFixture } from "./require-fixture.js";

/**
 * The corpus article these suites get by default.
 *
 * `writes` and not `noema-…`: nineteen blocks against a hundred and forty-one,
 * so every seed is a fifth of the round trips. It has a complete set of
 * artefacts through `ideas`, which is what the eight-step copy below asserts.
 *
 * **It is not `example/`.** `example/` has 34 blocks and its own block ids, and
 * a handful of suites quote one of them by name — see the note on
 * `ScratchArticle.blockIds`.
 */
export const SCRATCH_SOURCE = "writes";

/** Parts every clone needs, named so a missing one fails here and says which. */
const REQUIRED: readonly string[] = [
  "blocks.json",
  "tree.json",
  "meta.json",
  "output.html",
  "output.blocks.json",
];

export interface ScratchArticle {
  /** The throwaway slug, as asked for. */
  readonly slug: string;
  readonly articleId: string;
  /**
   * The steps that were actually copied — **the thing to assert on.**
   * `loadArticleIntoPg` refuses an empty one, but a clone that dropped half the
   * corpus article would still load, and a suite that needed `glossary` would
   * then fail somewhere unrelated.
   */
  readonly copied: readonly StepName[];
  /**
   * The article's blocks, in order, as they were copied in.
   *
   * Here because several of these suites name a block id and quote a phrase
   * from it as **literals** — `spya-gp3g6s` / `"Berggruen Prize"` in
   * tests/comment-referee-mark.test.ts, `spya-tgnssb` in
   * tests/remember-route.test.ts — and every one of those is an id of
   * `example/blocks.json`. They do not survive a move to a different source
   * article, and the honest repair is to take the id and the quote from the
   * fixture rather than to write down another pair of literals that will rot
   * the same way.
   */
  readonly blocks: readonly Block[];
  /** Remove the article row and the scratch directory. Safe to call twice. */
  remove(): Promise<void>;
}

export interface ScratchOptions {
  /** Which corpus article to copy. Defaults to `SCRATCH_SOURCE`. */
  readonly from?: string;
  /**
   * Whose article it is. Defaults to the environment's owner.
   *
   * **A route suite must pass one, and it is not the default.** A request
   * authenticated by `./authed.ts` runs as `TEST_SUB`
   * (`ADMIN_USER_ID_LOCAL`), and the Postgres reader filters every article by
   * owner (`ownedSlug` in src/store/pg.ts) — so an article seeded as
   * `DEV_OWNER_ID` is invisible to it and every route answers 404. That looks
   * exactly like a broken route.
   */
  readonly ownerId?: OwnerId;
  /**
   * Change the article on the way in.
   *
   * Called with the cloned directory **after** the copy and **before** the load,
   * so whatever it writes is what goes into Postgres. It is how the four suites
   * that rewrite `blocks.json` for their own assertions keep doing that:
   * tests/chat-library-exclusion.test.ts puts a rare word in every paragraph,
   * tests/library-search.test.ts writes the sentences it then searches for.
   *
   * Rewriting the article after it is loaded would be the alternative, and it is
   * worse: there is no supported way to edit a *published* revision's blocks,
   * and inventing one would be the second write path this helper exists to
   * avoid.
   *
   * **A rewrite of `blocks.json` is mirrored for you.** The filesystem store
   * keeps the blocks in two places — `data/<slug>/blocks.json` for step
   * `hierarchy` and `output/<slug>.blocks.json` for step `blocks`
   * (src/store/artifacts-fs.ts) — and `copyArtefacts` copies both. Editing one
   * and not the other loads two different articles into one revision, and which
   * of them wins is a question about `STEP_ORDER` that no test should have to
   * ask. So `mutate` gets the article directory, and whatever it leaves in
   * `blocks.json` is copied over the `output/` twin before the load.
   *
   * **And the hierarchy stamp is recomputed for you**, which is the part that
   * has no filesystem-era equivalent at all. `publishRevision` refuses a
   * revision whose tree was built from different blocks, comparing
   * `hashBlocks(blocks)` against the `hierarchy` step's `input_hash` — which on
   * this path comes from `labels.json`'s `sourceHash` (`STAMP_SOURCE` in
   * src/store/artifacts.ts). Rewriting the blocks and leaving that alone is
   * refused with *"the tree was built from different blocks — re-run
   * hierarchy"*. The filesystem store had no such check, which is why fixtures
   * of this shape worked for a year without anybody keeping the two in step.
   *
   * The tree itself is **not** rewritten, and cannot be from here: a `mutate`
   * that deletes blocks or renames ids leaves the tree naming rows that are
   * gone, and the publish guard says so by id. Change the text, keep the ids.
   */
  readonly mutate?: (dir: string) => Promise<void>;
}

/**
 * Clone one corpus article into a temporary data root under `slug`.
 *
 * The rewrite of `slug` inside every JSON artefact is not cosmetic:
 * `meta.json` carries the slug, and an article whose metadata names a different
 * one loads under a name no route will ask for.
 */
async function cloneCorpusArticle(slug: string, from: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "spya-scratch-article-"));
  const dir = path.join(root, "data", slug);
  await mkdir(path.join(root, "data"), { recursive: true });
  await cp(path.join(FIXTURE_ROOT, "data", from), dir, { recursive: true });

  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const at = path.join(dir, name);
    const value: unknown = JSON.parse(await readFile(at, "utf8"));
    if (value && typeof value === "object" && (value as { slug?: string }).slug === from) {
      (value as { slug: string }).slug = slug;
      await writeFile(at, JSON.stringify(value));
    }
  }

  await mkdir(path.join(root, "output"), { recursive: true });
  for (const ext of ["html", "blocks.json"]) {
    await cp(
      path.join(FIXTURE_ROOT, "output", `${from}.${ext}`),
      path.join(root, "output", `${slug}.${ext}`),
    );
  }
  return root;
}

/**
 * Record the blocks these labels were made from, after `mutate` changed them.
 *
 * See `ScratchOptions.mutate` for why. Quiet when there is no `labels.json`:
 * an article with no `hierarchy` stamp is refused by the publish guard anyway,
 * and it is refused with a message about the tree, which is the true one.
 */
async function restampHierarchy(dir: string): Promise<void> {
  const at = path.join(dir, "labels.json");
  let labels: Record<string, unknown>;
  try {
    labels = JSON.parse(await readFile(at, "utf8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf8")) as {
    blocks: Block[];
  };
  await writeFile(at, JSON.stringify({ ...labels, sourceHash: hashBlocks(blocks) }));
}

/**
 * Put a throwaway copy of a corpus article into Postgres, and hand back the way
 * to take it away again.
 *
 * Call it from `beforeAll`; call `remove()` from `afterAll`. It does **not**
 * clean up reader state written under the slug beyond what the article's own
 * foreign keys cascade — deleting the `articles` row takes comments, threads,
 * searches and shelf rows with it (drizzle/, `on delete cascade`).
 */
export async function scratchArticleInPg(
  slug: string,
  { from = SCRATCH_SOURCE, ownerId, mutate }: ScratchOptions = {},
): Promise<ScratchArticle> {
  requireFixture(from, REQUIRED);

  const root = await cloneCorpusArticle(slug, from);
  let loaded: Awaited<ReturnType<typeof loadArticleIntoPg>>;
  try {
    if (mutate) {
      const dir = path.join(root, "data", slug);
      await mutate(dir);
      await cp(path.join(dir, "blocks.json"), path.join(root, "output", `${slug}.blocks.json`));
      await restampHierarchy(dir);
    }
    loaded = await loadArticleIntoPg(slug, { root, ...(ownerId ? { ownerId } : {}) });
  } catch (err) {
    await rm(root, { recursive: true, force: true });
    throw err;
  }
  /* Read from the **clone**, not from the corpus: with `mutate` the two differ,
     and handing back the pristine ids would describe an article that is not the
     one in the database. Read before the scratch root is removed. */
  const { blocks } = JSON.parse(
    await readFile(path.join(root, "data", slug, "blocks.json"), "utf8"),
  ) as { blocks: Block[] };
  await rm(root, { recursive: true, force: true });

  let removed = false;
  return {
    slug,
    articleId: loaded.articleId,
    copied: loaded.copied,
    blocks,
    async remove() {
      if (removed) return;
      removed = true;
      await getDb().delete(articles).where(eq(articles.id, loaded.articleId));
    },
  };
}
