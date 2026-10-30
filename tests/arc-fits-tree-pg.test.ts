/**
 * **`loadArticle` embeds only an arc that still fits the tree** — the wiring
 * half of `fitsTree` (src/arc.ts; tests/arc-freshness.test.ts is the pure half).
 * Plan 261029l, GPT Sol's finding 1.
 *
 * An embedded arc is one `useArc` trusts without asking `/api/arc`. Before this,
 * a Structure re-run that re-cut the parts left the stored arc in the payload,
 * and the reading view dropped every sentence whose range no longer matched a
 * part, without a word and for good. A pure test of `fitsTree` would stay green
 * if `loadArticle` stopped calling it, so this one goes through the store.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { inputFingerprint, partsOf, PROMPT_VERSION } from "../src/arc.js";
import { CAPABLE_MODEL } from "../src/models.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { loadArc, loadArticle } from "../src/store/index.js";
import type { Arc, Article, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({ suite: "tests/arc-fits-tree-pg.test.ts" });

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-arc-fits-tree-${RUN}`;

let article: ScratchArticle | undefined;
let loadedArticle: Article | undefined;
let tree: Tree | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  expect(article.copied).toContain("structure");
  loadedArticle = await runAsOwner(DEV_OWNER_ID, () => loadArticle(SLUG));
  tree = loadedArticle.tree;
  /* Asserted, not assumed: with a single part, "re-cut" below would have no
     second range to fall across. */
  expect(tree.nodes[tree.rootId]?.children.length ?? 0).toBeGreaterThan(1);
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

/** The current revision's arc column, set by hand. */
async function setArc(arc: Arc): Promise<void> {
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  await getDb().update(articleRevisions).set({ arc }).where(eq(articleRevisions.id, row.id));
}

function arcOver(ranges: [string, string][]): Arc {
  return {
    version: "arc/test",
    generator: "test",
    slug: SLUG,
    entries: ranges.map((range, i) => ({ range, text: `Sentence ${i}.` })) as Arc["entries"],
  };
}

function partRanges(t: Tree): [string, string][] {
  return partsOf(t).map((node) => [node.range[0], node.range[1]]);
}

describe("the arc in the article payload", () => {
  it("is there when every sentence lands on a part", async () => {
    if (!tree) throw new Error("no tree");
    await setArc(arcOver(partRanges(tree)));
    const loaded = await runAsOwner(DEV_OWNER_ID, () => loadArticle(SLUG));
    expect(loaded.arc?.entries.length).toBe(partRanges(tree).length);
  });

  it("is left out when the parts were re-cut beneath it", async () => {
    if (!tree) throw new Error("no tree");
    const [first, second] = partRanges(tree);
    if (!first || !second) throw new Error("fewer than two parts");
    /* The first two parts as one, as a re-cut tree's arc would have them: a
       range that is no part of this tree. */
    await setArc(arcOver([[first[0], second[1]], ...partRanges(tree).slice(2)]));
    const loaded = await runAsOwner(DEV_OWNER_ID, () => loadArticle(SLUG));
    expect(loaded.arc).toBeUndefined();
  });

  it("is left out when its old ranges are a proper subset of the current parts", async () => {
    if (!tree) throw new Error("no tree");
    const ranges = partRanges(tree);
    expect(ranges.length).toBeGreaterThan(1);
    /* Every stored entry still matches a current part. The old one-way check
       therefore kept this incomplete arc; the missing last part is the half
       only an integration test through `loadArticle` can catch. */
    await setArc(arcOver(ranges.slice(0, -1)));
    const loaded = await runAsOwner(DEV_OWNER_ID, () => loadArticle(SLUG));
    expect(loaded.arc).toBeUndefined();
  });

  /* **The route needs no `fitsTree` of its own.** After a re-cut, the arc's
     stamp was taken over the old tree, so the stamp alone already calls it stale.
     That is what lets `useArc` remake the arc the payload left out, while the
     route and the queue keep one answer (tests/freshness-deciders-agree.test.ts).
     The control: the same arc stamped over today's tree is current. */
  it("is stale on the arc route when it was written for a tree that has since been re-cut", async () => {
    if (!tree || !loadedArticle) throw new Error("no article");
    const ranges = partRanges(tree);
    const lastPart = partsOf(tree).at(-1);
    if (!lastPart) throw new Error("no parts");
    const root = tree.nodes[tree.rootId];
    if (!root) throw new Error("no root");
    /* The node goes, not only the root's pointer to it: `structureHash` reads
       the nodes (id, parent, range, title, gist), never a children list, and a
       real re-cut changes nodes. */
    const { [lastPart.id]: _dropped, ...otherNodes } = tree.nodes;
    const oldTree: Tree = {
      ...tree,
      nodes: {
        ...otherNodes,
        [tree.rootId]: { ...root, children: root.children.filter((id) => id !== lastPart.id) },
      },
    };
    const stamped = (t: Tree): Arc => ({
      ...arcOver(partRanges(t)),
      version: PROMPT_VERSION,
      generator: CAPABLE_MODEL,
      sourceHash: inputFingerprint(loadedArticle!.blocks, t, loadedArticle!.meta),
    });
    expect(partRanges(oldTree).length).toBe(ranges.length - 1);

    await setArc(stamped(tree));
    expect((await runAsOwner(DEV_OWNER_ID, () => loadArc(SLUG))).stale).toBe(false);

    await setArc(stamped(oldTree));
    expect((await runAsOwner(DEV_OWNER_ID, () => loadArc(SLUG))).stale).toBe(true);
  });
});
