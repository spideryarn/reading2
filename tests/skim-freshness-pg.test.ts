/**
 * **The route's freshness, read from Postgres** — `loadSkim` in
 * src/store/pg.ts, which since stage 6 of plan 260928a judges a route against
 * `skimInputHash` over the `quotes` and `ideas` columns and the tree
 * beside it, not against the Quotes alone.
 *
 * The pipeline's stamp is pinned in tests/skim.test.ts; this is the read
 * path, which computes the same hash from different reads (the revision's
 * columns and its blocks rows). If the two disagree, the band says a route is
 * stale that the job would skip as current, or the other way round — so this
 * suite writes a route stamped by the stage's own functions, and asserts the
 * read calls it current before it asserts anything else (Sol F68).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { hashBlocks } from "../src/source-hash.js";
import { loadSkim } from "../src/store/index.js";
import { beginRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { PIPELINE_RUN } from "../src/store/artifacts.js";
import {
  emptyDrops,
  PROMPT_VERSION,
  skimInput,
  skimInputHash,
} from "../src/skim.js";
import type { Block, Ideas, Quotes, Skim, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* Its own slug: two suites sharing an article would see each other's revisions. */
const SLUG = "test-skim-freshness";

await pgReady({
  suite: "tests/skim-freshness-pg.test.ts",
  tables: ["spideryarn.article_revisions"],
});

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
  block("spya-tfa2bc", "The first paragraph states the main claim of a fixture article."),
  block("spya-tfa3de", "The second paragraph says how the claim was tested."),
  block("spya-tfa4gh", "The third paragraph says where the claim stops holding."),
];
const HASH = hashBlocks(BLOCKS);

const TREE = {
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
      range: [BLOCKS[0]!.id, BLOCKS[2]!.id],
      title: "A fixture article",
      gist: "A fixture built by tests/skim-freshness-pg.test.ts and nothing else.",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: ["l0", "l1"],
      range: [BLOCKS[0]!.id, BLOCKS[1]!.id],
      title: "The claim",
      gist: "The article's claim, and how it was tested.",
    },
    n2: {
      id: "n2",
      depth: 1,
      parent: "n0",
      children: ["l2"],
      range: [BLOCKS[2]!.id, BLOCKS[2]!.id],
      title: "The limits",
      gist: "Where the claim stops holding.",
    },
    ...Object.fromEntries(
      BLOCKS.map((b, i) => [
        `l${i}`,
        {
          id: `l${i}`,
          depth: 2,
          parent: i < 2 ? "n1" : "n2",
          children: [],
          range: [b.id, b.id],
          title: "A paragraph",
          navLabel: "One paragraph of a fixture article that exists only for this test",
        },
      ]),
    ),
  },
} as unknown as Tree;

const QUOTES = {
  version: "quotes/x",
  generator: "fixture",
  slug: SLUG,
  sourceHash: HASH,
  quotes: [
    { id: "spya-tfq2bc", blockId: BLOCKS[0]!.id, text: "states the main claim", importance: 0.9 },
    { id: "spya-tfq3de", blockId: BLOCKS[2]!.id, text: "where the claim stops holding", importance: 0.6 },
  ],
} as unknown as Quotes;

function ideas(statement: string): Ideas {
  return {
    version: "ideas/x",
    generator: "fixture",
    slug: SLUG,
    sourceHash: HASH,
    profileHash: null,
    ideas: [
      {
        id: "spya-tfi2bc",
        name: "The claim holds",
        provenance: "introduced",
        statement,
        occurrences: [{ blockId: BLOCKS[0]!.id, quote: "main claim", reasoning: "r" }],
      },
    ],
    generatedAt: "",
    elapsedMs: 0,
  };
}

/** A route stamped exactly as the stage would stamp it over these inputs. */
function route(withIdeas: Ideas | null, version = PROMPT_VERSION): Skim {
  return {
    version,
    generator: "fixture",
    slug: SLUG,
    sourceHash: skimInputHash(
      skimInput({ quotes: QUOTES, blocks: BLOCKS, tree: TREE, ideas: withIdeas }),
    ),
    profileHash: null,
    stops: [{ quoteId: "spya-tfq2bc", depth: 1, role: null, cue: "What is the claim?" }],
    visible: [1, 1, 1],
    offered: 2,
    dropped: emptyDrops(),
    generatedAt: "",
    elapsedMs: 0,
  };
}

let revisionId = "";

async function setColumns(values: { ideas?: Ideas | null; skim?: Skim; tree?: Tree }): Promise<void> {
  await getDb().update(articleRevisions).set(values).where(eq(articleRevisions.id, revisionId));
}

describe("loadSkim, judged on what the route's prompt rendered", () => {
  beforeAll(async () => {
    const begun = await beginRevision({ slug: SLUG });
    revisionId = begun.revisionId;
    const db = getDb();
    await db
      .insert(blockIdentities)
      .values(BLOCKS.map((b) => ({ articleId: begun.articleId, blockId: b.id })))
      .onConflictDoNothing();
    await db.delete(revisionBlocks).where(eq(revisionBlocks.revisionId, revisionId));
    await db.insert(revisionBlocks).values(
      BLOCKS.map((b, i) => ({
        articleId: begun.articleId,
        revisionId,
        blockId: b.id,
        ordinal: i,
        tag: b.tag,
        kind: b.kind,
        level: null,
        text: b.text,
        words: b.words,
        html: b.html,
        gistable: b.gistable,
        note: null,
      })),
    );
    const first = ideas("A claim, stated plainly.");
    await db
      .update(articleRevisions)
      .set({ title: "A fixture article", tree: TREE, quotes: QUOTES, ideas: first, skim: route(first) })
      .where(eq(articleRevisions.id, revisionId));
    await recordStepRun({
      revisionId,
      stepName: "structure",
      inputHash: HASH,
      implementationVersion: PIPELINE_RUN,
      status: "done",
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    await publishRevision({ slug: SLUG, revisionId });
  }, 60_000);

  afterAll(async () => {
    const db = getDb();
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    const id = rows[0]?.id;
    if (id) {
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await db.delete(articles).where(eq(articles.id, id));
    }
    await closeDb();
  });

  it("calls a route current against the inputs it was stamped with — the control", async () => {
    const found = await loadSkim(SLUG);
    expect(found.stale).toBe(false);
    expect(found.outdated).toBe(false);
  });

  it("calls it stale once the Ideas are found again, worded differently", async () => {
    await setColumns({ ideas: ideas("The same claim, found again in other words.") });
    expect((await loadSkim(SLUG)).stale).toBe(true);
  });

  it("calls a route planned without Ideas stale once Ideas exist, and current before", async () => {
    await setColumns({ ideas: null, skim: route(null) });
    expect((await loadSkim(SLUG)).stale).toBe(false);
    await setColumns({ ideas: ideas("A claim, stated plainly.") });
    expect((await loadSkim(SLUG)).stale).toBe(true);
  });

  it("reports a route from an older prompt as outdated, not as changed Quotes", async () => {
    const now = ideas("A claim, stated plainly.");
    await setColumns({ ideas: now, skim: { ...route(now, "trajectory/6"), sourceHash: "old-quotes-hash" } });
    const found = await loadSkim(SLUG);
    expect(found.outdated).toBe(true);
    expect(found.stale).toBe(false);
  });

  it("does not count a quote left out as the abstract's as missing from the route", async () => {
    const now = ideas("A claim, stated plainly.");
    /* The route stops only at the second quote, so the first is not on it. */
    const secondOnly = (tree: Tree): Skim => ({
      ...route(now),
      sourceHash: skimInputHash(skimInput({ quotes: QUOTES, blocks: BLOCKS, tree, ideas: now })),
      stops: [{ quoteId: "spya-tfq3de", depth: 1, role: null, cue: "Where does it stop holding?" }],
    });
    /* The control: with no abstract, the first quote is simply not on the route. */
    await setColumns({ ideas: now, tree: TREE, skim: secondOnly(TREE) });
    const control = await loadSkim(SLUG);
    expect(control.stale).toBe(false);
    expect(control.notOnRoute).toBe(1);

    const nodes = TREE.nodes as Record<string, Tree["nodes"][string]>;
    const withAbstract = { ...TREE, nodes: { ...nodes, n1: { ...nodes.n1!, title: "Abstract" } } } as Tree;
    await setColumns({ tree: withAbstract, skim: secondOnly(withAbstract) });
    const found = await loadSkim(SLUG);
    /* Stamped and read over the same input, so current — and nothing missing. */
    expect(found.stale).toBe(false);
    expect(found.notOnRoute).toBe(0);
    await setColumns({ tree: TREE });
  });
});
