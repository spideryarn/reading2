/**
 * Summary freshness, through the step's `stamp` rather than a function of its
 * own — docs/plans/delete-the-importer.md § D0.
 *
 * `summariesAreCurrent` in src/summarise.ts compared three things by hand: the
 * blocks the summaries were written from, the prompt that wrote them, and the
 * model that ran. Those are exactly `sameStamp`'s three fields, so the step now
 * declares them and the comparison happens in one place. The conditions have
 * not changed; where they are asserted has, and this is that place.
 *
 * Its own file because tests/pipeline-artifact-store.test.ts, where the
 * matching `glossary` block lives, is not mine to edit this week.
 *
 * Worth real files rather than a stub: this answer is `stepIsDone`'s, so
 * getting it wrong either serves last week's summaries for ever (too
 * permissive) or spends a batch of model calls on every run (too strict). Both
 * are quiet.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAPABLE_MODEL } from "../src/models.js";
import { STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { articleFingerprint } from "../src/source-hash.js";
import { PROMPT_VERSION as SUMMARY_VERSION } from "../src/summarise.js";
import {
  type ArtifactLocations,
  createFsArtifactStore,
  pathFor,
} from "../src/store/artifacts-fs.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { Block, Tree } from "../src/types.js";

const SLUG = "test-summary-stamp";

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: "",
    gistable: true,
  };
}

const BLOCKS = [block("spya-aaaaaa", "The first paragraph."), block("spya-bbbbbb", "The second.")];

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** An empty article directory pair, in a temp root that gets cleaned up. */
async function tempArticle(): Promise<ArtifactLocations> {
  const root = await mkdtemp(path.join(tmpdir(), "spya-summary-"));
  roots.push(root);
  const at = {
    dir: path.join(root, "data", SLUG),
    htmlFile: path.join(root, "output", `${SLUG}.html`),
  };
  await mkdir(at.dir, { recursive: true });
  await mkdir(path.dirname(at.htmlFile), { recursive: true });
  return at;
}

/**
 * The tree and the metadata these summaries are written against.
 *
 * Both are inputs to this stage's prompt — `batchesOf` and `skeletonOf` come
 * from the tree, the head from `articleText` — so both are in the fingerprint
 * the stamp compares. src/source-hash.ts § `articleFingerprint`.
 */
const STAMP_TREE: Tree = {
  version: "toc/2",
  generator: CAPABLE_MODEL,
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      parent: null,
      range: [BLOCKS[0]!.id, BLOCKS[BLOCKS.length - 1]!.id],
      title: "The whole thing",
      gist: "One sentence.",
      children: [],
    },
  },
} as unknown as Tree;
const STAMP_META = { slug: SLUG, title: "A title" };

/** Summaries as the stage would have written them against `blocks`. */
function summariesFor(blocks: Block[], over: Record<string, unknown>): Record<string, unknown> {
  return {
    version: SUMMARY_VERSION,
    generator: CAPABLE_MODEL,
    slug: SLUG,
    sourceHash: articleFingerprint(blocks, STAMP_TREE, STAMP_META),
    entries: [],
    missing: 0,
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
    ...over,
  };
}

/**
 * A context pointing at a directory that holds nothing.
 *
 * **Deliberately not the store's directory.** Freshness is the store's answer
 * now, and a context whose `dir` agreed with it could not tell the two apart —
 * on the filesystem they are the same file, so a test that pointed both at one
 * place would pass just as happily against the path-reading version this
 * replaced. Nothing here runs, so most of the rest is the type asking.
 */
function ctxAt(dir: string): StepContext {
  return {
    slug: SLUG,
    dir,
    htmlFile: path.join(dir, "page.html"),
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("summary freshness, through the step's stamp", () => {
  let where: ArtifactLocations;
  let store: ArtifactStore;
  /** Stays empty for every case below; see `ctxAt`. */
  let elsewhere: string;

  beforeAll(async () => {
    where = await tempArticle();
    store = createFsArtifactStore(() => where);
    elsewhere = (await tempArticle()).dir;
  });

  /** Put summaries and some blocks in the store, then ask the pipeline. */
  async function ask(
    summaries: Record<string, unknown> | "unreadable" | null,
    blocks: Block[] | null,
    over: { tree?: Tree; meta?: unknown } = {},
  ): Promise<boolean> {
    const file = pathFor(where, "summary", "summary");
    if (summaries === "unreadable") await writeFile(file, "{ not json", "utf8");
    else if (summaries) await writeJson(file, summaries);
    else await rm(file, { force: true });

    const blocksFile = pathFor(where, "toc", "blocks");
    if (blocks) await writeJson(blocksFile, { blocks });
    else await rm(blocksFile, { force: true });

    /* The other two thirds of what this stamp compares. Written on every call
       so that "no blocks" stays the only thing a case takes away. */
    await writeJson(pathFor(where, "toc", "tree"), over.tree ?? STAMP_TREE);
    await writeJson(pathFor(where, "extract", "meta"), over.meta ?? STAMP_META);

    return stepIsDone(STEPS.summary, ctxAt(elsewhere), store);
  }

  it("says done for summaries written against these very blocks", async () => {
    expect(await ask(summariesFor(BLOCKS, {}), BLOCKS)).toBe(true);
  });

  /* Both green — wrongly — until 2026-08-31, when this stamp stopped hashing
     the blocks alone. And this is the stage where being wrong costs the most:
     regenerating is one model call per part, not one per article.
     docs/plans/finish-the-database-move.md § stage 1. */
  it("says not-done once the sections have been re-cut underneath them", async () => {
    const recut = {
      ...STAMP_TREE,
      nodes: { n0: { ...STAMP_TREE.nodes.n0!, gist: "A different sentence." } },
    } as Tree;
    expect(await ask(summariesFor(BLOCKS, {}), BLOCKS, { tree: recut })).toBe(false);
  });

  it("says not-done once the article has been renamed underneath them", async () => {
    expect(
      await ask(summariesFor(BLOCKS, {}), BLOCKS, { meta: { ...STAMP_META, title: "Renamed" } }),
    ).toBe(false);
  });

  it("says not-done once the article has changed underneath it", async () => {
    // The bug the whole check exists for. Without it the file is present, so
    // the step skips, reports "already done" with a green tick, and the panel
    // serves summaries of text that has since moved —
    // docs/reusable/silent-success.md.
    const moved = [...BLOCKS, block("spya-dddddd", "A new paragraph.")];
    expect(await ask(summariesFor(BLOCKS, {}), moved)).toBe(false);
  });

  it("says not-done when the prompt or the model has moved", async () => {
    expect(await ask(summariesFor(BLOCKS, { version: "summary/0" }), BLOCKS)).toBe(false);
    expect(await ask(summariesFor(BLOCKS, { generator: "some-old-model" }), BLOCKS)).toBe(false);
  });

  it("says not-done when there are no summaries, and when there are no blocks", async () => {
    // "We cannot tell" and "it is stale" both answer not-done, and they must:
    // the alternative is summaries reporting themselves current because the
    // blocks they would have been checked against are missing.
    expect(await ask(null, BLOCKS)).toBe(false);
    expect(await ask(summariesFor(BLOCKS, {}), null)).toBe(false);
  });

  it("says not-done for an unreadable summary file rather than throwing", async () => {
    // Not-current is the safe way to be wrong: it costs a run, where the other
    // way round serves stale summaries for ever.
    expect(await ask("unreadable", BLOCKS)).toBe(false);
  });

  it("says not-done when the summaries carry no stamp at all", async () => {
    expect(await ask({ entries: [], missing: 0 }, BLOCKS)).toBe(false);
  });

  /**
   * The store is the authority, not the path in the context.
   *
   * Red before D0: `isDone: (ctx) => summariesAreCurrent(ctx.dir)` read
   * `ctx.dir` and answered *done* about summaries the store does not hold,
   * which is the whole reason freshness had to move behind the seam.
   */
  it("reads the store, not the directory the context happens to name", async () => {
    const inTheStore = await tempArticle();
    const onTheSide = await tempArticle();
    const moved = [...BLOCKS, block("spya-eeeeee", "Rewritten since.")];
    // What the store holds is stale: written against BLOCKS, and the blocks it
    // holds have moved on.
    await writeJson(pathFor(inTheStore, "summary", "summary"), summariesFor(BLOCKS, {}));
    await writeJson(pathFor(inTheStore, "toc", "blocks"), { blocks: moved });
    // `ctx.dir` holds a perfectly current pair, and is the wrong place to look.
    await writeJson(path.join(onTheSide.dir, "summary.json"), summariesFor(moved, {}));
    await writeJson(path.join(onTheSide.dir, "blocks.json"), { blocks: moved });

    const done = await stepIsDone(
      STEPS.summary,
      ctxAt(onTheSide.dir),
      createFsArtifactStore(() => inTheStore),
    );
    expect(done).toBe(false);
  });
});
