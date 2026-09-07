/**
 * **A tree written with an empty manifest beside it takes the `labels` receipt
 * with it — and that deletion is the whole of this design's freshness check.**
 *
 * Stage 2 of docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md
 * splits the label pass out of `hierarchy`. `hierarchy` now writes a
 * `PendingLabelsFile` (src/labels.ts — the three hashes and `batches: null`),
 * and the `labels` step writes the real one later, in a free successor job.
 *
 * ## The P0 this file exists for, which two reviewers found independently
 *
 * **Receipts are inherited.** `beginDraftIn` (src/store/pg-revisions.ts) copies
 * *every* `revision_step_runs` row forward into a new draft, in the same
 * transaction as the columns. So a **second** ingest of an article that already
 * has labels begins holding a `labels = done` receipt, and then `hierarchy`
 * overwrites the labels column underneath it. Two ways that ends badly, and
 * neither of them looks like this test:
 *
 * - the blocks changed, so the carried row's `input_hash` and the fresh
 *   manifest's `sourceHash` disagree, and `stampForStep` **throws** — inside
 *   `stepIsDone`, before `runStep`'s catch, so it escapes as a 409 and leaves
 *   the claim to recovery;
 * - or the two happen to agree and the labels step **skips**, leaving the empty
 *   manifest permanently. That one is silent, and the reader sees *"Paragraph
 *   labels are still arriving"* for ever. docs/reusable/silent-success.md.
 *
 * The fix is one statement in the transaction that creates the inconsistency:
 * `writeArtefacts` reads `parts.labels.batches === null` and deletes this
 * revision's `labels` receipt, atomically with the artefacts and the `pending`
 * status. **Keyed on the artefact, never on the step's name** — Fable's
 * relocation, 2026-09-06 — so the rule follows the manifest rather than
 * whoever wrote it, and the next writer of the tree (the deepening wave) is
 * refused by the store rather than expected to remember a convention.
 *
 * ## Two block sets, because one of them proves nothing
 *
 * The first draft of this file re-ingested the *same* blocks, and under that
 * fixture removing the deletion reddened one case out of seven — the row itself.
 * `stepIsDone` went on answering `false` anyway, for a reason that is not the
 * deletion: a `PendingLabelsFile` carries no `version` and no `generator`, so
 * the stamp `stampForStep` assembles is missing two of the three fields
 * `STEPS.labels.stamp` declares, and `sameStamp` refuses to call that current.
 * That is real, and it is what closes the *skip* half of the P0 — but it is the
 * union doing the work, not the deletion, and a test that cannot tell them apart
 * is docs/reusable/silent-success.md with the instrument as the casualty.
 *
 * So `BLOCKS_V2` exists. A real re-ingest re-extracts, which is what makes the
 * carried row's `input_hash` and the fresh manifest's `sourceHash` disagree —
 * and *that* is the arm the deletion alone can close, because a disagreement
 * between the row and the artefact makes `stampForStep` **throw** rather than
 * answer.
 *
 * ## The mutation, 2026-09-06
 *
 * The `await tx.delete(revisionStepRuns)…` block in `writeArtefacts` was made
 * unreachable (`if (false as boolean)`). Three cases went red:
 *
 *     × deletes this revision's labels receipt when a pending manifest lands
 *       → expected 'done' to be undefined
 *     × leaves stampForStep(labels) answering rather than throwing
 *       → promised not to throw: StampDisagrees
 *     × leaves stepIsDone(labels) false rather than throwing out of the claim
 *       → promised not to throw: StampDisagrees
 *
 * The rest stayed green and should have: they assert the status column, the
 * `tree`-without-`labels` refusal, the `ready` arm and the same-blocks skip,
 * none of which the deletion is what closes. Read them as the surroundings.
 *
 * ## Why it drives the real machinery
 *
 * `beginStep` / `write` / `finishStep` through `pgArtifactsIn`, inside a claim,
 * exactly as src/jobs.ts runs a step — so the `done` row it starts from is one
 * the fenced write path actually produced, and the deletion is one a real
 * `hierarchy` write performs. The shape is copied from
 * tests/shared-site-run-row-gate.test.ts, which explains the harness at length.
 * Everything happens inside a transaction that is rolled back.
 */
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs, revisionStepRuns } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import type { CompletedLabelsFile, PendingLabelsFile } from "../src/labels.js";
import { STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import { pgArtifactsIn, readsPgArtifacts, stampForStep } from "../src/store/artifacts-pg.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import { mintAttempt } from "../src/store/jobs.js";
import type { Block, JobStep, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

await pgReady({
  suite: "tests/labels-receipt-invalidation.test.ts",
  tables: ["spideryarn.article_revisions", "spideryarn.revision_step_runs"],
});

/** One run's suffix, so two processes cannot delete each other's article. */
const RUN = randomUUID().slice(0, 8);
const SLUG = `test-labels-receipt-${RUN}`;
const OWNER_ID = ADMIN_USER_ID_LOCAL;

const B1 = mintId();
const B2 = mintId();

const BLOCKS: Block[] = [
  { id: B1, tag: "p", kind: "text", text: "first", words: 1, html: "<p>first</p>", gistable: true },
  { id: B2, tag: "p", kind: "text", text: "second", words: 1, html: "<p>second</p>", gistable: true },
];

/**
 * **The same article, re-extracted** — which is the whole of what makes a second
 * ingest dangerous rather than merely redundant. The ids are stable (that is the
 * contract, docs/project/block-ids.md); the text is not, so `hashBlocks`
 * disagrees, and the `labels` row carried forward by `beginDraftIn` is stamped
 * against the first hash while the fresh manifest carries the second.
 */
const BLOCKS_V2: Block[] = [
  { id: B1, tag: "p", kind: "text", text: "first, revised", words: 2, html: "<p>first, revised</p>", gistable: true },
  { id: B2, tag: "p", kind: "text", text: "second", words: 1, html: "<p>second</p>", gistable: true },
];

const BLOCKS_HASH = hashBlocks(BLOCKS);
const BLOCKS_V2_HASH = hashBlocks(BLOCKS_V2);

function treeSaying(labelled: boolean): Tree {
  return {
    version: "toc/3",
    generator: "claude-sonnet-5",
    slug: SLUG,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        parentId: null,
        depth: 0,
        range: [B1, B2],
        title: "All of it",
        childIds: [],
        ...(labelled ? { navLabel: "the opening" } : {}),
      },
    },
  } as unknown as Tree;
}

/** What a real label run leaves behind: provenance, and the calls that made it. */
const DONE: CompletedLabelsFile = {
  version: "labels/2",
  generator: "claude-sonnet-5",
  slug: SLUG,
  sourceHash: BLOCKS_HASH,
  structureHash: "hash-of-the-tree",
  structureVersion: "toc/3",
  labels: { [B1]: "the opening", [B2]: "the close" },
  batches: [],
};

/**
 * What `generateHierarchy` writes now: the hashes it knows, and nothing a model
 * produced. `batches: null` is the discriminant.
 */
function pendingOver(sourceHash: string): PendingLabelsFile {
  return {
    slug: SLUG,
    sourceHash,
    structureHash: `hash-of-a-freshly-cut-tree-over-${sourceHash}`,
    structureVersion: "toc/3",
    labels: {},
    batches: null,
  };
}

let ref: JobDraftRef;
let articleId: string;

beforeAll(async () => {
  const db = getDb();
  const [article] = await db.insert(articles).values({ ownerId: OWNER_ID, slug: SLUG }).returning();
  if (!article) throw new Error("could not create the fixture article");
  articleId = article.id;

  const [revision] = await db
    .insert(articleRevisions)
    .values({
      articleId: article.id,
      status: "draft",
      title: "A Piece Whose Labels Are Bought Separately",
      extractedHtml: "<p>first</p><p>second</p>",
    })
    .returning();
  if (!revision) throw new Error("could not create the fixture revision");

  ref = {
    slug: SLUG,
    articleId: article.id,
    revisionId: revision.id,
    /* Replaced per claim by `withClaim`. Minted rather than written down, because
       tests/fixture-ids.test.ts reads every uuid literal in a file. */
    jobId: randomUUID(),
    attemptId: randomUUID(),
  };
}, 60_000);

afterAll(async () => {
  const db = getDb();
  if (articleId) {
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, articleId));
    await db.delete(articleRevisions).where(eq(articleRevisions.articleId, articleId));
    await db.delete(articles).where(eq(articles.id, articleId));
  }
  await closeDb();
});

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class RollBack extends Error {}

const JOB_STEPS: JobStep[] = [
  { name: "hierarchy", label: "Building the hierarchy", status: "pending" },
  { name: "labels", label: "Labelling the paragraphs", status: "pending" },
];

async function withClaim(body: (tx: Tx, claimed: JobDraftRef) => Promise<void>): Promise<void> {
  const id = mintId();
  const attemptId = mintAttempt();
  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(jobs).values({
        id,
        ownerId: OWNER_ID,
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

/** The `labels` step, through the path src/jobs.ts uses: begin, write, finish. */
async function runLabelsStep(tx: Tx, claimed: JobDraftRef): Promise<void> {
  const store = pgArtifactsIn(claimed, tx);
  const attempt = await store.beginStep(SLUG, "labels");
  await store.write(
    SLUG,
    "labels",
    { labels: DONE, tree: treeSaying(true) },
    { inputHash: BLOCKS_HASH, promptVersion: DONE.version, model: DONE.generator },
  );
  await store.finishStep(SLUG, "labels", attempt);
}

/**
 * Stage 3, so there are block rows to hash. `hierarchy` writes its own copy of
 * them too, and both point at the same rows (`STORAGE`, src/store/artifacts-pg.ts).
 */
async function runBlocksStep(tx: Tx, claimed: JobDraftRef, blocks = BLOCKS): Promise<void> {
  const store = pgArtifactsIn(claimed, tx);
  const attempt = await store.beginStep(SLUG, "blocks");
  await store.write(
    SLUG,
    "blocks",
    {
      blocks: { blocks },
      stampedHtml: blocks.map((b) => `<p id="${b.id}">${b.text}</p>`).join(""),
    },
    /* `{}` — this step stamps nothing at all (`STAMP_SOURCE.blocks` is `null`),
       and the argument is required rather than optional so that saying so is
       deliberate. */
    {},
  );
  await store.finishStep(SLUG, "blocks", attempt);
}

/**
 * A second `hierarchy` run, exactly as the step performs it — the pending
 * manifest, the freshly cut tree and stage 4's copy of the blocks, in one write.
 */
async function runHierarchyStep(
  tx: Tx,
  claimed: JobDraftRef,
  blocks = BLOCKS,
): Promise<void> {
  const store = pgArtifactsIn(claimed, tx);
  const hash = hashBlocks(blocks);
  const attempt = await store.beginStep(SLUG, "hierarchy");
  await store.write(
    SLUG,
    "hierarchy",
    { tree: treeSaying(false), labels: pendingOver(hash), blocks: { blocks } },
    { inputHash: hash },
  );
  await store.finishStep(SLUG, "hierarchy", attempt);
}

/**
 * A second ingest's stage 4, as far as this file cares: the tree re-cut over
 * re-extracted blocks. The `labels` row from the first ingest is what
 * `beginDraftIn` would have carried into the new draft; here it is simply still
 * there, which is the same state by a shorter route.
 *
 * **Stage 3 is deliberately not re-run**, and the reason is the harness rather
 * than the design: `beginStepRun`'s `setWhere` refuses to reopen a row *this
 * same attempt* has already ended (src/store/pg-revisions.ts — GPT Sol's finding
 * 4), so a second `blocks` run inside one claim throws `StepRunNotHeld` before
 * any of this file's claims are reached. A real re-ingest is a new attempt on a
 * new draft. It costs nothing to skip: `hierarchy` writes stage 4's own copy of
 * the blocks, and `STORAGE` points both steps at the same rows, so the new
 * blocks land here exactly as they would have.
 */
async function reIngest(tx: Tx, claimed: JobDraftRef): Promise<void> {
  await runHierarchyStep(tx, claimed, BLOCKS_V2);
}

async function runRow(tx: Tx, step: "labels" | "hierarchy") {
  const [row] = await tx
    .select()
    .from(revisionStepRuns)
    .where(
      and(eq(revisionStepRuns.revisionId, ref.revisionId), eq(revisionStepRuns.stepName, step)),
    )
    .limit(1);
  return row;
}

async function statusOf(tx: Tx): Promise<string | undefined> {
  const [row] = await tx
    .select({ navLabelStatus: articleRevisions.navLabelStatus })
    .from(articleRevisions)
    .where(eq(articleRevisions.id, ref.revisionId))
    .limit(1);
  return row?.navLabelStatus;
}

/** Nothing here sends the article anywhere, so there is no prefix to pay for. */
const ctx: StepContext = {
  slug: SLUG,
  report: () => {},
  signal: new AbortController().signal,
  cacheArticle: false,
};

describe("a re-ingest, which is where the receipt turns dangerous", () => {
  it("really does start from a done receipt and a ready revision", async () => {
    /* The premise, asserted rather than assumed: a completed run leaves a `done`
       receipt and `ready`, and `beginDraftIn` copies every such row forward.
       Every case below is "and then this is undone", which a broken harness
       satisfies for free. */
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      await runLabelsStep(tx, claimed);
      expect((await runRow(tx, "labels"))?.status).toBe("done");
      expect((await runRow(tx, "labels"))?.inputHash).toBe(BLOCKS_HASH);
      expect(await statusOf(tx)).toBe("ready");
    });
  });

  it("deletes this revision's labels receipt when a pending manifest lands", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      await runLabelsStep(tx, claimed);
      /* The write that creates the inconsistency and the write that resolves it
         are the same write — and it is not the `labels` step making it. */
      await reIngest(tx, claimed);
      expect((await runRow(tx, "labels"))?.status).toBeUndefined();
      /* `hierarchy`'s own receipt is untouched. The rule is keyed on the
         artefact, and it deletes one row rather than every row. */
      expect((await runRow(tx, "hierarchy"))?.status).toBe("done");
    });
  });

  it("says pending, atomically with the artefacts", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      await runLabelsStep(tx, claimed);
      await reIngest(tx, claimed);
      expect(await statusOf(tx)).toBe("pending");
    });
  });

  it("leaves stampForStep(labels) answering rather than throwing", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      await runLabelsStep(tx, claimed);
      await reIngest(tx, claimed);
      /* **The arm the deletion alone closes.** With the row still there it
         records `input_hash = BLOCKS_HASH` while the fresh manifest carries
         `BLOCKS_V2_HASH`, and `stampForStep` throws `StampDisagrees` on that
         clash rather than answering — inside `stepIsDone`, before `runStep`'s
         catch, so it escapes as a 409 and leaves the claim to recovery. With the
         row gone there is nothing left to disagree. */
      const stamp = await stampForStep(claimed, tx, SLUG, "labels");
      expect(stamp).toEqual({ inputHash: BLOCKS_V2_HASH });
    });
  });

  it("leaves stepIsDone(labels) false rather than throwing out of the claim", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      await runLabelsStep(tx, claimed);
      const reads = readsPgArtifacts(claimed, tx);
      /* The premise, at the altitude that costs something: with the receipt in
         place and nothing having moved, the step correctly skips. */
      expect(await stepIsDone(STEPS.labels, ctx, reads)).toBe(true);
      await reIngest(tx, claimed);
      /* And afterwards it is `false` — reached through `has`, which is false
         because the row is gone, so nothing ever reads a stamp. Without the
         deletion this line does not merely answer `true`; it **throws**, which
         is the worse of the two failures. */
      expect(await stepIsDone(STEPS.labels, ctx, reads)).toBe(false);
    });
  });
});

describe("a re-cut over the same blocks", () => {
  /**
   * The other half of the P0, and it is the **union** that closes this one
   * rather than the deletion — worth its own case so the two are not confused.
   *
   * A `hierarchy` re-run that changes nothing but the section boundaries leaves
   * the carried row and the fresh manifest agreeing on `sourceHash`, so there is
   * no clash to throw on. What stops the labels step skipping is that a
   * `PendingLabelsFile` carries no `version` and no `generator`: the stamp
   * `stampForStep` assembles is missing two of the three fields
   * `STEPS.labels.stamp` declares, and `sameStamp` refuses to call that current.
   */
  it("still does not let the labels step skip itself", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      await runLabelsStep(tx, claimed);
      const reads = readsPgArtifacts(claimed, tx);
      expect(await stepIsDone(STEPS.labels, ctx, reads)).toBe(true);
      /* Same blocks, so the hashes agree — the case the deletion cannot be
         credited with. */
      await runHierarchyStep(tx, claimed);
      expect(await stepIsDone(STEPS.labels, ctx, reads)).toBe(false);
      expect(await statusOf(tx)).toBe("pending");
    });
  });
});

describe("a completed manifest", () => {
  it("says ready, whichever step wrote it", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      await runHierarchyStep(tx, claimed);
      expect(await statusOf(tx)).toBe("pending");
      await runLabelsStep(tx, claimed);
      expect(await statusOf(tx)).toBe("ready");
      expect((await runRow(tx, "labels"))?.status).toBe("done");
    });
  });
});

describe("a tree with no manifest beside it", () => {
  /**
   * The refusal that makes the rule above a rule rather than a habit. The next
   * writer of this column is the deepening wave, which re-cuts the tree
   * *without* running `hierarchy`; under a convention living inside one step's
   * `run` it would have had to remember. Here the store refuses it.
   */
  it("is refused, naming what the writer has to decide", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      const store = pgArtifactsIn(claimed, tx);
      const attempt = await store.beginStep(SLUG, "hierarchy");
      await expect(
        store.write(SLUG, "hierarchy", { tree: treeSaying(true) }, { inputHash: BLOCKS_HASH }),
      ).rejects.toThrow(/tree was written with no labels manifest/);
      void attempt;
    });
  });
});
