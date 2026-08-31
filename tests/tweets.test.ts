/**
 * The deterministic half of stage 5c — src/tweets.ts.
 *
 * Nothing here calls a model. What is pinned is everything that happens either
 * side of the call: how a post's characters are counted, what the artefact
 * looks like once the model's array has been numbered, whether a thread still
 * describes the article on disk, and how many posts we ask for.
 *
 * Same split as stage 4, and for the same reason — `buildTree` in src/toc.ts is
 * exported and tested precisely so that only the genuinely nondeterministic
 * part goes untested. See docs/project/testing.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildThread,
  countChars,
  hashBlocks,
  isStale,
  LIMIT,
  overLimit,
  suggestedLength,
  TARGET,
} from "../src/tweets.js";
import { articleFingerprint } from "../src/source-hash.js";
import { STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import {
  type ArtifactLocations,
  createFsArtifactStore,
  pathFor,
} from "../src/store/artifacts-fs.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import type { Block, Tree, TweetThread } from "../src/types.js";

function block(id: string, text: string): Block {
  return { id, tag: "p", kind: "text", text, words: text.split(/\s+/).length, html: "", gistable: true };
}

const BLOCKS = [block("spya-aaaaaa", "The first paragraph."), block("spya-bbbbbb", "The second.")];

describe("countChars", () => {
  it("counts what a reader would count", () => {
    expect(countChars("hello")).toBe(5);
    expect(countChars("")).toBe(0);
  });

  it("counts an astral character once, not twice", () => {
    // `"𝕏".length` is 2, because JavaScript stores it as a surrogate pair.
    // That is a fact about the runtime, not about the post, and a per-post
    // counter that reports it would be wrong in a way nobody could explain.
    expect("𝕏".length).toBe(2);
    expect(countChars("𝕏")).toBe(1);
  });

  it("leaves room for the numbering the page adds", () => {
    // TARGET is what the prompt asks for; LIMIT is what the page bars against.
    // The gap is the "12/14 " prefix, which counts on X and is not in `text`.
    expect(TARGET).toBeLessThan(LIMIT);
    expect(LIMIT).toBe(280);
  });
});

describe("buildThread", () => {
  const opts = { slug: "a-slug", sourceHash: "deadbeefdeadbeef", elapsedMs: 1234 };

  it("stores no post number, because the array already has the order", () => {
    // A stored `number` beside the index is a second copy of one fact, and the
    // two can only ever disagree — which is how a page renders "3/12" twice.
    const thread = buildThread({ tweets: ["one", "two", "three"] }, opts);
    expect(thread.tweets.map((t) => t.text)).toEqual(["one", "two", "three"]);
    for (const t of thread.tweets) expect(t).not.toHaveProperty("number");
  });

  it("keeps an overlong post exactly as written", () => {
    // The whole argument of the plan's character-limit section. Their first
    // answer truncated to fit and hid what the model said; their second
    // rejected all twelve posts because one was long. We do neither.
    const long = "x".repeat(LIMIT + 12);
    const thread = buildThread({ tweets: ["short", long] }, opts);
    expect(thread.tweets[1]?.text).toBe(long);
    expect(thread.tweets[1]?.chars).toBe(LIMIT + 12);
    expect(overLimit(thread)).toBe(1);
  });

  it("does not throw away the good posts because of the long one", () => {
    const thread = buildThread({ tweets: ["a", "x".repeat(400), "c"] }, opts);
    expect(thread.tweets).toHaveLength(3);
  });

  it("records the limit it counted against, so the page needn't hardcode one", () => {
    expect(buildThread({ tweets: ["a"] }, opts).limit).toBe(LIMIT);
  });

  it("carries the source hash and the duration into the artefact", () => {
    const thread = buildThread({ tweets: ["a"] }, opts);
    expect(thread.sourceHash).toBe("deadbeefdeadbeef");
    expect(thread.elapsedMs).toBe(1234);
    expect(thread.version).toMatch(/^tweets\//);
  });

  it("trims each post and drops empty ones", () => {
    const thread = buildThread({ tweets: ["  a  ", "", "   ", "b"] }, opts);
    expect(thread.tweets.map((t) => t.text)).toEqual(["a", "b"]);
  });

  it("refuses to write an empty thread", () => {
    // A zero-post thread is not a degenerate success. Written to disk it would
    // satisfy the step's existence check for ever, so the stage would report
    // itself done and never run again.
    expect(() => buildThread({ tweets: [] }, opts)).toThrow(/no posts/);
    expect(() => buildThread({ tweets: ["", "  "] }, opts)).toThrow(/no posts/);
  });

  it("has no thread summary at all", () => {
    // Cut deliberately: a sentence summarising a thread that is itself a
    // summary of the article. The tree root's gist already says the whole
    // piece in one sentence, and the library card already uses it.
    expect(buildThread({ tweets: ["a"] }, opts)).not.toHaveProperty("summary");
  });
});

describe("hashBlocks and isStale", () => {
  it("is stable for the same article", () => {
    expect(hashBlocks(BLOCKS)).toBe(hashBlocks(BLOCKS.map((b) => ({ ...b }))));
  });

  it("changes when the text changes", () => {
    const edited = [BLOCKS[0]!, block("spya-bbbbbb", "The second, rewritten.")];
    expect(hashBlocks(edited)).not.toBe(hashBlocks(BLOCKS));
  });

  it("changes when the ids change, even with identical text", () => {
    // A re-split that moved the boundaries produces the same prose under
    // different ids. The thread was written against the old shape either way.
    const resplit = [block("spya-cccccc", "The first paragraph."), BLOCKS[1]!];
    expect(hashBlocks(resplit)).not.toBe(hashBlocks(BLOCKS));
  });

  it("ignores fields a reader never reads", () => {
    // `words` is derived and `html` changes whenever the sanitiser does.
    // Neither means the article a thread describes has changed.
    const rehtml = BLOCKS.map((b) => ({ ...b, html: "<p>anything</p>", words: 99 }));
    expect(hashBlocks(rehtml)).toBe(hashBlocks(BLOCKS));
  });

  /* The thread's fingerprint is the blocks, the tree and the metadata head —
     `renderPrompt` shows the model `partsOf(tree)` and `articleText` writes the
     `TITLE:`/`BY:`/`PUBLISHED IN:` lines, so all three are what it was written
     from. src/source-hash.ts § `articleFingerprint`. */
  const STALE_TREE: Tree = {
    version: "toc/2",
    generator: "x",
    slug: "s",
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
  const STALE_META = { title: "A title", byline: "Somebody", siteName: "Somewhere" };
  const freshThread = () =>
    buildThread(
      { tweets: ["a"] },
      {
        slug: "s",
        sourceHash: articleFingerprint(BLOCKS, STALE_TREE, STALE_META),
        elapsedMs: 0,
      },
    );

  it("says a thread is stale once the article moves under it", () => {
    expect(isStale(freshThread(), BLOCKS, STALE_TREE, STALE_META)).toBe(false);
    expect(
      isStale(
        freshThread(),
        [...BLOCKS, block("spya-dddddd", "And a third.")],
        STALE_TREE,
        STALE_META,
      ),
    ).toBe(true);
  });

  /* Both red before 2026-08-31, when this compared the blocks alone: the
     sections could be re-cut or the extracted title changed and the thread went on
     reporting itself current. docs/plans/finish-the-database-move.md § stage 1. */
  it("says a thread is stale once the sections are re-cut", () => {
    const recut = {
      ...STALE_TREE,
      nodes: { n0: { ...STALE_TREE.nodes.n0!, title: "Something else" } },
    } as Tree;
    expect(isStale(freshThread(), BLOCKS, recut, STALE_META)).toBe(true);
  });

  it("says a thread is stale once the article is renamed", () => {
    expect(isStale(freshThread(), BLOCKS, STALE_TREE, { ...STALE_META, title: "Renamed" })).toBe(
      true,
    );
  });
});

describe("suggestedLength", () => {
  it("scales with the article rather than being a flat twelve", () => {
    // Theirs asked for 12 every time, tuned on academic papers of roughly one
    // length. This pipeline eats a 500-word blog post and a 13,000-word essay.
    expect(suggestedLength(500)).toBeLessThan(suggestedLength(8000));
  });

  it("never asks for fewer than four posts or more than fifteen", () => {
    expect(suggestedLength(0)).toBe(4);
    expect(suggestedLength(200_000)).toBe(15);
  });

  it("never shrinks as the article grows", () => {
    // Sweep the range rather than sampling it — docs/project/testing.md.
    let previous = 0;
    for (let words = 0; words <= 30_000; words += 50) {
      const n = suggestedLength(words);
      expect(n).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
  });

  it("puts our long test article on twelve", () => {
    // 8,275 words — the Noema essay. Landing on the number their own research
    // picked is a sanity check on the divisor, not a target.
    expect(suggestedLength(8275)).toBe(12);
  });
});

/* ---------------------------------------------------------------------------
   Thread freshness — the difference between a cache and a file that happens to
   exist, and since D0 (docs/plans/delete-the-importer.md) it is the step's
   `stamp` rather than a `threadIsCurrent` of its own. The three comparisons are
   unchanged — the blocks it was written from, the prompt that wrote it, the
   model that ran — but they are now `sameStamp`'s one comparison, so these
   cases are asserted through `stepIsDone` and exercise the wiring with them.

   Worth real files rather than a stub: it is read as `stepIsDone`'s answer, so
   getting it wrong either serves last week's thread for ever (too permissive)
   or spends a model call on every run (too strict). Both are quiet.
--------------------------------------------------------------------------- */

const SLUG = "test-tweets-stamp";

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** An empty article directory pair, in a temp root that gets cleaned up. */
async function tempArticle(): Promise<ArtifactLocations> {
  const root = await mkdtemp(path.join(tmpdir(), "spya-tweets-"));
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
 * The tree and the metadata the stamped cases are written against.
 *
 * Both are inputs to this stage's prompt — the skeleton comes from
 * `partsOf(tree)` and the head from `articleText` — so both are in the
 * fingerprint. src/source-hash.ts § `articleFingerprint`.
 */
const STAMP_TREE: Tree = {
  version: "toc/2",
  generator: "x",
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

/** A thread as the stage would have written it against `blocks`. */
function threadFor(blocks: Block[], over: Partial<TweetThread>): TweetThread {
  const full = buildThread(
    { tweets: ["a post"] },
    {
      slug: SLUG,
      sourceHash: articleFingerprint(blocks, STAMP_TREE, STAMP_META),
      elapsedMs: 0,
    },
  );
  return { ...full, ...over };
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

describe("tweets freshness, through the step's stamp", () => {
  let where: ArtifactLocations;
  let store: ArtifactStore;
  /** Stays empty for every case below; see `ctxAt`. */
  let elsewhere: string;

  beforeAll(async () => {
    where = await tempArticle();
    store = createFsArtifactStore(() => where);
    elsewhere = (await tempArticle()).dir;
  });

  /** Put a thread and some blocks in the store, then ask the pipeline. */
  async function ask(
    thread: Partial<TweetThread> | "unreadable" | null,
    blocks: Block[] | null,
    over: { tree?: Tree; meta?: unknown } = {},
  ): Promise<boolean> {
    const file = pathFor(where, "tweets", "tweets");
    if (thread === "unreadable") await writeFile(file, "{ not json", "utf8");
    else if (thread) await writeJson(file, threadFor(BLOCKS, thread));
    else await rm(file, { force: true });

    const blocksFile = pathFor(where, "toc", "blocks");
    if (blocks) await writeJson(blocksFile, { blocks });
    else await rm(blocksFile, { force: true });

    /* The other two thirds of what the stamp compares. Written every time, so
       that "no blocks" stays the only thing a case removes. */
    await writeJson(pathFor(where, "toc", "tree"), over.tree ?? STAMP_TREE);
    await writeJson(pathFor(where, "extract", "meta"), over.meta ?? STAMP_META);

    return stepIsDone(STEPS.tweets, ctxAt(elsewhere), store);
  }

  it("says done for a thread written against these very blocks", async () => {
    expect(await ask({}, BLOCKS)).toBe(true);
  });

  /* Both green — wrongly — until 2026-08-31, when this stamp stopped hashing
     the blocks alone. The thread is built from the outline and carries the
     article's name; either could move with every block byte-identical.
     docs/plans/finish-the-database-move.md § stage 1. */
  it("says not-done once the sections have been re-cut underneath it", async () => {
    const recut = {
      ...STAMP_TREE,
      nodes: { n0: { ...STAMP_TREE.nodes.n0!, title: "Something else" } },
    } as Tree;
    expect(await ask({}, BLOCKS, { tree: recut })).toBe(false);
  });

  it("says not-done once the article has been renamed underneath it", async () => {
    expect(await ask({}, BLOCKS, { meta: { ...STAMP_META, title: "Renamed" } })).toBe(false);
  });

  it("says not-done once the article has changed underneath it", async () => {
    // THE bug this whole check exists for. Without it the file is present, so
    // the step skips, reports "already done" with a green tick, and the page
    // serves a thread about text that has since moved —
    // docs/reusable/silent-success.md.
    expect(await ask({}, [...BLOCKS, block("spya-dddddd", "A new paragraph.")])).toBe(false);
  });

  it("says not-done when the prompt has changed", async () => {
    expect(await ask({ version: "tweets/0" }, BLOCKS)).toBe(false);
  });

  it("says not-done when the model has changed", async () => {
    expect(await ask({ generator: "some-old-model" }, BLOCKS)).toBe(false);
  });

  it("says not-done when there is no thread, and when there are no blocks", async () => {
    // "We cannot tell" and "it is stale" both answer not-done, and they must:
    // the alternative is a thread reporting itself current because the blocks
    // it would have been checked against are missing.
    expect(await ask(null, BLOCKS)).toBe(false);
    expect(await ask({}, null)).toBe(false);
  });

  it("says not-done for an unreadable thread rather than throwing", async () => {
    // Not-current is the safe way to be wrong: it costs one model call, where
    // the other way round serves a wrong thread for ever.
    expect(await ask("unreadable", BLOCKS)).toBe(false);
  });

  it("says not-done when the thread carries no stamp at all", async () => {
    await writeJson(pathFor(where, "tweets", "tweets"), { tweets: [], limit: 280 });
    await writeJson(pathFor(where, "toc", "blocks"), { blocks: BLOCKS });
    expect(await stepIsDone(STEPS.tweets, ctxAt(elsewhere), store)).toBe(false);
  });

  /**
   * The store is the authority, not the path in the context.
   *
   * Red before D0: `isDone: (ctx) => threadIsCurrent(ctx.dir)` read `ctx.dir`
   * and answered *done* about a thread the store does not hold, which is the
   * whole reason freshness had to move behind the seam.
   */
  it("reads the store, not the directory the context happens to name", async () => {
    const inTheStore = await tempArticle();
    const onTheSide = await tempArticle();
    const moved = [...BLOCKS, block("spya-eeeeee", "Rewritten since.")];
    // What the store holds is stale: written against BLOCKS, and the blocks it
    // holds have moved on.
    await writeJson(pathFor(inTheStore, "tweets", "tweets"), threadFor(BLOCKS, {}));
    await writeJson(pathFor(inTheStore, "toc", "blocks"), { blocks: moved });
    // `ctx.dir` holds a perfectly current pair, and is the wrong place to look.
    await writeJson(path.join(onTheSide.dir, "tweets.json"), threadFor(moved, {}));
    await writeJson(path.join(onTheSide.dir, "blocks.json"), { blocks: moved });

    const done = await stepIsDone(
      STEPS.tweets,
      ctxAt(onTheSide.dir),
      createFsArtifactStore(() => inTheStore),
    );
    expect(done).toBe(false);
  });
});
