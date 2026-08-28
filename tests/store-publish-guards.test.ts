/**
 * What `publishRevision` refuses, and the one thing it was letting through.
 *
 * The publication guard is the last thing standing between a failed pipeline
 * run and a reader seeing it as the article. It checks that the draft has
 * blocks, that it has a tree, that `checkTree` is happy, and that the `toc` step
 * ran against *these* blocks rather than some earlier generation.
 *
 * **It never looked at whether that run succeeded.** `revision_step_runs.status`
 * is one of `running`, `done` or `error`, and the guard read the row, compared
 * `input_hash`, and stopped (src/store/pg-revisions.ts). So a `toc` that errored
 * — or one still going — published, as long as the hash beside it matched.
 *
 * Found by GPT Sol while reviewing docs/plans/delete-the-importer.md, which
 * proposes a *second* guard of exactly this shape for the raw source reference.
 * That is why this is fixed first and on its own: writing the new guard on top
 * of the same mistake would have doubled it.
 *
 * ## How to watch these go red
 *
 * Delete the `toc.status !== "done"` branch from `publishRevision` and
 * *"refuses a tree whose toc run errored"* and *"…is still running"* both fail.
 * Both were watched failing that way before the branch existed.
 *
 * The happy-path case is here for a reason rather than for symmetry: a guard
 * that refuses everything also passes both refusal tests, and the way to notice
 * is to keep something that must still be allowed through in the same file.
 *
 * Skips loudly when there is no database, for the reason tests/db-schema.test.ts
 * explains at length: a skipped test protects nothing, so the run must say
 * "skipped" rather than "passed".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  revisionBlocks,
} from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { hashBlocks } from "../src/source-hash.js";
import {
  PublishRefused,
  beginRevision,
  publishRevision,
  recordStepRun,
} from "../src/store/pg-revisions.js";
import { PIPELINE_RUN } from "../src/store/revisions.js";
import type { Block, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "test-publish-guards";

/* ---------------------------------------------------- is there a database -- */

const { reachable } = await pgReady({
  suite: "tests/store-publish-guards.test.ts",
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

const BLOCKS: Block[] = [
  block("spya-pgaaa2", "The opening paragraph of an article that exists only for this test."),
  block("spya-pgaaa3", "The closing paragraph, which says nothing either."),
];

const HASH = hashBlocks(BLOCKS);

/** One root over one leaf per block — the smallest shape `checkTree` accepts. */
const TREE: Tree = {
  version: "toc/1",
  generator: "fixture",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1", "n2"],
      range: [BLOCKS[0]!.id, BLOCKS[1]!.id],
      title: "A fixture article",
      gist: "A fixture built by tests/store-publish-guards.test.ts and nothing else.",
    },
    ...Object.fromEntries(
      BLOCKS.map((b, i) => [
        `n${i + 1}`,
        {
          id: `n${i + 1}`,
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

async function writeBlocks(articleId: string, revisionId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(blockIdentities)
    .values(BLOCKS.map((b) => ({ articleId, blockId: b.id })))
    .onConflictDoNothing();
  await db.delete(revisionBlocks).where(eq(revisionBlocks.revisionId, revisionId));
  await db.insert(revisionBlocks).values(
    BLOCKS.map((b, i) => ({
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

/**
 * The `toc` run this draft will be judged on.
 *
 * `inputHash` is **always** the hash of the blocks that are really there, so the
 * only thing varying between these tests is `status`. Vary two things and a
 * refusal proves nothing about either.
 */
const tocRun = (revisionId: string, status: "running" | "done" | "error") =>
  recordStepRun({
    revisionId,
    stepName: "toc",
    inputHash: HASH,
    implementationVersion: PIPELINE_RUN,
    status,
    startedAt: new Date(),
    finishedAt: status === "running" ? null : new Date(),
  });

/**
 * A draft that is complete in every way except the one under test: blocks, a
 * tree over exactly those blocks, and a `toc` run whose hash matches.
 */
async function draftReadyToPublish(): Promise<string> {
  const { articleId, revisionId } = await beginRevision({ slug: SLUG });
  await writeBlocks(articleId, revisionId);
  await getDb()
    .update(articleRevisions)
    .set({ title: "A fixture article", tree: TREE })
    .where(eq(articleRevisions.id, revisionId));
  return revisionId;
}

/* ------------------------------------------------------------------ tests -- */

when("the publication guard", () => {
  beforeAll(async () => {
    // A first publication, so later drafts are the ordinary carried-forward
    // shape rather than the first-ever revision of an article.
    const revisionId = await draftReadyToPublish();
    await tocRun(revisionId, "done");
    await publishRevision({ slug: SLUG, revisionId });
  }, 60_000);

  afterAll(async () => {
    const db = getDb();
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    const id = rows[0]?.id;
    if (id) {
      // The pointer lets go first, or the revision cannot cascade away.
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await db.delete(articles).where(eq(articles.id, id));
    }
    await closeDb();
  });

  it("refuses a tree whose toc run errored, however well its hash matches", async () => {
    const revisionId = await draftReadyToPublish();
    await tocRun(revisionId, "error");

    await expect(publishRevision({ slug: SLUG, revisionId })).rejects.toThrow(PublishRefused);
  });

  it("refuses a tree whose toc run is still running", async () => {
    const revisionId = await draftReadyToPublish();
    await tocRun(revisionId, "running");

    await expect(publishRevision({ slug: SLUG, revisionId })).rejects.toThrow(PublishRefused);
  });

  it("says which of the two it was, rather than blaming the hash", async () => {
    const revisionId = await draftReadyToPublish();
    await tocRun(revisionId, "error");

    /* The message matters more than usual here. The nearest existing reason
       string blames the hash — "the tree was built from different blocks" —
       and that would send somebody re-running `toc` to fix a `toc` that ran and
       failed. */
    const refusal = await publishRevision({ slug: SLUG, revisionId }).catch((err) => err);
    expect(refusal).toBeInstanceOf(PublishRefused);
    expect((refusal as PublishRefused).message).toContain("error");
    expect((refusal as PublishRefused).message).not.toContain("different blocks");
  });

  it("still publishes a draft whose toc run finished", async () => {
    const revisionId = await draftReadyToPublish();
    await tocRun(revisionId, "done");

    const published = await publishRevision({ slug: SLUG, revisionId });
    expect(published.revisionId).toBe(revisionId);
    expect(published.scalars.blockCount).toBe(BLOCKS.length);
  });
});
