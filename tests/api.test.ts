/**
 * Stage 6 server side — src/api.ts. The whole point of loadArticle is the
 * fallback: an unknown slug quietly serves the hand-authored example/ fixture,
 * so the client works before the pipeline has run.
 */
import { describe, expect, it } from "vitest";
import { articleMetadata, loadArticle } from "../src/api.js";
import { isSpideryarnId } from "../src/ids.js";
import { STEP_ORDER, STEPS } from "../src/pipeline.js";

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

/**
 * `articleMetadata` — what the metadata page reads, src/api.ts.
 *
 * Against the committed `example/` fixture, because it is the one article whose
 * files are in the repo. What that buys is the *shape*: which stages are
 * reported, in what order, and that "done" follows the pipeline's own rule
 * rather than a second copy of it.
 *
 * There is deliberately no staleness test, because there is deliberately no
 * staleness verdict — mtimes cannot prove what a file was built from, and the
 * obvious comparison marks every *successful* toc run stale. The reasoning is
 * on `articleMetadata` itself and in docs/plans/metadata-page.md.
 */
describe("articleMetadata", () => {
  it("reports every pipeline stage, in pipeline order", async () => {
    const m = await articleMetadata("example");
    expect(m.stages.map((s) => s.step)).toEqual([...STEP_ORDER]);
  });

  it("names the real files each stage writes, not a prettier version of them", async () => {
    const m = await articleMetadata("example");
    const toc = m.stages.find((s) => s.step === "toc");
    // Both of them: stage 4 writes the tree AND copies the blocks beside it, so
    // a caller checking only the first would call a half-finished run done.
    expect(toc?.outputs).toEqual(["example/tree.json", "example/blocks.json"]);
    // Extract's HTML lands in output/, not in the data directory. The plan's
    // sketch had it as `data/<slug>/article.html`, which does not exist.
    const extract = m.stages.find((s) => s.step === "extract");
    expect(extract?.outputs).toContain("output/example.html");
    expect(extract?.outputs).toContain("example/meta.json");
  });

  it("carries the label the pipeline gives the stage, not one of its own", async () => {
    const m = await articleMetadata("example");
    for (const stage of m.stages) {
      expect(stage.label, stage.step).toBe(STEPS[stage.step].label);
    }
  });

  it("says a stage that has not run has not run", async () => {
    const m = await articleMetadata("example");
    // The fixture was hand-authored: nobody ever fetched a page for it, and
    // nothing ever wrote its HTML into output/.
    expect(m.stages.find((s) => s.step === "fetch")?.done).toBe(false);
    expect(m.stages.find((s) => s.step === "toc")?.done).toBe(true);
  });

  it("needs ALL of a stage's outputs before calling it done", async () => {
    const m = await articleMetadata("example");
    // `extract` writes meta.json (present) and output/example.html (absent).
    // Any-of would call this finished; stepIsDone's all-of is what stops it.
    const extract = m.stages.find((s) => s.step === "extract");
    expect(extract?.done).toBe(false);
  });

  it("finds the fixture's artefacts in example/, not data/example/", async () => {
    const m = await articleMetadata("example");
    expect(m.dir).toBe("example");
  });

  it("falls through to the fixture exactly as loadArticle does", async () => {
    // The metadata page must describe the article the reading view is actually
    // showing. `loadArticle` serves the fixture for an unknown slug, so this
    // has to describe the fixture's files or the two pages would disagree about
    // the same URL — and `dir` is what says where they came from.
    const m = await articleMetadata("no-such-article-slug");
    expect(m.slug).toBe("no-such-article-slug");
    expect(m.dir).toBe("example");
  });

  it("refuses a slug that is not one, before it joins any path", async () => {
    // This function enumerates files for a living, and routes.ts hands it a
    // percent-decoded path segment. `path.join` will happily walk out of data/.
    for (const bad of ["../etc", "a/b", "..", "Example", ""]) {
      await expect(articleMetadata(bad), bad).rejects.toMatchObject({ status: 400 });
    }
  });
});
