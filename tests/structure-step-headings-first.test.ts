/**
 * **A first import that asked to open early gets a stand-in tree from the
 * `structure` step with no model call. The marked import may resume with that
 * stand-in; after publication, structure still has to replace it.**
 *
 * Stage 1 of
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md.
 * Three things, none of which needs a database:
 *
 * 1. `generateStructure({ headingsOnly })` (src/structure.ts) returns the
 *    bounded headings tree marked `provisional: "awaiting-structure"`, asking
 *    nothing — unless the body is too short for that builder, when it asks the
 *    model as it always did.
 * 2. `STEPS.structure.run` (src/pipeline.ts) passes `headingsOnly` only when
 *    the step carries the mark **and** the article has never been published.
 *    The second half is what lets the job that builds the real tree reach the
 *    model whatever mark it carries.
 * 3. `stepIsDone` answers *no* for the successor while the stored tree is the
 *    stand-in, and *yes* for a marked unpublished import resuming its work.
 *    Without the former the second job skips and the real tree never arrives;
 *    without the latter a short claim repeatedly builds the same stand-in. See
 *    tests/open-before-structure-queue.test.ts for the same through the queue.
 *
 * And the two small things beside them: the progress card's clause for the new
 * source (GPT Sol, F7), and which steps count as reading the structure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, Tree } from "../src/types.js";

/** What the structure call "returns". A root alone is a sound answer at any size. */
const MODEL_ANSWER = JSON.stringify({
  root: { title: "The piece", gist: "The piece says things.", question: "What follows?" },
});
let modelCalls = 0;

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      modelCalls += 1;
      return {
        onText: () => {},
        finalMessage: async () => ({
          content: [{ type: "text", text: MODEL_ANSWER }],
          stop_reason: "end_turn",
          usage: { input_tokens: 7, output_tokens: 11 },
        }),
      };
    },
  };
});

const { generateStructure } = await import("../src/structure.js");
const { buildBoundedHeadingTree, BOUNDED_TREE_GENERATOR } = await import("../src/heading-tree.js");
const { mergeLabels } = await import("../src/labels.js");
const { checkTree } = await import("../src/tree-invariants.js");
const { STEPS, STEP_ORDER, needsRealStructure, stepIsDone, structureSourceDetail } = await import(
  "../src/pipeline.js"
);
const { blocksArtefact } = await import("../src/blocks.js");
const { awaitingStructure } = await import("../src/types.js");
const { memoryCheckpoints } = await import("./helpers/memory-checkpoints.js");
const { memoryArtefacts } = await import("./helpers/memory-artefacts.js");
const { heading, paragraphs } = await import("./helpers/bounded-tree.js");

type StepContext = import("../src/pipeline.js").StepContext;

const SLUG = "headings-first";
/** A headed piece, comfortably over the bounded builder's four-block minimum. */
const BLOCKS: Block[] = [
  heading("One"),
  ...paragraphs(6),
  heading("Two"),
  ...paragraphs(6, 6),
];

const checkpoints = () => memoryCheckpoints({ slug: SLUG, articleId: "a-1" });

beforeEach(() => {
  modelCalls = 0;
});

describe("generateStructure with headingsOnly", () => {
  it("returns the bounded headings tree, awaiting, and asks no model", async () => {
    const out = await generateStructure({
      power: "standard",
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: checkpoints(),
      deepen: false,
      headingsOnly: true,
    });

    expect(modelCalls, "a model was asked for a tree the import was not going to wait for").toBe(0);
    expect(out.source).toEqual({ by: "headings", reason: "before-structure" });
    expect(out.parts.tree.provisional, "the tree does not say the real one is coming").toBe(
      "awaiting-structure",
    );
    /* The same tree the fallbacks return, with that one field different. */
    const bounded = buildBoundedHeadingTree(BLOCKS, SLUG).tree;
    expect(out.parts.tree).toEqual(mergeLabels({ ...bounded, provisional: "awaiting-structure" }, {}));
    expect(out.parts.tree.generator).toBe(BOUNDED_TREE_GENERATOR);
    expect(checkTree(BLOCKS, out.parts.tree).problems).toEqual([]);
    /* Nothing was bought, and the run does not pretend otherwise. */
    expect([out.wholeDocumentCalls, out.inputTokens, out.outputTokens]).toEqual([0, 0, 0]);
    /* A pending manifest, as every structure run writes: the publication gate
       refuses a tree without one. */
    expect(out.parts.labels.batches).toBeNull();
  });

  it("asks the model after all when the body is under the bounded builder's minimum", async () => {
    const short = paragraphs(3);
    const out = await generateStructure({
      power: "standard",
      blocks: short,
      slug: SLUG,
      checkpoints: checkpoints(),
      deepen: false,
      headingsOnly: true,
    });

    expect(modelCalls, "a three-paragraph article was left with no tree to publish").toBe(1);
    expect(out.source).toEqual({ by: "model" });
    expect(awaitingStructure(out.parts.tree)).toBe(false);
  });

  it("is the ordinary run without the option", async () => {
    const out = await generateStructure({
      power: "standard",
      blocks: BLOCKS,
      slug: SLUG,
      checkpoints: checkpoints(),
      deepen: false,
    });
    expect(modelCalls).toBe(1);
    expect(out.source).toEqual({ by: "model" });
    expect(out.parts.tree.provisional).toBeUndefined();
  });
});

/* ---------------------------------------------------------- the step itself -- */

function ctxFor(over: Partial<StepContext> = {}): StepContext {
  return {
    slug: SLUG,
    report: () => {},
    preview: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
    power: "standard",
    ...over,
  };
}

/** A store holding stage 3's blocks; `published` adds what an earlier publication leaves. */
function storeWith(blocks: Block[], published: boolean) {
  const store = memoryArtefacts();
  store.plant(SLUG, "blocks", "blocks", blocksArtefact(blocks));
  store.plant(SLUG, "extract", "meta", { title: "The piece" });
  if (published) store.plant(SLUG, "structure", "blocks", blocksArtefact(blocks));
  return store;
}

describe("STEPS.structure.run", () => {
  it("with the mark and nothing ever published: no model call, an awaiting tree", async () => {
    const store = storeWith(BLOCKS, false);
    const product = await STEPS.structure.run(ctxFor({ headingsFirst: true }), store, checkpoints());

    expect(modelCalls, "the import waited on the model after asking not to").toBe(0);
    expect(awaitingStructure(product.parts.tree as Tree)).toBe(true);
    expect(product.detail).toContain("a first outline (the full structure follows)");
    expect(product.detail, "the card reports a failure that did not happen").not.toContain("too long");
  });

  it("with the mark on an article that has been published: the model is asked", async () => {
    const store = storeWith(BLOCKS, true);
    const product = await STEPS.structure.run(ctxFor({ headingsFirst: true }), store, checkpoints());

    expect(modelCalls, "a published article's tree was replaced by a stand-in").toBe(1);
    expect(awaitingStructure(product.parts.tree as Tree)).toBe(false);
  });

  it("without the mark: the model is asked, as it always was", async () => {
    const store = storeWith(BLOCKS, false);
    const product = await STEPS.structure.run(ctxFor(), store, checkpoints());

    expect(modelCalls).toBe(1);
    expect(awaitingStructure(product.parts.tree as Tree)).toBe(false);
  });

  it("with the mark but under the minimum body: the model is asked in the import", async () => {
    const store = storeWith(paragraphs(3), false);
    const product = await STEPS.structure.run(ctxFor({ headingsFirst: true }), store, checkpoints());

    expect(modelCalls).toBe(1);
    expect(awaitingStructure(product.parts.tree as Tree)).toBe(false);
  });

  it("describes a headingless stand-in without claiming it came from headings", async () => {
    const store = storeWith(paragraphs(12), false);
    const product = await STEPS.structure.run(ctxFor({ headingsFirst: true }), store, checkpoints());
    expect(awaitingStructure(product.parts.tree as Tree)).toBe(true);
    expect(product.detail).toContain("a first outline");
    expect(product.detail).not.toContain("from its headings");
  });
});

/* ------------------------------------------------------------------ isDone -- */

describe("stepIsDone for structure", () => {
  /** Run the step and store its product, as the commit does. */
  async function stored(headingsFirst: boolean) {
    const store = storeWith(BLOCKS, false);
    const product = await STEPS.structure.run(
      ctxFor(headingsFirst ? { headingsFirst: true } : {}),
      store,
      checkpoints(),
    );
    await store.write(SLUG, "structure", product.parts, product.stamp ?? {});
    return store;
  }

  it("is not done while the stored tree is the stand-in", async () => {
    const store = await stored(true);
    /* The control: everything the presence check asks for is there. */
    expect(await store.has(SLUG, "structure", STEPS.structure.produces)).toBe(true);
    expect(
      await stepIsDone(STEPS.structure, ctxFor(), store),
      "the stand-in counted as the structure, so the job that replaces it would skip",
    ).toBe(false);
  });

  it("is done once a real tree is stored", async () => {
    const store = await stored(false);
    expect(await stepIsDone(STEPS.structure, ctxFor(), store)).toBe(true);
  });

  it("keeps a marked unpublished import's stand-in when its claim resumes", async () => {
    const store = await stored(true);
    // Draft outputs are not earlier published blocks. This fake has no revision model.
    store.hasEarlierBlocks = async () => false;
    expect(await stepIsDone(STEPS.structure, ctxFor({ headingsFirst: true }), store)).toBe(true);
  });

  it("replaces the stand-in after publication even when the step carries the mark", async () => {
    const store = await stored(true);
    store.hasEarlierBlocks = async () => true;
    expect(await stepIsDone(STEPS.structure, ctxFor({ headingsFirst: true }), store)).toBe(false);
  });
});

/* ------------------------------------------------------ the two small rules -- */

describe("structureSourceDetail", () => {
  it("has its own clause for the stand-in, and not the too-long one", () => {
    const clause = structureSourceDetail({ by: "headings", reason: "before-structure" });
    expect(clause).toBe(", a first outline (the full structure follows)");
  });

  it("keeps the two fallbacks' clauses", () => {
    expect(structureSourceDetail({ by: "model" })).toBe("");
    expect(structureSourceDetail({ by: "headings", reason: "labels-could-not-ask" })).toBe(
      ", from its headings (a section was too long to label)",
    );
  });
});

describe("needsRealStructure", () => {
  it("is every step after structure but assets, by position", () => {
    const after = STEP_ORDER.slice(STEP_ORDER.indexOf("structure") + 1).filter((s) => s !== "assets");
    expect(after.length).toBeGreaterThan(10);
    expect(STEP_ORDER.filter(needsRealStructure)).toEqual(after);
    /* Named, so the rule cannot agree with itself about an empty list. */
    for (const step of ["labels", "arc", "glossary", "skim"] as const) {
      expect(needsRealStructure(step), step).toBe(true);
    }
    for (const step of ["fetch", "metadata", "extract", "blocks", "structure", "assets"] as const) {
      expect(needsRealStructure(step), step).toBe(false);
    }
  });
});
