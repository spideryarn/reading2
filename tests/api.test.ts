/**
 * Stage 6 server side — src/api.ts. The whole point of loadArticle is the
 * fallback: an unknown slug quietly serves the hand-authored example/ fixture,
 * so the client works before the pipeline has run.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { articleMetadata, loadArticle, loadGlossary, lookUpTerm } from "../src/api.js";
import { PROMPT_VERSION } from "../src/glossary.js";
import { hashBlocks } from "../src/source-hash.js";
import type { Block } from "../src/types.js";
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

  it("counts the questions asked, so the page never has to fetch them", async () => {
    // The count is here rather than on the client because the metadata page
    // must NOT call `useComments` — that hook fetches on mount, and a visit
    // would buy a drawer nobody opened (docs/plans/metadata-page.md § The
    // shell). This endpoint is already looking in the article's directory.
    const m = await articleMetadata("example");
    expect(typeof m.comments).toBe("number");
    // A slug with no comments file reports none, rather than throwing or
    // reporting NaN — `loadComments` owns that, and this is the check that it
    // still does.
    expect((await articleMetadata("no-such-article-slug")).comments).toBe(0);
  });

  it("refuses a slug that is not one, before it joins any path", async () => {
    // This function enumerates files for a living, and routes.ts hands it a
    // percent-decoded path segment. `path.join` will happily walk out of data/.
    for (const bad of ["../etc", "a/b", "..", "Example", ""]) {
      await expect(articleMetadata(bad), bad).rejects.toMatchObject({ status: 400 });
    }
  });
});

/**
 * `lookUpTerm` — the per-entry web lookup, src/api.ts.
 *
 * The model call itself is not testable and is not tested. What is tested is
 * the guard around it, which is the part that can lose data or leak a bad URL
 * into an `href`: the fixture must not be writable, and an unknown term must
 * not reach a model call at all. Both refuse **before** `explain` is reached,
 * which is what makes them assertable without a network.
 *
 * See docs/plans/glossary-entries-worth-reading.md § The web.
 */
describe("loadGlossary's two verdicts", () => {
  /* `stale` and `outdated` are different facts, and the second nearly did not
     exist. `isStale` compares source hashes only, so bumping PROMPT_VERSION for
     the `glossary/2` rewrite marked exactly zero glossaries as anything — the
     panel went on showing pre-rewrite entries with no banner and no offer to
     rewrite them, while the plan that bumped it claimed the opposite.

     Read through `loadGlossary` itself rather than through the predicate, which
     is the mistake the first version of this test made: asserting
     `version !== PROMPT_VERSION` tests arithmetic nobody doubted, and would
     have passed with the field hardcoded to `false`. */
  const slugs: string[] = [];
  afterAll(async () => {
    for (const slug of slugs) {
      await rm(path.join(process.cwd(), "data", slug), { recursive: true, force: true });
    }
  });

  async function article(version: string): Promise<string> {
    const slug = `zz-test-api-${process.pid}-${slugs.length}`;
    slugs.push(slug);
    const dir = path.join(process.cwd(), "data", slug);
    await mkdir(dir, { recursive: true });
    const blocks: Block[] = [
      {
        id: "spya-aaaaaa" as Block["id"],
        kind: "text",
        tag: "p",
        gistable: true,
        html: "<p>Hi.</p>",
        text: "Hi.",
        words: 1,
      },
    ];
    await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks }));
    /* `articleDir` needs BOTH blocks.json and tree.json before it will call a
       directory an article — otherwise it falls through to the `example/`
       fixture, which is how this test first failed. */
    await writeFile(
      path.join(dir, "tree.json"),
      JSON.stringify({ rootId: "spya-aaaaaa", nodes: {} }),
    );
    await writeFile(
      path.join(dir, "glossary.json"),
      JSON.stringify({
        version,
        generator: "a-model",
        slug,
        sourceHash: hashBlocks(blocks),
        entries: [],
        passes: 1,
        generatedAt: "2026-08-25T12:00:00.000Z",
        elapsedMs: 1,
      }),
    );
    return slug;
  }

  it("reports a list written by an older prompt as outdated but not stale", async () => {
    const res = await loadGlossary(await article("glossary/0"));
    expect(res.outdated).toBe(true);
    // Not stale: the article has not moved. Two facts, two sentences — folding
    // this into `stale` would have made the panel say something untrue.
    expect(res.stale).toBe(false);
  });

  it("reports a current list as neither", async () => {
    const res = await loadGlossary(await article(PROMPT_VERSION));
    expect(res.outdated).toBe(false);
    expect(res.stale).toBe(false);
  });
});

describe("lookUpTerm", () => {
  it("refuses to write into the built-in example", async () => {
    /* `articleDir` falls through to `example/` for any slug with no output of
       its own — including a slug that does not exist — so without this guard a
       lookup on a typo would edit the one committed directory in the repo. The
       same guard `deleteGlossary` carries, for the same reason. */
    await expect(lookUpTerm("no-such-article-slug", "spya-k3m9qt")).rejects.toThrow(
      /built-in example/,
    );
    await expect(lookUpTerm("example", "spya-k3m9qt")).rejects.toThrow(/built-in example/);
  });

  it("rejects a slug that is not one", async () => {
    // Path traversal, refused where every other read-side entry point refuses
    // it — see docs/project/security.md.
    await expect(lookUpTerm("../../etc", "spya-k3m9qt")).rejects.toThrow();
  });
});
