/**
 * Stage 6 server side — src/api.ts. The whole point of loadArticle is the
 * fallback: an unknown slug quietly serves the hand-authored example/ fixture,
 * so the client works before the pipeline has run.
 */
import { describe, expect, it } from "vitest";
import { loadArticle } from "../src/api.js";
import { isSpideryarnId } from "../src/ids.js";

describe("loadArticle", () => {
  it("falls back to example/ for a slug with no data/ directory", async () => {
    const article = await loadArticle("no-such-article-slug");
    expect(article.blocks.length).toBeGreaterThan(0);
    expect(article.meta.title).toBeTruthy();
    expect(article.tree.nodes[article.tree.rootId]).toBeDefined();
  });

  it("returns blocks whose ids are the ones the tree ranges over", async () => {
    const { blocks, tree } = await loadArticle("example");
    const ids = new Set(blocks.map((b) => b.id));
    for (const b of blocks) expect(isSpideryarnId(b.id)).toBe(true);
    for (const node of Object.values(tree.nodes)) {
      expect(ids.has(node.range[0]), `${node.id} start`).toBe(true);
      expect(ids.has(node.range[1]), `${node.id} end`).toBe(true);
    }
  });
});
