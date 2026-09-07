/**
 * **What a `hierarchy` run produces now that it buys no labels — asked of the
 * functions rather than of the plan.**
 *
 * Stage 2 of docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md
 * moved the label pass out of `generateHierarchy`. Two things went with it, and
 * both are the kind of change that leaves no symptom if it is done wrong:
 *
 * - **`checkCoverage` moved into the `labels` step.** Left where it was, it
 *   would have failed every single ingest — it asks whether every structural
 *   block carries a navigation label, which a structure-only tree guarantees to
 *   be false. Loud, and caught by anything. The interesting direction is the
 *   other one: removed from *both* steps, nothing would notice, and an article
 *   that quietly lost a third of its labels would publish under a green tick.
 *   docs/reusable/silent-success.md.
 * - **The tree is `mergeLabels(structure, {})`.** The stage-2 brief said this
 *   "keeps the author's own heading labels, minted for free at
 *   src/heading-tree.ts:157". **It does not, and this file is where that is
 *   written down.** `buildHeadingTree` really does mint one per heading — and it
 *   has no caller outside `evals/`. `generateHierarchy` builds with `buildTree`
 *   in src/hierarchy.ts, which sets `navLabel` from the map it is handed and
 *   from nothing else; and `mergeLabels` *deletes* the key wherever the map has
 *   none. So a fresh tree carries no navigation labels at all, and the reader
 *   sees the withheld state (`nav_label_status = 'pending'`, stage 1) over every
 *   paragraph rather than over some of them.
 *
 * ## Which instrument
 *
 * `npm test`. Nothing here calls a model: `buildTree` and `mergeLabels` are
 * pure, and they are the two functions the claim is actually about. Driving
 * `generateHierarchy` would need a structure call and would tell us less.
 */
import { describe, expect, it } from "vitest";

import { buildHeadingTree } from "../src/heading-tree.js";
import {
  buildTree,
  checkCoverage,
  generateHierarchy,
  type ModelNode,
} from "../src/hierarchy.js";
import { mergeLabels } from "../src/labels.js";
import { STEPS } from "../src/pipeline.js";
import type { Block } from "../src/types.js";

function block(id: string, text: string, kind: Block["kind"] = "text", tag = "p"): Block {
  return {
    id,
    tag,
    kind,
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    html: `<${tag} id="${id}">${text}</${tag}>`,
    gistable: true,
  };
}

/** A heading and two paragraphs under it — the shape the claim is about. */
const BLOCKS: Block[] = [
  block("spya-aaaaaa", "What the piece is for", "heading", "h2"),
  block("spya-bbbbbb", "First paragraph of the section"),
  block("spya-cccccc", "Second paragraph of the section"),
];

const ROOT: ModelNode = {
  title: "Whole piece",
  gist: "The article argues something.",
  range: ["spya-aaaaaa", "spya-cccccc"],
  children: [],
};

const NAV = {
  "spya-aaaaaa": "The heading, as a navigable row",
  "spya-bbbbbb": "The opening claim, stated plainly and at some length",
  "spya-cccccc": "The supporting argument, which runs to a dozen words or so",
};

const leafLabels = (tree: ReturnType<typeof buildTree>): string[] =>
  Object.values(tree.nodes)
    .filter((n) => n.children.length === 0)
    .map((n) => n.navLabel ?? "");

describe("a structure-only tree", () => {
  it("carries no navigation labels at all — not even the headings", () => {
    const structure = buildTree(ROOT, {}, BLOCKS, "test");
    const tree = mergeLabels(structure, {});
    expect(leafLabels(tree)).toEqual(["", "", ""]);
  });

  it("is not an accident of mergeLabels: buildTree mints none either", () => {
    /* Both halves stated, because either one alone would leave the reader
       guessing which is responsible — and the brief guessed the other way. */
    expect(leafLabels(buildTree(ROOT, {}, BLOCKS, "test"))).toEqual(["", "", ""]);
    /* And with a map, the same call labels every one of them, so the empty
       result above is about the map rather than about this fixture. */
    expect(leafLabels(mergeLabels(buildTree(ROOT, NAV, BLOCKS, "test"), NAV))).toEqual([
      NAV["spya-aaaaaa"],
      NAV["spya-bbbbbb"],
      NAV["spya-cccccc"],
    ]);
  });

  it("is not what buildHeadingTree would have produced, which is the confusion", () => {
    /* The function the brief pointed at really does mint a free heading label —
       so the claim was not invented, it was aimed at a builder this pipeline
       does not use. Kept as an executable footnote: if `generateHierarchy` ever
       adopts this builder, the first case above is what will go red and this one
       is what explains why. */
    const heading = buildHeadingTree(BLOCKS, "test").tree;
    expect(leafLabels(heading)).toContain("What the piece is for");
  });

  it("would fail checkCoverage, which is why that check moved", () => {
    const tree = mergeLabels(buildTree(ROOT, {}, BLOCKS, "test"), {});
    expect(() => checkCoverage({}, tree, BLOCKS)).toThrow();
  });
});

/**
 * A function's source with its comments taken out.
 *
 * **Both of the cases below were wrong without it, in opposite directions, and
 * both looked right.** `Function.prototype.toString()` returns the source
 * *including comments* — and this change wrote a paragraph into each of these
 * two functions explaining where `checkCoverage` now lives. So the positive case
 * passed on a comment saying the call had moved here, and the negative case
 * failed on a comment saying it had moved away, with the call itself in neither
 * place. A check that reads prose cannot tell prose from code.
 * docs/reusable/silent-success.md.
 *
 * **Match the bare identifier, never `checkCoverage(`.** Vite's SSR transform
 * rewrites an imported binding to `(0,__vite_ssr_import_36__.checkCoverage)(…)`,
 * so under vitest the name and its open bracket are never adjacent and a check
 * for the two together can only ever fail. Found by probing the transformed
 * source; written down so nobody probes it twice.
 *
 * The one thing this cannot survive is a `//` or a comment marker inside a
 * string literal in the function under test. Neither of these two has one, and
 * if one arrives the failure is a false *green* — so prefer widening the check
 * to reading it more cleverly.
 */
function code(fn: (...args: never[]) => unknown): string {
  return fn
    .toString()
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

describe("checkCoverage's home", () => {
  /**
   * A source-level check, because the alternative — driving both steps — needs a
   * structure call and a label run. What it pins is the pair: gone from one and
   * arrived in the other. Removed from both, the second half goes red.
   */
  it("is called by the labels step's run", () => {
    expect(code(STEPS.labels.run)).toContain("checkCoverage");
  });

  it("is no longer called by generateHierarchy", () => {
    /* **`generateHierarchy`, not `STEPS.hierarchy.run`**, and the first draft of
       this file got that wrong too: the call was never in the step's closure, it
       was in the stage the closure calls, so the assertion passed over a function
       that had never mentioned `checkCoverage` and would have gone on passing
       with the check put back. Watched red by putting it back — twice, once for
       each mistake. */
    expect(code(generateHierarchy)).not.toContain("checkCoverage");
  });
});
