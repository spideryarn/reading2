/**
 * Reading artefacts back out of Postgres — the map, and what it reassembles.
 *
 * `src/store/artifacts-pg.ts` is the half of the seam that replaces `db:import`
 * (docs/plans/delete-the-importer.md, landing C3). This file is its read half:
 * the kind ↔ storage map, `readArtefact` and `stampForStep`.
 *
 * ## The oracle is written-out fixtures, and the first plan had that wrong
 *
 * The obvious test is *import an article and read it back*. It proves nothing
 * worth having. It would compare the adapter against `src/store/import.ts`,
 * so the claim would be "importer-plus-adapter behave consistently" — and the
 * importer is known to be wrong in three ways this adapter must not copy: it
 * stores `extractedHtml: null`, it stamps every inferred step with the same
 * fingerprint where `ideas` hashes blocks *and* tree, and it holds no source
 * reference at all.
 *
 * So the fixtures below are **column values written by hand**. Every expected
 * result is a literal. A literal cannot agree with a bug in the code it is
 * checking, which is the whole reason `tests/artefact-copy.test.ts` was
 * rewritten after its first version passed against two deliberate breakages.
 *
 * ## How to watch each of these go red
 *
 * Each was watched failing, individually, against the mutation named beside it:
 *
 * | mutation in src/store/artifacts-pg.ts | what fails |
 * |---|---|
 * | `order by block_id` instead of `ordinal` | *brings the blocks back in document order* |
 * | no `order by` at all | *…with no index to fall back on* (only that one — see it) |
 * | prefer either kind over refusing | *refuses a row whose reference and bytes are two different documents* |
 * | `if (rows.length === 0) return { blocks: [] }` | *an article with no block rows has no blocks artefact* |
 * | skip the `whyUnusable` check in `readArtefact` | *refuses a tree whose nodes are an array* |
 * | drop `requireBound` | *refuses a slug that is not the one it is bound to* |
 * | keep `NO_INPUT_HASH` in the stamp | *drops the two sentinels* |
 * | resolve a stamp clash instead of refusing | *refuses a stamp the row and the artefact disagree about* |
 * | let the row fill a field the artefact lacks | *does not let the row supply what the artefact has no room for* |
 * | `row.title === null` → `!row.title` | *keeps an empty title* |
 * | drop the title check | *says no meta at all when there is no title* |
 * | prefer sniffing over `raw_source_kind` | *takes the document kind from the source reference* |
 *
 * Skips loudly when there is no database, for the reason tests/db-schema.test.ts
 * explains at length.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  rawSources,
  revisionBlocks,
  revisionStepRuns,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { PATHS } from "../src/store/artifacts-fs.js";
import {
  STORAGE,
  WrongArticle,
  readArtefact,
  siteFor,
  stampForStep,
} from "../src/store/artifacts-pg.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import type { ArtifactKind } from "../src/store/artifacts.js";
import { STEPS, STEP_ORDER } from "../src/pipeline.js";
import type { Arc, Ideas, Tree } from "../src/types.js";
import type { LabelsFile } from "../src/labels.js";

loadEnvLocal();

const SLUG = "test-artefacts-pg";
const DEV_OWNER_ID = "f4d08b58-5573-4811-9887-e26c114fb324";

/* ------------------------------------------- the map, which needs no database -- */

/**
 * The two adapters must know about exactly the same artefacts.
 *
 * A parity oracle that is not the importer and not a database: if one store
 * grows a `(step, kind)` the other has never heard of, a stage writes through
 * one and reads back nothing through the other, and the only symptom is a step
 * that will not stay done.
 */
describe("the two storage maps", () => {
  const keysOf = (map: Record<string, Partial<Record<ArtifactKind, unknown>>>) =>
    STEP_ORDER.flatMap((step) => Object.keys(map[step] ?? {}).sort().map((k) => `${step}/${k}`));

  it("cover the same (step, kind) pairs", () => {
    expect(keysOf(STORAGE)).toEqual(keysOf(PATHS));
  });

  it("cover exactly what every step declares it produces", () => {
    for (const step of STEP_ORDER) {
      expect(Object.keys(STORAGE[step]).sort(), step).toEqual([...STEPS[step].produces].sort());
    }
  });

  it("refuses a pair no step produces, rather than returning undefined", () => {
    expect(() => siteFor("arc", "glossary")).toThrow(/arc does not produce glossary/);
  });

  it("puts stage 3's and stage 4's blocks in the same place", () => {
    /* Two files on disk, deliberately. One table here, necessarily — and this
       is the assertion that says the difference was noticed rather than
       missed. */
    expect(siteFor("blocks", "blocks")).toEqual(siteFor("toc", "blocks"));
  });

  it("gives the two HTMLs different places, unlike the filesystem", () => {
    /* On disk `extract` writes `output/<slug>.html` and `blocks` overwrites it,
       so stage 2's output is destroyed. Two columns here. */
    expect(siteFor("extract", "extractedHtml")).not.toEqual(siteFor("blocks", "stampedHtml"));
  });
});

/* ---------------------------------------------------- is there a database -- */

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
      "select to_regclass('spideryarn.article_revisions') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) {
    console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
  }
}

const when = reachable ? describe : describe.skip;

/* ------------------------------------------------------------ the fixture -- */

/* Ids from the alphabet `block_identities_id_format` allows: no 1, i, l or o,
   and the first character after the prefix must be a letter.

   **They sort backwards on purpose.** The first version of this file used
   `…pgaaa2/3/4`, which sort the same way as the ordinals — so replacing
   `order by ordinal` with `order by block_id` left every assertion green, and
   the ordering test was proving nothing. Ordering is the one thing about blocks
   that cannot be recovered from anywhere else (ids are random and carry no
   position, docs/project/block-ids.md), so the fixture has to be able to tell
   the two orders apart. */
const B1 = "spya-zaaaa2";
const B2 = "spya-maaaa2";
const B3 = "spya-caaaa2";

const TREE: Tree = {
  version: "toc/3",
  generator: "claude-sonnet-5",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: { id: "n0", parentId: null, depth: 0, range: [B1, B3], title: "All of it", childIds: [] },
  },
} as unknown as Tree;

const LABELS: LabelsFile = {
  version: "labels/2",
  generator: "claude-haiku-4-5-20251001",
  slug: SLUG,
  sourceHash: "hash-of-the-blocks",
  structureHash: "hash-of-the-tree",
  structureVersion: "toc/3",
  labels: { [B1]: "the opening" },
  batches: null,
} as unknown as LabelsFile;

const ARC: Arc = {
  version: "arc/1",
  generator: "claude-opus-5",
  slug: SLUG,
  entries: [{ range: [B1, B3], text: "It begins and then it ends." }],
};

/** `profileHash: null` is a real recorded value — "written deliberately without a profile". */
const IDEAS: Ideas = {
  version: "ideas/2",
  generator: "claude-opus-5",
  slug: SLUG,
  sourceHash: "hash-of-blocks-and-tree",
  profileHash: null,
  ideas: [],
  generatedAt: "2026-08-28T00:00:00.000Z",
  elapsedMs: 1234,
} as unknown as Ideas;

const FETCHED_AT = new Date("2026-03-04T05:06:07.000Z");

/* Real-looking hex, because the schema insists: `raw_sources_sha256_format` is
   `^[0-9a-f]{64}$` and the composite FK from `article_revisions` means the row
   this points at has to exist. Two different values, because the two hashes
   answer two different questions — the network's bytes and the stored ones. */
const NETWORK_SHA = "b2".repeat(32);
const STORED_SHA = "a1".repeat(32);

let ref: JobDraftRef;

async function makeFixture(): Promise<void> {
  const db = getDb();
  /* The object the revision's source reference points at. The composite foreign
     key means this is not optional, which is the schema doing its job: a
     reference to an object nobody holds is a half-pointer. */
  await db
    .insert(rawSources)
    .values({
      sha256: STORED_SHA,
      kind: "html",
      bytes: 29,
      contentType: "text/html; charset=utf-8",
      verifiedAt: FETCHED_AT,
    })
    .onConflictDoNothing();
  const [article] = await db
    .insert(articles)
    .values({ ownerId: DEV_OWNER_ID, slug: SLUG })
    .returning();
  if (!article) throw new Error("could not create the fixture article");

  const [revision] = await db
    .insert(articleRevisions)
    .values({
      articleId: article.id,
      status: "draft",
      title: "A Piece Written By Hand",
      byline: "Nobody",
      siteName: "the fixture",
      lang: "en",
      excerpt: "Two sentences of it.",
      requestedUrl: "https://example.test/asked",
      finalUrl: "https://example.test/landed",
      fetchedAt: FETCHED_AT,
      rawContentType: "text/html; charset=utf-8",
      rawEncoding: "utf-8",
      rawSha256: NETWORK_SHA,
      rawSourceSha256: STORED_SHA,
      rawSourceKind: "html",
      extractedHtml: "<p>as Readability left it</p>",
      stampedHtml: `<p id="${B1}">with the ids in</p>`,
      tree: TREE,
      labels: LABELS,
      arc: ARC,
      ideas: IDEAS,
    })
    .returning();
  if (!revision) throw new Error("could not create the fixture revision");

  await db
    .insert(blockIdentities)
    .values([B1, B2, B3].map((blockId) => ({ articleId: article.id, blockId })));

  /* **Inserted out of order on purpose.** `ordinal` is document order; row
     order is not. If `readArtefact` loses its ORDER BY, this is what says so. */
  await db.insert(revisionBlocks).values(
    [
      { blockId: B3, ordinal: 2, text: "third" },
      { blockId: B1, ordinal: 0, text: "first" },
      { blockId: B2, ordinal: 1, text: "second" },
    ].map((b) => ({
      articleId: article.id,
      revisionId: revision.id,
      blockId: b.blockId,
      ordinal: b.ordinal,
      tag: "p",
      kind: "text",
      text: b.text,
      words: 1,
      html: `<p>${b.text}</p>`,
      gistable: true,
    })),
  );

  ref = {
    slug: SLUG,
    articleId: article.id,
    revisionId: revision.id,
    /* No job here: nothing in the read half fences on one, and a suite that
       claimed the single global `running` slot would be mutually exclusive with
       every other suite that wants it. */
    jobId: "00000000-0000-4000-8000-000000000000",
    attemptId: "00000000-0000-4000-8000-000000000001",
  };
}

async function cleanUp(): Promise<void> {
  const db = getDb();
  const [article] = await db.select().from(articles).where(eq(articles.slug, SLUG)).limit(1);
  if (article) {
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, article.id));
    await db.delete(articleRevisions).where(eq(articleRevisions.articleId, article.id));
    await db.delete(articles).where(eq(articles.id, article.id));
  }
  await closeDb();
}

when("reading an artefact out of Postgres", () => {
  beforeAll(async () => {
    await cleanUpQuietly();
    await makeFixture();
  }, 60_000);
  afterAll(cleanUp);

  const read = <K extends ArtifactKind>(step: Parameters<typeof readArtefact>[3], kind: K) =>
    readArtefact(ref, getDb(), SLUG, step, kind);

  it("refuses a slug that is not the one it is bound to", async () => {
    /* And **before** reading anything: a plausible artefact for the wrong
       article, with nothing saying so, is the worst answer available. */
    await expect(readArtefact(ref, getDb(), "some-other-piece", "toc", "tree")).rejects.toThrow(
      WrongArticle,
    );
  });

  it("returns the tree exactly as it was stored", async () => {
    expect(await read("toc", "tree")).toEqual(TREE);
  });

  it("returns the labels, which is where toc keeps its stamp", async () => {
    expect(await read("toc", "labels")).toEqual(LABELS);
  });

  it("keeps the two HTMLs apart", async () => {
    expect(await read("extract", "extractedHtml")).toBe("<p>as Readability left it</p>");
    expect(await read("blocks", "stampedHtml")).toBe(`<p id="${B1}">with the ids in</p>`);
  });

  it("returns null for an artefact no step has written", async () => {
    expect(await read("glossary", "glossary")).toBeNull();
    expect(await read("summary", "summary")).toBeNull();
    expect(await read("tweets", "tweets")).toBeNull();
  });

  it("brings the blocks back in document order", async () => {
    const file = await read("blocks", "blocks");
    expect(file?.blocks.map((b) => b.text)).toEqual(["first", "second", "third"]);
    expect(file?.blocks.map((b) => b.id)).toEqual([B1, B2, B3]);
  });

  it("brings them back in document order with no index to fall back on", async () => {
    /* **The test above is not enough, and finding that out is the point.**
       Replacing `order by ordinal` with `order by block_id` fails it — so it
       does read ordering. Deleting the ORDER BY *altogether* left it green,
       because Postgres chose `revision_blocks_revision_ordinal` — the unique
       index on `(revision_id, ordinal)` — and handed the rows back in ordinal
       order for free. The assertion was passing on the planner's goodwill.

       Turning the index scans off inside a transaction forces a sequential
       scan, which returns physical order: the fixture inserts third, first,
       second, so a missing ORDER BY now says so. `set local` is undone by the
       rollback, and nothing here writes anything.

       Both mutations were watched failing this. */
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`set local enable_indexscan = off`);
      await tx.execute(sql`set local enable_bitmapscan = off`);
      await tx.execute(sql`set local enable_indexonlyscan = off`);
      const file = await readArtefact(ref, tx, SLUG, "blocks", "blocks");
      expect(file?.blocks.map((b) => b.text)).toEqual(["first", "second", "third"]);
    });
  });

  it("gives stage 3 and stage 4 the same blocks", async () => {
    expect(await read("toc", "blocks")).toEqual(await read("blocks", "blocks"));
  });

  it("drops a column that is null rather than a level of 0", async () => {
    /* `level` is null on everything but a heading, and `...(null ? {} : {…})`
       is the only thing standing between that and `level: null` reaching a
       consumer that checks `"level" in block`. */
    const file = await read("blocks", "blocks");
    expect(file?.blocks[0]).not.toHaveProperty("level");
    expect(file?.blocks[0]).not.toHaveProperty("note");
  });

  it("refuses a tree whose nodes are an array", async () => {
    /* The shared shape check, `whyUnusable` — the same table the file adapter
       uses. `{"nodes": []}` is the one shape it exists to say no to, and
       `Array.isArray` is the load-bearing half of it. */
    const db = getDb();
    const good = await db
      .select({ tree: articleRevisions.tree })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, ref.revisionId));
    await db
      .update(articleRevisions)
      .set({ tree: { ...TREE, nodes: [] } as unknown as Tree })
      .where(eq(articleRevisions.id, ref.revisionId));
    try {
      expect(await read("toc", "tree")).toBeNull();
    } finally {
      await db
        .update(articleRevisions)
        .set({ tree: good[0]?.tree ?? TREE })
        .where(eq(articleRevisions.id, ref.revisionId));
    }
  });
});

when("reassembling meta and raw from their columns", () => {
  beforeAll(async () => {
    await cleanUpQuietly();
    await makeFixture();
  }, 60_000);
  afterAll(cleanUp);

  it("rebuilds meta.json, with absent fields absent", async () => {
    /* A written-out literal, not a comparison against another reader. `slug`
       comes from the bound reference — it is not a column and cannot be the
       thing that is missing, which is why this adapter cannot reproduce the
       file decoder's check on it. */
    expect(await readArtefact(ref, getDb(), SLUG, "extract", "meta")).toEqual({
      slug: SLUG,
      title: "A Piece Written By Hand",
      byline: "Nobody",
      siteName: "the fixture",
      lang: "en",
      url: "https://example.test/landed",
      fetchedAt: "2026-03-04T05:06:07.000Z",
      excerpt: "Two sentences of it.",
      /* Stage 2 writes this so that "is this the same document?" has an answer.
         The **network** hash, matching `db:export`, and note it is not the same
         number as the manifest's `storedSha256`. */
      rawSha256: NETWORK_SHA,
    });
  });

  it("keeps an empty title, which is not the same fact as no title", async () => {
    /* `=== null`, not truthiness. An empty string means extraction ran and
       produced nothing usable; null means nothing was recorded at all. Reading
       the first as the second would report an article as never extracted.
       GPT Sol, 2026-08-28. */
    const db = getDb();
    await db
      .update(articleRevisions)
      .set({ title: "" })
      .where(eq(articleRevisions.id, ref.revisionId));
    try {
      expect(await readArtefact(ref, getDb(), SLUG, "extract", "meta")).toMatchObject({
        title: "",
      });
    } finally {
      await db
        .update(articleRevisions)
        .set({ title: "A Piece Written By Hand" })
        .where(eq(articleRevisions.id, ref.revisionId));
    }
  });

  it("says no meta at all when there is no title", async () => {
    const db = getDb();
    await db
      .update(articleRevisions)
      .set({ title: null })
      .where(eq(articleRevisions.id, ref.revisionId));
    try {
      expect(await readArtefact(ref, getDb(), SLUG, "extract", "meta")).toBeNull();
    } finally {
      await db
        .update(articleRevisions)
        .set({ title: "A Piece Written By Hand" })
        .where(eq(articleRevisions.id, ref.revisionId));
    }
  });

  it("takes the document kind from the source reference", async () => {
    const raw = await readArtefact(ref, getDb(), SLUG, "fetch", "raw");
    expect(raw).toEqual({
      kind: "html",
      file: "raw.html",
      requestedUrl: "https://example.test/asked",
      url: "https://example.test/landed",
      contentType: "text/html; charset=utf-8",
      encoding: "utf-8",
      bytes: 0,
      sha256: NETWORK_SHA,
      storedSha256: STORED_SHA,
      fetchedAt: "2026-03-04T05:06:07.000Z",
    });
  });

  it("keeps the network hash and the stored hash apart", async () => {
    /* Two different questions — `sha256` is what the server sent, `storedSha256`
       is what is in the bucket — and for any non-UTF-8 page they differ.
       Collapsing them would be a lie that reads perfectly. */
    const raw = await readArtefact(ref, getDb(), SLUG, "fetch", "raw");
    expect(raw?.sha256).not.toBe(raw?.storedSha256);
  });

  it("refuses a row whose reference and bytes are two different documents", async () => {
    /* PDF magic in `raw_bytes`, `html` in the source reference. The two describe
       the same document — for a PDF the stored object *is* the fetched bytes,
       for HTML it is those bytes decoded — so they cannot legitimately be
       different kinds, and this row needs a person rather than a winner.

       My first version of this test asserted that the reference wins. GPT Sol
       said no on 2026-08-28, and it is right: silently preferring either one
       hides the corruption, and the cost of refusing is one article reading as
       unfetched until somebody looks. */
    const db = getDb();
    await db
      .update(articleRevisions)
      .set({ rawBytes: Buffer.from("%PDF-1.7\nnot really") })
      .where(eq(articleRevisions.id, ref.revisionId));
    try {
      expect(await readArtefact(ref, getDb(), SLUG, "fetch", "raw")).toBeNull();
    } finally {
      await db
        .update(articleRevisions)
        .set({ rawBytes: null })
        .where(eq(articleRevisions.id, ref.revisionId));
    }
  });

  it("falls back to sniffing the bytes for a row with no source reference", async () => {
    /* The legacy branch, and it dies with `raw_bytes` at the end of this
       landing. `%PDF-` is what `sniffKind` looks for, and the content type says
       HTML — deliberately, because the stored content type is the *server's
       claim* and the bytes are the authority. */
    const db = getDb();
    await db
      .update(articleRevisions)
      .set({
        rawSourceSha256: null,
        rawSourceKind: null,
        rawBytes: Buffer.from("%PDF-1.7\nnot really"),
      })
      .where(eq(articleRevisions.id, ref.revisionId));
    try {
      const raw = await readArtefact(ref, getDb(), SLUG, "fetch", "raw");
      expect(raw?.kind).toBe("pdf");
      expect(raw?.file).toBe("raw.pdf");
      expect(raw?.storedSha256).toBeUndefined();
    } finally {
      await db
        .update(articleRevisions)
        .set({
          rawSourceSha256: STORED_SHA,
          rawSourceKind: "html",
          rawBytes: null,
        })
        .where(eq(articleRevisions.id, ref.revisionId));
    }
  });

  it("says nothing rather than guessing a filename it cannot know", async () => {
    /* No source reference and no bytes. `file` is the only thing that tells a
       later reader which decoder to use, so a guess here is the bug `db:export`
       shipped until 2026-08-27: every exported PDF named `raw.html`. */
    const db = getDb();
    await db
      .update(articleRevisions)
      .set({ rawSourceSha256: null, rawSourceKind: null, rawBytes: null })
      .where(eq(articleRevisions.id, ref.revisionId));
    try {
      expect(await readArtefact(ref, getDb(), SLUG, "fetch", "raw")).toBeNull();
    } finally {
      await db
        .update(articleRevisions)
        .set({ rawSourceSha256: STORED_SHA, rawSourceKind: "html" })
        .where(eq(articleRevisions.id, ref.revisionId));
    }
  });
});

when("an article whose blocks have all gone", () => {
  beforeAll(async () => {
    await cleanUpQuietly();
    await makeFixture();
    await getDb().delete(revisionBlocks).where(eq(revisionBlocks.revisionId, ref.revisionId));
  }, 60_000);
  afterAll(cleanUp);

  it("has no blocks artefact, rather than an artefact of no blocks", async () => {
    /* The difference matters downstream: `inputHashFor` in src/pipeline.ts does
       `if (!file?.blocks) return null`, which `{ blocks: [] }` sails past — and
       every late step would then be compared against `hashBlocks([])`, a
       real-looking fingerprint of nothing. */
    expect(await readArtefact(ref, getDb(), SLUG, "blocks", "blocks")).toBeNull();
    expect(await readArtefact(ref, getDb(), SLUG, "toc", "blocks")).toBeNull();
  });
});

when("what the store recorded about a run", () => {
  beforeAll(async () => {
    await cleanUpQuietly();
    await makeFixture();
  }, 60_000);
  afterAll(cleanUp);

  const runRow = async (
    step: "fetch" | "arc" | "ideas" | "glossary",
    values: Partial<typeof revisionStepRuns.$inferInsert>,
  ) => {
    /* **Every nullable field named, not just the ones a case cares about.**
       `onConflictDoUpdate`'s `set` only writes the keys it is given, so a row
       left from the previous case kept its `prompt_version` and the case after
       it read a clash it never set up — green alone, red in the suite. Stating
       the whole row is what makes each case independent of its neighbours. */
    const row = {
      revisionId: ref.revisionId,
      stepName: step,
      inputHash: NO_INPUT_HASH,
      implementationVersion: PIPELINE_RUN,
      promptVersion: null,
      model: null,
      status: "done",
      ...values,
    };
    await getDb()
      .insert(revisionStepRuns)
      .values(row)
      .onConflictDoUpdate({
        target: [revisionStepRuns.revisionId, revisionStepRuns.stepName],
        set: row,
      });
  };

  it("says nothing when nothing ran and no artefact carries a stamp", async () => {
    expect(await stampForStep(ref, getDb(), SLUG, "glossary")).toBeNull();
  });

  it("drops the two sentinels", async () => {
    /* `input_hash` and `implementation_version` are NOT NULL, so a step that
       records nothing about its input still writes something. Handing either
       back would let `sameStamp` compare a sentinel against a real hash — and
       would make a stamp look declared when nothing was declared. */
    await runRow("fetch", {});
    expect(await stampForStep(ref, getDb(), SLUG, "fetch")).toBeNull();
  });

  it("keeps a real implementation version, which is not the sentinel", async () => {
    await runRow("fetch", { implementationVersion: "imported" });
    expect(await stampForStep(ref, getDb(), SLUG, "fetch")).toEqual({
      implementationVersion: "imported",
    });
  });

  it("takes the implementation version from the row, which no artefact carries", async () => {
    await runRow("arc", { implementationVersion: "arc/impl-1" });
    expect(await stampForStep(ref, getDb(), SLUG, "arc")).toEqual({
      implementationVersion: "arc/impl-1",
      promptVersion: "arc/1",
      model: "claude-opus-5",
    });
  });

  it("refuses a stamp the row and the artefact disagree about", async () => {
    /* My first version of this asserted that the artefact silently wins. GPT
       Sol said no on 2026-08-28: the artefact is the *authority*, but a
       disagreement is a fact about the row, and resolving it quietly is how a
       stale artefact gets served for ever. No usable stamp, and a warning. */
    await runRow("arc", { promptVersion: "arc/0", model: "a-model-from-last-week" });
    expect(await stampForStep(ref, getDb(), SLUG, "arc")).toBeNull();
  });

  it("does not let the row supply what the artefact has no room for", async () => {
    /* `arc.json` carries `version` and `generator` and **no `sourceHash`** — the
       arc's stamp can only ever answer two of the three questions, which is
       what `StepStamp` says out loud. The row has an `input_hash` column and it
       is always populated, so a merge that filled the gap from it would give
       Postgres freshness evidence the filesystem does not have, and the same
       article would be current in one store and stale in the other.

       This is the case my own merge got wrong and my own test could not see: I
       only ever set `implementationVersion` on the row, so the rule was never
       exercised. */
    await runRow("arc", {
      inputHash: "a-hash-the-arc-itself-does-not-carry",
      implementationVersion: "arc/impl-1",
    });
    const stamp = await stampForStep(ref, getDb(), SLUG, "arc");
    expect(stamp).not.toHaveProperty("inputHash");
    expect(stamp).toEqual({
      implementationVersion: "arc/impl-1",
      promptVersion: "arc/1",
      model: "claude-opus-5",
    });
  });

  it("keeps a value the row and the artefact agree about", async () => {
    await runRow("arc", { promptVersion: "arc/1", model: "claude-opus-5" });
    expect(await stampForStep(ref, getDb(), SLUG, "arc")).toMatchObject({
      promptVersion: "arc/1",
      model: "claude-opus-5",
    });
  });

  it("preserves a profileHash of null, which no column could hold", async () => {
    /* Three states, and they are not interchangeable: `undefined` is "written
       before this existed", `null` is "written deliberately without a profile",
       and a hash is a hash. There is no `profile_hash` column, so `null` here
       can only come from the artefact — which is the whole reason `stampFor`
       merges two sources. */
    await runRow("ideas", { inputHash: "hash-of-blocks-and-tree" });
    const stamp = await stampForStep(ref, getDb(), SLUG, "ideas");
    expect(stamp).toHaveProperty("profileHash", null);
    expect(stamp?.inputHash).toBe("hash-of-blocks-and-tree");
  });
});

/** Whatever a previous crashed run left behind, without failing if there is none. */
async function cleanUpQuietly(): Promise<void> {
  const db = getDb();
  const [article] = await db.select().from(articles).where(eq(articles.slug, SLUG)).limit(1);
  if (!article) return;
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, article.id));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, article.id));
  await db.delete(articles).where(eq(articles.id, article.id));
}
