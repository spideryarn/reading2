/**
 * **The label eval's accounting — does it check the ids, or only the totals?**
 *
 * `evals/hierarchy-labels.ts` decides whether an article with unlabelled paragraphs is
 * behaving as designed or is broken, and the only thing it has to go on is the
 * `dropped` list `labels.json` writes. That list is produced by the code under
 * measurement, so the eval must not take it on trust any further than it has to:
 * a count is a claim about how many, and what it needs is a claim about which.
 *
 * Until 2026-08-31 the check was `gistable - labelled - dropped.length`, which
 * balances for any list of the right length. A stale file, or one whose drops
 * were recorded from the wrong batch, made the eval report everything accounted
 * for while a row was missing somewhere else — the eval "silently redefining the
 * measurement" it was told about once already, arriving in its own arithmetic.
 * GPT Sol's review of stage 1, finding 8. docs/reusable/silent-success.md.
 */
import { describe, expect, it } from "vitest";
import { evaluate } from "../evals/hierarchy-labels.js";
import type { LabelsFile } from "../src/labels.js";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";

function block(i: number): Block {
  const id = `spya-${String(i).padStart(6, "0")}`;
  return {
    id,
    tag: "p",
    kind: "text",
    text: `Paragraph ${i} makes a point about the matter under discussion here.`,
    words: 10,
    html: `<p id="${id}">Paragraph ${i}</p>`,
    gistable: true,
  };
}

const BLOCKS: Block[] = [0, 1, 2, 3].map(block);

/** A root over four leaves; `bare` gets no `navLabel`. */
function treeMissing(bare: number): Tree {
  const nodes: Record<NodeId, TreeNode> = {};
  const rootId = "n0001";
  const leafIds: NodeId[] = [];
  BLOCKS.forEach((b, i) => {
    const id = `n${String(i + 2).padStart(4, "0")}`;
    nodes[id] = {
      id,
      depth: 1,
      parent: rootId,
      children: [],
      range: [b.id, b.id],
      title: "",
      ...(i === bare ? {} : { navLabel: `A claim about paragraph ${i}, at a workable length` }),
    };
    leafIds.push(id);
  });
  nodes[rootId] = {
    id: rootId,
    depth: 0,
    parent: null,
    children: leafIds,
    range: [BLOCKS[0]!.id, BLOCKS.at(-1)!.id],
    title: "The whole piece",
    gist: "It argues something.",
  };
  return { version: "toc/1", rootId, nodes, slug: "test" } as Tree;
}

function labelsFile(dropped: string[]): LabelsFile {
  const labels: Record<string, string> = {};
  for (const [i, b] of BLOCKS.entries()) {
    if (!dropped.includes(b.id)) labels[b.id] = `A claim about paragraph ${i}, at a workable length`;
  }
  return {
    version: "labels/1",
    generator: "test",
    slug: "test",
    sourceHash: "0000000000000000",
    structureHash: "0000000000000000",
    structureVersion: "toc/1",
    labels,
    batches: null,
    dropped,
  };
}

describe("the label eval's coverage accounting", () => {
  it("says nothing is unaccounted for when the dropped list names the block that is bare", () => {
    /* The control, and it has to come first: every assertion below is "this
       field is non-empty", which a broken evaluator satisfies for free. */
    const report = evaluate("test", treeMissing(2), BLOCKS, labelsFile([BLOCKS[2]!.id]));
    expect(report.labelled).toBe(3);
    expect(report.dropped).toBe(1);
    expect(report.unexplained).toEqual([]);
    expect(report.phantomDrops).toEqual([]);
  });

  it("names the block nobody accounted for when the dropped list is the right length and the wrong id", () => {
    /* One bare block, one drop recorded, and they are different blocks. The
       subtraction this replaced came out at zero — three labelled, four
       gistable, one dropped — and printed nothing at all. */
    const report = evaluate("test", treeMissing(2), BLOCKS, labelsFile([BLOCKS[3]!.id]));
    expect(report.dropped).toBe(1);
    expect(report.unexplained).toEqual([BLOCKS[2]!.id]);
    // And the other half of the same disagreement, which the count also hid.
    expect(report.phantomDrops).toEqual([BLOCKS[3]!.id]);
  });

  it("still reports a genuine gap when labels.json has no dropped list at all", () => {
    /* An older file: absent is not zero, and a missing row is still missing.
       The key is deleted rather than set to undefined — `exactOptionalPropertyTypes`
       is on, and the two are not the same value on disk either. */
    const { dropped: _absent, ...older } = labelsFile([]);
    const report = evaluate("test", treeMissing(2), BLOCKS, older);
    expect(report.dropped).toBeNull();
    expect(report.unexplained).toEqual([BLOCKS[2]!.id]);
  });
});
