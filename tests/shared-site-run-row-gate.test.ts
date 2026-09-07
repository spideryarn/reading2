/**
 * **Two steps, one storage site, and doneness that is still each step's own.**
 *
 * `STORAGE` in src/store/artifacts-pg.ts maps `blocks`/`blocks` and
 * `hierarchy`/`blocks` to the *same rows* — its own comment says so in as many
 * words: *"The same rows as `blocks`/`blocks` above, not a second copy."* On
 * disk those were two files; in Postgres there is one set of block rows and two
 * steps that both call it theirs.
 *
 * ## What this file pins
 *
 * That sharing a site does **not** share doneness. `hasArtefacts` asks two
 * questions and the second one is per-step: every requested kind must read
 * back, *and* `revision_step_runs` must hold a `done` row **for the asking
 * step**. So when `blocks` writes the block rows, `hierarchy` does not become
 * done by proximity — its own row is still absent, `has` still says no, and
 * `stepIsDone` (src/pipeline.ts) therefore still says no, because `hierarchy`
 * has neither a `stamp` nor an `isDone` and is exactly `interrupted → has`.
 *
 * ## Why it exists
 *
 * Because a design may want to put a second step's artefact at a site the first
 * one already writes — that is what the `blocks`/`hierarchy` pair already is —
 * and the whole safety of doing so rests on this one line. If it went, the
 * failure would be silent and expensive in the direction that matters: a job of
 * `["blocks", "hierarchy"]` would run stage 3, find "hierarchy's" blocks
 * sitting there, skip stage 4, and publish last week's tree over this week's
 * blocks under a row of green ticks — `arc` entries silently dropped wherever a
 * range no longer matches a node (src/web/tree.ts), which is the exact hazard
 * the `hierarchy` stamp was withdrawn to avoid.
 *
 * tests/store-artefacts-pg.test.ts already covers the run row *per step* — no
 * row, `running`, `error`. It never crosses two steps at one site, which is the
 * property a shared-site design actually depends on, and the one thing it can
 * get wrong that nothing else here would notice.
 *
 * ## The mutation, 2026-09-06
 *
 * `if (run?.status !== "done") return false;` in `hasArtefacts` was replaced
 * with `void run;` — the artefact's presence alone deciding — and three of the
 * five cases below went red, each on an assertion rather than a timeout:
 * `expected true to be false`, twice from `has("hierarchy", ["blocks"])` with
 * no hierarchy row anywhere, and once from `stepIsDone(STEPS.hierarchy, …)`
 * with the whole of stage 4 unrun. The line was then put back exactly.
 *
 * The two that stayed green are the first two, and they should have: they
 * assert the *sharing* — that the map really does point both steps at one site
 * and that the rows read back under either name — which the mutation does not
 * touch. Read them as the premise; the last three are the claim.
 *
 * ## Why it drives the real machinery rather than inserting rows
 *
 * `beginStep` / `write` / `finishStep` through `pgArtifactsIn`, inside a claim,
 * exactly as src/jobs.ts runs a step — so the `done` row is one the fenced
 * write path actually produced. A hand-written `revision_step_runs` insert would
 * assert that this file can spell the row, which is a different claim and a
 * weaker one. Everything happens inside a transaction that is rolled back, so
 * there is nothing to clean up but the fixture article.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import type { LabelsFile } from "../src/labels.js";
import { STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { hashBlocks } from "../src/source-hash.js";
import {
  hasArtefacts,
  pgArtifactsIn,
  readArtefact,
  readsPgArtifacts,
  STORAGE,
} from "../src/store/artifacts-pg.js";
import type { JobDraftRef } from "../src/store/artifacts-pg.js";
import { mintAttempt } from "../src/store/jobs.js";
import type { Block, JobStep, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

await pgReady({
  suite: "tests/shared-site-run-row-gate.test.ts",
  tables: ["spideryarn.article_revisions", "spideryarn.revision_step_runs"],
});

/**
 * One run's suffix, so two processes running this file cannot delete each
 * other's article — tests/fixture-ids.test.ts § *the same file, in two
 * processes*, which no static guard can see.
 */
const RUN = randomUUID().slice(0, 8);
const SLUG = `test-shared-site-gate-${RUN}`;

/** Greg's `auth.users` row in the local stack, imported rather than typed out. */
const OWNER_ID = ADMIN_USER_ID_LOCAL;

/* Minted, not written down, for the same reason the slug is. */
const B1 = mintId();
const B2 = mintId();

const BLOCKS: Block[] = [
  { id: B1, tag: "p", kind: "text", text: "first", words: 1, html: "<p>first</p>", gistable: true },
  { id: B2, tag: "p", kind: "text", text: "second", words: 1, html: "<p>second</p>", gistable: true },
];

const STAMPED_HTML = `<p id="${B1}">first</p><p id="${B2}">second</p>`;

const TREE: Tree = {
  version: "toc/3",
  generator: "claude-sonnet-5",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: { id: "n0", parentId: null, depth: 0, range: [B1, B2], title: "All of it", childIds: [] },
  },
} as unknown as Tree;

/**
 * `sourceHash` is `hashBlocks(BLOCKS)` on purpose.
 *
 * `STAMP_SOURCE.hierarchy` is `labels` (src/store/artifacts.ts), so
 * `assertStampAgrees` compares this against the `inputHash` handed to `write` —
 * and more to the point, a labels file describing *these* blocks is what makes
 * the fourth case below about the run row and nothing else.
 */
const LABELS: LabelsFile = {
  version: "labels/2",
  generator: "claude-haiku-4-5-20251001",
  slug: SLUG,
  sourceHash: hashBlocks(BLOCKS),
  structureHash: "hash-of-the-tree",
  structureVersion: "toc/3",
  labels: { [B1]: "the opening" },
  batches: null,
} as unknown as LabelsFile;

/**
 * A draft holding `tree` and `labels` in its columns with **no run rows at
 * all** — which is not a contrived state: it is exactly what `beginDraftIn`
 * leaves behind when it carries the published revision's columns into a new
 * draft. The block rows are deliberately absent, because the `blocks` step is
 * about to write them.
 */
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
      title: "A Piece With Two Steps Over One Site",
      extractedHtml: "<p>first</p><p>second</p>",
      tree: TREE,
      labels: LABELS,
    })
    .returning();
  if (!revision) throw new Error("could not create the fixture revision");

  ref = {
    slug: SLUG,
    articleId: article.id,
    revisionId: revision.id,
    /* Replaced per claim by `withClaim` below, and nothing reads these two —
       but they are minted rather than written down, because
       tests/fixture-ids.test.ts reads **every** uuid literal in a file and the
       obvious `0000…0001` placeholder is already taken by
       tests/store-artefacts-pg.test.ts. It caught exactly that here. */
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
  { name: "blocks", label: "Splitting into blocks", status: "pending" },
  { name: "hierarchy", label: "Building the hierarchy", status: "pending" },
];

/**
 * A live claim on the fixture draft, and everything it touches rolled back.
 *
 * `writeArtefacts` and `finishStepRun` both fence on a running job that owns
 * this draft, so there has to be a real `jobs` row; committing one would make
 * this file mutually exclusive with anything else wanting `jobs_active_slug` for
 * the slug. The throw at the end rolls the lot back, which is also why each case
 * builds the state it needs from scratch rather than inheriting the last one's.
 *
 * Copied in shape from tests/store-artefacts-pg.test.ts, which explains it at
 * length.
 */
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

/** Stage 3, through the path src/jobs.ts uses: begin, write, finish. */
async function runBlocksStep(tx: Tx, claimed: JobDraftRef): Promise<void> {
  const store = pgArtifactsIn(claimed, tx);
  const attempt = await store.beginStep(SLUG, "blocks");
  await store.write(SLUG, "blocks", { blocks: { blocks: BLOCKS }, stampedHtml: STAMPED_HTML }, {});
  await store.finishStep(SLUG, "blocks", attempt);
}

/**
 * Stage 4, the same way — and it writes `blocks` too, which is the point.
 *
 * The `inputHash` is not optional decoration: `hierarchy` has no
 * `PipelineStep.stamp`, and `reasonsNotToPublish` compares this column against
 * the stored blocks, so the runner has to supply it (src/pipeline.ts § the
 * `hierarchy` step).
 */
async function runHierarchyStep(tx: Tx, claimed: JobDraftRef): Promise<void> {
  const store = pgArtifactsIn(claimed, tx);
  const attempt = await store.beginStep(SLUG, "hierarchy");
  await store.write(
    SLUG,
    "hierarchy",
    { tree: TREE, labels: LABELS, blocks: { blocks: BLOCKS } },
    { inputHash: hashBlocks(BLOCKS) },
  );
  await store.finishStep(SLUG, "hierarchy", attempt);
}

/** Nothing here sends the article anywhere, so there is no prefix to pay for. */
const ctx: StepContext = {
  slug: SLUG,
  report: () => {},
  signal: new AbortController().signal,
  cacheArticle: false,
};

describe("two steps that share one storage site", () => {
  it("really do share it, which is what makes the rest of this file worth having", () => {
    /* Asserted rather than assumed. If the map ever gave `hierarchy` its own
       place for blocks, every case below would go on passing while testing
       nothing — the shape docs/reusable/silent-success.md is about. */
    expect(STORAGE.blocks.blocks).toEqual({ at: "blocks" });
    expect(STORAGE.hierarchy.blocks).toEqual({ at: "blocks" });
    expect(STORAGE.hierarchy.blocks).toEqual(STORAGE.blocks.blocks);
  });

  it("hands the same rows back under either step's name", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      const asBlocks = await readArtefact(claimed, tx, SLUG, "blocks", "blocks");
      const asHierarchy = await readArtefact(claimed, tx, SLUG, "hierarchy", "blocks");
      expect(asBlocks?.blocks.map((b) => b.id)).toEqual([B1, B2]);
      /* One artefact, two names. This is what stops the next case being
         explicable by "hierarchy's blocks simply are not there". */
      expect(asHierarchy).toEqual(asBlocks);
    });
  });

  it("does not let one step's write make the other step done", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      expect(await hasArtefacts(claimed, tx, SLUG, "blocks", ["blocks"])).toBe(true);
      /* The artefact is there — the case above proves it reads back under this
         very step's name — and `has` still says no, because
         `revision_step_runs` holds no `hierarchy` row. Doneness is the asking
         step's own row, never the artefact's presence. */
      expect(await hasArtefacts(claimed, tx, SLUG, "hierarchy", ["blocks"])).toBe(false);
    });
  });

  it("flips once the second step's own run finishes", async () => {
    await withClaim(async (tx, claimed) => {
      await runBlocksStep(tx, claimed);
      expect(await hasArtefacts(claimed, tx, SLUG, "hierarchy", ["blocks"])).toBe(false);
      await runHierarchyStep(tx, claimed);
      expect(await hasArtefacts(claimed, tx, SLUG, "hierarchy", ["blocks"])).toBe(true);
      expect(await hasArtefacts(claimed, tx, SLUG, "hierarchy", ["tree", "labels", "blocks"])).toBe(
        true,
      );
    });
  });

  it("is what makes the pipeline run the second step at all", async () => {
    /* The consequence, at the altitude where it costs something. `hierarchy`
       has no `stamp` and no `isDone` (src/pipeline.ts), so `stepIsDone` is
       `interrupted → has` and nothing else — the run-row gate is the *only*
       thing between stage 3's write and stage 4 skipping itself. `tree` and
       `labels` are in the fixture's columns throughout, so the answer cannot be
       "something else was missing". */
    await withClaim(async (tx, claimed) => {
      const reads = readsPgArtifacts(claimed, tx);
      await runBlocksStep(tx, claimed);
      expect(await stepIsDone(STEPS.hierarchy, ctx, reads)).toBe(false);
      await runHierarchyStep(tx, claimed);
      expect(await stepIsDone(STEPS.hierarchy, ctx, reads)).toBe(true);
    });
  });
});
