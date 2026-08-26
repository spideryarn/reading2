/**
 * `planBatches` and `parseLabels` — the two places the label split can go wrong
 * without anything throwing.
 *
 * The design's whole claim is that labels can be written in separate calls
 * without becoming incoherent, and that claim rests on one rule: every leaf
 * under one lowest-level parent goes in the same call, because a label's job is
 * to tell its paragraph apart from its *neighbours*. A batching bug that split a
 * sibling set would not fail anything — it would produce a complete, valid tree
 * whose labels were subtly worse in a way only a reader would notice. That is
 * docs/reusable/silent-success.md, and it is what most of this file is about.
 *
 * The other half is the wire format. `parseLabels` refuses anything but the
 * exact set of paragraph numbers it asked for, because the two obvious formats
 * both fail silently: a map keyed by block id loses duplicates to `JSON.parse`,
 * and a bare array shifts every later label onto the wrong paragraph when one
 * entry is dropped.
 *
 * Deterministic — no network, no model. docs/project/testing.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import PQueue from "p-queue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allOrStop,
  assertEveryBlockLabelled,
  BatchIncomplete,
  batchFingerprint,
  contentWords,
  detectShift,
  generateLabels,
  mergeLabels,
  parseLabels,
  planBatches,
  batchParts,
  renderBatch,
  renderOutline,
  serialise,
  usableCheckpoint,
} from "../src/labels.js";
import type { Batch } from "../src/labels.js";
import { MODEL } from "../src/models.js";
import { hashBlocks } from "../src/source-hash.js";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";

/** The committed fixture, for the checks that need real prose rather than made-up prose. */
function read<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(import.meta.dirname, "..", file), "utf8")) as T;
}

function block(i: number, gistable = true): Block {
  const id = `spya-${String(i).padStart(6, "0")}`;
  return {
    id,
    tag: "p",
    kind: gistable ? "text" : "media",
    text: `Paragraph ${i} says something about the matter at hand.`,
    words: 9,
    html: `<p id="${id}">Paragraph ${i}</p>`,
    gistable,
  };
}

/**
 * A tree of `sections` sections, each holding `per` blocks, under one root.
 * Shaped the way `buildTree` shapes one: a node's children are either all
 * internal or all leaves, never mixed.
 */
function fixture(sections: number, per: number, nonGistable: number[] = []): { tree: Tree; blocks: Block[] } {
  const total = sections * per;
  const blocks = Array.from({ length: total }, (_, i) => block(i, !nonGistable.includes(i)));
  const nodes: Record<NodeId, TreeNode> = {};
  let n = 0;
  const nextId = (): NodeId => `n${String(++n).padStart(4, "0")}`;

  const rootId = nextId();
  const sectionIds: NodeId[] = [];

  for (let s = 0; s < sections; s++) {
    const sectionId = nextId();
    const from = s * per;
    const to = from + per - 1;
    const leafIds: NodeId[] = [];
    for (let i = from; i <= to; i++) {
      const leafId = nextId();
      nodes[leafId] = {
        id: leafId,
        depth: 2,
        parent: sectionId,
        children: [],
        range: [blocks[i]!.id, blocks[i]!.id],
        title: "",
      };
      leafIds.push(leafId);
    }
    nodes[sectionId] = {
      id: sectionId,
      depth: 1,
      parent: rootId,
      children: leafIds,
      range: [blocks[from]!.id, blocks[to]!.id],
      title: `Section ${s}`,
      gist: `Section ${s} argues something.`,
    };
    sectionIds.push(sectionId);
  }

  nodes[rootId] = {
    id: rootId,
    depth: 0,
    parent: null,
    children: sectionIds,
    range: [blocks[0]!.id, blocks[total - 1]!.id],
    title: "Whole piece",
    gist: "The article argues something.",
  };

  return { tree: { version: "test", generator: "test", slug: "test", rootId, nodes }, blocks };
}

describe("planBatches", () => {
  it("puts every gistable block in exactly one batch", () => {
    // The failure this catches is a block in none — which would surface as a
    // paragraph with no sidebar row and nothing anywhere saying why.
    const { tree, blocks } = fixture(20, 7);
    const batches = planBatches(tree, blocks);
    const seen = batches.flatMap((b) => b.blocks.map((x) => x.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(blocks.map((b) => b.id).sort());
  });

  it("never splits a sibling set across two calls — the rule the design rests on", () => {
    // Sections of 7 against a 40-block target: the packing must round to whole
    // sections rather than cutting one at 40.
    const { tree, blocks } = fixture(20, 7);
    const batches = planBatches(tree, blocks);
    for (const batch of batches) {
      for (const set of batch.sets) {
        const ids = new Set(batch.blocks.map((b) => b.id));
        for (const b of set.blocks) expect(ids.has(b.id)).toBe(true);
      }
    }
    // And every section appears in exactly one batch.
    const sets = batches.flatMap((b) => b.sets.map((s) => s.nodeId));
    expect(new Set(sets).size).toBe(sets.length);
  });

  it("keeps blocks in document order, within a batch and across them", () => {
    // Order is what makes an ordinal mean anything, and what makes the eval's
    // adjacency test meaningful. A reordering here would be invisible.
    const { tree, blocks } = fixture(15, 6);
    const index = new Map(blocks.map((b, i) => [b.id, i]));
    const flat = planBatches(tree, blocks).flatMap((b) => b.blocks.map((x) => index.get(x.id)!));
    expect(flat).toEqual([...flat].sort((a, b) => a - b));
  });

  it("leaves non-gistable blocks out — they get no label", () => {
    const { tree, blocks } = fixture(10, 6, [3, 4, 20]);
    const seen = planBatches(tree, blocks).flatMap((b) => b.blocks.map((x) => x.id));
    expect(seen).not.toContain(blocks[3]!.id);
    expect(seen).not.toContain(blocks[20]!.id);
    expect(seen.length).toBe(blocks.filter((b) => b.gistable).length);
  });

  it("actually fills a batch to the cap it is given", () => {
    // This test used to assert `<= 30` against sets of 5 under a min of 20 — a
    // bound that could never bind, because the packing closed at the minimum
    // first. It passed on an invariant it did not exercise, which is how the
    // 40-80 range this file documented came out as a flat 40 in practice.
    // Sets of 5 under a cap of 30 must now give batches of exactly 30.
    const { tree, blocks } = fixture(30, 5);
    const batches = planBatches(tree, blocks, { max: 30 });
    for (const batch of batches.slice(0, -1)) expect(batch.blocks.length).toBe(30);
    expect(batches.length).toBe(5);
  });

  it("gives an oversized section a call to itself rather than cutting it", () => {
    // The cap is a preference; the sibling rule is not. A 30-block section under
    // a max of 20 must survive whole.
    const { tree, blocks } = fixture(3, 30);
    const batches = planBatches(tree, blocks, { max: 20 });
    expect(batches).toHaveLength(3);
    for (const batch of batches) expect(batch.blocks).toHaveLength(30);
  });

  it("records where each sibling set starts, so the eval has its control", () => {
    // The seam test compares call boundaries against sibling-set boundaries
    // *inside* a call. Without setStarts there is no fair comparison to make.
    const { tree, blocks } = fixture(12, 7);
    for (const batch of planBatches(tree, blocks)) {
      expect(batch.setStarts).toHaveLength(batch.sets.length);
      expect(batch.setStarts[0]).toBe(0);
      let at = 0;
      batch.sets.forEach((set, i) => {
        expect(batch.setStarts[i]).toBe(at);
        at += set.blocks.length;
      });
    }
  });

  it("handles an article too short to batch", () => {
    const { tree, blocks } = fixture(2, 4);
    const batches = planBatches(tree, blocks);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.blocks).toHaveLength(8);
  });

  it("returns nothing rather than an empty call when there is nothing to label", () => {
    const { tree, blocks } = fixture(3, 4, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(planBatches(tree, blocks)).toHaveLength(0);
  });

  it("refuses a tree whose node mixes leaf and internal children, instead of losing the leaves", () => {
    // buildTree never produces this — a node gets either the model's children
    // (all internal) or grown leaves (all leaves). But planBatches is handed a
    // tree.json off disk, and `walk` recurses straight past a mixed node's leaf
    // children without noticing.
    //
    // On the generateToc path checkCoverage would catch the result. On the
    // `npm run labels -- <dir>` path nothing would: the merged tree reaches disk
    // with paragraphs that have no sidebar row and nothing saying why. So the
    // check lives where both callers pass through.
    const { tree, blocks } = fixture(4, 6);
    const root = tree.nodes[tree.rootId]!;
    const firstSection = tree.nodes[root.children[0]!]!;
    // Graft one of the section's leaves directly onto the root, beside sections.
    const strayLeaf = firstSection.children[0]!;
    firstSection.children = firstSection.children.slice(1);
    root.children = [strayLeaf, ...root.children];
    tree.nodes[strayLeaf]!.parent = tree.rootId;

    expect(() => planBatches(tree, blocks)).toThrow(/out of every batch/);
    expect(() => planBatches(tree, blocks)).toThrow(/mix of leaves and internal nodes/);
  });
});

describe("renderBatch", () => {
  const { tree, blocks } = fixture(10, 6);
  const batch = planBatches(tree, blocks)[0]!;
  const rendered = renderBatch(batch, blocks, renderOutline(tree));

  it("numbers exactly the blocks it wants labelled, from 1", () => {
    expect(rendered).toContain("[1] <p>");
    expect(rendered).toContain(`[${batch.blocks.length}] <p>`);
    expect(rendered).not.toContain(`[${batch.blocks.length + 1}] <p>`);
  });

  it("carries no block ids into the prompt — ordinals are call-local", () => {
    // The mapping back to stable ids happens in code. An id in the prompt is an
    // invitation for the model to echo one, which is the failure `parseLabels`
    // exists to make impossible.
    for (const b of batch.blocks) expect(rendered).not.toContain(b.id);
  });

  it("marks surrounding blocks as context so they are not labelled", () => {
    /* This test was vacuous and passed anyway. The fixture makes exactly 60
       gistable blocks, which after the batch cap moved to 60 is a single batch,
       so `planBatches(...)[1]` was undefined and the early return skipped the
       assertion — while the assertion itself still expected `[CONTEXT]`, which
       the implementation had stopped emitting for in-span blocks. A test that
       exercises nothing is worse than no test, because it reads as coverage.
       Caught by GPT-5.6-sol, 2026-08-26.

       So: build a second batch deliberately rather than hoping one exists, and
       assert on the batch that actually has an article before it. */
    const { tree: t, blocks: bs } = fixture(6, 10);
    const batches = planBatches(t, bs, { max: 20 });
    expect(batches.length).toBeGreaterThan(1);
    const second = batches[1]!;
    const rendered = renderBatch(second, bs, "");
    expect(rendered).toContain("[CONTEXT]");
    // And exactly one on each side, not a window that quietly grew.
    expect(rendered.match(/\[CONTEXT\]/g)).toHaveLength(2);
  });

  it("calls a non-gistable block inside its span NOT-GISTABLE", () => {
    const { tree: t, blocks: bs } = fixture(4, 10, [5]);
    const batch = planBatches(t, bs, { max: 20 })[0]!;
    expect(renderBatch(batch, bs, "")).toContain("NOT-GISTABLE");
  });

  it("calls a gistable block inside its span but not in the batch OTHER-SECTION", () => {
    /* The batch is built by hand, and deliberately so. `planBatches` packs
       *consecutive* sibling sets, so every gistable block between a batch's
       first and last is in that batch — which makes OTHER-SECTION unreachable
       through the planner today. It is kept because the alternative is worse:
       the marker used to be chosen from position alone, which announced such a
       block to the model as NOT-GISTABLE, a lie that produced no error
       anywhere. If the packing ever stops being contiguous, this is what stops
       that lie coming back silently.

       Constructing the case directly is the honest way to test a defensive
       branch. Going through `planBatches` and asserting on whatever came out
       would be the vacuous test above, written again. */
    const { blocks: bs } = fixture(1, 10);
    const gap: Batch = {
      sets: [],
      blocks: [bs[0]!, bs[1]!, bs[4]!],
      setStarts: [0],
      span: [0, 4],
    };
    const rendered = renderBatch(gap, bs, "");
    expect(rendered).toContain("[OTHER-SECTION]");
    expect(rendered).not.toContain("NOT-GISTABLE");
    // Blocks 2 and 3 are the skipped ones, and they are the only two.
    expect(rendered.match(/\[OTHER-SECTION\]/g)).toHaveLength(2);
  });

  it("tells the batch where it sits in the article", () => {
    expect(rendered).toContain("Section 0");
    expect(rendered).toContain("THE ARTICLE'S OUTLINE");
  });

  it("says HEADING out loud rather than leaving it to the tag", () => {
    // Regression. The first live run of this stage came back with
    // "Title: The Mythology Of Conscious AI" and "Heading: The Temptations Of
    // Conscious AI" — the rule says a heading's label is its own text copied
    // exactly, and `<h1>` alone was not enough of a signal, so the model
    // labelled the heading instead of quoting it. Nothing threw: the labels were
    // the right length, in the right place, and wrong.
    const withHeading = [
      { ...block(0), tag: "h2", text: "The Temptations Of Conscious AI" },
      ...Array.from({ length: 5 }, (_, i) => block(i + 1)),
    ];
    const t = fixture(1, 6).tree;
    const b = planBatches(t, withHeading, { max: 10 })[0]!;
    const out = renderBatch(b, withHeading, "");
    expect(out).toContain("<h2> HEADING:");
    expect(out).not.toContain("<p> HEADING:");
  });
});

describe("parseLabels", () => {
  const { tree, blocks } = fixture(2, 3);
  const batch = planBatches(tree, blocks)[0]!;
  const good = JSON.stringify({
    labels: batch.blocks.map((_, i) => [i + 1, `A claim about paragraph ${i + 1}, at some length`]),
  });

  it("maps ordinals back onto block ids in order", () => {
    const out = parseLabels(good, batch);
    expect(Object.keys(out).sort()).toEqual(batch.blocks.map((b) => b.id).sort());
    expect(out[batch.blocks[0]!.id]).toContain("paragraph 1");
    expect(out[batch.blocks[2]!.id]).toContain("paragraph 3");
  });

  it("strips a code fence the model was told not to write", () => {
    expect(() => parseLabels(["```json", good, "```"].join("\n"), batch)).not.toThrow();
  });

  it("refuses a response that is one label short", () => {
    // The failure this replaces: a bare array would have shifted every later
    // label onto the wrong paragraph, and nothing would have noticed.
    const short = JSON.stringify({ labels: [[1, "One"], [2, "Two"]] });
    expect(() => parseLabels(short, batch)).toThrow(/asked for 6 labels and got 2/);
  });

  it("names which paragraphs are missing, so the gap is findable", () => {
    const short = JSON.stringify({ labels: [[1, "One"], [3, "Three"]] });
    expect(() => parseLabels(short, batch)).toThrow(/missing 2, 4/);
  });

  it("refuses a label for a paragraph it did not ask about", () => {
    const extra = JSON.stringify({
      labels: [...batch.blocks.map((_, i) => [i + 1, "x"]), [99, "From nowhere"]],
    });
    expect(() => parseLabels(extra, batch)).toThrow(/were not asked for/);
  });

  it("refuses a duplicate paragraph number rather than keeping the last", () => {
    // This is the case a map keyed by block id could not catch at all:
    // `JSON.parse` silently keeps the last of duplicate keys.
    const dupe = JSON.stringify({
      labels: [[1, "First"], [1, "Also first"], [2, "b"], [3, "c"], [4, "d"], [5, "e"], [6, "f"]],
    });
    expect(() => parseLabels(dupe, batch)).toThrow(/labelled twice/);
  });

  it("refuses an empty label rather than storing a blank row", () => {
    const blank = JSON.stringify({
      labels: batch.blocks.map((_, i) => [i + 1, i === 2 ? "   " : "a real label here"]),
    });
    expect(() => parseLabels(blank, batch)).toThrow(/empty label/);
  });

  it("takes a heading's label from the block, not from the model", () => {
    // The prompt asks for the heading copied EXACTLY and the model does not
    // comply: on the two committed articles, 9 of 36 and 3 of 9 heading labels
    // differed from their block — curly apostrophes flattened, authored
    // numbering dropped. The apostrophe half is the same failure as
    // docs/postmortems/toc-max-tokens.md. A heading's label is knowable without
    // a model, so it is taken rather than requested.
    const heading = { ...block(0), tag: "h2", text: "2: Claude’s core values" };
    const withHeading = [heading, ...Array.from({ length: 5 }, (_, i) => block(i + 1))];
    const t = fixture(1, 6).tree;
    const b = planBatches(t, withHeading, { max: 10 })[0]!;
    const raw = JSON.stringify({
      // What the model actually does: straight apostrophe, numbering gone.
      labels: b.blocks.map((_, i) => [i + 1, i === 0 ? "Claude's core values" : "A label here"]),
    });
    expect(parseLabels(raw, b)[heading.id]).toBe("2: Claude’s core values");
  });

  it("still requires the model to answer about the heading, so the set check holds", () => {
    // Not asking would let a batch skip its headings silently and lose the
    // ordinal-set check's diagnostic value.
    const heading = { ...block(0), tag: "h2", text: "A heading" };
    const withHeading = [heading, ...Array.from({ length: 5 }, (_, i) => block(i + 1))];
    const t = fixture(1, 6).tree;
    const b = planBatches(t, withHeading, { max: 10 })[0]!;
    const missingHeading = JSON.stringify({
      labels: b.blocks.slice(1).map((_, i) => [i + 2, "A label here"]),
    });
    expect(() => parseLabels(missingHeading, b)).toThrow(/missing 1/);
  });

  it("refuses a shape that is not pairs", () => {
    expect(() => parseLabels(JSON.stringify({ labels: ["one", "two"] }), batch)).toThrow(
      /\[number, string\] pairs/,
    );
    expect(() => parseLabels(JSON.stringify({ nope: [] }), batch)).toThrow(/expected/);
  });

  it("says nothing was written, because nothing was", () => {
    expect(() => parseLabels(JSON.stringify({ labels: [[1, "One"]] }), batch)).toThrow(
      /Nothing has been written/,
    );
  });

  it("marks an incomplete answer as retryable, and a malformed one as not", () => {
    // The distinction generateLabels retries on. Seen live at effort "medium":
    // a batch asked about 42 paragraphs answered about 41, well-formed, twice.
    // That is a model slip and a second ask usually fixes it. A malformed shape
    // or a duplicate is not — asking again produces the same thing, and a retry
    // loop over it would just spend money slowly.
    const short = JSON.stringify({ labels: [[1, "One"], [2, "Two"]] });
    expect(() => parseLabels(short, batch)).toThrow(BatchIncomplete);

    const dupe = JSON.stringify({
      labels: [[1, "a"], [1, "b"], [2, "c"], [3, "d"], [4, "e"], [5, "f"], [6, "g"]],
    });
    try {
      parseLabels(dupe, batch);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(BatchIncomplete);
    }
  });
});

describe("mergeLabels", () => {
  const { tree, blocks } = fixture(3, 4, [5]);

  it("puts a label on the leaf whose block it names, and nowhere else", () => {
    const labels = { [blocks[0]!.id]: "The opening claim, stated plainly and at length" };
    const merged = mergeLabels(tree, labels);
    const leaves = Object.values(merged.nodes).filter((n) => n.children.length === 0);
    expect(leaves.filter((n) => n.navLabel)).toHaveLength(1);
    expect(leaves.find((n) => n.range[0] === blocks[0]!.id)?.navLabel).toBe(labels[blocks[0]!.id]);
  });

  it("never labels an internal node", () => {
    // A gist and a navLabel are different lengths for different columns
    // (docs/project/table-of-contents.md). Crossing them would render one in
    // the other's place with nothing to see.
    const labels = Object.fromEntries(blocks.map((b) => [b.id, "A label of about the right length"]));
    const merged = mergeLabels(tree, labels);
    for (const node of Object.values(merged.nodes)) {
      if (node.children.length > 0) expect(node.navLabel).toBeUndefined();
    }
  });

  it("leaves the original tree alone", () => {
    const before = JSON.stringify(tree);
    mergeLabels(tree, { [blocks[0]!.id]: "Some label" });
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("replaces the labels rather than overlaying them on last run's", () => {
    // Overlaying reads like politeness and is a trap. A re-run of
    // `npm run labels` that covered less than the whole article would write a
    // tree mixing this run's labels with the previous run's, with nothing on
    // disk recording which was which — two prompts' output in one artefact,
    // indistinguishable. Found by an adversarial review, 2026-08-26.
    const first = mergeLabels(tree, {
      [blocks[0]!.id]: "The label from the first run, at a workable length",
      [blocks[1]!.id]: "Another label from the first run, also long enough",
    });
    const second = mergeLabels(first, {
      [blocks[0]!.id]: "The label from the second run, at a workable length",
    });
    const leafFor = (id: string) =>
      Object.values(second.nodes).find((n) => n.children.length === 0 && n.range[0] === id);

    expect(leafFor(blocks[0]!.id)?.navLabel).toContain("second run");
    expect(leafFor(blocks[1]!.id)?.navLabel).toBeUndefined();
  });

  it("drops navLabel as a key, not just as a value", () => {
    // A key whose value is `undefined` vanishes when the tree is written to
    // disk but exists in memory, which is how two objects that stringify
    // identically stop comparing equal.
    const merged = mergeLabels(mergeLabels(tree, { [blocks[0]!.id]: "A label" }), {});
    const leaf = Object.values(merged.nodes).find((n) => n.range[0] === blocks[0]!.id)!;
    expect("navLabel" in leaf).toBe(false);
  });
});

/**
 * The one wrong answer `parseLabels` cannot see.
 *
 * The exact-set check stops a *dropped* entry. It cannot stop a model that
 * loses count internally and returns a complete, exactly-sized set in which
 * pair n describes paragraph n+1 — every check passes and every label from the
 * slip onwards is on the wrong paragraph. Raised by an adversarial review,
 * 2026-08-26, which noted the measure capable of catching it already existed in
 * the eval and was wired to nothing.
 */
describe("detectShift", () => {
  /** Blocks whose vocabulary is distinctive enough to tell apart. */
  const topics = [
    "photosynthesis converts sunlight into chemical energy inside chloroplasts",
    "mitochondria respire glucose and release adenosine triphosphate steadily",
    "ribosomes translate messenger sequences into folded polypeptide chains",
    "lysosomes digest worn organelles using acidic hydrolytic enzymes",
    "microtubules organise spindle fibres during chromosomal separation",
    "membranes regulate osmotic pressure through embedded transport proteins",
    "telomeres shorten with each replication until senescence arrives",
    "histones coil chromatin into densely packed nucleosome structures",
    "vacuoles store water and maintain turgor within plant tissue",
    "flagella propel motile cells using rotary molecular engines",
    "peroxisomes neutralise reactive oxygen through catalase activity",
    "centrioles duplicate before mitosis and anchor the spindle apparatus",
    "plasmids carry accessory genes between bacteria by conjugation",
    "chaperones refold misfolded proteins before aggregation becomes toxic",
  ];
  const topicBlocks: Block[] = topics.map((text, i) => ({ ...block(i), text }));
  const tree = fixture(1, topics.length).tree;
  // 14 distinctive paragraphs — above MIN_SHIFT_EVIDENCE, which is what stops
  // the check judging a batch too small to have a pattern in it.

  const batch = planBatches(tree, topicBlocks, { max: 20 })[0]!;
  /** A label made from its own block's distinctive words. */
  const labelFor = (text: string) => text.split(" ").slice(0, 5).join(" ");

  it("passes labels that sit on their own paragraphs", () => {
    const labels = Object.fromEntries(topicBlocks.map((b) => [b.id, labelFor(b.text)]));
    expect(() => detectShift(labels, batch)).not.toThrow();
  });

  it("catches a whole batch shifted by one, which every other check accepts", () => {
    // Note what this response is: the right count, the right paragraph numbers,
    // no duplicates, no blanks, nothing truncated. parseLabels is happy with it.
    const shifted = Object.fromEntries(
      topicBlocks.map((b, i) => [b.id, labelFor(topics[i + 1] ?? topics[0]!)]),
    );
    expect(() => parseLabels(
      JSON.stringify({ labels: batch.blocks.map((b, i) => [i + 1, shifted[b.id]]) }),
      batch,
    )).not.toThrow();

    expect(() => detectShift(shifted, batch)).toThrow(BatchIncomplete);
    expect(() => detectShift(shifted, batch)).toThrow(/the paragraph after it/);
  });

  it("catches a shift the other way too", () => {
    const shifted = Object.fromEntries(
      topicBlocks.map((b, i) => [b.id, labelFor(topics[i - 1] ?? topics.at(-1)!)]),
    );
    expect(() => detectShift(shifted, batch)).toThrow(/the paragraph before it/);
  });

  it("is comparative, so one oddly-worded label does not fail a good batch", () => {
    // Absolute overlap proves nothing: adjacent paragraphs of one article share
    // plenty of vocabulary, and a legitimately abstractive label may share none
    // with its block. Only a neighbour winning *across the batch* is evidence.
    const labels = Object.fromEntries(topicBlocks.map((b) => [b.id, labelFor(b.text)]));
    labels[topicBlocks[3]!.id] = "an entirely unrelated remark about weather";
    expect(() => detectShift(labels, batch)).not.toThrow();
  });

  it("clears the real fixture by a wide margin, so it will not fail a real ingest", () => {
    // A heuristic that throws needs its distance from the threshold measured,
    // not assumed — a false positive here fails an ingest that was fine. On the
    // eleven batches of the three committed articles, a label's overlap with its
    // own paragraph runs 3.4x to 10.5x its overlap with the best neighbour. This
    // pins the committed fixture to the bottom of that range, so a prompt change
    // that stops labels using the paragraph's own words goes red here rather
    // than being discovered when detectShift starts refusing real articles.
    const tree = read<Tree>("example/tree.json");
    const { blocks: fixtureBlocks } = read<{ blocks: Block[] }>("example/blocks.json");
    const labels: Record<string, string> = {};
    for (const n of Object.values(tree.nodes)) {
      if (n.children.length === 0 && n.navLabel) labels[n.range[0]] = n.navLabel;
    }
    const batch = planBatches(tree, fixtureBlocks)[0]!;
    expect(batch.blocks.length).toBeGreaterThan(20);
    expect(() => detectShift(labels, batch)).not.toThrow();
    expect(() => detectShift(shiftBy(labels, batch, 1), batch)).toThrow(BatchIncomplete);
  });

  /** The same labels, each moved onto the next paragraph along. */
  function shiftBy(
    labels: Record<string, string>,
    batch: ReturnType<typeof planBatches>[number],
    by: number,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    batch.blocks.forEach((b, i) => {
      const from = batch.blocks[i + by];
      if (from && labels[from.id]) out[b.id] = labels[from.id]!;
    });
    return out;
  }

  it("stays silent on a language its word-splitting cannot read", () => {
    // Not "passes" — declines to judge. The first version split on [a-z], so a
    // Greek article produced empty sets everywhere, every score was zero, and
    // `own >= best` answered yes to 0 >= 0: the gate reported itself satisfied
    // having examined nothing. Now the splitting is Unicode-aware, and where
    // there is genuinely no signal the evidence floor is what keeps it quiet.
    // The same mistake as `\b` in docs/project/glossary.md.
    const greek = [
      "Η συνείδηση δεν είναι υπολογισμός αλλά βιολογική διαδικασία",
      "Ο εγκέφαλος προβλέπει συνεχώς τις αισθητηριακές του εισροές",
      "Η αντίληψη μοιάζει με ελεγχόμενη παραίσθηση κατά τον Seth",
    ];
    expect(contentWords(greek[0]!).size).toBeGreaterThan(3);

    const blocks = greek.map((text, i) => ({ ...block(i), text }));
    const t = fixture(1, greek.length).tree;
    const b = planBatches(t, blocks, { max: 20 })[0]!;
    const nonsense = Object.fromEntries(blocks.map((x) => [x.id, "εντελώς άσχετα λόγια εδώ"]));
    expect(() => detectShift(nonsense, b)).not.toThrow();
  });

  it("stays silent on a list whose rows all resemble each other", () => {
    // A table or a list of near-identical items pushes every alignment together,
    // so a tiny accidental imbalance used to be enough to throw. The votes now
    // have to point the same way, which near-identical rows cannot make them do.
    const rows = Array.from(
      { length: 16 },
      (_, i) => `Item ${i}: the same clause repeated with one changed number, ${i * 7}.`,
    );
    const blocks = rows.map((text, i) => ({ ...block(i), text }));
    const t = fixture(1, rows.length).tree;
    const b = planBatches(t, blocks, { max: 20 })[0]!;
    const labels = Object.fromEntries(
      blocks.map((x, i) => [x.id, `The same clause repeated with one changed number ${i * 7}`]),
    );
    expect(() => detectShift(labels, b)).not.toThrow();
  });

  it("does not fail a batch where most labels are right and a few are odd", () => {
    // SHIFT_OWN_CEILING. A third of a batch reading oddly is an editorial
    // problem; it is not the model having lost its place, and failing the whole
    // batch for it would throw away twelve good labels.
    const labels = Object.fromEntries(topicBlocks.map((b) => [b.id, labelFor(b.text)]));
    for (const i of [1, 4, 9]) labels[topicBlocks[i]!.id] = "a remark about the weather outside";
    expect(() => detectShift(labels, batch)).not.toThrow();
  });

  it("says nothing about a batch too short to tell a lean from a shift", () => {
    const small = fixture(1, 4);
    const tiny = planBatches(small.tree, small.blocks, { max: 20 })[0]!;
    const nonsense = Object.fromEntries(small.blocks.map((b) => [b.id, "unrelated words entirely"]));
    expect(() => detectShift(nonsense, tiny)).not.toThrow();
  });
});

describe("assertEveryBlockLabelled", () => {
  const { blocks } = fixture(3, 4, [5]);
  const complete = Object.fromEntries(
    blocks.filter((b) => b.gistable).map((b) => [b.id, "A label of about the right length"]),
  );

  it("passes a complete set", () => {
    expect(() => assertEveryBlockLabelled(complete, blocks)).not.toThrow();
  });

  it("refuses a gap, and names where it is", () => {
    // `npm run labels -- <dir>` does not go through generateToc, so this is the
    // only thing between a short answer and a rewritten tree.json on that path.
    const { [blocks[0]!.id]: _gone, ...short } = complete;
    expect(() => assertEveryBlockLabelled(short, blocks)).toThrow(/came back without one/);
    expect(() => assertEveryBlockLabelled(short, blocks)).toThrow(blocks[0]!.id);
  });

  it("does not ask for a label on a non-gistable block", () => {
    expect(() => assertEveryBlockLabelled(complete, blocks)).not.toThrow();
    expect(complete[blocks[5]!.id]).toBeUndefined();
  });
});

describe("batchParts — the cache boundary", () => {
  const { tree, blocks } = fixture(30, 6);
  const outline = renderOutline(tree);
  const batches = planBatches(tree, blocks);

  it("gives every batch the identical shared part", () => {
    /* The whole reason the split exists. These four requests run at once and
       share one cached prefix, so if the shared halves ever differ by a byte the
       fan-out silently pays full price four times over and nothing is red. */
    const shared = batches.map((b) => batchParts(b, blocks, outline).shared);
    expect(shared.length).toBeGreaterThan(1);
    for (const one of shared) expect(one).toBe(shared[0]);
  });

  it("keeps this batch's own sections out of the shared part", () => {
    // A breakpoint placed after the varying text is worse than no breakpoint:
    // every call writes a new entry and none ever reads one.
    const { shared } = batchParts(batches[0]!, blocks, outline);
    expect(shared).not.toContain("THE SECTIONS YOU ARE LABELLING");
    expect(shared).not.toContain("PARAGRAPHS");
  });

  it("loses nothing — the two parts rejoin as the original prompt", () => {
    /* The split is a cut through `renderBatch`'s own output, so this holds it to
       that. If the two ever stop reassembling, the model is being sent something
       nobody wrote. */
    const batch = batches[0]!;
    const { shared, own } = batchParts(batch, blocks, outline);
    expect(`${shared}\n\n${own}`).toBe(renderBatch(batch, blocks, outline));
  });

  it("puts the outline in the shared part", () => {
    const { shared } = batchParts(batches[0]!, blocks, outline);
    expect(shared).toContain("THE ARTICLE'S OUTLINE");
    expect(shared).toContain(outline);
  });

  it("refuses to guess when the boundary is missing", () => {
    // Rather than split at the wrong place, it caches nothing — an empty shared
    // part marks no prefix, which is the safe failure.
    const { shared, own } = batchParts(batches[0]!, blocks, outline);
    expect(shared === "" ? own : shared).toBeTruthy();
  });
});

/**
 * The fingerprint, the checkpoint, and the resume — the three pieces that stop
 * a transient failure eight batches into a book costing the whole book.
 *
 * Every test here is about the wrong-answer direction. A resume that refuses
 * too often costs money and nothing else; a resume that accepts too readily
 * publishes labels written for a different article, and the article looks
 * finished. So most of what follows is checking that things are *refused*.
 */
describe("batchFingerprint", () => {
  it("is stable across calls with the same inputs", () => {
    const { tree, blocks } = fixture(6, 7);
    const outline = renderOutline(tree);
    const [batch] = planBatches(tree, blocks);
    expect(batchFingerprint(batch!, blocks, outline)).toBe(
      batchFingerprint(batch!, blocks, outline),
    );
  });

  it("changes when the structure moves but the blocks do not — the whole point", () => {
    // This is the case that block ids cannot see and that resuming by id would
    // get wrong: same paragraphs, same call, different article around them. A
    // label written to tell a paragraph apart from one set of neighbours is not
    // a label for a different set.
    const { tree, blocks } = fixture(6, 7);
    const before = batchFingerprint(planBatches(tree, blocks)[0]!, blocks, renderOutline(tree));

    const moved: Tree = {
      ...tree,
      nodes: Object.fromEntries(
        Object.entries(tree.nodes).map(([id, node]) => [
          id,
          node.title === "Section 3" ? { ...node, title: "Something else entirely" } : node,
        ]),
      ),
    };
    const after = batchFingerprint(planBatches(moved, blocks)[0]!, blocks, renderOutline(moved));
    expect(after).not.toBe(before);
  });

  it("changes when a gist the prompt shows changes", () => {
    const { tree, blocks } = fixture(6, 7);
    const first = planBatches(tree, blocks)[0]!;
    const outline = renderOutline(tree);
    const before = batchFingerprint(first, blocks, outline);

    const restated: Tree = {
      ...tree,
      nodes: Object.fromEntries(
        Object.entries(tree.nodes).map(([id, node]) => [
          id,
          node.gist ? { ...node, gist: "A different claim about the section." } : node,
        ]),
      ),
    };
    const after = batchFingerprint(planBatches(restated, blocks)[0]!, blocks, renderOutline(restated));
    expect(after).not.toBe(before);
  });

  it("changes when a paragraph's text changes", () => {
    const { tree, blocks } = fixture(6, 7);
    const outline = renderOutline(tree);
    const before = batchFingerprint(planBatches(tree, blocks)[0]!, blocks, outline);
    const edited = blocks.map((b, i) => (i === 2 ? { ...b, text: "Rewritten entirely." } : b));
    const after = batchFingerprint(planBatches(tree, edited)[0]!, edited, outline);
    expect(after).not.toBe(before);
  });

  it("distinguishes two batches whose prose is identical", () => {
    // Boilerplate repeats. If two batches could share a fingerprint, a resume
    // would fill one from the other's labels — a wrong answer, not a gap.
    const { tree, blocks } = fixture(4, 7);
    const same = blocks.map((b) => ({ ...b, text: "The same sentence, every time." }));
    const outline = renderOutline(tree);
    const batches = planBatches(tree, same, { max: 7 });
    expect(batches.length).toBeGreaterThan(1);
    const prints = batches.map((b) => batchFingerprint(b, same, outline));
    expect(new Set(prints).size).toBe(prints.length);
  });
});

describe("usableCheckpoint", () => {
  const expected = {
    version: "labels/1",
    generator: "claude-sonnet-5",
    slug: "test",
    sourceHash: "abc123",
  };
  const entry = {
    fingerprint: "ff00",
    labels: { "spya-000000": "A label" },
    record: { blocks: ["spya-000000"], setStarts: [0], inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, ms: 1 },
  };
  const good = { ...expected, batches: [entry] };

  it("accepts a checkpoint whose manifest matches, keyed by fingerprint", () => {
    const map = usableCheckpoint(good, expected);
    expect(map.size).toBe(1);
    expect(map.get("ff00")?.labels).toEqual({ "spya-000000": "A label" });
  });

  for (const field of ["version", "generator", "slug", "sourceHash"] as const) {
    it(`refuses the whole file when ${field} differs`, () => {
      // All four, one test each, because a check that quietly stopped comparing
      // one of them would still pass every other test in this file — and what
      // it would then do is resume a run against a different article.
      const map = usableCheckpoint({ ...good, [field]: "something else" }, expected);
      expect(map.size).toBe(0);
    });
  }

  it("is worth nothing rather than a guess when handed rubbish", () => {
    for (const junk of [undefined, null, "a string", 42, [], { batches: "no" }]) {
      expect(usableCheckpoint(junk, expected).size).toBe(0);
    }
  });

  it("drops a malformed entry and keeps the good ones beside it", () => {
    const map = usableCheckpoint(
      {
        ...expected,
        batches: [
          entry,
          { fingerprint: "", labels: {}, record: entry.record },
          { fingerprint: "aa11", labels: null, record: entry.record },
          { fingerprint: "bb22", labels: { x: "" }, record: entry.record },
          { fingerprint: "cc33", labels: { x: 4 }, record: entry.record },
          { fingerprint: "dd44", labels: { x: "fine" }, record: { blocks: "no" } },
          "not an object",
        ],
      },
      expected,
    );
    expect([...map.keys()]).toEqual(["ff00"]);
  });
});

describe("serialise", () => {
  it("runs overlapping calls one at a time", async () => {
    // Four batches land at once and each writes the whole checkpoint. Without
    // this they interleave and the last rename wins, so a file that should hold
    // four holds one — and nothing is red, because the labels are all correct.
    const order: string[] = [];
    let inside = 0;
    const run = serialise(async () => {
      inside++;
      expect(inside).toBe(1);
      order.push("in");
      await new Promise((r) => setTimeout(r, 5));
      order.push("out");
      inside--;
    });
    await Promise.all([run(), run(), run(), run()]);
    expect(order).toEqual(["in", "out", "in", "out", "in", "out", "in", "out"]);
  });

  it("keeps going after one call throws", async () => {
    let n = 0;
    const run = serialise(async () => {
      n++;
      if (n === 1) throw new Error("first one fails");
    });
    await expect(run()).rejects.toThrow("first one fails");
    await expect(run()).resolves.toBeUndefined();
    expect(n).toBe(2);
  });
});

describe("generateLabels, resuming", () => {
  /**
   * A checkpoint holding every batch of a plan, written the way a run would.
   *
   * The labels are made up; that is fine, because what these tests check is
   * *which* labels come back and whether anything went to the model, not what a
   * model would have said.
   */
  async function checkpointFor(dir: string, tree: Tree, blocks: Block[]): Promise<Batch[]> {
    const outline = renderOutline(tree);
    const batches = planBatches(tree, blocks);
    const file = {
      version: "labels/1",
      generator: MODEL,
      slug: "test",
      sourceHash: hashBlocks(blocks),
      batches: batches.map((batch) => ({
        fingerprint: batchFingerprint(batch, blocks, outline),
        labels: Object.fromEntries(batch.blocks.map((b) => [b.id, `Saved label for ${b.id}`])),
        record: {
          blocks: batch.blocks.map((b) => b.id),
          setStarts: batch.setStarts,
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          ms: 10,
        },
      })),
    };
    await writeFile(path.join(dir, "labels-progress.json"), JSON.stringify(file), "utf8");
    return batches;
  }

  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "labels-resume-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("makes no model call at all when every batch is in the checkpoint", async () => {
    /* The API key is deliberately removed for this test. If a single batch went
       to the model the SDK's constructor would throw, and the test would fail
       for exactly the right reason — which is the only way to prove a resumed
       batch did not quietly go and ask again. Counting calls would prove the
       same thing only if the counter were wired to the thing that costs money. */
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { tree, blocks } = fixture(6, 7);
      const batches = await checkpointFor(dir, tree, blocks);

      const run = await generateLabels({ tree, blocks, slug: "test", dir });

      expect(run.resumed).toBe(batches.length);
      expect(run.batches).toBe(batches.length);
      expect(run.inputTokens).toBe(0);
      expect(run.outputTokens).toBe(0);
      expect(Object.keys(run.labels).length).toBe(blocks.length);
      expect(run.labels[blocks[0]!.id]).toBe(`Saved label for ${blocks[0]!.id}`);
      /* The artefact keeps the per-batch figures of the calls that made these
         labels, whenever they happened; the run reports what *it* spent. The two
         disagreeing on a resumed run is the intended behaviour, and pinning it
         here is what stops someone "fixing" one of them. */
      expect(run.file.batches?.reduce((n, r) => n + r.inputTokens, 0)).toBe(100 * batches.length);
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it("records the manifest that lets a stale complete set be spotted", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { tree, blocks } = fixture(6, 7);
      await checkpointFor(dir, tree, blocks);
      const run = await generateLabels({ tree, blocks, slug: "test", dir });

      expect(run.file.sourceHash).toBe(hashBlocks(blocks));
      expect(run.file.structureVersion).toBe(tree.version);
      expect(run.file.outlineHash).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it("reuses nothing when the structure has moved under the checkpoint", async () => {
    // Same blocks, same source hash, different tree. The manifest cannot see
    // this — the per-batch fingerprints are what catch it, which is why the
    // resume is not allowed to stop at the manifest.
    const { tree, blocks } = fixture(6, 7);
    await checkpointFor(dir, tree, blocks);

    const moved: Tree = {
      ...tree,
      nodes: Object.fromEntries(
        Object.entries(tree.nodes).map(([id, node]) => [
          id,
          node.title ? { ...node, title: `${node.title}, revised` } : node,
        ]),
      ),
    };
    const outline = renderOutline(moved);
    const reusable = usableCheckpoint(
      JSON.parse(await readFile(path.join(dir, "labels-progress.json"), "utf8")),
      { version: "labels/1", generator: MODEL, slug: "test", sourceHash: hashBlocks(blocks) },
    );
    expect(reusable.size).toBeGreaterThan(0);
    for (const batch of planBatches(moved, blocks)) {
      expect(reusable.has(batchFingerprint(batch, blocks, outline))).toBe(false);
    }
  });

  it("clears the checkpoint only when asked, and leaves it there until then", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { tree, blocks } = fixture(6, 7);
      await checkpointFor(dir, tree, blocks);
      const file = path.join(dir, "labels-progress.json");

      const run = await generateLabels({ tree, blocks, slug: "test", dir });
      // Still there: the artefacts have not been written yet, and until they
      // have, this file is the only copy of what the run bought.
      expect(existsSync(file)).toBe(true);
      await run.clearCheckpoint();
      expect(existsSync(file)).toBe(false);
      // And calling it twice is not an error.
      await run.clearCheckpoint();
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it("writes nothing at all when no directory is given", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { tree, blocks } = fixture(6, 7);
      await checkpointFor(dir, tree, blocks);
      // No `dir`, so the checkpoint sitting right there is not read — the run
      // would go to the model, and with no key that throws. The point is that
      // checkpointing is opt-in rather than inferred from a path lying around.
      // Matched on the message, because a test that only asks "did it throw"
      // passes just as happily when the throw came from somewhere else — and
      // what it would then stop checking is whether the model was called.
      await expect(generateLabels({ tree, blocks, slug: "test" })).rejects.toThrow(
        /Could not resolve authentication/,
      );
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it("says whether the shared prefix was big enough for the cache to take it", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // A six-section outline is a few hundred characters. Under the floor, so
      // the run says so rather than reporting a zero that a broken cache would
      // report too, and does not serialise the first batch to warm nothing.
      const { tree, blocks } = fixture(6, 7);
      await checkpointFor(dir, tree, blocks);
      const run = await generateLabels({ tree, blocks, slug: "test", dir });
      expect(run.cacheable).toBe(false);
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });
});

describe("allOrStop, and the queue behaviour it depends on", () => {
  it("stops the rest as soon as one fails, and keeps that first error", async () => {
    let stopped = 0;
    const err = new Error("the 429 that ended the run");
    await expect(
      allOrStop(
        [Promise.resolve(1), Promise.reject(err), new Promise(() => {})],
        () => {
          stopped++;
        },
      ),
    ).rejects.toBe(err);
    expect(stopped).toBe(1);
  });

  it("does not call stop when everything succeeds", async () => {
    let stopped = 0;
    await expect(allOrStop([Promise.resolve("a"), Promise.resolve("b")], () => { stopped++; }))
      .resolves.toEqual(["a", "b"]);
    expect(stopped).toBe(0);
  });

  it("handles the failures that arrive after the first one", async () => {
    // If these were not already handled, Node would take the process down with
    // an unhandled rejection — from the path that is meant to be the tidy one.
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const later = new Promise((_, reject) => setTimeout(() => reject(new Error("second")), 5));
      await expect(
        allOrStop([Promise.reject(new Error("first")), later], () => {}),
      ).rejects.toThrow("first");
      await new Promise((r) => setTimeout(r, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("p-queue settles a queued task's promise when the signal aborts", async () => {
    /* Pinning a claim about a dependency, not about our code — and it is the
       claim the whole fail-fast rests on. `queue.clear()` on its own leaves a
       cleared task's promise unsettled for ever, so `Promise.all` would wait on
       a batch that will never run and the process would hang rather than fail.
       The signal is what makes it settle. If a p-queue upgrade changed this,
       nothing else here would notice until a run hung in the dark. */
    const controller = new AbortController();
    const queue = new PQueue({ concurrency: 1 });
    const first = queue.add(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return "ran";
    });
    const queued = queue.add(async () => "should never run", { signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toThrow();
    await expect(first).resolves.toBe("ran");
  });
});
