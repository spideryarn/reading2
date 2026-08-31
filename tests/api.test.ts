/**
 * Stage 6 server side — src/api.ts. The reads the client makes, and the one
 * rule that decides which article answers a slug: `data/<slug>/`, and the
 * hand-authored `example/` fixture for the fixture's own slug and nothing else.
 *
 * That rule is younger than this file. `candidateDirs` used to append `example/`
 * for *every* slug, so an article with no tree yet — and a slug with no article
 * at all — was answered with the fixture's prose under the reader's name. The
 * describe block below is the one that would have said so.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { articleMetadata, loadArticle, loadGlossary } from "../src/api.js";
import { PROMPT_VERSION } from "../src/glossary.js";
import { articleFingerprint } from "../src/source-hash.js";
import type { Block, Tree } from "../src/types.js";
import { isSpideryarnId } from "../src/ids.js";
import { STEP_ORDER, STEPS } from "../src/pipeline.js";

/**
 * **The fixture answers for its own slug and for no other.**
 *
 * Two states have to refuse, and the second is the one that stops being
 * hypothetical: an article that does not exist, and an article whose blocks are
 * written but whose tree is not. The second is a normal few seconds of every
 * ingest once the ToC moves out of the critical path
 * (docs/plans/260830am-faster-ingest-and-concurrency.md), and serving the fixture there
 * means a reader who opens their own article early reads somebody else's.
 *
 * Asserted as "not the fixture" rather than only as a 404, because a 404 for the
 * wrong reason would still pass — src/api.ts's own standing alarm was that
 * nothing about the fixture's response distinguishes it from a correct refusal.
 */
describe("the example/ fixture is not a fallback for other slugs", () => {
  const EXAMPLE = path.join(process.cwd(), "example");
  const slugs: string[] = [];
  afterAll(async () => {
    for (const slug of slugs) {
      await rm(path.join(process.cwd(), "data", slug), { recursive: true, force: true });
    }
  });

  /** A `data/<slug>/` with blocks and no tree — half an ingest, mid-flight. */
  async function halfBuilt(): Promise<string> {
    const slug = `zz-test-nofallback-${process.pid}-${slugs.length}`;
    slugs.push(slug);
    const dir = path.join(process.cwd(), "data", slug);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "blocks.json"),
      JSON.stringify({
        blocks: [
          {
            id: "spya-aaaaab",
            kind: "text",
            tag: "p",
            gistable: true,
            html: "<p>Mine, not the fixture's.</p>",
            text: "Mine, not the fixture's.",
            words: 4,
          } satisfies Block,
        ],
      }),
    );
    return slug;
  }

  const fixtureBlockIds = async (): Promise<Set<string>> => {
    const parsed = JSON.parse(await readFile(path.join(EXAMPLE, "blocks.json"), "utf8")) as {
      blocks: Block[];
    };
    return new Set(parsed.blocks.map((b) => b.id));
  };

  it("refuses a slug with no data/ directory instead of serving the fixture", async () => {
    await expect(loadArticle("zz-no-such-article-slug")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an article whose blocks are written and whose tree is not", async () => {
    const slug = await halfBuilt();
    await expect(loadArticle(slug)).rejects.toMatchObject({ status: 404 });
  });

  it("never hands the fixture's blocks back under another slug", async () => {
    const ids = await fixtureBlockIds();
    for (const slug of ["zz-no-such-article-slug", await halfBuilt()]) {
      const article = await loadArticle(slug).catch(() => null);
      if (!article) continue;
      expect(article.blocks.some((b) => ids.has(b.id)), slug).toBe(false);
    }
  });

  it("describes no article rather than the fixture's files", async () => {
    // `articleDir` is the second door into the same fallback, and the metadata
    // page walked through it: a confident 200 whose `dir` said "example" for an
    // address with no article behind it at all.
    for (const slug of ["zz-no-such-article-slug", await halfBuilt()]) {
      await expect(articleMetadata(slug), slug).rejects.toMatchObject({ status: 404 });
    }
  });

  it("still opens the fixture under its own slug", async () => {
    // The control. Six test files read `example/` as static data and
    // docs/plans/260825f-postgres-migration.md says it stays, so the refusal above must
    // be about the slug and not about the directory.
    const article = await loadArticle("example");
    expect(article.blocks.length).toBeGreaterThan(0);
    expect(article.tree.nodes[article.tree.rootId]).toBeDefined();
    expect((await articleMetadata("example")).dir).toBe("example");
  });
});

describe("loadArticle", () => {
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
 * on `articleMetadata` itself and in docs/plans/260825e-metadata-page.md.
 */
describe("articleMetadata", () => {
  it("reports every pipeline stage, in pipeline order", async () => {
    const m = await articleMetadata("example");
    expect(m.stages.map((s) => s.step)).toEqual([...STEP_ORDER]);
  });

  it("names the real files each stage writes, not a prettier version of them", async () => {
    const m = await articleMetadata("example");
    const toc = m.stages.find((s) => s.step === "toc");
    // All three: stage 4 writes the tree, the nav labels its second model pass
    // produced, AND copies the blocks beside them, so a caller checking only
    // the first would call a half-finished run done. src/toc.ts writes the tree
    // last for the same reason — docs/plans/260826h-toc-scaling.md.
    expect(toc?.outputs).toEqual([
      "example/tree.json",
      "example/labels.json",
      "example/blocks.json",
    ]);
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

  it("refuses an unknown slug exactly as loadArticle does", async () => {
    // The metadata page must describe the article the reading view is actually
    // showing, so the two share `candidateDirs` and must agree about the same
    // URL. This test used to assert the opposite — that both answered with the
    // fixture — which was true and was the bug: `dir: "example"` under a slug
    // nobody has ever ingested. See the describe block at the top of this file.
    await expect(articleMetadata("zz-no-such-article-slug")).rejects.toMatchObject({ status: 404 });
  });

  it("says when each stage last wrote, and what it left, without saying what from", async () => {
    // Greg, 2026-08-27, asked for exact date times on this page. They are a
    // fact and never a verdict: mtimes cannot prove provenance, so the test
    // checks the shape and the honesty of the absence, and there is still no
    // staleness comparison anywhere for it to check.
    const m = await articleMetadata("example");
    const toc = m.stages.find((s) => s.step === "toc");
    // The fixture's tree.json is committed, so this is whenever the repo was
    // checked out — which is exactly why the tooltip says "when, never what
    // from". A parseable ISO string is all that can be asserted about it.
    expect(toc?.ranAt).toBeTypeOf("string");
    expect(Number.isNaN(Date.parse(toc?.ranAt ?? ""))).toBe(false);
    expect(toc?.bytes).toBeGreaterThan(0);

    // `fetch` never ran for the fixture and wrote nothing, so both are null —
    // "we cannot say", and specifically NOT a zero, which would read as a
    // measurement of an empty file.
    const fetched = m.stages.find((s) => s.step === "fetch");
    expect(fetched?.done).toBe(false);
    expect(fetched?.ranAt).toBe(null);
    expect(fetched?.bytes).toBe(null);

    // The half-written case, which is the state this page is opened to look at:
    // `extract` owes meta.json AND output/example.html, only the first exists,
    // so it is not done and still says when it last wrote.
    const extract = m.stages.find((s) => s.step === "extract");
    expect(extract?.done).toBe(false);
    expect(extract?.ranAt).toBeTypeOf("string");
  });

  it("counts the questions asked, so the page never has to fetch them", async () => {
    // The count is here rather than on the client because the metadata page
    // must NOT call `useComments` — that hook fetches on mount, and a visit
    // would buy a drawer nobody opened (docs/plans/260825e-metadata-page.md § The
    // shell). This endpoint is already looking in the article's directory.
    const m = await articleMetadata("example");
    expect(typeof m.comments).toBe("number");
    /* And an article with no comments file reports none, rather than throwing
       or reporting NaN — `loadComments` owns that, and this is the check that
       it still does. The fixture is that article: reader state lives under
       `data/<slug>/` even for it, and `data/example/` holds no comments.json.
       This used to reach for an unknown slug instead, which now 404s. */
    expect(m.comments).toBe(0);
  });

  it("refuses a slug that is not one, before it joins any path", async () => {
    // This function enumerates files for a living, and routes.ts hands it a
    // percent-decoded path segment. `path.join` will happily walk out of data/.
    for (const bad of ["../etc", "a/b", "..", "Example", ""]) {
      await expect(articleMetadata(bad), bad).rejects.toMatchObject({ status: 400 });
    }
  });
});

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
    const tree = { rootId: "spya-aaaaaa", nodes: {} } as unknown as Tree;
    await writeFile(path.join(dir, "tree.json"), JSON.stringify(tree));
    /* The metadata is the third input to the glossary's fingerprint (its prompt
       carries `TITLE:`, `BY:` and `PUBLISHED IN:`), so the fixture has to write
       one — an absent `meta.json` is a legitimate but *different* input, and
       these two cases are about the prompt version, not about staleness.
       src/source-hash.ts § `articleFingerprint`. */
    const meta = { slug, title: "A title" };
    await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
    await writeFile(
      path.join(dir, "glossary.json"),
      JSON.stringify({
        version,
        generator: "a-model",
        slug,
        sourceHash: articleFingerprint(blocks, tree, meta),
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
