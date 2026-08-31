/**
 * A re-extraction must not take the reader's paid-for artefacts with it.
 *
 * On the filesystem this is free: `data/<slug>/` outlives any one step, so
 * re-running `blocks` overwrites `blocks.json` and leaves `glossary.json` lying
 * beside it. As columns on one row a new revision starts NULL, and the reader's
 * glossary becomes *"nobody has found the terms for this one yet"* under a green
 * tick. `beginRevision` copies the current published revision into the new draft
 * to close that (src/store/pg-revisions.ts), and this is the test of it.
 *
 * ## It performs a real re-extraction rather than asserting about a fixture
 *
 * The `ADDED_AT` lesson is that a property asserted against whatever data you
 * happen to have can pass by luck, so this builds its own article: publishes
 * blocks B1 with all three on-demand artefacts stamped against them, then
 * **re-extracts** to B2 — one paragraph reworded, one dropped, every surviving
 * id kept — and re-runs `hierarchy` beside it, which is what `cascadeForce` already
 * does and what the publication guard requires.
 *
 * ## Four one-line ways to make it red, from the plan
 *
 * 1. `beginRevision` inserts a bare row instead of copying → *"survives a
 *    re-extraction"* 404s. The bug the whole step exists to prevent.
 * 2. Move `word_count`/`block_count` from DERIVE to CARRY → *"describe B2"*
 *    fails with B1's numbers. The resurrect-dead-data direction, and the worse
 *    one: a stale artefact has a banner, a wrong count is printed as fact.
 * 3. Drop the `revision_step_runs` copy → *"still says what the carried
 *    artefacts ran against"* fails. The metadata page then reports a stage that
 *    never ran while the column beside it holds a thread.
 * 4. Make `beginRevision` walk back to the last revision that *had* a glossary
 *    → *"a glossary the reader deleted stays deleted"* fails.
 *
 * The fifth guard — a new column being carried or dropped by accident — is
 * tests/store-revision-policy.test.ts, which compares the policy map against
 * both the schema and the live table.
 *
 * ## Why the slug is `test-`-prefixed and the directory is real
 *
 * Both stores are asked the same question, so this needs an article on disk as
 * well as in Postgres. `tests/store-parity.test.ts` skips a `test-` directory
 * by name for the reason its own comment gives — vitest runs files
 * concurrently, so a fixture directory caught half-built is the least useful
 * kind of red. A `_` prefix would have been the other convention, and it cannot
 * be used here: `isSlug` rejects it, so `requireSlug` refuses every Postgres
 * read of it.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { articleMetadata as fsArticleMetadata } from "../src/api.js";
import type { Assets } from "../src/assets.js";
import { ASSETS_VERSION } from "../src/collect-assets.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  revisionBlocks,
  revisionStepRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { PROMPT_VERSION as GLOSSARY_PROMPT_VERSION } from "../src/glossary.js";
import { mintUniqueId } from "../src/ids.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { articleFingerprint, hashBlocks } from "../src/source-hash.js";
import { PROMPT_VERSION as TWEETS_PROMPT_VERSION } from "../src/tweets.js";
import { pgArticleReader } from "../src/store/pg.js";
import {
  beginRevision,
  publishRevision,
  recordStepRun,
} from "../src/store/pg-revisions.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import type {
  Arc,
  Block,
  Glossary,
  StepName,
  Tree,
  TweetThread,
} from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "test-carry-forward";
const DIR = path.join(ROOT, "data", SLUG);

/* ---------------------------------------------------- is there a database -- */

const { reachable } = await pgReady({
  suite: "tests/store-carry-forward.test.ts",
  tables: ["spideryarn.article_revisions"],
});

const when = reachable ? describe : describe.skip;

/* ------------------------------------------------------------ the article -- */

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<p id="${id}">${text}</p>`,
    gistable: true,
  };
}

/**
 * Minted rather than written out, because this fixture already drifted once.
 *
 * The ids here were `spya-cfaaa1`, `…2`, `…3`. Only the first is illegal: `1`
 * is not in the alphabet (src/ids.ts — `l`/`i`/`1` and `o`/`0` are the pairs a
 * person misreads copying an id out of a URL), while `…2` and `…3` are fine.
 * One bad id was enough, because the three go in as a single multi-row insert
 * and Postgres aborts the statement. `ID_PATTERN` is also what
 * `block_identities_id_format` is built from, so `writeBlocks` was rejected
 * every time and eight of this file's nine tests never ran.
 *
 * Nothing here depends on the *value* of an id, so the minter is asked for
 * them and the fixture cannot say something the app could never mint.
 */
const MINTED = new Set<string>();
const OPENING = mintUniqueId(MINTED);
const KEPT = mintUniqueId(MINTED);
const DROPPED = mintUniqueId(MINTED);

/** The first extraction. */
const B1: Block[] = [
  block(OPENING, "The opening paragraph, which both extractions agree about."),
  block(KEPT, "The middle paragraph, as the page first said it."),
  block(DROPPED, "The closing paragraph, which the second extraction does not find."),
];

/**
 * The second, and it is a real re-extraction rather than a nudge: one paragraph
 * reworded, one gone, every surviving id **kept**. Keeping the ids is what makes
 * this the interesting case — the article's spine is intact, so nothing about
 * the block table says the artefacts hanging off it have gone out of date.
 */
const B2: Block[] = [
  B1[0] as Block,
  block(KEPT, "The middle paragraph, rewritten by the time we fetched it again."),
];

const HASH1 = hashBlocks(B1);
const HASH2 = hashBlocks(B2);

/**
 * The **article** fingerprint of each publication — blocks, tree and metadata
 * head, which is what `tweets` and `glossary` stamp
 * (src/source-hash.ts § `articleFingerprint`).
 *
 * Separate from `HASH1`/`HASH2` above rather than replacing them, because the
 * two answer different questions and two steps still ask the narrow one:
 * `hierarchy.input_hash` is compared against the stored blocks by
 * `reasonsNotToPublish`, and `assets` really is built from the blocks alone.
 * Declared below `treeFor` — see the note there.
 */
let FINGERPRINT1 = "";

/**
 * A tree of one root over one leaf per block — the smallest shape `checkTree`
 * accepts, and it has to really pass: `publishRevision` runs the full
 * structural check rather than "every id in a range exists".
 */
function treeFor(blocks: Block[]): Tree {
  const leaves = blocks.map((b, i) => [`n${i + 1}`, b] as const);
  return {
    version: "toc/1",
    generator: "fixture",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: leaves.map(([id]) => id),
        range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""],
        title: "A fixture article",
        gist: "A fixture built by tests/store-carry-forward.test.ts and nothing else.",
      },
      ...Object.fromEntries(
        leaves.map(([id, b]) => [
          id,
          {
            id,
            depth: 1,
            parent: "n0",
            children: [],
            range: [b.id, b.id],
            title: "A paragraph",
            navLabel: "One paragraph of a fixture article that exists only for this test",
          },
        ]),
      ),
    },
  } as Tree;
}

/* Assigned once `treeFor` exists, because a `const` initialiser that called it
   from above would read the function before its declaration. The metadata is
   the three fields the prompt head carries and nothing else — the same three
   `metaFingerprintOf` rebuilds from the revision's columns on the Postgres
   side, so both stores hash the identical input. */
FINGERPRINT1 = articleFingerprint(B1, treeFor(B1), { title: "A fixture article" });

const assetsFor = (sourceHash: string): Assets => ({
  version: "assets/1",
  sourceHash,
  fetchedAt: "2026-08-29T00:00:00.000Z",
  entries: [
    {
      url: "https://cdn.example.com/figure.png",
      status: "stored",
      sha256: "a".repeat(64),
      ext: "png",
      contentType: "image/png",
      bytes: 1024,
    },
  ],
});

const arcFor = (blocks: Block[]): Arc => ({
  version: "arc/1",
  generator: "fixture",
  slug: SLUG,
  entries: [
    {
      range: [blocks[0]?.id ?? "", blocks[blocks.length - 1]?.id ?? ""],
      text: "The whole of it, in one line.",
    },
  ],
});

/* The three on-demand artefacts, all stamped against B1 — and stamped with the
   **live** prompt versions and model rather than literals, so that after the
   re-extraction the only thing that can make them not-current is the source
   hash. Pinning versions as literals is what turned five tests in
   tests/pipeline-artifact-store.test.ts red the afternoon three prompts moved. */
/* Minted once, not per call: `glossaryFor` is asked for the same artefact twice
   — once onto disk, once into the column — and two ids there would be two
   different glossaries wearing one source hash. `GlossaryEntry.id` is a block id
   by construction, which is what makes `?term=` validate for free. */
const GLOSSARY_ENTRY_ID = mintUniqueId(MINTED);

const glossaryFor = (hash: string): Glossary => ({
  version: GLOSSARY_PROMPT_VERSION,
  generator: CAPABLE_MODEL,
  slug: SLUG,
  sourceHash: hash,
  entries: [
    {
      id: GLOSSARY_ENTRY_ID,
      name: "Fixture",
      kind: "term",
      aliases: [],
      senseHere: "A thing built for a test.",
      blocks: [],
    },
  ],
  passes: 1,
  generatedAt: "2026-08-26T00:00:00.000Z",
  elapsedMs: 1,
});

const tweetsFor = (hash: string): TweetThread => ({
  version: TWEETS_PROMPT_VERSION,
  generator: CAPABLE_MODEL,
  slug: SLUG,
  sourceHash: hash,
  limit: 280,
  tweets: [{ text: "A fixture thread of exactly one post.", chars: 36 }],
  generatedAt: "2026-08-26T00:00:00.000Z",
  elapsedMs: 1,
});

/* ------------------------------------------------- standing in for stage 5 -- */

/**
 * Put an extraction's blocks into a draft, the way the pipeline will once
 * step 11 half B stage 5 moves the writes off disk.
 *
 * Identities are minted for anything new and **never deleted**, which is the
 * one rule the spine turns on (docs/project/block-ids.md) and the thing the
 * dropped paragraph below is here to prove.
 */
async function writeBlocks(articleId: string, revisionId: string, blocks: Block[]): Promise<void> {
  const db = getDb();
  await db
    .insert(blockIdentities)
    .values(blocks.map((b) => ({ articleId, blockId: b.id })))
    .onConflictDoNothing();
  await db.delete(revisionBlocks).where(eq(revisionBlocks.revisionId, revisionId));
  await db.insert(revisionBlocks).values(
    blocks.map((b, i) => ({
      articleId,
      revisionId,
      blockId: b.id,
      ordinal: i,
      tag: b.tag,
      kind: b.kind,
      level: b.level ?? null,
      text: b.text,
      words: b.words,
      html: b.html,
      gistable: b.gistable,
      note: b.note ?? null,
    })),
  );
}

/** One step run, as the seam records it — see src/store/revisions.ts. */
const step = (
  revisionId: string,
  name: StepName,
  stamp?: { inputHash: string; promptVersion?: string; model?: string },
) =>
  recordStepRun({
    revisionId,
    stepName: name,
    inputHash: stamp?.inputHash ?? NO_INPUT_HASH,
    implementationVersion: PIPELINE_RUN,
    promptVersion: stamp?.promptVersion ?? null,
    model: stamp?.model ?? null,
    status: "done",
    startedAt: new Date(),
    finishedAt: new Date(),
  });

async function runsFor(revisionId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(revisionStepRuns)
    .where(eq(revisionStepRuns.revisionId, revisionId));
  return new Map(rows.map((r) => [r.stepName, r]));
}

async function revisionRow(revisionId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, revisionId))
    .limit(1);
  return rows[0];
}

/* ------------------------------------------------------ the files, in step -- */

const writeFileJson = (name: string, value: unknown) =>
  writeFile(path.join(DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

/**
 * The same situation on disk: B2's blocks and tree, beside three artefacts
 * stamped against B1.
 *
 * This is what the filesystem *already* does for free after a re-extraction,
 * and the point of writing it out is that the two stores are then asked the
 * same question rather than two questions that sound alike.
 */
async function writeTheFiles(): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFileJson("blocks.json", { blocks: B2 });
  await writeFileJson("tree.json", treeFor(B2));
  await writeFileJson("labels.json", {
    version: "labels/1",
    generator: "fixture",
    slug: SLUG,
    sourceHash: HASH2,
    labels: {},
  });
  await writeFileJson("arc.json", arcFor(B2));
  /* Stamped against B1, like the three below it: the blocks moved and this
     manifest did not, so both stores have to say the images want re-fetching. */
  await writeFileJson("assets.json", assetsFor(HASH1));
  await writeFileJson("glossary.json", glossaryFor(FINGERPRINT1));
  await writeFileJson("tweets.json", tweetsFor(FINGERPRINT1));
  await writeFileJson("meta.json", {
    slug: SLUG,
    title: "A fixture article",
    excerpt: "A fixture built by one test.",
    url: "https://example.com/carry-forward",
    fetchedAt: "2026-08-26T00:00:00.000Z",
  });
  await writeFile(path.join(DIR, "article.html"), "<p>A fixture article.</p>", "utf8");
  await writeFile(
    path.join(DIR, "article.stamped.html"),
    B2.map((b) => b.html).join("\n"),
    "utf8",
  );
}

/* ------------------------------------------------------------- the fixture -- */

let articleId = "";
let firstRevision = "";
let secondRevision = "";

when("a re-extraction, through beginRevision and publishRevision", () => {
  beforeAll(async () => {
    await writeTheFiles();

    /* Publication one: B1, with everything stamped against it. */
    const begun = await beginRevision({ slug: SLUG });
    articleId = begun.articleId;
    firstRevision = begun.revisionId;
    expect(begun.basedOn, "a brand-new article has nothing to copy from").toBeNull();

    await writeBlocks(articleId, firstRevision, B1);
    const db = getDb();
    await db
      .update(articleRevisions)
      .set({
        title: "A fixture article",
        excerpt: "A fixture built by one test.",
        finalUrl: "https://example.com/carry-forward",
        fetchedAt: new Date("2026-08-26T00:00:00.000Z"),
        extractedHtml: "<p>A fixture article.</p>",
        stampedHtml: B1.map((b) => b.html).join("\n"),
        tree: treeFor(B1),
        arc: arcFor(B1),
        assets: assetsFor(HASH1),
        tweets: tweetsFor(FINGERPRINT1),
        glossary: glossaryFor(FINGERPRINT1),
      })
      .where(eq(articleRevisions.id, firstRevision));

    for (const name of ["fetch", "extract", "blocks"] as StepName[]) {
      await step(firstRevision, name);
    }
    await step(firstRevision, "hierarchy", { inputHash: HASH1 });
    /* **A `done` run row for `assets` as well as the column**, and it is the
       row that makes the staleness assertion below mean anything: `done` on the
       metadata page is `run.status === "done" && isCurrent(step)`, so without a
       row the step reads not-done whatever `isCurrent` says — and deleting
       `case "assets"` from src/store/pg.ts would redden nothing. Checked by
       doing exactly that. No `model`: this step makes no model call. */
    await step(firstRevision, "assets", {
      inputHash: HASH1,
      promptVersion: ASSETS_VERSION,
    });
    await step(firstRevision, "arc", { inputHash: HASH1 });
    await step(firstRevision, "tweets", {
      inputHash: FINGERPRINT1,
      promptVersion: TWEETS_PROMPT_VERSION,
      model: CAPABLE_MODEL,
    });
    await step(firstRevision, "glossary", {
      inputHash: FINGERPRINT1,
      promptVersion: GLOSSARY_PROMPT_VERSION,
      model: CAPABLE_MODEL,
    });

    await publishRevision({ slug: SLUG, revisionId: firstRevision });
  }, 60_000);

  afterAll(async () => {
    const db = getDb();
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    const id = rows[0]?.id;
    if (id) {
      // The pointer lets go first, or the revision cannot cascade away — the
      // order tests/store-import-convergence.test.ts works out at length.
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await db.delete(articles).where(eq(articles.id, id));
    }
    await closeDb();
    await rm(DIR, { recursive: true, force: true });
  });

  it("publishes B1 with the numbers the library prints derived from it", async () => {
    const row = await revisionRow(firstRevision);
    expect(row?.status).toBe("published");
    expect(row?.blockCount).toBe(3);
    expect(row?.wordCount).toBe(B1.reduce((n, b) => n + b.words, 0));
    // Leaves sit at depth 1, so they are what `partCount` counts here.
    expect(row?.partCount).toBe(3);
    expect(row?.rootGist).toContain("A fixture built by");

    const found = await pgArticleReader.loadGlossary(SLUG);
    expect(found.stale, "stamped against the blocks it was published with").toBe(false);
  }, 30_000);

  it("copies the published revision into the new draft, blocks and step runs too", async () => {
    const begun = await beginRevision({ slug: SLUG });
    secondRevision = begun.revisionId;

    expect(begun.basedOn).toBe(firstRevision);
    /* The two the three-column reading of this design missed. Without the
       blocks a `{ steps: ["extract"] }` job would publish an article with no
       paragraphs; without the step runs the metadata page reports a stage that
       never ran while the column beside it holds a thread. */
    expect(begun.blocksCopied).toBe(3);
    expect(begun.stepRunsCopied).toBe(8);

    const draft = await revisionRow(secondRevision);
    expect(draft?.status).toBe("draft");
    /* `assets` is in this list for a reason worth stating: the objects it names
       are content-addressed and never deleted, so a carried manifest cannot come
       to point at bytes that have gone — and NOT carrying it would leave an
       article hot-linking every image again after an unrelated `{steps:
       ["blocks"]}` run, with nothing anywhere saying so. */
    for (const column of ["tree", "arc", "assets", "tweets", "glossary"] as const) {
      expect(draft?.[column], `${column} should have been carried`).not.toBeNull();
    }

    /* And the five that must NOT be carried. They are derivations of the blocks
       and the tree, so a copied `block_count` beside changed blocks is not a
       stale artefact with a banner — it is a wrong number the library prints as
       fact, and nothing anywhere can tell. */
    expect(draft?.wordCount).toBeNull();
    expect(draft?.blockCount).toBeNull();
    expect(draft?.partCount).toBeNull();
    expect(draft?.sectionCount).toBeNull();
    expect(draft?.rootGist).toBeNull();
  }, 30_000);

  it("publishes the re-extraction, with the tree re-run beside the blocks", async () => {
    await writeBlocks(articleId, secondRevision, B2);
    const db = getDb();
    await db
      .update(articleRevisions)
      .set({ tree: treeFor(B2), arc: arcFor(B2), stampedHtml: B2.map((b) => b.html).join("\n") })
      .where(eq(articleRevisions.id, secondRevision));
    await step(secondRevision, "blocks");
    await step(secondRevision, "hierarchy", { inputHash: HASH2 });
    await step(secondRevision, "arc", { inputHash: HASH2 });

    const published = await publishRevision({ slug: SLUG, revisionId: secondRevision });
    expect(published.previousRevisionId).toBe(firstRevision);

    const row = await revisionRow(secondRevision);
    expect(row?.status).toBe("published");
    /* B2's numbers, not B1's. This is the assertion that goes red if the five
       derived scalars are moved into the carry list. */
    expect(row?.blockCount).toBe(2);
    expect(row?.wordCount).toBe(B2.reduce((n, b) => n + b.words, 0));
    expect(row?.partCount).toBe(2);
    // A NULL tree is an unreadable article, and a NULL arc loses the one
    // sentence per part. Both carry, and the publication guard is what makes
    // that safe rather than the copy being skipped.
    expect(row?.tree).not.toBeNull();
    expect(row?.arc).not.toBeNull();
  }, 30_000);

  it("survives a re-extraction, stale rather than gone", async () => {
    const [glossary, tweets] = await Promise.all([
      pgArticleReader.loadGlossary(SLUG),
      pgArticleReader.loadTweets(SLUG),
    ]);

    expect(glossary.glossary.entries).toHaveLength(1);
    expect(glossary.stale, "written against B1, published beside B2").toBe(true);
    expect(tweets.stale).toBe(true);
    // The one thing that must not have happened: the artefact reading as
    // "nobody has found the terms for this one yet" under a green tick.
    expect(glossary.glossary.sourceHash).toBe(FINGERPRINT1);
  }, 30_000);

  it("still says what the carried artefacts ran against", async () => {
    const runs = await runsFor(secondRevision);
    /* `input_hash` unchanged by the copy, which is the whole point of it: the
       row says *tweets ran against B1* while the blocks hash B2, and that
       comparison is what yields "present but not current". */
    expect(runs.get("tweets")?.inputHash).toBe(FINGERPRINT1);
    expect(runs.get("glossary")?.inputHash).toBe(FINGERPRINT1);
    expect(runs.get("hierarchy")?.inputHash, "hierarchy was re-run against B2").toBe(HASH2);
    expect(runs.get("fetch")?.inputHash, "fetch records nothing about its input").toBe(
      NO_INPUT_HASH,
    );
  }, 30_000);

  it("reports the three as not done, in both stores", async () => {
    const fromPg = await pgArticleReader.articleMetadata(SLUG);
    const fromFiles = await fsArticleMetadata(SLUG);

    const doneIn = (meta: { stages: { step: StepName; done: boolean }[] }) =>
      Object.fromEntries(meta.stages.map((s) => [s.step, s.done]));
    const pg = doneIn(fromPg);
    const files = doneIn(fromFiles);

    /* **`assets` is in this list, and it is the one that would have diverged.**
       The filesystem asks the step's own `stamp`, so it gets this right for
       free; Postgres has a hand-written `isCurrent` switch whose `default` arm
       returns `true`, so a manifest with no case there would report itself
       current on this page while the files said the opposite about the same
       article. Delete `case "assets"` from src/store/pg.ts and the `pg` half of
       this goes red while the `files` half stays green — which is exactly the
       divergence a parity test is for. */
    for (const name of ["assets", "glossary", "tweets"] as StepName[]) {
      expect(pg[name], `Postgres should offer to regenerate ${name}`).toBe(false);
      expect(files[name], `the files should offer to regenerate ${name}`).toBe(false);
    }
    /* The step that WAS re-run, so this is not a test that everything is
       false — which is the shape this assertion could rot into. */
    expect(pg.hierarchy).toBe(true);
    expect(files.hierarchy).toBe(true);
  }, 30_000);

  it("keeps the identity of a paragraph the re-extraction dropped", async () => {
    const db = getDb();
    const ids = await db
      .select({ id: blockIdentities.blockId })
      .from(blockIdentities)
      .where(eq(blockIdentities.articleId, articleId))
      .orderBy(asc(blockIdentities.blockId));

    /* An id is an identity; its text is a revision. The reader's question about
       the dropped closing paragraph has to have something to point at, so the
       identity outlives the paragraph. docs/project/block-ids.md. */
    expect(ids.map((r) => r.id)).toEqual(B1.map((b) => b.id).sort());

    const live = await db
      .select({ id: revisionBlocks.blockId })
      .from(revisionBlocks)
      .where(eq(revisionBlocks.revisionId, secondRevision));
    expect(live.map((r) => r.id).includes(DROPPED), "but it is not in the new revision").toBe(
      false,
    );
  }, 30_000);

  it("leaves a glossary the reader deleted deleted", async () => {
    const db = getDb();
    /* Standing in for `deleteGlossary`, which has no Postgres implementation
       yet (src/store/index.ts § notMigrated) — the state it produces is a NULL
       column on the published revision, which is what this writes. */
    await db
      .update(articleRevisions)
      .set({ glossary: null })
      .where(eq(articleRevisions.id, secondRevision));

    const begun = await beginRevision({ slug: SLUG });
    const draft = await revisionRow(begun.revisionId);
    /* The copy is from the current published revision **only**. A lookback to
       "the last revision that had a glossary" would resurrect one the reader
       threw away, weeks later, with nothing to say where it came from. */
    expect(draft?.glossary).toBeNull();
    expect(draft?.tweets, "and the artefacts nobody deleted still carry").not.toBeNull();

    await db.delete(articleRevisions).where(eq(articleRevisions.id, begun.revisionId));
  }, 30_000);
});

/* ------------------------------------------------------- the fixture's own -- */

when("the fixture itself", () => {
  it("really is a re-extraction: same ids, different text", () => {
    expect(B2.map((b) => b.id)).toEqual([B1[0]?.id, KEPT]);
    expect(B2[1]?.text).not.toBe(B1[1]?.text);
    expect(HASH1).not.toBe(HASH2);
  });
});
