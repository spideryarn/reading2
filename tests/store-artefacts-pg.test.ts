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
 * ## It cannot run twice at once, and that is worth knowing before it confuses you
 *
 * The fixture is one article at a fixed slug, created in `beforeAll` and deleted
 * in `afterAll`. Two copies of this file running against the same database tear
 * each other's fixture down mid-test: measured, deliberately — two concurrent
 * `vitest run` of this file gave 20 and 25 failures with 19 and 26 skipped,
 * where each alone is green three times running. The skips are the giveaway,
 * because they mean a `beforeAll` threw rather than an assertion failing.
 *
 * Vitest will not do that to itself — one file runs once per invocation — so
 * this only happens when two runs overlap by hand, which is exactly how it was
 * found. It is not the same problem as the shared `running` job slot
 * (`withClaim` below); that one is between *different* suites and is retried.
 *
 * Skips loudly when there is no database, for the reason tests/db-schema.test.ts
 * explains at length.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, eq, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  rawSources,
  revisionBlocks,
  revisionStepRuns,
} from "../src/db/schema.js";
import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { loadEnvLocal } from "../src/env.js";
import { PATHS } from "../src/store/artifacts-fs.js";
import {
  NoStoredDocument,
  RawSourceDisagrees,
  STORAGE,
  WrongArticle,
  hasArtefacts,
  readArtefact,
  siteFor,
  pgArtifactsIn,
  readOnlyPgArtifacts,
  StampDisagrees,
  stampForStep,
  stepInterrupted,
  writeArtefacts,
} from "../src/store/artifacts-pg.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/artifacts.js";
import type { ArtifactKind } from "../src/store/artifacts.js";
import { STEPS, STEP_ORDER } from "../src/pipeline.js";
import { mintId } from "../src/ids.js";
import { mintAttempt } from "../src/store/jobs.js";
import {
  NotTheLiveAttempt,
  StepRunNotHeld,
  beginStepRun,
  publishRevision,
} from "../src/store/pg-revisions.js";
import { jobs } from "../src/db/schema.js";
import type { Block, JobStep, Meta } from "../src/types.js";
import type { RawManifest } from "../src/fetch.js";
import type { Arc, Ideas, Tree } from "../src/types.js";
import type { LabelsFile } from "../src/labels.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";

loadEnvLocal();

const SLUG = "test-artefacts-pg";

/**
 * The owner every row here hangs off — Greg's `auth.users` row in the local
 * stack, which the migrations put there and no test owns.
 *
 * **Imported, not copied.** It is a foreign key, so it has to match a row that
 * already exists; three test files each wrote the uuid out longhand, and the
 * day the dev identity changes is the day all three point at nothing. It is
 * also not a fixture id in the sense `tests/fixture-ids.test.ts` guards —
 * `cleanUp` below deletes by slug and by article id, never by owner — so
 * sharing it across files is safe in a way sharing an article id is not.
 */
const DEV_OWNER_ID = ADMIN_USER_ID_LOCAL;

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

const { reachable } = await pgReady({
  suite: "tests/store-artefacts-pg.test.ts",
  tables: ["spideryarn.article_revisions"],
});

const when = reachable ? describe : describe.skip;

/**
 * **This file starts a job, so it takes the shared run lock.**
 *
 * This file's fixtures are named the same on every run, so a second copy — a
 * peer's `npm test` beside yours — collides with it on `jobs_active_slug` and
 * on the fixture rows themselves. Taken after `pgReady` and only
 * when reachable, because a suite that is about to skip must not sit holding it.
 * tests/helpers/run-lock.ts has the reasoning and the measurements.
 */
const runLock = reachable ? await takeRunLock("tests/store-artefacts-pg.test.ts") : undefined;
afterAll(async () => {
  await runLock?.release();
});

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
      /* **The canonical type for the kind, not the server's claim.** The
         revision's `raw_content_type` records what the origin said —
         `text/html; charset=utf-8` below — and this records what the object in
         the bucket is stored as, which `storeRawSource` sets from
         `CONTENT_TYPE[kind]`. The first version of this fixture put the
         server's claim here and `writeArtefacts` correctly refused it as a
         disagreement, which is the check working on its author. */
      contentType: "text/html",
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
      /* Deliberately not equal to the `raw_sources` row's 29 bytes below: this
         is what the network sent and that is the size of what we stored, and
         for a page that was not already UTF-8 they differ. A fixture where they
         matched could not tell a reader that swapped them. */
      rawByteCount: 31,
      rawFilename: "The Reader's Own Name.html",
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
      /* **And no `rawSha256`**, which this asserted until 2026-08-29 with a
         comment saying stage 2 writes it "so that 'is this the same document?'
         has an answer". Stage 2 writes no such thing for a web page: the field
         is PDFs only (src/types.ts) and src/pdf-read.ts is its only writer,
         while this fixture is Readability's HTML — `raw_source_kind` is `html`
         and there is no `source` column set.
         `article_revisions.raw_sha256` above is stage 1's hash of what it
         fetched and every fetch has one, so reading it straight into `Meta` put
         a PDF field on every HTML article. The question the old comment asked
         is a real one and `raw.json` is where it is answered — `readRaw` below
         puts the same `NETWORK_SHA` in `RawManifest.sha256`, which is the
         artefact that owns it. */
    });
  });

  /**
   * **The two directions of `Meta.rawSha256`, which one test cannot cover.**
   *
   * The fixture is Readability's HTML with a non-null `raw_sha256`, so the case
   * above already pins the direction that was broken: the column is there and
   * the field must not be. But a rule that returned nothing at all would pass
   * that perfectly, and would break every PDF instead — the same bug pointed
   * the other way, and quieter, because no fixture in `data/` would notice a
   * hash going missing from a PDF until somebody compared two files by hand.
   *
   * So the second one flips exactly one field. `source` is what the rule reads,
   * and it is the only thing that differs between the two rows.
   *
   * **Why `source` is the key**, checked against the database rather than
   * argued from the types (2026-08-29): `article_revisions.source` is nullable
   * text with no default, and across every revision it holds `'pdf'` or null
   * and nothing else. It agrees with stage 1's independent `raw_source_kind` on
   * every row — no PDF has a null `source`, and no `source: 'pdf'` sits on a
   * row stage 1 called HTML. On disk the pairing is just as tight: all six
   * `meta.json` files carrying a `rawSha256` also carry `source: "pdf"`, and
   * none has one without the other. That is what src/pdf-read.ts guarantees by
   * writing the two in a single object literal.
   */
  it("gives a PDF back its hash, which is the direction a null rule would break", async () => {
    const db = getDb();
    /* One field, so the fixture cannot pass by accident: everything else about
       this row still says HTML. */
    await db
      .update(articleRevisions)
      .set({ source: "pdf" })
      .where(eq(articleRevisions.id, ref.revisionId));
    try {
      expect(await readArtefact(ref, getDb(), SLUG, "extract", "meta")).toMatchObject({
        source: "pdf",
        rawSha256: NETWORK_SHA,
      });
    } finally {
      await db
        .update(articleRevisions)
        .set({ source: null })
        .where(eq(articleRevisions.id, ref.revisionId));
    }
  });

  it("withholds the hash from a web page, whose meta.json never had one", async () => {
    /* The restored fixture: `raw_sha256` populated by stage 1, no `source`.
       Named separately from "rebuilds meta.json" above because that one would
       still pass if `rawSha256` were dropped for *every* article, and this says
       which article it is about. */
    const meta = await readArtefact(ref, getDb(), SLUG, "extract", "meta");
    expect(meta).toBeDefined();
    expect(meta && "rawSha256" in meta).toBe(false);
    /* And the hash is not lost — it lives in the artefact that owns it. */
    expect(await readArtefact(ref, getDb(), SLUG, "fetch", "raw")).toMatchObject({
      kind: "html",
      sha256: NETWORK_SHA,
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

  it("rebuilds the manifest from every column that holds a piece of it", async () => {
    /* **A written-out literal, and it used to say `bytes: 0`.** `raw_byte_count`
       and `raw_filename` had just been added for exactly these two fields and
       `readRaw` was not changed to read them, so a manifest that went in saying
       4096 bytes came back saying 0 — and this test asserted the 0, which is
       how a fixture stops being an oracle and becomes a record of the bug.
       GPT Sol, 2026-08-28.

       `storedBytes` comes from the joined `raw_sources` row, because that is
       the only place the object's size lives. */
    const raw = await readArtefact(ref, getDb(), SLUG, "fetch", "raw");
    expect(raw).toEqual({
      kind: "html",
      file: "raw.html",
      requestedUrl: "https://example.test/asked",
      url: "https://example.test/landed",
      filename: "The Reader's Own Name.html",
      contentType: "text/html; charset=utf-8",
      encoding: "utf-8",
      bytes: 31,
      sha256: NETWORK_SHA,
      storedSha256: STORED_SHA,
      storedBytes: 29,
      fetchedAt: "2026-03-04T05:06:07.000Z",
    });
  });

  it("keeps the network byte count and the object's size apart", async () => {
    /* The same distinction as the two hashes, one field along, and the one a
       reader that took `raw_sources.bytes` for both would fail. */
    const raw = await readArtefact(ref, getDb(), SLUG, "fetch", "raw");
    expect(raw?.bytes, "what the network sent").toBe(31);
    expect(raw?.storedBytes, "the object in the bucket").toBe(29);
  });

  it("falls back to the stored bytes column for a revision written before raw_byte_count", async () => {
    /* `raw_bytes` is dropped at the end of this landing, so it is the fallback
       rather than the answer — but a revision that predates the column still
       has to read back with a size. */
    const db = getDb();
    await db
      .update(articleRevisions)
      .set({ rawByteCount: null, rawBytes: Buffer.from("<p>eleven</p>") })
      .where(eq(articleRevisions.id, ref.revisionId));
    try {
      expect((await readArtefact(ref, getDb(), SLUG, "fetch", "raw"))?.bytes).toBe(13);
    } finally {
      await db
        .update(articleRevisions)
        .set({ rawByteCount: 31, rawBytes: null })
        .where(eq(articleRevisions.id, ref.revisionId));
    }
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
      /* No reference means no `raw_sources` row to join, so the object's size is
         absent rather than guessed from the network count. */
      expect(raw?.storedBytes).toBeUndefined();
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

  it("throws on a prompt version the row and the artefact disagree about", async () => {
    /* **Thrown, not `null`.** My first version had the artefact silently win;
       the second returned `null`, which is no better, because `null` already
       means "nothing recorded" and every caller reads it as *re-run the step* —
       `copyArtefacts` turns it into `{}` and copies the artefact anyway, so the
       clash is resolved in the artefact's favour with nothing saying so. GPT
       Sol, twice, 2026-08-28.

       And the two fields are asserted **separately**: a single case that moved
       both would stay green if either comparison disappeared. */
    await runRow("arc", { promptVersion: "arc/0" });
    await expect(stampForStep(ref, getDb(), SLUG, "arc")).rejects.toThrow(StampDisagrees);
    await expect(stampForStep(ref, getDb(), SLUG, "arc")).rejects.toThrow(/promptVersion/);
  });

  it("throws on a model the row and the artefact disagree about", async () => {
    await runRow("arc", { model: "a-model-from-last-week" });
    await expect(stampForStep(ref, getDb(), SLUG, "arc")).rejects.toThrow(/model/);
  });

  it("says nothing about the field that agrees", async () => {
    /* The message names what disagrees and nothing else — a refusal that listed
       every field would send somebody to look at the two that are fine. */
    await runRow("arc", { promptVersion: "arc/1", model: "a-model-from-last-week" });
    await expect(stampForStep(ref, getDb(), SLUG, "arc")).rejects.toThrow(
      /disagree about model,/,
    );
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

when("whether a step has actually produced anything", () => {
  /* `has` is presence **and completion**, and never freshness — see the long
     header on `hasArtefacts`. Every case below was watched red against the
     mutation named in it. */
  beforeAll(async () => {
    await cleanUpQuietly();
    await makeFixture();
  }, 60_000);
  afterAll(cleanUp);

  const has = (step: "toc" | "arc" | "blocks", kinds: ArtifactKind[]) =>
    hasArtefacts(ref, getDb(), SLUG, step, kinds);

  const runRow = async (step: "toc" | "arc" | "blocks", status: "running" | "done" | "error") => {
    const row = {
      revisionId: ref.revisionId,
      stepName: step,
      inputHash: NO_INPUT_HASH,
      implementationVersion: PIPELINE_RUN,
      promptVersion: null,
      model: null,
      status,
      finishedAt: status === "running" ? null : new Date(),
    };
    await getDb()
      .insert(revisionStepRuns)
      .values(row)
      .onConflictDoUpdate({
        target: [revisionStepRuns.revisionId, revisionStepRuns.stepName],
        set: row,
      });
  };

  it("refuses a slug that is not the one it is bound to", async () => {
    await expect(hasArtefacts(ref, getDb(), "elsewhere", "toc", ["tree"])).rejects.toThrow(
      WrongArticle,
    );
  });

  it("refuses a kind the step does not produce, whether or not it has run", async () => {
    /* **The same answer in both states**, which it was not: reading the run row
       first made the validity of an argument depend on the database, so
       `has("arc", ["glossary"])` returned false while no arc run existed and
       threw once one did. The file adapter throws unconditionally, and a check
       that changes its mind about whether its argument is valid is worse than
       either answer. GPT Sol, 2026-08-28. */
    await expect(has("arc", ["glossary"])).rejects.toThrow(/arc does not produce glossary/);
    await runRow("arc", "done");
    await expect(has("arc", ["glossary"])).rejects.toThrow(/arc does not produce glossary/);
  });

  it("says no to a step whose artefacts are all there but which never ran", async () => {
    /* **The whole reason this function reads a row at all.** The fixture wrote
       `tree` and `labels` straight into the columns and recorded no run — which
       is exactly the shape `beginDraftIn` produces when it carries a previous
       revision's columns forward. On the filesystem the artefacts being there
       is very nearly proof that the step put them there; here it is not.

       Watched red by deleting the run-row read. */
    expect(await has("toc", ["tree", "labels"])).toBe(false);
  });

  it("says yes once the step is recorded done and everything reads back", async () => {
    await runRow("toc", "done");
    expect(await has("toc", ["tree", "labels", "blocks"])).toBe(true);
  });

  it("says no while the step is still running", async () => {
    await runRow("toc", "running");
    expect(await has("toc", ["tree", "labels"])).toBe(false);
    expect(await stepInterrupted(ref, getDb(), SLUG, "toc")).toBe(true);
  });

  it("says no to a step that ended in error, artefacts or no artefacts", async () => {
    /* The `status = 'done'` half **alone**: every artefact this step declares is
       sitting in its column, and the only thing wrong is the row. Watched red by
       relaxing the condition to "a row exists".

       And it is not *interrupted*: it finished, badly. `stepIsDone` treats those
       differently, so the two questions must not collapse into one. */
    await runRow("toc", "error");
    expect(await has("toc", ["tree", "labels"])).toBe(false);
    expect(await stepInterrupted(ref, getDb(), SLUG, "toc")).toBe(false);
  });

  it("says no when one of the step's products is missing", async () => {
    /* All of them, never any of them. `arc` is the whole of the arc step, and
       `toc` declares three — a done row beside two of them is a step that
       cannot be believed. */
    await runRow("arc", "done");
    expect(await has("arc", ["arc"])).toBe(true);
    const db = getDb();
    await db
      .update(articleRevisions)
      .set({ labels: null })
      .where(eq(articleRevisions.id, ref.revisionId));
    try {
      await runRow("toc", "done");
      expect(await has("toc", ["tree"])).toBe(true);
      expect(await has("toc", ["tree", "labels"])).toBe(false);
    } finally {
      await db
        .update(articleRevisions)
        .set({ labels: LABELS })
        .where(eq(articleRevisions.id, ref.revisionId));
    }
  });

  it("says no when nothing was asked for", async () => {
    /* Not "yes, all of nothing". A step whose products list is empty has not
       been shown to have run, and the file adapter answers the same way. */
    await runRow("toc", "done");
    expect(await has("toc", [])).toBe(false);
  });

  it("keeps saying yes about a tree built from blocks that have since moved", async () => {
    /* **The assertion that says freshness stayed out of storage.** The `toc`
       row records a hash that has nothing to do with the blocks now stored, and
       `has` does not care: the tree is there and a run of `toc` finished.

       An earlier version of the plan wanted the opposite — compare the row's
       `input_hash` against the stored blocks — and it is wrong twice over. It
       is a freshness rule in the one function that must not have one, and it
       re-runs `toc`, which moves the tree's boundaries, which silently drops
       every `arc` and `summary` entry whose block range no longer matches a
       node. GPT Sol, 2026-08-28. */
    await runRow("toc", "done");
    const [row] = await getDb()
      .select({ hash: revisionStepRuns.inputHash })
      .from(revisionStepRuns)
      .where(
        and(
          eq(revisionStepRuns.revisionId, ref.revisionId),
          eq(revisionStepRuns.stepName, "toc"),
        ),
      );
    expect(row?.hash, "the row must not happen to describe these blocks").toBe(NO_INPUT_HASH);
    expect(await has("toc", ["tree", "labels", "blocks"])).toBe(true);
  });
});

/* --------------------------------------------------------------- write -- */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class RollBack extends Error {}

const JOB_STEPS: JobStep[] = [
  { name: "toc", label: "Building the table of contents", status: "pending" },
];

/**
 * A live claim on the fixture draft, and everything it touches rolled back.
 *
 * A committed `running` row is a contended thing, and it was worse when this
 * was written: `jobs_only_one_running` allowed one in the whole table, so every
 * suite that wanted one was mutually exclusive with every other, and two of them
 * failed against each other under parallel vitest. That index went on
 * 2026-08-30, replaced by a counted cap; what remains is `jobs_active_slug` —
 * one job in flight per article — and this file's slug is fixed. So this
 * inserts inside a transaction, does its work, and throws to roll the lot back:
 * nothing is committed and there is nothing to clean up.
 *
 * **The retry loop that used to sit in the `catch` went with the index.** It
 * waited out a 23505 from `jobs_only_one_running` while another job held the one
 * global running slot. That slot no longer exists, and this insert is direct SQL
 * that the counted cap does not apply to either, so the loop could never fire
 * again — dead code reading as a live guard.
 *
 * Copied in shape from tests/store-step-fence.test.ts, which explains it at
 * length.
 */
async function withClaim(
  body: (tx: Tx, claimed: JobDraftRef) => Promise<void>,
): Promise<void> {
  const id = mintId();
  const attemptId = mintAttempt();
  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(jobs).values({
        id,
        ownerId: DEV_OWNER_ID,
        slug: SLUG,
        steps: JOB_STEPS,
        status: "running",
        attemptId,
        leaseExpiresAt: new Date(Date.now() + 600_000),
        workKey: `wk-${id}`,
        draftRevisionId: ref.revisionId,
      });
      await body(tx, { ...ref, jobId: id, attemptId });
      throw new RollBack();
    });
  } catch (err) {
    if (!(err instanceof RollBack)) throw err;
  }
}

const NEW_BLOCKS: Block[] = [
  { id: B1, tag: "p", kind: "text", text: "rewritten first", words: 2, html: "<p>a</p>", gistable: true },
  { id: B2, tag: "p", kind: "text", text: "rewritten second", words: 2, html: "<p>b</p>", gistable: true },
];

when("writing artefacts into a draft", () => {
  beforeAll(async () => {
    await cleanUpQuietly();
    await makeFixture();
  }, 60_000);
  afterAll(cleanUp);

  /** The protocol the runner follows: begin, then write. */
  const begun = async (
    tx: Tx,
    claimed: JobDraftRef,
    step: "toc" | "arc" | "blocks" | "fetch" | "extract",
  ) => {
    await beginStepRun(
      { revisionId: claimed.revisionId, stepName: step, job: { id: claimed.jobId, attemptId: claimed.attemptId } },
      tx,
    );
  };

  it("puts a column artefact where the map says, and reads it back", async () => {
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "arc");
      const arc: Arc = { ...ARC, entries: [{ range: [B1, B2], text: "Something else entirely." }] };
      await writeArtefacts(claimed, tx, SLUG, "arc", { arc }, { promptVersion: "arc/1", model: "claude-opus-5" });
      expect(await readArtefact(claimed, tx, SLUG, "arc", "arc")).toEqual(arc);
    });
  });

  it("takes meta apart into the columns it owns and puts it back together", async () => {
    /* The round trip is the assertion: `metaColumns` and `readMeta` are
       inverses over the columns `extract` owns, and a field one of them forgets
       is a field that silently stops surviving an extraction.

       The three stage-1 fields — `url`, `fetchedAt`, `rawSha256` — come back
       from the columns `fetch` wrote, not from the meta handed in. See the next
       test, which is the one that matters. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "extract");
      const meta: Meta = {
        slug: SLUG,
        title: "Rewritten",
        byline: "Somebody",
        lang: "fr",
        excerpt: "Two other sentences.",
        note: "a note",
        source: "pdf",
        method: "openai/gpt-5.6-luna/pdf-v1",
        pages: 17,
        unverified: false,
        recall: 0.94,
        pagesChecked: 12,
      };
      /* `extract` writes two things and this writes one, which the store allows
         — `has` is what refuses the half-finished step, not `write`. */
      await writeArtefacts(claimed, tx, SLUG, "extract", { meta }, {});
      expect(await readArtefact(claimed, tx, SLUG, "extract", "meta")).toEqual({
        ...meta,
        // The fixture's stage-1 columns, untouched.
        url: "https://example.test/landed",
        fetchedAt: "2026-03-04T05:06:07.000Z",
        rawSha256: NETWORK_SHA,
      });
    });
  });

  it("does not let extract overwrite what fetch recorded", async () => {
    /* **The reason `META_COLUMNS` is shorter than `meta.json`.** All three of
       these are stage 1's facts that stage 2 copies, and each would be wrong in
       its own way if `extract` wrote it:

       - `src/extract.ts` sets `fetchedAt` to `new Date()` — *its* clock. The
         shelf sorts on that column, so a re-extraction would send the article
         to the top of the library as though it had just arrived.
       - `Meta.rawSha256` is a PDF field, so an HTML meta has none and `?? null`
         would clear the hash `fetch` wrote.
       - `finalUrl` is where stage 1's redirects ended; stage 2 only sees what it
         was handed.

       Watched red by putting the three back into `metaColumns`. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "extract");
      await writeArtefacts(
        claimed,
        tx,
        SLUG,
        "extract",
        {
          meta: {
            slug: SLUG,
            title: "Re-extracted today",
            url: "https://example.test/somewhere-else",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
        },
        {},
      );
      const [row] = await tx
        .select({
          finalUrl: articleRevisions.finalUrl,
          fetchedAt: articleRevisions.fetchedAt,
          rawSha256: articleRevisions.rawSha256,
        })
        .from(articleRevisions)
        .where(eq(articleRevisions.id, claimed.revisionId));
      expect(row?.finalUrl).toBe("https://example.test/landed");
      expect(row?.fetchedAt?.toISOString()).toBe("2026-03-04T05:06:07.000Z");
      expect(row?.rawSha256).toBe(NETWORK_SHA);
    });
  });

  it("clears a column extract owns when the new meta does not have it", async () => {
    /* The fixture has a `siteName` and an `excerpt`; this meta has neither. An
       absent-key-means-leave-it write would leave last extraction's values
       sitting beside this one's, and the result would read perfectly. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "extract");
      await writeArtefacts(claimed, tx, SLUG, "extract", { meta: { slug: SLUG, title: "Bare" } }, {});
      const back = await readArtefact(claimed, tx, SLUG, "extract", "meta");
      expect(back).not.toHaveProperty("siteName");
      expect(back).not.toHaveProperty("excerpt");
      expect(back).toMatchObject({ slug: SLUG, title: "Bare" });
    });
  });

  it("replaces the blocks wholesale, in the order it was given", async () => {
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "blocks");
      await writeArtefacts(claimed, tx, SLUG, "blocks", { blocks: { blocks: NEW_BLOCKS } }, {});
      const back = await readArtefact(claimed, tx, SLUG, "blocks", "blocks");
      expect(back?.blocks.map((b) => b.text)).toEqual(["rewritten first", "rewritten second"]);
      /* The third fixture block is gone, not left behind beside the two new
         ones — a paragraph nothing points at. */
      expect(back?.blocks).toHaveLength(2);
    });
  });

  it("deletes every block when it is handed none", async () => {
    /* **The decision, and it is the opposite of what the importer does.**
       `src/store/import.ts` puts its delete inside `if (blocks.length)`, so an
       empty array leaves the inherited rows in place: the stage returns
       nothing, the old article survives, and the run reports done. Watched red
       by moving this delete back inside the same condition. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "blocks");
      await writeArtefacts(claimed, tx, SLUG, "blocks", { blocks: { blocks: [] } }, {});
      const rows = await tx
        .select({ id: revisionBlocks.blockId })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, claimed.revisionId));
      expect(rows).toHaveLength(0);
    });
  });

  it("refuses a stamp that contradicts the artefact it is writing", async () => {
    /* The file adapter has nowhere to put a stamp, so it checks. This one has a
       whole column, so a contradiction would **survive** — and `stampFor` would
       then have to pick between the row and the artefact. Rejecting the write
       is the only answer that keeps them meaning the same thing. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "arc");
      await expect(
        writeArtefacts(claimed, tx, SLUG, "arc", { arc: ARC }, { model: "some-other-model" }),
      ).rejects.toThrow(/disagrees with the arc itself/);
    });
  });

  it("refuses a manifest that names no object in the bucket", async () => {
    /* No `storedSha256` means **we do not hold the document**. Writing the rest
       would leave a `fetch` reporting done beside a null reference — and
       `article_revisions_raw_source_both` would not complain, because
       null-and-null is a legal pair meaning exactly "we do not have the
       source". The database cannot catch this one; the adapter has to. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "fetch");
      const manifest: RawManifest = {
        kind: "html",
        file: "raw.html",
        contentType: "text/html",
        encoding: "utf-8",
        bytes: 10,
        sha256: NETWORK_SHA,
        fetchedAt: "2026-08-28T00:00:00.000Z",
      };
      await expect(
        writeArtefacts(claimed, tx, SLUG, "fetch", { raw: manifest }, {}),
      ).rejects.toThrow(NoStoredDocument);
    });
  });

  it("refuses a manifest with a stored hash and no stored size", async () => {
    /* `raw_sources.bytes` describes the object, and `RawManifest.bytes` counts
       what the network sent — two different numbers for any page that was not
       already UTF-8, because `writeRaw` stores the decoded text. Guessing with
       the network count would put a wrong size on a **shared** row that other
       revisions point at. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "fetch");
      const manifest: RawManifest = {
        kind: "html",
        file: "raw.html",
        contentType: "text/html",
        encoding: "utf-8",
        bytes: 10,
        sha256: NETWORK_SHA,
        storedSha256: "c3".repeat(32),
        fetchedAt: "2026-08-28T00:00:00.000Z",
      };
      await expect(
        writeArtefacts(claimed, tx, SLUG, "fetch", { raw: manifest }, {}),
      ).rejects.toThrow(NoStoredDocument);
    });
  });

  it("writes the source row and the reference pair together", async () => {
    /* The first thing in this project ever to write either. The order is the
       foreign key's: `raw_sources` before the reference, or
       `article_revisions_raw_source_fk` refuses — which is the design working,
       since a reference to a row that is not there is a half-pointer. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "fetch");
      const fresh = "d4".repeat(32);
      const manifest: RawManifest = {
        kind: "pdf",
        file: "raw.pdf",
        origin: "upload",
        uploadId: "up_1",
        filename: "The Reader's Own Name.pdf",
        contentType: "application/pdf",
        encoding: null,
        bytes: 4096,
        sha256: NETWORK_SHA,
        storedSha256: fresh,
        storedBytes: 4096,
        fetchedAt: "2026-08-28T01:02:03.000Z",
      };
      await writeArtefacts(claimed, tx, SLUG, "fetch", { raw: manifest }, {});

      const [source] = await tx
        .select()
        .from(rawSources)
        .where(and(eq(rawSources.sha256, fresh), eq(rawSources.kind, "pdf")));
      expect(source?.bytes, "the stored size, not the network size").toBe(4096);
      expect(source?.contentType).toBe("application/pdf");

      const [row] = await tx
        .select({
          sha: articleRevisions.rawSourceSha256,
          kind: articleRevisions.rawSourceKind,
          filename: articleRevisions.rawFilename,
          count: articleRevisions.rawByteCount,
        })
        .from(articleRevisions)
        .where(eq(articleRevisions.id, claimed.revisionId));
      expect(row).toEqual({
        sha: fresh,
        kind: "pdf",
        filename: "The Reader's Own Name.pdf",
        count: 4096,
      });
    });
  });

  it("refuses a manifest that disagrees with the source row already there", async () => {
    /* The `raw_sources` row is **shared** — every revision that fetched the same
       document points at it — so two manifests claiming different sizes for one
       digest is corruption, not a race to resolve. Two things cannot hash to
       one name. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "fetch");
      const manifest: RawManifest = {
        kind: "html",
        file: "raw.html",
        contentType: "text/html",
        encoding: "utf-8",
        bytes: 10,
        sha256: NETWORK_SHA,
        storedSha256: STORED_SHA,
        // The fixture's row says 29.
        storedBytes: 999,
        fetchedAt: "2026-08-28T00:00:00.000Z",
      };
      await expect(
        writeArtefacts(claimed, tx, SLUG, "fetch", { raw: manifest }, {}),
      ).rejects.toThrow(RawSourceDisagrees);
    });
  });

  it("refuses a manifest whose kind is stored under a different content type", async () => {
    /* The other half of the shared-row comparison. Same digest, same kind, and
       a row saying the object is a PDF — one of the two is describing something
       else. */
    const db = getDb();
    await db
      .update(rawSources)
      .set({ contentType: "application/pdf" })
      .where(and(eq(rawSources.sha256, STORED_SHA), eq(rawSources.kind, "html")));
    try {
      await withClaim(async (tx, claimed) => {
        await begun(tx, claimed, "fetch");
        await expect(
          writeArtefacts(
            claimed,
            tx,
            SLUG,
            "fetch",
            {
              raw: {
                kind: "html",
                file: "raw.html",
                contentType: "text/html; charset=utf-8",
                encoding: "utf-8",
                bytes: 31,
                sha256: NETWORK_SHA,
                storedSha256: STORED_SHA,
                storedBytes: 29,
                fetchedAt: "2026-08-28T00:00:00.000Z",
              },
            },
            {},
          ),
        ).rejects.toThrow(/content type application\/pdf/);
      });
    } finally {
      await db
        .update(rawSources)
        .set({ contentType: "text/html" })
        .where(and(eq(rawSources.sha256, STORED_SHA), eq(rawSources.kind, "html")));
    }
  });

  it("does not restamp a shared source row it has not verified", async () => {
    /* `verified_at` means "when the bytes at this key were last shown to hash to
       it", and this function is handed a *file*. Pointing a revision at a hash
       is not looking at the object. So the existing row's timestamp is left
       exactly where the thing that did verify put it. */
    const db = getDb();
    const [was] = await db
      .select({ verifiedAt: rawSources.verifiedAt })
      .from(rawSources)
      .where(and(eq(rawSources.sha256, STORED_SHA), eq(rawSources.kind, "html")));
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "fetch");
      await writeArtefacts(
        claimed,
        tx,
        SLUG,
        "fetch",
        {
          raw: {
            kind: "html",
            file: "raw.html",
            contentType: "text/html; charset=utf-8",
            encoding: "utf-8",
            bytes: 31,
            sha256: NETWORK_SHA,
            storedSha256: STORED_SHA,
            storedBytes: 29,
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
        },
        {},
      );
      const [now] = await tx
        .select({ verifiedAt: rawSources.verifiedAt })
        .from(rawSources)
        .where(and(eq(rawSources.sha256, STORED_SHA), eq(rawSources.kind, "html")));
      expect(now?.verifiedAt?.toISOString()).toBe(was?.verifiedAt?.toISOString());
    });
  });

  it("dates a new source row from when the object was actually stored", async () => {
    /* Not `now()`. The manifest's `fetchedAt` is when `storeRawSource` did the
       verifying, so it is traceable and never later than the truth — where
       `now()` would certify an object this function has never looked at. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "fetch");
      const fresh = "f6".repeat(32);
      await writeArtefacts(
        claimed,
        tx,
        SLUG,
        "fetch",
        {
          raw: {
            kind: "pdf",
            file: "raw.pdf",
            contentType: "application/pdf",
            encoding: null,
            bytes: 8,
            sha256: NETWORK_SHA,
            storedSha256: fresh,
            storedBytes: 8,
            fetchedAt: "2025-01-02T03:04:05.000Z",
          },
        },
        {},
      );
      const [row] = await tx
        .select({ verifiedAt: rawSources.verifiedAt })
        .from(rawSources)
        .where(and(eq(rawSources.sha256, fresh), eq(rawSources.kind, "pdf")));
      expect(row?.verifiedAt?.toISOString()).toBe("2025-01-02T03:04:05.000Z");
    });
  });

  it("keeps the two byte counts apart, as it keeps the two hashes apart", async () => {
    /* A page that was not UTF-8: the network sent 9000 bytes and we stored
       10000 of decoded text. `raw_sources.bytes` must be the second and
       `raw_byte_count` the first, and swapping them reads perfectly. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "fetch");
      const fresh = "e5".repeat(32);
      await writeArtefacts(
        claimed,
        tx,
        SLUG,
        "fetch",
        {
          raw: {
            kind: "html",
            file: "raw.html",
            url: "https://example.test/shift-jis",
            contentType: "text/html; charset=shift_jis",
            encoding: "shift_jis",
            bytes: 9000,
            sha256: NETWORK_SHA,
            storedSha256: fresh,
            storedBytes: 10000,
            fetchedAt: "2026-08-28T01:02:03.000Z",
          },
        },
        {},
      );
      const [source] = await tx
        .select({ bytes: rawSources.bytes })
        .from(rawSources)
        .where(and(eq(rawSources.sha256, fresh), eq(rawSources.kind, "html")));
      const [row] = await tx
        .select({ count: articleRevisions.rawByteCount })
        .from(articleRevisions)
        .where(eq(articleRevisions.id, claimed.revisionId));
      expect(source?.bytes, "the object's size").toBe(10000);
      expect(row?.count, "what the network sent").toBe(9000);
    });
  });

  it("does no work at all before refusing a write with no run", async () => {
    /* **The order, not just the outcome.** The transaction made a late refusal
       *safe* — everything rolls back — and it was still wrong: this would have
       replaced every block row of the article and inserted a `raw_sources` row
       before discovering a protocol error it could discover first, and any
       database error raised on the way would mask the refusal that explains it.
       Watched red by moving `lockStepRun` back to the end. */
    await withClaim(async (tx, claimed) => {
      const before = await tx
        .select({ id: revisionBlocks.blockId })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, claimed.revisionId));
      await expect(
        writeArtefacts(claimed, tx, SLUG, "blocks", { blocks: { blocks: [] } }, {}),
      ).rejects.toThrow(StepRunNotHeld);
      const after = await tx
        .select({ id: revisionBlocks.blockId })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, claimed.revisionId));
      expect(after, "the delete must not have run").toHaveLength(before.length);
      expect(before).not.toHaveLength(0);
    });
  });

  it("leaves an article with no blocks not-done, from end to end", async () => {
    /* The complete outcome rather than the row count: begin, write nothing,
       finish — and then the three things that have to follow. A `blocks` step
       that produced nothing has not produced its artefact, and everything
       downstream has to agree about that. */
    await withClaim(async (tx, claimed) => {
      const store = pgArtifactsIn(claimed, tx);
      const attempt = await store.beginStep(SLUG, "blocks");
      await store.write(SLUG, "blocks", { blocks: { blocks: [] } }, {});
      await store.finishStep(SLUG, "blocks", attempt);

      expect(await store.read(SLUG, "blocks", "blocks"), "no artefact").toBeNull();
      expect(await store.has(SLUG, "blocks", ["blocks"]), "not done").toBe(false);
      /* And publication refuses independently, so the two guards do not depend
         on each other. */
      await expect(
        publishRevision({ slug: SLUG, revisionId: claimed.revisionId }),
      ).rejects.toThrow();
    });
  });

  it("refuses a write with no run of its own to record", async () => {
    /* No `beginStep`. The artefacts would land with nothing saying a run
       produced them, and `has` would then answer no for ever. */
    await withClaim(async (tx, claimed) => {
      await expect(
        writeArtefacts(claimed, tx, SLUG, "arc", { arc: ARC }, {}),
      ).rejects.toThrow(StepRunNotHeld);
    });
  });

  it("refuses a write from an attempt the job has moved past", async () => {
    /* The job fence, taken by `write` itself. `finishStepRun` takes it too, and
       that is not a reason to leave it out here: "the write is safe because the
       call after it checks" holds until somebody calls the write on its own. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "arc");
      const stale = { ...claimed, attemptId: mintAttempt() };
      /* **`NotTheLiveAttempt`, named.** A bare `rejects.toThrow()` passed with
         the fence deleted, because `recordStamp` refuses a token it does not
         recognise anyway — so the test would have been green about the wrong
         refusal. Naming the error is what makes it about the job fence. */
      await expect(writeArtefacts(stale, tx, SLUG, "arc", { arc: ARC }, {})).rejects.toThrow(
        NotTheLiveAttempt,
      );
    });
  });

  it("leaves the blocks alone when the fence refuses", async () => {
    /* The delete is unconditional, so a fence that refuses *after* it would be
       the worst of both. It refuses first, and this is what says so. */
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "blocks");
      const stale = { ...claimed, attemptId: mintAttempt() };
      await expect(
        writeArtefacts(stale, tx, SLUG, "blocks", { blocks: { blocks: [] } }, {}),
      ).rejects.toThrow();
      const rows = await tx
        .select({ id: revisionBlocks.blockId })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, claimed.revisionId));
      expect(rows, "the delete must not have run").toHaveLength(3);
    });
  });

  it("records the stamp on the running row, where stampFor will find it", async () => {
    await withClaim(async (tx, claimed) => {
      await begun(tx, claimed, "toc");
      /* `toc` has no `PipelineStep.stamp` and must still record an input hash,
         because `reasonsNotToPublish` compares that column against the stored
         blocks. Having no expected stamp and recording no input are different
         things. */
      await writeArtefacts(
        claimed,
        tx,
        SLUG,
        "toc",
        { tree: TREE, labels: LABELS, blocks: { blocks: NEW_BLOCKS } },
        { inputHash: "hash-of-the-blocks" },
      );
      const [row] = await tx
        .select()
        .from(revisionStepRuns)
        .where(
          and(
            eq(revisionStepRuns.revisionId, claimed.revisionId),
            eq(revisionStepRuns.stepName, "toc"),
          ),
        );
      expect(row?.inputHash).toBe("hash-of-the-blocks");
      expect(row?.status, "still running until finishStep says otherwise").toBe("running");
    });
  });
});

when("the store, assembled", () => {
  beforeAll(async () => {
    await cleanUpQuietly();
    await makeFixture();
  }, 60_000);
  afterAll(cleanUp);

  it("runs a step end to end through the interface alone", async () => {
    /* begin → write → finish, the same three calls in the same order as the
       runner, through `ArtifactStore` and nothing else. This is what
       `copyArtefacts` drives (src/store/copy-artefacts.ts), and it is what C7's
       replacement suites will use in place of `db:import`. */
    await withClaim(async (tx, claimed) => {
      const store = pgArtifactsIn(claimed, tx);
      expect(await store.has(SLUG, "arc", ["arc"])).toBe(false);

      const attempt = await store.beginStep(SLUG, "arc");
      expect(await store.interrupted(SLUG, "arc")).toBe(true);

      await store.write(SLUG, "arc", { arc: ARC }, { promptVersion: "arc/1" });
      /* Written but not finished: the artefact is there and the step is not
         done. That distinction is the whole reason `beginStep` exists. */
      expect(await store.has(SLUG, "arc", ["arc"])).toBe(false);

      await store.finishStep(SLUG, "arc", attempt);
      expect(await store.interrupted(SLUG, "arc")).toBe(false);
      expect(await store.has(SLUG, "arc", ["arc"])).toBe(true);
      expect(await store.read(SLUG, "arc", "arc")).toEqual(ARC);
    });
  });

  it("hands back the job's own attempt, not a token of its own", async () => {
    /* `revision_step_runs.attempt_id` is the same value as `jobs.attempt_id` —
       the interface predicted these would "end up being literally the same
       value", and this is the assertion that keeps it true. */
    await withClaim(async (tx, claimed) => {
      const store = pgArtifactsIn(claimed, tx);
      expect(await store.beginStep(SLUG, "arc")).toBe(claimed.attemptId);
    });
  });

  it("refuses to finish a step with somebody else's token", async () => {
    await withClaim(async (tx, claimed) => {
      const store = pgArtifactsIn(claimed, tx);
      await store.beginStep(SLUG, "arc");
      await expect(store.finishStep(SLUG, "arc", mintAttempt())).rejects.toThrow(StepRunNotHeld);
    });
  });

  it("refuses to finish a step that never began", async () => {
    /* The filesystem tolerates this — a step can complete without that store
       having seen it start, which is every CLI run. Nothing on this path can:
       the runner always begins its step, so a finish with nothing to finish is
       a protocol error and a quiet return would leave a step that never reports
       itself done. */
    await withClaim(async (tx, claimed) => {
      const store = pgArtifactsIn(claimed, tx);
      await expect(store.finishStep(SLUG, "arc", claimed.attemptId)).rejects.toThrow(
        StepRunNotHeld,
      );
    });
  });

  it("answers the read-only questions without a transaction", async () => {
    const store = readOnlyPgArtifacts(ref, getDb());
    expect(await store.read(SLUG, "toc", "tree")).toEqual(TREE);
    expect(await store.has(SLUG, "toc", ["tree"])).toBe(false);
    expect(await store.interrupted(SLUG, "toc")).toBe(false);
  });
});
