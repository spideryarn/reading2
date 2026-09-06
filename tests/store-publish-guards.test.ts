/**
 * What `publishRevision` refuses, and the one thing it was letting through.
 *
 * The publication guard is the last thing standing between a failed pipeline
 * run and a reader seeing it as the article. It checks that the draft has
 * blocks, that it has a tree, that `checkTree` is happy, and that the `hierarchy` step
 * ran against *these* blocks rather than some earlier generation.
 *
 * **It never looked at whether that run succeeded.** `revision_step_runs.status`
 * is one of `running`, `done` or `error`, and the guard read the row, compared
 * `input_hash`, and stopped (src/store/pg-revisions.ts). So a `hierarchy` that errored
 * — or one still going — published, as long as the hash beside it matched.
 *
 * Found by GPT Sol while reviewing docs/plans/260827aa-delete-the-importer.md, which
 * proposes a *second* guard of exactly this shape for the raw source reference.
 * That is why this is fixed first and on its own: writing the new guard on top
 * of the same mistake would have doubled it.
 *
 * ## How to watch these go red
 *
 * Delete the `hierarchyRun.status !== "done"` branch from `publishRevision` and
 * *"refuses a tree whose hierarchy run errored"* and *"…is still running"* both fail.
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

import { and, eq } from "drizzle-orm";

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

await pgReady({
  suite: "tests/store-publish-guards.test.ts",
  tables: ["spideryarn.article_revisions"],
});

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

/**
 * The one shape `c8e2cc7e` made illegal: `n1` covers the whole of `n0`'s range
 * and has children of its own, so one rung finer restates the same blocks.
 * Everything else about it is well-formed, so `checkTree` reports exactly one
 * problem and a refusal cannot be about something else.
 */
const RESTATED_RUNG: Tree = {
  version: "toc/1",
  generator: "fixture",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0", depth: 0, parent: null, children: ["n1"],
      range: [BLOCKS[0]!.id, BLOCKS[1]!.id],
      title: "A fixture article",
      gist: "A fixture built by tests/store-publish-guards.test.ts and nothing else.",
    },
    n1: {
      id: "n1", depth: 1, parent: "n0", children: ["n2", "n3"],
      range: [BLOCKS[0]!.id, BLOCKS[1]!.id],
      title: "The rung that says it again",
      gist: "The same two paragraphs as its parent, one rung finer and no finer.",
    },
    n2: {
      id: "n2", depth: 2, parent: "n1", children: [],
      range: [BLOCKS[0]!.id, BLOCKS[0]!.id],
      title: "A paragraph",
      navLabel: "One paragraph of a fixture article that exists only for this test",
    },
    n3: {
      id: "n3", depth: 2, parent: "n1", children: [],
      range: [BLOCKS[1]!.id, BLOCKS[1]!.id],
      title: "A paragraph",
      navLabel: "One paragraph of a fixture article that exists only for this test",
    },
  },
} as Tree;

/** The same defect under a different title, so it is not the same JSON. */
const RESTATED_RUNG_MOVED: Tree = {
  ...RESTATED_RUNG,
  nodes: {
    ...RESTATED_RUNG.nodes,
    n1: { ...RESTATED_RUNG.nodes.n1!, title: "The rung that says it again, differently" },
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
 * The `hierarchy` run this draft will be judged on.
 *
 * `inputHash` is **always** the hash of the blocks that are really there, so the
 * only thing varying between these tests is `status`. Vary two things and a
 * refusal proves nothing about either.
 */
const hierarchyRun = (revisionId: string, status: "running" | "done" | "error") =>
  recordStepRun({
    revisionId,
    stepName: "hierarchy",
    inputHash: HASH,
    implementationVersion: PIPELINE_RUN,
    status,
    startedAt: new Date(),
    finishedAt: status === "running" ? null : new Date(),
  });

/**
 * A draft that is complete in every way except the one under test: blocks, a
 * tree over exactly those blocks, and a `hierarchy` run whose hash matches.
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

describe("the publication guard", () => {
  beforeAll(async () => {
    // A first publication, so later drafts are the ordinary carried-forward
    // shape rather than the first-ever revision of an article.
    const revisionId = await draftReadyToPublish();
    await hierarchyRun(revisionId, "done");
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

  it("refuses a tree whose hierarchy run errored, however well its hash matches", async () => {
    const revisionId = await draftReadyToPublish();
    await hierarchyRun(revisionId, "error");

    await expect(publishRevision({ slug: SLUG, revisionId })).rejects.toThrow(PublishRefused);
  });

  it("refuses a tree whose hierarchy run is still running", async () => {
    const revisionId = await draftReadyToPublish();
    await hierarchyRun(revisionId, "running");

    await expect(publishRevision({ slug: SLUG, revisionId })).rejects.toThrow(PublishRefused);
  });

  it("says which of the two it was, rather than blaming the hash", async () => {
    const revisionId = await draftReadyToPublish();
    await hierarchyRun(revisionId, "error");

    /* The message matters more than usual here. The nearest existing reason
       string blames the hash — "the tree was built from different blocks" —
       and that would send somebody re-running `hierarchy` to fix a `hierarchy` that ran and
       failed. */
    const refusal = await publishRevision({ slug: SLUG, revisionId }).catch((err) => err);
    expect(refusal).toBeInstanceOf(PublishRefused);
    expect((refusal as PublishRefused).message).toContain("error");
    expect((refusal as PublishRefused).message).not.toContain("different blocks");
  });

  it("still publishes a draft whose hierarchy run finished", async () => {
    const revisionId = await draftReadyToPublish();
    await hierarchyRun(revisionId, "done");

    const published = await publishRevision({ slug: SLUG, revisionId });
    expect(published.revisionId).toBe(revisionId);
    expect(published.scalars.blockCount).toBe(BLOCKS.length);
  });
  /* -------------------------------------------------------------------------
     A tree that was legal when it was published, and is not now.

     This is the shape that took `nagel-bat` off the air on 2026-09-05, and it
     is not hypothetical: `c8e2cc7e` added the "no rung may restate its parent"
     rule to `checkTree` that morning, deployed it, and every article whose
     ALREADY-PUBLISHED tree had that shape stopped being able to publish
     anything at all — glossary, quotes, debate, any mode — because
     `beginDraftIn` copies the base tree forward verbatim and
     `reasonsNotToPublish` runs the whole of `checkTree` on it again.

     Four refusals in thirteen minutes on one article, each after its paid model
     call had already completed, each reported to the reader as "trying again is
     worth a go". Which was false: the failure is deterministic and permanent.

     `UPDATE`ing the published tree is exactly what the invariant change did —
     it made a stored tree illegal without anything writing to it. There is no
     other way to get one: the guard refuses to publish it in the first place.
     ------------------------------------------------------------------------- */

  /** The published tree, poisoned in place; returns the good one to put back. */
  async function poisonThePublishedTree(): Promise<() => Promise<void>> {
    const db = getDb();
    const [article] = await db
      .select({ id: articles.id, current: articles.currentRevisionId })
      .from(articles)
      .where(eq(articles.slug, SLUG));
    const current = article?.current;
    if (!current) throw new Error("no published revision to poison — beforeAll did not run");
    await db.update(articleRevisions).set({ tree: RESTATED_RUNG }).where(eq(articleRevisions.id, current));
    return async () => {
      await getDb().update(articleRevisions).set({ tree: TREE }).where(eq(articleRevisions.id, current));
    };
  }

  /**
   * **The red one.** Watched failing before the fix existed, with the sentence
   * production produced verbatim:
   *
   * > `PublishRefused: Refusing to publish "test-publish-guards": n0 → n1: covers
   * > its parent's whole range, so one rung finer restates the same blocks…`
   *
   * There is no `.set({ tree })` here, and that is the whole point: this draft
   * did not touch the tree. It is what a glossary step's draft looks like.
   */
  it("publishes a draft carrying a bad tree it did not change", async () => {
    const putBack = await poisonThePublishedTree();
    try {
      const { revisionId } = await beginRevision({ slug: SLUG });

      const published = await publishRevision({ slug: SLUG, revisionId });
      expect(published.revisionId).toBe(revisionId);
    } finally {
      await putBack();
    }
  });

  /**
   * **The laundering path GPT Sol found before it shipped.**
   *
   * `checkTree` is a function of the *pair* `(blocks, tree)`, so an exemption
   * that compared only the tree would let a draft change its blocks — causing a
   * fresh tree problem — and be waved through because the tree JSON matched.
   * `hashBlocks` would not catch it either: it fingerprints `id`, `text`, `role`
   * and `treatment`, and `checkTree` reads `kind`.
   *
   * This asserts the mechanism rather than one synthesised failure: change a
   * block and the exemption must not apply, so the carried tree's problem is
   * reported exactly as it was before the fix.
   *
   * Watched red by comparing only the tree — which is what the first draft of
   * the fix did.
   */
  it("withholds the exemption from a draft that changed its blocks", async () => {
    const putBack = await poisonThePublishedTree();
    try {
      const { revisionId } = await beginRevision({ slug: SLUG });
      /* One column, on one block, that `hashBlocks` does not fingerprint. The
         tree is untouched and still equal to the base's. */
      await getDb()
        .update(revisionBlocks)
        .set({ kind: "heading" })
        .where(
          and(eq(revisionBlocks.revisionId, revisionId), eq(revisionBlocks.blockId, BLOCKS[0]!.id)),
        );

      const refusal = await publishRevision({ slug: SLUG, revisionId }).catch((err) => err);
      expect(refusal).toBeInstanceOf(PublishRefused);
      expect((refusal as PublishRefused).message).toContain("covers its parent's whole range");
    } finally {
      await putBack();
    }
  });

  /* The other half, and the reason the exemption is narrow: a publication that
     ALTERS the tree is judged on the tree it is proposing, however bad the one
     it inherited was. Without this, the fix above would be a way to launder a
     broken tree into an article by starting from a broken one. */
  it("still refuses a bad tree that this draft actually changed", async () => {
    const putBack = await poisonThePublishedTree();
    try {
      const { revisionId } = await beginRevision({ slug: SLUG });
      /* Same defect, different tree: one extra leaf under the restated rung, so
         it cannot be mistaken for the carried-forward one. */
      await getDb()
        .update(articleRevisions)
        .set({ tree: RESTATED_RUNG_MOVED })
        .where(eq(articleRevisions.id, revisionId));

      const refusal = await publishRevision({ slug: SLUG, revisionId }).catch((err) => err);
      expect(refusal).toBeInstanceOf(PublishRefused);
      expect((refusal as PublishRefused).message).toContain("covers its parent's whole range");
    } finally {
      await putBack();
    }
  });
});
