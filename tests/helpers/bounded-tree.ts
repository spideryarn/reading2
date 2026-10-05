/**
 * What every bounded headings tree must be, asked in one place so the three
 * suites that build one (stated-limits, bounded-heading-tree, the structure
 * step's fallback) cannot drift into asking different things.
 */
import { expect } from "vitest";

import { isStructural } from "../../src/block-policy.js";
import { MAX_BATCH, mergeLabels, MIN_BATCH, planBatches } from "../../src/labels.js";
import { isSupplementNode } from "../../src/supplement.js";
import { checkTree } from "../../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";

let counter = 0;
/** The id alphabet (src/ids.ts), so a counter can be spelt as a well-formed id. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";
const nextId = (): string => {
  let n = ++counter;
  let body = "";
  for (let i = 0; i < 5; i++, n = Math.floor(n / 32)) body = ALPHABET[n % 32]! + body;
  return `spya-t${body}`;
};

/** A block with a well-formed id; `words` follows the text unless overridden. */
export function block(text: string, over: Partial<Block> = {}): Block {
  const tag = over.tag ?? "p";
  return {
    id: nextId(),
    tag,
    kind: "text",
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    html: `<${tag}>${text}</${tag}>`,
    gistable: true,
    ...over,
  };
}

export const heading = (text: string, level = 2): Block =>
  block(text, { tag: `h${level}`, kind: "heading", level });

/** Prose that clears the stub threshold, with a number so two paragraphs differ. */
export const prose = (n: number): string =>
  `Paragraph ${n} runs on for long enough to clear the stub threshold with room to spare, ` +
  `because a section needs some words in it before it counts as one`;

export const paragraphs = (n: number, from = 0): Block[] =>
  Array.from({ length: n }, (_, i) => block(prose(from + i)));

/** An endnote: apparatus, so it lands under the supplement node. */
export const note = (n: number): Block =>
  block(`Note ${n}. A source.`, { role: "footnote", treatment: "supplement" });

const internal = (tree: Tree): TreeNode[] => Object.values(tree.nodes).filter((n) => n.children.length > 0);

/** Body nodes whose children are all leaves, with how many they hold. */
export function bodyLeafSets(tree: Tree): { node: TreeNode; leaves: number }[] {
  return internal(tree)
    .filter((n) => !isSupplementNode(n))
    .filter((n) => n.children.every((c) => tree.nodes[c]!.children.length === 0))
    .map((node) => ({ node, leaves: node.children.length }));
}

/** The depth of every leaf that is not under a supplement. */
export function bodyLeafDepths(tree: Tree): Set<number> {
  const depths = new Set<number>();
  for (const n of Object.values(tree.nodes)) {
    if (n.children.length > 0) continue;
    const parent = n.parent === null ? undefined : tree.nodes[n.parent];
    if (parent && isSupplementNode(parent)) continue;
    depths.add(n.depth);
  }
  return depths;
}

/**
 * The shape promise: sound as the structure step stores it (labels merged
 * away), provisional, every body leaf at depth 3, no body leaf set over the
 * labels batch size, and no internal node without a title.
 */
export function expectBoundedTree(blocks: Block[], tree: Tree): void {
  expect(checkTree(blocks, mergeLabels(tree, {})).problems).toEqual([]);
  expect(tree.provisional).toBe("headings");
  expect([...bodyLeafDepths(tree)]).toEqual([3]);
  expect(Math.max(...bodyLeafSets(tree).map((s) => s.leaves))).toBeLessThanOrEqual(MAX_BATCH);
  expect(internal(tree).filter((n) => n.title.trim() === "").map((n) => n.id)).toEqual([]);
}

/**
 * What a planned batch can reach when no sibling set passes `MAX_BATCH`: a
 * batch still under `MIN_BATCH` takes one more whole set, and a short tail is
 * then merged back into it. src/labels.ts § `planBatches`.
 */
export const LARGEST_PLANNED_BATCH = MAX_BATCH + 2 * (MIN_BATCH - 1);

/** The labels planner takes the tree: every structural block in one batch, in order, none too big. */
export function expectPlannable(blocks: Block[], tree: Tree): void {
  const batches = planBatches(mergeLabels(tree, {}), blocks);
  const planned = batches.flatMap((b) => b.blocks.map((x) => x.id));
  expect(planned).toEqual(blocks.filter((b) => isStructural(b)).map((b) => b.id));
  expect(Math.max(...batches.flatMap((b) => b.sets).map((s) => s.blocks.length))).toBeLessThanOrEqual(MAX_BATCH);
  expect(Math.max(...batches.map((b) => b.blocks.length))).toBeLessThanOrEqual(LARGEST_PLANNED_BATCH);
}
