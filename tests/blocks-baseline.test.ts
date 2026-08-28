/**
 * Stage 3 gets the previous run's blocks from the **store**, not from a path.
 *
 * This is the file that stands behind
 * docs/project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters
 * once the artefacts stop being files. Stage 3 keeps a paragraph's id across a
 * re-extraction by matching this run's blocks against the previous run's, and
 * until 2026-08-28 it got the previous run by reading
 * `output/<slug>.blocks.json` inside a `try/catch` whose `catch` said *first run
 * for this article*. The day the pipeline's artefacts move to Postgres that read
 * fails on every run, every article silently becomes a first ingest, and every
 * comment, saved search and ToC row in the database stops naming anything.
 * Nothing throws. See docs/plans/delete-the-importer.md § Three stages carry
 * identity in a file.
 *
 * ## Each of these was watched failing, and against what
 *
 * A check that has never been red is not evidence
 * (docs/reusable/silent-success.md), and the shape of bug here is precisely one
 * that agrees with the code. So:
 *
 * | mutation | what fails |
 * |---|---|
 * | `previousBlocksFrom` returns `undefined` instead of reading | *carries every id across a re-extraction…* (both stores) |
 * | drop the `hasEarlierBlocks` question | *refuses to mint when a baseline it should have had is missing* |
 * | swallow a throwing store read | *lets an infrastructure fault through untouched* |
 * | drop `assertIdsCarried` | *stops a run that kept none of the previous ids* |
 *
 * ## The Postgres half needs a database and says so
 *
 * It skips loudly when there is none, like every other Postgres suite here —
 * and the skip matters, because "0 failures" from a suite that never ran looks
 * exactly like a pass.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import {
  BLOCKS_INPUT_HTML,
  BaselineMissing,
  IdsNotCarried,
  blocksArtefact,
  previousBlocksFrom,
  runBlocks,
} from "../src/blocks.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { Block, OwnerId } from "../src/types.js";

/* ------------------------------------------------------------ the article -- */

/**
 * What stage 2 hands over: two paragraphs and a heading, no ids anywhere.
 *
 * **No ids is the whole point.** Readability writes a fresh document on every
 * extraction, so after a re-extraction there is nothing in the HTML to preserve
 * and the `isSpideryarnId` branch in `splitIntoBlocks` has nothing to do. Every
 * id in the second run has to come from the baseline or be minted, which is the
 * one condition under which this test can tell the two apart.
 */
const EXTRACTED = `<!doctype html><html><body>
<h2>The opening</h2>
<p>A first paragraph, which does not change between the two runs.</p>
<p>A second paragraph, which does not change either.</p>
</body></html>`;

/* -------------------------------------------------------- the filesystem -- */

interface Workspace {
  root: string;
  dir: string;
  htmlFile: string;
  store: ArtifactStore;
}

/**
 * A store over a throwaway directory, laid out the way the real one is:
 * stage 3's `a.blocks.json` beside the HTML, stage 4's inside `data/`.
 */
async function aWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(path.join(tmpdir(), "spya-baseline-"));
  const dir = path.join(root, "data");
  await mkdir(dir, { recursive: true });
  const htmlFile = path.join(root, "a.html");
  return { root, dir, htmlFile, store: createFsArtifactStore(() => ({ dir, htmlFile })) };
}

const idsIn = (blocks: readonly Block[]): string[] => blocks.map((b) => b.id);

describe("the baseline, over the filesystem store", () => {
  const cleanUp: string[] = [];
  afterAll(async () => {
    for (const root of cleanUp) await rm(root, { recursive: true, force: true });
  });

  const workspace = async (): Promise<Workspace> => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    return w;
  };

  it("carries every id across a re-extraction, taking the baseline from the store", async () => {
    const { dir, htmlFile, store } = await workspace();

    // Run one: a genuine first ingest. Nothing to carry, so everything mints.
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocks({ htmlFile, previous: undefined });
    expect(first.stats.minted).toBe(3);
    expect(first.stats.carried).toBe(0);
    /* Stage 4's copy, which is what `hasEarlierBlocks` reads on this store. It
       exists here because a real article has been through stage 4 by now. */
    await writeFile(
      path.join(dir, "blocks.json"),
      JSON.stringify(blocksArtefact(first.blocks)),
      "utf-8",
    );

    /* Stage 2 runs again and overwrites the HTML with an id-free document —
       the case random ids exist for. */
    await writeFile(htmlFile, EXTRACTED, "utf-8");

    const previous = await previousBlocksFrom(store, "a");
    expect(idsIn(previous ?? [])).toEqual(idsIn(first.blocks));

    const second = await runBlocks({ htmlFile, previous });
    expect(second.stats.carried).toBe(3);
    expect(second.stats.minted).toBe(0);
    /* The exact ids, in order — not a count of survivors. Two runs that each
       produced three ids and share none of them would pass a count. */
    expect(idsIn(second.blocks)).toEqual(idsIn(first.blocks));
  });

  it("refuses to mint when a baseline it should have had is missing", async () => {
    const { dir, htmlFile, store } = await workspace();
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocks({ htmlFile, previous: undefined });

    /* Stage 4's copy still lists every id this article ever had; stage 3's own
       copy — the baseline — has gone. block-ids.md calls that file a source
       artefact rather than a cache for exactly this reason. */
    await writeFile(
      path.join(dir, "blocks.json"),
      JSON.stringify(blocksArtefact(first.blocks)),
      "utf-8",
    );
    await rm(htmlFile.replace(/\.html$/, ".blocks.json"));

    await expect(previousBlocksFrom(store, "a")).rejects.toBeInstanceOf(BaselineMissing);
  });

  it("mints quietly when this really is a first ingest", async () => {
    const { store } = await workspace();
    /* Nothing on disk at all: no baseline and no earlier run to say there
       should have been one. This is the case that must NOT throw, and it is
       what stops the rule above turning every new article into an error. */
    await expect(previousBlocksFrom(store, "a")).resolves.toBeUndefined();
  });

  it("lets an infrastructure fault through untouched, rather than calling it a first ingest", async () => {
    const { store } = await workspace();
    const broken: ArtifactStore = {
      ...store,
      read: () => Promise.reject(new Error("connection terminated unexpectedly")),
    };
    /* The difference that matters: a store that cannot answer is not a store
       that answered "nothing". Swallowing this is how a database hiccup becomes
       permanent identity loss. */
    await expect(previousBlocksFrom(broken, "a")).rejects.toThrow(/connection terminated/);
  });

  it("asks the store, and does not fall back to reading the file itself", async () => {
    const { htmlFile, store } = await workspace();
    await writeFile(htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocks({ htmlFile, previous: undefined });

    /* The baseline is sitting on disk exactly where the old code read it from.
       A store that says there is none must win, or the seam is decorative and
       landing D will take the files away without anything noticing. */
    const empty: ArtifactStore = { ...store, read: () => Promise.resolve(null) };
    await expect(previousBlocksFrom(empty, "a")).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(first.jsonFile, "utf-8")).blocks).toHaveLength(3);
  });
});

/* ------------------------------------------------------------- the guard -- */

describe("the runtime guard", () => {
  const cleanUp: string[] = [];
  afterAll(async () => {
    for (const root of cleanUp) await rm(root, { recursive: true, force: true });
  });

  /** A previous run of a completely different article, so nothing can match. */
  const strangers: Block[] = [
    {
      id: "spya-zzzzz2",
      tag: "p",
      kind: "text",
      text: "Words from somewhere else entirely.",
      words: 5,
      html: "<p>Words from somewhere else entirely.</p>",
      gistable: true,
    },
  ];

  it("stops a run that kept none of the previous ids", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");

    /* A non-empty baseline and a non-empty output that share nothing. Every
       anchor into this article would be pointing at a block that no longer
       exists, and the step would have reported success. */
    await expect(runBlocks({ htmlFile: w.htmlFile, previous: strangers })).rejects.toBeInstanceOf(
      IdsNotCarried,
    );
  });

  it("refuses before it writes, so the previous artefacts survive the refusal", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const jsonFile = w.htmlFile.replace(/\.html$/, ".blocks.json");
    await writeFile(jsonFile, JSON.stringify(blocksArtefact(strangers)), "utf-8");

    await expect(runBlocks({ htmlFile: w.htmlFile, previous: strangers })).rejects.toThrow();

    /* Still the baseline, not half of a run that was refused. A guard that
       destroys what it is protecting is worse than no guard. */
    const after = JSON.parse(await readFile(jsonFile, "utf-8"));
    expect(idsIn(after.blocks)).toEqual(["spya-zzzzz2"]);
    expect(await readFile(w.htmlFile, "utf-8")).toBe(EXTRACTED);
  });

  it("says nothing on a first ingest, where minting everything is correct", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const run = await runBlocks({ htmlFile: w.htmlFile, previous: undefined });
    expect(run.stats.minted).toBe(3);
  });

  it("says nothing when even one id survives, because a threshold would be a guess", async () => {
    const w = await aWorkspace();
    cleanUp.push(w.root);
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const first = await runBlocks({ htmlFile: w.htmlFile, previous: undefined });

    /* One paragraph unchanged, the rest of the baseline unrecognisable. A real
       partial loss, deliberately not an error — the numbers are in the step's
       log line instead. */
    const survivor = first.blocks[1]!;
    await writeFile(w.htmlFile, EXTRACTED, "utf-8");
    const run = await runBlocks({
      htmlFile: w.htmlFile,
      previous: [...strangers, survivor],
    });
    expect(idsIn(run.blocks)).toContain(survivor.id);
  });
});

/* --------------------------------------------------- which HTML stage 3 eats -- */

describe("the HTML stage 3 consumes", () => {
  it("is stage 2's, and never stage 3's own previous output", () => {
    /* Not a tautology, and not a style preference. On the filesystem the two
       are the same path and nobody could choose; in Postgres they are two
       columns, and reading `stampedHtml` would hand stage 3 last week's
       paragraphs already carrying this week's ids — a clean-looking run that
       re-publishes the previous article. Landing D reads this constant. */
    expect(BLOCKS_INPUT_HTML).toBe("extractedHtml");
  });
});

/* ------------------------------------------------------------- Postgres -- */

const { loadEnvLocal } = await import("../src/env.js");
loadEnvLocal();

let reachable = false;
if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
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
  if (!reachable) console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
}
const when = reachable ? describe : describe.skip;

when("the baseline, over the Postgres store", () => {
  const SLUG = "test-blocks-baseline";
  const FRESH_SLUG = "test-blocks-baseline-new";

  let db: Awaited<ReturnType<typeof importDb>>["db"];
  let mod: Awaited<ReturnType<typeof importDb>>;

  async function importDb() {
    const client = await import("../src/db/client.js");
    const schema = await import("../src/db/schema.js");
    const pg = await import("../src/store/artifacts-pg.js");
    const revisions = await import("../src/store/pg-revisions.js");
    const admin = await import("../src/admin.js");
    const owner = await import("../src/owner.js");
    return { db: client.getDb(), client, schema, pg, revisions, admin, owner };
  }

  /* Ids from the alphabet `block_identities_id_format` allows, and deliberately
     not in the order the paragraphs appear: an assertion that reads back the
     ids in document order cannot be satisfied by an accident of sorting. */
  const H = "spya-zbaaa2";
  const P1 = "spya-mbaaa2";
  const P2 = "spya-cbaaa2";

  /** The published article, exactly as stage 3 left it three paragraphs ago. */
  const PUBLISHED: { blockId: string; ordinal: number; tag: string; text: string }[] = [
    { blockId: H, ordinal: 0, tag: "h2", text: "The opening" },
    { blockId: P1, ordinal: 1, tag: "p", text: "A first paragraph, which does not change between the two runs." },
    { blockId: P2, ordinal: 2, tag: "p", text: "A second paragraph, which does not change either." },
  ];

  let articleId = "";
  let publishedId = "";
  const roots: string[] = [];

  async function wipe(slug: string): Promise<void> {
    const { schema } = mod;
    const rows = await db
      .select({ id: schema.articles.id })
      .from(schema.articles)
      .where(eq(schema.articles.slug, slug));
    for (const { id } of rows) {
      await db.execute(sql`update ${schema.articles} set current_revision_id = null where id = ${id}::uuid`);
      await db.delete(schema.revisionBlocks).where(eq(schema.revisionBlocks.articleId, id));
      await db.delete(schema.articleRevisions).where(eq(schema.articleRevisions.articleId, id));
      await db.delete(schema.blockIdentities).where(eq(schema.blockIdentities.articleId, id));
      await db.delete(schema.articles).where(eq(schema.articles.id, id));
    }
  }

  beforeAll(async () => {
    mod = await importDb();
    db = mod.db;
    const { schema, admin } = mod;
    await wipe(SLUG);
    await wipe(FRESH_SLUG);

    const [article] = await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID, slug: SLUG })
      .returning();
    if (!article) throw new Error("could not create the fixture article");
    articleId = article.id;

    const [revision] = await db
      .insert(schema.articleRevisions)
      .values({ articleId, status: "published", extractedHtml: EXTRACTED })
      .returning();
    if (!revision) throw new Error("could not create the fixture revision");
    publishedId = revision.id;

    await db
      .insert(schema.blockIdentities)
      .values(PUBLISHED.map((b) => ({ articleId, blockId: b.blockId })));

    /* **Column names spelled out, not a drizzle `.values()`.** Drizzle names
       every column of the table, including ones a pending migration has not
       added to this database yet, so a fixture written that way fails for a
       reason that has nothing to do with what it is testing. `beginDraftIn`
       writes its copy the same way and for the same kind of reason. */
    for (const b of PUBLISHED) {
      await db.execute(sql`
        insert into ${schema.revisionBlocks}
          (article_id, revision_id, block_id, ordinal, tag, kind, text, words, html, gistable)
        values (${articleId}::uuid, ${publishedId}::uuid, ${b.blockId}, ${b.ordinal},
                ${b.tag}, 'text', ${b.text}, ${b.text.split(" ").length},
                ${`<${b.tag} id="${b.blockId}">${b.text}</${b.tag}>`}, true)
      `);
    }

    /* The pointer `hasEarlierBlocks` reads. Set directly rather than through
       `publishRevision`, which wants a tree, labels and a step run — none of
       which this is about. */
    await db.execute(
      sql`update ${schema.articles} set current_revision_id = ${publishedId}::uuid where id = ${articleId}::uuid`,
    );

    await db
      .insert(schema.articles)
      .values({ ownerId: admin.ADMIN_USER_ID, slug: FRESH_SLUG })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    if (mod) {
      await wipe(SLUG);
      await wipe(FRESH_SLUG);
      await mod.client.closeDb();
    }
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  /**
   * A draft based on the published revision, and a store bound to it.
   *
   * **`runAsOwner`, explicitly.** `lockArticle` filters by `currentOwnerId()`,
   * which outside a request falls back to `SPIDERYARN_OWNER_ID` — and
   * `vite.config.ts` loads `.env.local` into vitest, so a suite that relied on
   * that would pass on this laptop and fail on one where the variable names
   * somebody else. Naming the owner here is the only version of this that is
   * about the code rather than about the environment.
   */
  async function aDraft(slug: string) {
    const { pg, revisions, admin, owner } = mod;
    /* `asOwnerId` is module-private, and the brand exists so an owner cannot be
       invented by accident — which is what a test fixture is doing here on
       purpose, with a uuid the migrations put in `auth.users`. */
    const begun = await owner.runAsOwner(admin.ADMIN_USER_ID as OwnerId, () =>
      revisions.beginRevision({ slug }),
    );
    const ref = {
      slug,
      articleId: begun.articleId,
      revisionId: begun.revisionId,
      jobId: randomUUID(),
      attemptId: randomUUID(),
    };
    return { begun, ref, store: (tx: never) => pg.pgArtifactsIn(ref, tx) };
  }

  it("carries every id across a re-extraction, from the rows the draft was given", async () => {
    const { begun, ref } = await aDraft(SLUG);
    /* `beginDraftIn` copies the published revision's block rows into the new
       draft before any stage runs — the baseline is already there, and this is
       the number that says so. */
    expect(begun.blocksCopied).toBe(3);

    const previous = await db.transaction((tx) =>
      previousBlocksFrom(mod.pg.pgArtifactsIn(ref, tx), SLUG),
    );
    expect(previous?.map((b) => b.id)).toEqual([H, P1, P2]);

    const root = await mkdtemp(path.join(tmpdir(), "spya-baseline-pg-"));
    roots.push(root);
    const htmlFile = path.join(root, "a.html");
    /* Stage 2's output: the same words, no ids anywhere. */
    await writeFile(htmlFile, EXTRACTED, "utf-8");

    const run = await runBlocks({ htmlFile, previous });
    expect(run.stats.minted).toBe(0);
    expect(run.blocks.map((b) => b.id)).toEqual([H, P1, P2]);
  }, 60_000);

  it("refuses to mint when the draft's carried baseline is not there", async () => {
    const { ref } = await aDraft(SLUG);
    const { schema } = mod;
    /* The carry-forward did not happen — a failed copy, a bad migration, a
       hand-edit. The article has a published revision, so this is not a first
       ingest, and minting would orphan every anchor into it. */
    await db
      .delete(schema.revisionBlocks)
      .where(eq(schema.revisionBlocks.revisionId, ref.revisionId));

    await expect(
      db.transaction((tx) => previousBlocksFrom(mod.pg.pgArtifactsIn(ref, tx), SLUG)),
    ).rejects.toBeInstanceOf(BaselineMissing);
  }, 60_000);

  it("mints quietly for an article with no published revision", async () => {
    const { begun, ref } = await aDraft(FRESH_SLUG);
    expect(begun.basedOn).toBeNull();
    expect(begun.blocksCopied).toBe(0);

    await expect(
      db.transaction((tx) => previousBlocksFrom(mod.pg.pgArtifactsIn(ref, tx), FRESH_SLUG)),
    ).resolves.toBeUndefined();
  }, 60_000);
});
