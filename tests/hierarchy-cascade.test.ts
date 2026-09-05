/**
 * **The pure half of the hierarchy cascade** — the stopping rule, the packing,
 * the immediate normalisation, and the guard that no node was left unasked.
 *
 * Everything here is deterministic and there is no model in it, which is the
 * point: docs/plans/260904c-hierarchy-structure-in-waves.md § "What is
 * deterministic, and what only an eval can answer" lists exactly these
 * questions as the ones a test must answer before a paid run is worth making,
 * *because none of them fails loudly on its own*. A batch that splits a sibling
 * set still produces a tree. A node that stopped one level early still tiles,
 * still has a gist, still passes `assertTreeSound` — it is byte-identical in
 * kind to a tree whose governor legitimately stopped there. That is
 * docs/reusable/silent-success.md, and it is what most of this file is about.
 *
 * Every assertion below was watched red first, against a deliberately naive
 * `src/hierarchy-cascade.ts` — raw block counts instead of `isStructural`, no
 * heading clause, no caps, no drop — so that the assertion that fires is the
 * one that was meant to. A generic red proves nothing.
 *
 * **Six of these arrived from GPT Sol's review of 2026-09-04**, which
 * reproduced four faults this file did not catch: an `"expanded"` node with no
 * children that every check accepted, a one-child answer that looked like an
 * expansion, an error message carrying article prose, and a `sourceHeading: ""`
 * that vanished. Each of those is a test here now, named for what it protects.
 */
import { describe, expect, it } from "vitest";
import {
  CASCADE_RECIPE,
  type CascadeNode,
  type CascadeRecipe,
  type CascadeState,
  type ExpandedNode,
  type ExpansionTarget,
  ExpansionRefused,
  type PendingNode,
  type RangedNode,
  type RequestOverhead,
  type TerminalNode,
  UNMEASURED_OVERHEAD,
  assertCascadeComplete,
  bodyWordsIn,
  decideExpansion,
  type ExpansionDecision,
  estimateEvidenceTokens,
  estimateRequestTokens,
  finaliseCascade,
  type ModelVerdict,
  normaliseExpansion,
  planExpansionBatches,
  predictedChildren,
  proposalFromTree,
  shouldExpand,
  structuralBlocksIn,
} from "../src/hierarchy-cascade.js";
import { type BuildReport, type ModelNode, buildTree } from "../src/hierarchy.js";
import type { Block } from "../src/types.js";

/* ------------------------------------------------------------- fixtures -- */

/** The id alphabet from src/ids.ts, so every fixture id passes `isSpideryarnId`. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";

/**
 * A real-looking block id for document position `i`.
 *
 * Fixture ids that are not ids matter here: `nameValue` (src/ids.ts) quotes a
 * value only once it has passed `isSpideryarnId`, and withholds everything
 * else — so a test using `block-3` as an id would exercise the *withheld*
 * branch of every error message and never the one production shows.
 */
function blockId(i: number): string {
  return `spya-b${ALPHABET[Math.floor(i / 32) % 32]}${ALPHABET[i % 32]}000`;
}

/** One ordinary structural paragraph. */
function para(i: number): Block {
  return {
    id: blockId(i),
    tag: "p",
    kind: "text",
    /* Fixed width, so every paragraph costs the same number of characters.
       `estimateEvidenceTokens` reads the prose, and a fixture whose blocks
       silently grow by a digit at index 10 would make the token-cap test
       depend on where in the article its parents happened to sit. */
    text: `Paragraph ${String(i).padStart(4, "0")} says something about the matter at hand.`,
    words: 12,
    html: `<p id="${blockId(i)}">Paragraph ${i}</p>`,
    gistable: true,
  };
}

/** An authored heading — `isStructural`, and a hard boundary the prompt honours. */
function heading(i: number): Block {
  return { ...para(i), tag: "h2", kind: "heading", level: 2, text: `Heading ${i}` };
}

/** A heading inside the apparatus: a heading whose text the model is never shown. */
function noteHeading(i: number): Block {
  return { ...heading(i), treatment: "supplement", role: "footnote" };
}

/** An image: a block, and not navigation. `isStructural` says no. */
function image(i: number): Block {
  return { ...para(i), tag: "figure", kind: "media", gistable: false, text: "" };
}

/** A footnote: gistable prose, and still not navigation. `isStructural` says no. */
function note(i: number): Block {
  return { ...para(i), treatment: "supplement", role: "footnote" };
}

/** `length` blocks, with `shape` deciding what each one is. */
function article(length: number, shape: (i: number) => Block = para): Block[] {
  return Array.from({ length }, (_, i) => shape(i));
}

/** Just a range, which is all the governor and the packer read. */
function ranged(from: number, to: number, children?: RangedNode[]): RangedNode {
  return { range: [blockId(from), blockId(to)], ...(children ? { children } : {}) };
}

function pending(from: number, to: number): PendingNode {
  return { title: `Part ${from}`, range: [blockId(from), blockId(to)], status: "pending" };
}

function terminal(from: number, to: number): TerminalNode {
  return { title: `Part ${from}`, range: [blockId(from), blockId(to)], status: "terminal" };
}

function expanded(
  from: number,
  to: number,
  children: [CascadeNode, CascadeNode, ...CascadeNode[]],
): ExpandedNode {
  return { title: `Part ${from}`, range: [blockId(from), blockId(to)], status: "expanded", children };
}

function target(from: number, to: number, where: string): ExpansionTarget {
  return { node: pending(from, to), where };
}

function emptyReport(): BuildReport {
  return { repairs: [], droppedChildren: [], droppedHeadings: [], collapsedRungs: [] };
}

const state = (root: CascadeNode, capReached: CascadeState["capReached"] = []): CascadeState => ({
  root,
  capReached,
});

/* ------------------------------------------------- the stopping rule ----- */

describe("shouldExpand", () => {
  /**
   * **The boundary, exactly.** The plan's first draft said "split above ~12,
   * stop at ≤~9" and left 10–12 undefined; a rule that becomes a checkpoint
   * fingerprint cannot have an undefined band. So: 9 stops, 10 expands, and
   * nothing in between to argue about.
   */
  it("stops at nine structural blocks and expands at ten", () => {
    const blocks = article(40);
    expect(shouldExpand(ranged(0, 8), blocks, CASCADE_RECIPE)).toBe(false);
    expect(shouldExpand(ranged(0, 9), blocks, CASCADE_RECIPE)).toBe(true);
  });

  /**
   * **The clause that stops the terminal level welding across an authored
   * heading.** A size rule alone would stop on this node, and its leaves would
   * then span a heading the prompt calls a hard boundary everywhere else —
   * silently, in the finished tree, for every reader of that article.
   */
  it("expands a short node that still holds an unresolved authored heading", () => {
    const blocks = article(20, (i) => (i === 4 ? heading(i) : para(i)));
    const short = ranged(0, 7); // eight blocks: well under the terminal size
    expect(structuralBlocksIn(short, blocks)).toBe(8);
    expect(shouldExpand(short, blocks, CASCADE_RECIPE)).toBe(true);
  });

  /**
   * The heading a node *begins* on is a boundary that has already been
   * honoured — the node starts there. Counting it as unresolved would make
   * every heading-started node expand for ever, which is the cascade failing
   * to terminate rather than the cascade respecting a boundary.
   */
  it("does not count the heading a node starts on, nor one a child starts on", () => {
    const blocks = article(20, (i) => (i === 0 || i === 4 ? heading(i) : para(i)));
    expect(shouldExpand(ranged(0, 3), blocks, CASCADE_RECIPE)).toBe(false);
    const done = ranged(0, 7, [ranged(0, 3), ranged(4, 7)]);
    expect(shouldExpand(done, blocks, CASCADE_RECIPE)).toBe(false);
  });

  /**
   * **A heading the model cannot read is not a boundary it can honour.**
   * `renderBlocks` withholds a supplement's text, so expanding on a "Notes"
   * heading asks the call to split on a boundary shown to it as
   * `NOT-GISTABLE: (withheld)`. Reachable whenever `splitBlocks` falls back to
   * handing over the whole article, which stage 0b made more visible today.
   *
   * The control is the body heading beside it: same position, same `kind`, and
   * it *does* expand — so this test cannot pass by the clause being switched
   * off altogether.
   */
  it("ignores a supplement heading and still honours a body one", () => {
    const withNote = article(20, (i) => (i === 4 ? noteHeading(i) : para(i)));
    expect(shouldExpand(ranged(0, 7), withNote, CASCADE_RECIPE)).toBe(false);

    const withBody = article(20, (i) => (i === 4 ? heading(i) : para(i)));
    expect(shouldExpand(ranged(0, 7), withBody, CASCADE_RECIPE)).toBe(true);
  });

  /**
   * **The assertion that proves `isStructural` is actually consulted.** An
   * empty paragraph, a withheld apparatus block and a `No posts` footer are all
   * blocks and none of them is navigation, so a raw count expands a node that
   * has nothing to expand — and produces a level of the tree the reader gets
   * nothing from. Twenty-seven blocks, nine of them structural: the two counts
   * disagree and the rule must follow the structural one.
   */
  it("counts structural blocks, not raw ones", () => {
    const blocks = article(30, (i) => (i % 3 === 0 ? para(i) : i % 3 === 1 ? image(i) : note(i)));
    const padded = ranged(0, 26); // 27 raw blocks, 9 of them structural
    expect(structuralBlocksIn(padded, blocks)).toBe(9);
    expect(shouldExpand(padded, blocks, CASCADE_RECIPE)).toBe(false);

    // And one more structural block, with nothing else changed, tips it over.
    const wider = ranged(0, 27);
    expect(structuralBlocksIn(wider, blocks)).toBe(10);
    expect(shouldExpand(wider, blocks, CASCADE_RECIPE)).toBe(true);
  });
});

describe("bodyWordsIn", () => {
  /**
   * **A different predicate from `structuralBlocksIn`, on purpose.** The block
   * count asks how many rows a reader could navigate to (`isStructural`); the
   * word count asks how much prose the call is actually shown, which is what
   * `renderBlocks` sends — every body block, the `gistable: false` ones marked
   * and printed in full, and a supplement withheld. The two counts disagree on
   * this fixture, which is the whole reason there are two of them.
   */
  it("counts every body block the model is shown, and never a withheld supplement", () => {
    const mixed = article(9, (i) => (i === 3 ? image(i) : i === 6 ? note(i) : para(i)));
    expect(structuralBlocksIn(ranged(0, 8), mixed)).toBe(7);
    expect(bodyWordsIn(ranged(0, 8), mixed)).toBe(8 * 12);
  });
});

/* ---------------------------------------------------------- precedence --- */

/**
 * **The five bounds, in order** — and the order is the part that had to be
 * written down, because two of them contradict on a real node.
 *
 * Every case below is one row of the plan's table
 * (docs/plans/260904d-deepen-fat-sections.md § "The four bounds, and which of
 * them can overrule the verdict") plus the collision that made the ordering
 * necessary.
 */
describe("decideExpansion", () => {
  /** 2,400 words at twelve to the paragraph: over the ceiling, and well over the floor. */
  const long = article(200);

  const decide = (
    node: RangedNode,
    depth: number,
    verdict?: ModelVerdict,
    blocks: Block[] = long,
  ) => decideExpansion({ node, depth, blocks, recipe: CASCADE_RECIPE, verdict });

  it("1 — past the depth cap nothing expands, however loudly the node asks", () => {
    const fat = ranged(0, 199);
    expect(decide(fat, CASCADE_RECIPE.maxDepth, "needs-deeper")).toEqual({
      decision: "stop",
      because: "depth-cap",
    });
    /* **And the governor still says the node wants splitting**, which is the
       point of keeping `maxDepth` out of `shouldExpand`: the executor writes a
       `capReached` record from the two answers together. A `shouldExpand` that
       went false here would make the node silently terminal — indistinguishable
       from one that legitimately stopped. */
    expect(shouldExpand(fat, long, CASCADE_RECIPE)).toBe(true);
  });

  it("3 — a node under the divisibility floor is not expanded however loudly it asks", () => {
    expect(decide(ranged(0, 8), 1, "needs-deeper")).toEqual({
      decision: "stop",
      because: "divisibility-floor",
    });
  });

  /**
   * **The collision, and the reason the bounds are ordered rather than listed.**
   * An eight-block node holding two of the author's own headings is under the
   * floor *and* over the heading rule. `hierarchy-cascade.ts` had already
   * settled it — a size rule alone would stop here, and the terminal level would
   * then weld across a heading the prompt calls a hard boundary everywhere else.
   * ⟨GPT Sol, finding 4.⟩
   */
  it("2 beats 3 — the eight-block node with two authored headings opens anyway", () => {
    const headed = article(20, (i) => (i === 0 || i === 4 ? heading(i) : para(i)));
    const short = ranged(0, 7);
    expect(structuralBlocksIn(short, headed)).toBe(8); // under the floor
    expect(decide(short, 1, "finished", headed)).toEqual({
      decision: "expand",
      because: "authored-heading",
    });
  });

  it("4 — a node over the ceiling that called itself finished is opened, and says so", () => {
    expect(decide(ranged(0, 199), 1, "finished")).toEqual({
      decision: "expand",
      because: "forced-open",
    });
    // Same node, one word under the ceiling: the verdict gets it back.
    const generous = { ...CASCADE_RECIPE, forcedOpenWords: 2_400 };
    expect(
      decideExpansion({
        node: ranged(0, 199),
        depth: 1,
        blocks: long,
        recipe: generous,
        verdict: "finished",
      }),
    ).toEqual({ decision: "stop", because: "verdict" });
  });

  it("5 — everything the four leave open is the model's, either way", () => {
    const middling = ranged(0, 99); // above the floor, 1,200 words: under the ceiling
    expect(decide(middling, 1, "needs-deeper")).toEqual({
      decision: "expand",
      because: "verdict",
    });
    expect(decide(middling, 1, "finished")).toEqual({ decision: "stop", because: "verdict" });
  });

  /**
   * **An absent verdict is a third state, and it must not read as "finished".**
   * A missing field silently meaning "finished" is the shape of this plan's
   * whole failure mode. The *decision* is the same — stopping is the side that
   * cannot spend money nobody asked for — and the *reason* is not, which is what
   * lets the instrumentation tell a node nobody has asked yet (wave 1's whole
   * tree) from one that answered.
   */
  it("names an absent verdict rather than folding it into finished", () => {
    expect(decide(ranged(0, 99), 1)).toEqual({ decision: "stop", because: "no-verdict" });
    // And the mechanical bounds still open what they would have opened — under
    // their own name, because a ceiling with no verdict to overrule is not the
    // same event as one that overruled a model saying "finished". See below.
    expect(decide(ranged(0, 199), 1)).toEqual({
      decision: "expand",
      because: "unassessed-ceiling",
    });
  });

  /**
   * **The `never` check.** The pairings live in the type — `"depth-cap"` can only
   * stop, `"authored-heading"` can only expand — and this is what keeps the
   * switch on `because` exhaustive: a sixth reason added without a case here is
   * a compile error at `npm run typecheck`, which covers the test project.
   */
  it("names a bound for every decision it can return", () => {
    const bound = (d: ExpansionDecision): string => {
      switch (d.because) {
        case "depth-cap":
          return "1";
        case "authored-heading":
          return "2";
        case "divisibility-floor":
          return "3";
        case "forced-open":
        case "unassessed-ceiling":
          return "4";
        case "verdict":
        case "no-verdict":
          return "5";
        default: {
          const unreachable: never = d;
          return unreachable;
        }
      }
    };
    const headed = article(20, (i) => (i === 0 || i === 4 ? heading(i) : para(i)));
    const seen = [
      decide(ranged(0, 199), CASCADE_RECIPE.maxDepth, "needs-deeper"),
      decide(ranged(0, 7), 1, "finished", headed),
      decide(ranged(0, 8), 1, "needs-deeper"),
      decide(ranged(0, 199), 1, "finished"),
      decide(ranged(0, 99), 1, "finished"),
      decide(ranged(0, 99), 1),
      decide(ranged(0, 199), 1),
    ];
    expect(seen.map(bound)).toEqual(["1", "2", "3", "4", "5", "5", "4"]);
    expect(new Set(seen.map((d) => d.because)).size).toBe(7);
  });

  /**
   * **The ceiling's number is "how often it overruled a model that said
   * finished", and a node nobody asked overrules nothing.** Both nodes are over
   * the ceiling and both are opened; only one of them contradicts an answer. If
   * they shared a `because` the figure would read high on precisely the wave
   * where no verdict exists for any node — wave 1, which is every article's
   * first pass. ⟨GPT Sol's review of stage 3, F2.⟩
   */
  it("distinguishes the ceiling overruling a verdict from the ceiling with none to overrule", () => {
    expect(decide(ranged(0, 199), 1, "finished")).toEqual({
      decision: "expand",
      because: "forced-open",
    });
    expect(decide(ranged(0, 199), 1)).toEqual({
      decision: "expand",
      because: "unassessed-ceiling",
    });
  });
});

describe("predictedChildren", () => {
  it("is ceil(structural / terminal), clamped to the prompt's own 2–9 fan-out", () => {
    const blocks = article(200);
    expect(predictedChildren(ranged(0, 0), blocks, CASCADE_RECIPE)).toBe(2); // clamped up
    expect(predictedChildren(ranged(0, 26), blocks, CASCADE_RECIPE)).toBe(3); // 27/9
    expect(predictedChildren(ranged(0, 27), blocks, CASCADE_RECIPE)).toBe(4); // 28/9 → 4
    expect(predictedChildren(ranged(0, 199), blocks, CASCADE_RECIPE)).toBe(9); // clamped down
  });

  it("reads the structural count, so padding does not inflate the prediction", () => {
    const blocks = article(60, (i) => (i % 2 === 0 ? para(i) : image(i)));
    // 54 raw blocks, 27 structural: 3 predicted children, not 6.
    expect(predictedChildren(ranged(0, 53), blocks, CASCADE_RECIPE)).toBe(3);
  });
});

/* ----------------------------------------------------------- estimating -- */

describe("estimateEvidenceTokens", () => {
  /**
   * **Pinned against a hand-computed figure, not against itself.** The
   * batching tests below derive their caps from this function, so they measure
   * packing arithmetic and would pass unchanged if the estimator started
   * returning half of what it should. This is the one place the estimator's own
   * fidelity is asserted. ⟨GPT Sol, 2026-09-04⟩
   */
  it("charges for the rendered slice plus one context block either side", () => {
    const blocks = article(10);
    const one = blocks[0]!;
    const perBlock = one.id.length + one.tag.length + 12 + one.text.length;
    // Blocks 3..5, plus context at 2 and 6: five blocks.
    expect(estimateEvidenceTokens(ranged(3, 5), blocks)).toBe(Math.ceil((perBlock * 5) / 4));
    // At the article's edge there is no context to the left: four blocks.
    expect(estimateEvidenceTokens(ranged(0, 2), blocks)).toBe(Math.ceil((perBlock * 4) / 4));
  });

  /**
   * A withheld supplement costs what `renderBlocks` prints for it, not what its
   * prose would have cost — otherwise the estimate describes an article the
   * request never sends, and a bibliography makes every batch look enormous.
   */
  it("charges a withheld supplement for its marker, not its prose", () => {
    const blocks = article(6, (i) => (i === 2 ? note(i) : para(i)));
    const body = { ...blocks[1]! };
    const withheld = blocks[2]!;
    const overhead = withheld.id.length + withheld.tag.length + 12;
    const marker = "NOT-GISTABLE: (withheld)".length;
    expect(marker).toBeLessThan(body.text.length); // or the test proves nothing
    expect(estimateEvidenceTokens(ranged(2, 2), blocks)).toBe(
      Math.ceil((overhead + marker + 2 * (body.id.length + body.tag.length + 12 + body.text.length)) / 4),
    );
  });
});

/* ------------------------------------------------------------- packing --- */

describe("planExpansionBatches", () => {
  const batchesOf = (calls: ReturnType<typeof planExpansionBatches>) =>
    calls.map((c) => (c.kind === "batch" ? c.targets.length : "oversized"));

  /**
   * **The rule `planBatches` already lives by**: generate siblings together,
   * generate disjoint sibling groups in parallel. A parent's complete child set
   * is the unit, and a batch that split one would produce a perfectly valid
   * tree whose boundaries were decided by two calls that could not see each
   * other.
   *
   * **This proves coverage of the list it was handed, and nothing more.** A
   * frontier that omitted a pending node would be packed perfectly and this
   * test would still pass; the node's absence is `assertCascadeComplete`'s to
   * notice, because only it walks the tree. ⟨GPT Sol⟩
   */
  it("covers every supplied target exactly once, in document order, splitting no sibling set", () => {
    const blocks = article(400);
    const targets = Array.from({ length: 11 }, (_, i) =>
      target(i * 36, i * 36 + 35, `root > child ${i + 1}`),
    );
    const calls = planExpansionBatches(targets, blocks, CASCADE_RECIPE, UNMEASURED_OVERHEAD);

    const seen = calls.flatMap((c) => (c.kind === "batch" ? c.targets.map((t) => t.where) : []));
    expect(seen).toEqual(targets.map((t) => t.where));
    expect(new Set(seen).size).toBe(targets.length);
  });

  /**
   * The precondition, stated. An out-of-order or overlapping frontier packs
   * parents from opposite ends of the article into one call and gives every
   * batch a `span` that describes nothing — and neither of those throws
   * anywhere downstream.
   */
  it("refuses a frontier that is out of document order or overlapping", () => {
    const blocks = article(400);
    expect(() =>
      planExpansionBatches(
        [target(20, 29, "root > child 1"), target(0, 9, "root > child 2")],
        blocks,
        CASCADE_RECIPE,
        UNMEASURED_OVERHEAD,
      ),
    ).toThrow(/not in document order.*root > child 2/s);
    expect(() =>
      planExpansionBatches(
        [target(0, 20, "root > child 1"), target(10, 29, "root > child 2")],
        blocks,
        CASCADE_RECIPE,
        UNMEASURED_OVERHEAD,
      ),
    ).toThrow(/must not overlap/);
  });

  it("closes a batch on the predicted-children cap", () => {
    const blocks = article(500);
    // 9 predicted children each (81 structural blocks) — four would be 36, and
    // the fifth is what closes it.
    const targets = Array.from({ length: 5 }, (_, i) =>
      target(i * 81, i * 81 + 80, `root > child ${i + 1}`),
    );
    const recipe: CascadeRecipe = {
      ...CASCADE_RECIPE,
      maxParentsPerBatch: 99,
      maxEvidenceTokensPerBatch: 10_000_000,
    };
    const calls = planExpansionBatches(targets, blocks, recipe, UNMEASURED_OVERHEAD);
    expect(batchesOf(calls)).toEqual([4, 1]);
    expect(calls[0]!.kind === "batch" && calls[0]!.predictedChildren).toBe(36);
  });

  it("closes a batch on the parent-count cap", () => {
    const blocks = article(400);
    // Two predicted children each, so the children cap (36) cannot fire first.
    const targets = Array.from({ length: 9 }, (_, i) =>
      target(i * 4, i * 4 + 3, `root > child ${i + 1}`),
    );
    const recipe: CascadeRecipe = { ...CASCADE_RECIPE, maxEvidenceTokensPerBatch: 10_000_000 };
    expect(batchesOf(planExpansionBatches(targets, blocks, recipe, UNMEASURED_OVERHEAD))).toEqual([
      4, 4, 1,
    ]);
  });

  it("closes a batch on the soft evidence cap", () => {
    const blocks = article(400);
    const targets = Array.from({ length: 6 }, (_, i) =>
      target(i * 8, i * 8 + 7, `root > child ${i + 1}`),
    );
    /* Room for two of these and not three, whatever the other caps say. Measured
       off an *interior* target: the first one sits at the article's edge and so
       carries one context block rather than two, and a cap derived from it would
       be a shade too small for every target after it. */
    const one = estimateEvidenceTokens(targets[1]!.node, blocks);
    const recipe: CascadeRecipe = {
      ...CASCADE_RECIPE,
      maxParentsPerBatch: 99,
      maxPredictedChildrenPerBatch: 999,
      maxEvidenceTokensPerBatch: one * 2 + 1,
    };
    const calls = planExpansionBatches(targets, blocks, recipe, UNMEASURED_OVERHEAD);
    expect(batchesOf(calls)).toEqual([2, 2, 2]);
    const first = calls[0]!;
    expect(first.kind === "batch" && first.estimatedEvidenceTokens).toBeLessThanOrEqual(
      recipe.maxEvidenceTokensPerBatch,
    );
  });

  /**
   * **A soft cap gives way to the sibling rule; the hard one does not.** A
   * parent over the *evidence* preference still gets a call to itself, because
   * cutting it would hand two calls the same parent — the trade `planBatches`
   * makes for an oversized sibling set.
   */
  it("gives a parent over the soft cap a batch of its own rather than splitting it", () => {
    const blocks = article(400);
    const targets = [
      target(0, 3, "root > child 1"),
      target(4, 103, "root > child 2"),
      target(104, 107, "root > child 3"),
    ];
    const recipe: CascadeRecipe = {
      ...CASCADE_RECIPE,
      maxEvidenceTokensPerBatch: estimateEvidenceTokens(targets[1]!.node, blocks) - 1,
    };
    const calls = planExpansionBatches(targets, blocks, recipe, UNMEASURED_OVERHEAD);
    expect(calls.map((c) => (c.kind === "batch" ? c.targets.map((t) => t.where) : c))).toEqual([
      ["root > child 1"],
      ["root > child 2"],
      ["root > child 3"],
    ]);
    const middle = calls[1]!;
    // It really was over the soft cap, and it got a call anyway.
    expect(middle.kind === "batch" && middle.estimatedEvidenceTokens).toBeGreaterThan(
      recipe.maxEvidenceTokensPerBatch,
    );
  });

  /**
   * **The hard bound is different in kind, and a lone target may not breach
   * it.** A request past the model's real limit is a call that cannot succeed,
   * made anyway, after the wave in front of it has been paid for. What this
   * module owes is to say so, not to send it — the bounding, chunking or
   * refusal is stage 2's. ⟨GPT Sol, 2026-09-04⟩
   */
  it("hands back a target whose own request cannot fit, rather than a doomed call", () => {
    const blocks = article(400);
    const targets = [
      target(0, 3, "root > child 1"),
      target(4, 103, "root > child 2"),
      target(104, 107, "root > child 3"),
    ];
    const recipe: CascadeRecipe = {
      ...CASCADE_RECIPE,
      maxRequestTokensPerBatch: estimateEvidenceTokens(targets[1]!.node, blocks) - 1,
    };
    const calls = planExpansionBatches(targets, blocks, recipe, UNMEASURED_OVERHEAD);
    expect(calls.map((c) => c.kind)).toEqual(["batch", "oversized", "batch"]);
    const over = calls[1]!;
    if (over.kind !== "oversized") throw new Error("unreachable");
    expect(over.target.where).toBe("root > child 2");
    expect(over.estimatedRequestTokens).toBeGreaterThan(over.limit);
    // The batch in front of it is emitted whole, not swallowed.
    expect(calls[0]!.kind === "batch" && calls[0]!.targets.map((t) => t.where)).toEqual([
      "root > child 1",
    ]);
  });

  /**
   * **The prefix and the per-target metadata count towards the hard bound.**
   * The estimator deliberately leaves them out — they are constant within a
   * wave, so they cannot decide where a batch closes — but the request they are
   * part of is the thing the model has to accept. Measuring only the evidence
   * and calling it "input tokens" was the conflation Sol found.
   */
  it("counts the prefix and target metadata in the request, not in the evidence", () => {
    const blocks = article(400);
    const targets = Array.from({ length: 4 }, (_, i) =>
      target(i * 8, i * 8 + 7, `root > child ${i + 1}`),
    );
    const overhead: RequestOverhead = { prefixTokens: 5_000, perTargetTokens: 100 };
    const calls = planExpansionBatches(targets, blocks, CASCADE_RECIPE, overhead);
    const batch = calls[0]!;
    if (batch.kind !== "batch") throw new Error("unreachable");
    expect(batch.estimatedRequestTokens).toBe(
      estimateRequestTokens(batch.estimatedEvidenceTokens, batch.targets.length, overhead),
    );
    expect(batch.estimatedRequestTokens - batch.estimatedEvidenceTokens).toBe(5_400);

    // And a prefix alone can make a batch infeasible that its evidence never would.
    const tight: CascadeRecipe = { ...CASCADE_RECIPE, maxRequestTokensPerBatch: 5_050 };
    expect(planExpansionBatches(targets, blocks, tight, overhead).map((c) => c.kind)).toEqual([
      "oversized",
      "oversized",
      "oversized",
      "oversized",
    ]);
  });

  /** `span` is metadata a caller reads and nothing else checks. */
  it("reports the document-order span its targets actually cover", () => {
    const blocks = article(400);
    const targets = [
      target(3, 10, "root > child 1"),
      target(11, 20, "root > child 2"),
      target(21, 30, "root > child 3"),
    ];
    const recipe: CascadeRecipe = { ...CASCADE_RECIPE, maxParentsPerBatch: 2 };
    const calls = planExpansionBatches(targets, blocks, recipe, UNMEASURED_OVERHEAD);
    expect(calls.map((c) => c.span)).toEqual([
      [3, 20],
      [21, 30],
    ]);
  });
});

/* ------------------------------------------------------- normalisation --- */

describe("normaliseExpansion", () => {
  const blocks = article(20);
  const parent = [blockId(4), blockId(15)] as const;

  it("pins the first child to the parent's start and derives every end", () => {
    const report = emptyReport();
    const children = normaliseExpansion({
      children: [
        { start: blockId(5), title: "One" },
        { start: blockId(9), title: "Two" },
        { start: blockId(12), title: "Three" },
      ],
      parent,
      blocks,
      where: "root > child 2",
      report,
    });
    expect(children.map((c) => c.range)).toEqual([
      [blockId(4), blockId(8)],
      [blockId(9), blockId(11)],
      [blockId(12), blockId(15)],
    ]);
    // The first child claimed block 5 and got block 4: one boundary, moved one.
    expect(report.repairs).toEqual([
      { where: "root > child 2 > child 1", kind: "gap", at: 4, size: 1 },
    ]);
    expect(report.droppedChildren).toEqual([]);
  });

  /**
   * **The tiling is exact by construction, not by inspection.** A list of
   * ordered split points partitions its parent; the property this asserts is
   * that nothing in the starts-only path lets a gap or an overlap back in.
   */
  it("tiles the parent exactly, with no gap and no overlap, whatever the starts say", () => {
    /* Every start here is inside the parent except the first child's, which is
       pinned rather than clamped. A *later* start outside the parent is no
       longer planned around at all — it is refused, two tests below — so a
       case that used to claim block 19 of a parent ending at 15 now claims 15
       itself, and still exercises the collision and the drop it was written
       for. */
    const cases: string[][] = [
      [blockId(4), blockId(5), blockId(6)],
      [blockId(15), blockId(15), blockId(15)],
      [blockId(0), blockId(15), blockId(7)],
      [blockId(4), blockId(9), blockId(10), blockId(11), blockId(15)],
    ];
    for (const starts of cases) {
      const report = emptyReport();
      const children = normaliseExpansion({
        children: starts.map((start, i) => ({ start, title: `Child ${i + 1}` })),
        parent,
        blocks,
        where: "root",
        report,
      });
      expect(children.length).toBeGreaterThanOrEqual(2);
      const at = (id: string) => blocks.findIndex((b) => b.id === id);
      expect(at(children[0]!.range[0])).toBe(4);
      expect(at(children.at(-1)!.range[1])).toBe(15);
      for (const [i, child] of children.entries()) {
        expect(at(child.range[0])).toBeLessThanOrEqual(at(child.range[1]));
        const next = children[i + 1];
        if (next) expect(at(next.range[0])).toBe(at(child.range[1]) + 1);
      }
    }
  });

  /**
   * An invented id is the plainest fault left, and it still refuses — stage 0c
   * walked the size bound, the count bound and the backwards range back, and
   * this is what those three tests moved to. Planning around a start that means
   * nothing would replace a precise error with a vague one.
   */
  it("refuses an invented start rather than planning around it", () => {
    expect(() =>
      normaliseExpansion({
        children: [
          { start: blockId(5), title: "One" },
          { start: "spya-zzzzzz", title: "Two" },
        ],
        parent,
        blocks,
        where: "root > child 2",
        report: emptyReport(),
      }),
    ).toThrow(/not in blocks\.json.*child 2.*spya-zzzzzz/s);
  });

  /**
   * **Fewer than two kept children is not an expansion**, and the two roads to
   * it are the same fault. One child inherits its parent's entire range, so the
   * governor asks the identical question one level down and the cascade grinds
   * to `maxDepth` having divided nothing. GPT Sol reproduced both shapes, and
   * this file's own "tiles the parent exactly" case positively exercised the
   * first of them until 2026-09-04.
   */
  it("refuses an answer of one child, and one that collapses to one after drops", () => {
    const outright = () =>
      normaliseExpansion({
        children: [{ start: blockId(9), title: "Only" }],
        parent,
        blocks,
        where: "root",
        report: emptyReport(),
      });
    expect(outright).toThrow(ExpansionRefused);
    expect(outright).toThrow(/1 usable child from 1 proposed/);

    /* Three starts, two of which mark no split point — neither advances past
       the parent's own start, where the first child is pinned. A one-child
       answer wearing a disguise, and invisible until after the planning. */
    const collapsed = () =>
      normaliseExpansion({
        children: [
          { start: blockId(9), title: "One" },
          { start: blockId(4), title: "Two" },
          { start: blockId(4), title: "Three" },
        ],
        parent,
        blocks,
        where: "root",
        report: emptyReport(),
      });
    expect(collapsed).toThrow(/1 usable child from 3 proposed, and 2 start\(s\)/);
  });

  it("refuses an expansion that proposes no children at all", () => {
    expect(() =>
      normaliseExpansion({ children: [], parent, blocks, where: "root", report: emptyReport() }),
    ).toThrow(/no children/);
  });

  /**
   * **A refused answer costs the run nothing it will be charged for twice.**
   * The batch is going to be retried; if its drops had already been added to
   * the run's totals, the second attempt would add them again, and
   * `repairedBlocks` is the figure the CLI prints and the eval scores arms on.
   */
  it("leaves the caller's report untouched when it refuses, and carries the working on the error", () => {
    const report = emptyReport();
    try {
      normaliseExpansion({
        children: [
          { start: blockId(9), title: "One" },
          { start: blockId(4), title: "Two" },
        ],
        parent,
        blocks,
        where: "root",
        report,
      });
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(ExpansionRefused);
      const refusal = err as ExpansionRefused;
      expect(refusal.reason).toBe("not-an-expansion");
      expect(refusal.planned.droppedChildren).toEqual(["root > child 2"]);
    }
    expect(report).toEqual(emptyReport());
  });

  /**
   * **A start that does not advance is not a split point.** With ends
   * withheld from the schema there is no second claim to fall back to, so the
   * child is dropped and counted — the same loss `planChildRanges` reports
   * when a backwards end makes its own fallback ineligible.
   */
  it("drops a duplicate start, and counts it", () => {
    const report = emptyReport();
    const children = normaliseExpansion({
      children: [
        { start: blockId(4), title: "One" },
        { start: blockId(4), title: "Two" },
        { start: blockId(10), title: "Three" },
      ],
      parent,
      blocks,
      where: "root",
      report,
    });
    expect(children.map((c) => c.title)).toEqual(["One", "Three"]);
    expect(report.droppedChildren).toEqual(["root > child 2"]);
    expect(children.map((c) => c.range)).toEqual([
      [blockId(4), blockId(9)],
      [blockId(10), blockId(15)],
    ]);
  });

  /**
   * **Starts in reverse order do not collapse to one child**, and the reason
   * is worth pinning: the first child is *pinned* to its parent's start
   * whatever it claimed, so the second claim is measured against the parent's
   * own boundary rather than against the first child's ambition. Only the third
   * has nothing left to say. The eight blocks the first claim was out by are
   * not swallowed — they are the head repair, which is the number a re-ask
   * would be triggered by.
   */
  it("keeps what a reversed list still supplies, and reports the distance", () => {
    const report = emptyReport();
    const children = normaliseExpansion({
      children: [
        { start: blockId(12), title: "Late" },
        { start: blockId(8), title: "Middle" },
        { start: blockId(5), title: "Early" },
      ],
      parent,
      blocks,
      where: "root",
      report,
    });
    expect(children.map((c) => c.title)).toEqual(["Late", "Middle"]);
    expect(children.map((c) => c.range)).toEqual([
      [blockId(4), blockId(7)],
      [blockId(8), blockId(15)],
    ]);
    expect(report.droppedChildren).toEqual(["root > child 3"]);
    expect(report.repairs).toEqual([{ where: "root > child 1", kind: "gap", at: 4, size: 8 }]);
  });

  it("drops a non-increasing start in the middle and keeps its neighbours", () => {
    const report = emptyReport();
    const children = normaliseExpansion({
      children: [
        { start: blockId(4), title: "One" },
        { start: blockId(9), title: "Two" },
        { start: blockId(7), title: "Backwards" },
        { start: blockId(13), title: "Four" },
      ],
      parent,
      blocks,
      where: "root",
      report,
    });
    expect(children.map((c) => c.title)).toEqual(["One", "Two", "Four"]);
    expect(report.droppedChildren).toEqual(["root > child 3"]);
  });

  /**
   * **Presence, not truthiness.** A truthiness spread deletes `sourceHeading:
   * ""`, and `buildTree` counts an unbacked heading claim into
   * `droppedHeadings` from `!== undefined` — deliberately, so that "a number,
   * or a string of spaces" is counted too. Dropping the empty string here made
   * the cascade report fewer dropped headings than the incumbent would on
   * identical model output, silently. ⟨GPT Sol, 2026-09-04⟩
   */
  it("carries an empty sourceHeading and an empty gist through, rather than deleting them", () => {
    const children = normaliseExpansion({
      children: [
        { start: blockId(4), title: "One", gist: "", sourceHeading: "" },
        { start: blockId(10), title: "Two", gist: "A gist.", sourceHeading: "Two" },
      ],
      parent,
      blocks,
      where: "root",
      report: emptyReport(),
    });
    expect(Object.hasOwn(children[0]!, "sourceHeading")).toBe(true);
    expect(children[0]!.sourceHeading).toBe("");
    expect(Object.hasOwn(children[0]!, "gist")).toBe(true);
    expect(children[1]).toMatchObject({ gist: "A gist.", sourceHeading: "Two" });
  });

  /**
   * **A start outside the parent is refused, not clamped.**
   *
   * The cascade's whole argument is that *"a call shown thirty blocks cannot
   * emit a range that is wrong by 1,289 of them"* — and a clamp makes that
   * sentence false by quietly mending the one answer that would have proved it.
   * A scoped call is shown its parent's blocks and nothing else, so a start
   * outside them is an answer about a different stretch of the article: a
   * different fault from a boundary in the wrong place, and worth another draw.
   */
  it("refuses a later start outside the parent, and names it", () => {
    const report = emptyReport();
    const refuse = () =>
      normaliseExpansion({
        children: [
          { start: blockId(4), title: "One" },
          { start: blockId(17), title: "Two" },
        ],
        parent,
        blocks,
        where: "root > child 2",
        report,
      });
    expect(refuse).toThrow(ExpansionRefused);
    try {
      refuse();
    } catch (err) {
      const refusal = err as ExpansionRefused;
      expect(refusal.reason).toBe("outside-parent");
      // The offending id, and where the parent ends, both through `nameValue`.
      expect(refusal.message).toContain(blockId(17));
      expect(refusal.message).toContain(blockId(15));
      expect(refusal.planned).toEqual(emptyReport());
    }
    // Retryable, and the run is charged nothing for an answer it will re-ask.
    expect(report).toEqual(emptyReport());
  });

  /**
   * **The first kept child keeps its pin, which is not a clamp of a claim.**
   * Children must cover their parent and nothing else can supply that block, so
   * an opening claim from outside is absorbed and *measured* — the head repair
   * is the number a re-ask would be triggered by — rather than refused.
   */
  it("still pins the first child to the parent's start when its claim is outside", () => {
    const report = emptyReport();
    const children = normaliseExpansion({
      children: [
        { start: blockId(0), title: "One" },
        { start: blockId(9), title: "Two" },
      ],
      parent,
      blocks,
      where: "root",
      report,
    });
    expect(children[0]!.range).toEqual([blockId(4), blockId(8)]);
    expect(report.repairs).toEqual([
      { where: "root > child 1", kind: "overlap", at: 4, size: 4 },
    ]);
  });

  /**
   * **The heading snap, which only one of the two derivations had.**
   *
   * `planChildRanges` runs `snapStartsToHeadings`: a child that begins one
   * block after an authored heading and whose own `sourceHeading` names that
   * heading is moved back onto it. `normaliseExpansion` did not, and from wave
   * 2 on that is two rules over one tree — a scoped call is shown a slice
   * derived by `planChildRanges` and its answer is derived here.
   *
   * Measured on a 142-page Kuhn paper: 53 of 82 nodes started on the block
   * immediately after a heading, and every unbacked `sourceHeading` reproduced
   * was at that offset (src/heading-snap.ts).
   */
  it("moves a child back onto the heading it names, as planChildRanges does", () => {
    const withHeading = article(20, (i) => (i === 8 ? heading(i) : para(i)));
    const report = emptyReport();
    const children = normaliseExpansion({
      children: [
        { start: blockId(5), title: "One" },
        { start: blockId(9), title: "Two", sourceHeading: "Heading 8" },
      ],
      parent,
      blocks: withHeading,
      where: "root",
      report,
    });
    expect(children.map((c) => c.range)).toEqual([
      [blockId(4), blockId(7)],
      [blockId(8), blockId(15)],
    ]);
    expect(report.repairs).toContainEqual({
      where: "root > child 2",
      kind: "heading",
      at: 8,
      size: 1,
    });
  });

  /**
   * **The differential test: the two derivations must not drift apart.**
   *
   * `normaliseExpansion` and `planChildRanges` implement the same rule in two
   * files — believe the start, compute every end — and the review's ruling was
   * to keep them separate rather than thread an optional `ends` through one
   * helper. This is what makes that safe: normalise an answer, hand the result
   * to the *real* `buildTree`, and require that it changes nothing and finds
   * nothing to mend. The day the two rules disagree, this goes red and names
   * the boundary.
   *
   * It also proves the double-count concern is unfounded in the direction that
   * matters: the final build over an already-normalised cascade adds no repairs
   * of its own, so the figures this module records *are* the run's figures.
   * The idempotence test it replaces never touched `buildTree` at all.
   * ⟨GPT Sol, 2026-09-04⟩
   */
  it("agrees with buildTree: a fresh build changes no range and records no repair", () => {
    const whole = article(16);
    const normalised = emptyReport();
    const children = normaliseExpansion({
      children: [
        { start: blockId(2), title: "One" },
        { start: blockId(6), title: "Two" },
        { start: blockId(11), title: "Three" },
      ],
      parent: [blockId(0), blockId(15)],
      blocks: whole,
      where: "root",
      report: normalised,
    });
    expect(normalised.repairs.length).toBe(1); // the head boundary, moved two

    const rebuilt = emptyReport();
    const tree = buildTree(
      { title: "Root", range: [blockId(0), blockId(15)], children },
      {},
      whole,
      "differential",
      rebuilt,
    );
    expect(rebuilt).toEqual(emptyReport());

    const internal = Object.values(tree.nodes).filter(
      (n) => n.parent === tree.rootId && n.children.length > 0,
    );
    expect(internal.map((n) => n.range)).toEqual(children.map((c) => c.range));
  });

  /**
   * **The differential test, on the case that was escaping it.** The snap moved
   * into src/heading-snap.ts precisely so that both derivations run the same
   * one; this is what says they did. Without it `normaliseExpansion` hands
   * `buildTree` a child starting one block after its own heading, and
   * `planChildRanges` snaps it — a changed range and a `heading` repair, on a
   * tree the cascade had already called finished.
   */
  it("agrees with buildTree on a section that began one block after its heading", () => {
    const whole = article(16, (i) => (i === 8 ? heading(i) : para(i)));
    const normalised = emptyReport();
    const children = normaliseExpansion({
      children: [
        { start: blockId(0), title: "One" },
        { start: blockId(9), title: "Two", sourceHeading: "Heading 8" },
        { start: blockId(12), title: "Three" },
      ],
      parent: [blockId(0), blockId(15)],
      blocks: whole,
      where: "root",
      report: normalised,
    });
    expect(children.map((c) => c.range)).toEqual([
      [blockId(0), blockId(7)],
      [blockId(8), blockId(11)],
      [blockId(12), blockId(15)],
    ]);
    expect(normalised.repairs).toEqual([
      { where: "root > child 2", kind: "heading", at: 8, size: 1 },
    ]);

    const rebuilt = emptyReport();
    const tree = buildTree(
      { title: "Root", range: [blockId(0), blockId(15)], children },
      {},
      whole,
      "differential-heading",
      rebuilt,
    );
    expect(rebuilt).toEqual(emptyReport());
    const internal = Object.values(tree.nodes).filter(
      (n) => n.parent === tree.rootId && n.children.length > 0,
    );
    expect(internal.map((n) => n.range)).toEqual(children.map((c) => c.range));
    // The claim is backed now, so the `§` badge survives — which is what the
    // snap is for, rather than the boundary as such.
    expect(internal[1]!.sourceHeading).toBe("Heading 8");
  });

  /**
   * **The one place the two derivations differ, stated so that the differential
   * test's promise is precise.** `planChildRanges` clamps a start back inside
   * its parent and keeps the article; `normaliseExpansion` refuses. That is not
   * drift: the incumbent is a whole-document call naming a boundary in an
   * article it has all of, and its behaviour is measured and is not being
   * changed by this stage. A scoped call has no such excuse.
   */
  it("differs from planChildRanges on an out-of-range start, deliberately", () => {
    const whole = article(16);
    const outside: ModelNode = {
      title: "Root",
      range: [blockId(0), blockId(15)],
      children: [
        {
          title: "One",
          range: [blockId(0), blockId(7)],
          children: [
            { title: "One a", range: [blockId(0), blockId(3)] },
            { title: "One b", range: [blockId(10), blockId(11)] },
          ],
        },
        { title: "Two", range: [blockId(8), blockId(15)] },
      ],
    };
    const incumbent = emptyReport();
    expect(() => buildTree(outside, {}, whole, "clamped", incumbent)).not.toThrow();
    expect(incumbent.repairs.length).toBeGreaterThan(0);

    expect(() =>
      normaliseExpansion({
        children: [
          { start: blockId(0), title: "One a" },
          { start: blockId(10), title: "One b" },
        ],
        parent: [blockId(0), blockId(7)],
        blocks: whole,
        where: "root > child 1",
        report: emptyReport(),
      }),
    ).toThrow(/outside the parent's range/);
  });
});

/* ------------------------------------------------------- the tree, back -- */

/**
 * **Wave 2 plans from the tree wave 1 built**, so the conversion back has to be
 * lossless — and *ranges alone are not the property that matters*. A round trip
 * that kept every range and shuffled the titles would produce a tree in which
 * each section is named after its neighbour, and every invariant we have would
 * pass it: it tiles, it covers, it has a gist on every internal node. So this
 * asserts internal shape, `title`, `gist` and `sourceHeading`, and that the
 * second build finds nothing to mend and nothing to drop.
 */
describe("proposalFromTree", () => {
  const blocks = article(16, (i) => (i === 8 ? heading(i) : para(i)));
  const navLabels = { [blockId(2)]: "A leaf label" };
  const proposal: ModelNode = {
    title: "Root",
    gist: "The whole argument, in one sentence.",
    range: [blockId(0), blockId(15)],
    children: [
      {
        title: "One",
        gist: "The first half.",
        range: [blockId(0), blockId(7)],
        children: [
          { title: "One a", gist: "Opening.", range: [blockId(0), blockId(3)] },
          { title: "One b", gist: "Turn.", range: [blockId(4), blockId(7)] },
        ],
      },
      {
        title: "Two",
        gist: "The second half.",
        range: [blockId(8), blockId(15)],
        sourceHeading: "Heading 8",
      },
    ],
  };

  it("round-trips a built tree with no repair and no drop on the second build", () => {
    const first = emptyReport();
    const tree = buildTree(proposal, navLabels, blocks, "round-trip", first);
    expect(first).toEqual(emptyReport()); // or the second build proves less

    const back = proposalFromTree(tree);
    expect(back).toEqual(proposal);

    const second = emptyReport();
    const again = buildTree(back, navLabels, blocks, "round-trip", second);
    expect(second).toEqual(emptyReport());
    /* The same tree, node for node — ids included, because `buildTree` mints
       them in visit order and the visit order is what the shape decides. */
    expect(again).toEqual(tree);
  });

  it("keeps the title, gist and sourceHeading attached to the prose they describe", () => {
    const back = proposalFromTree(buildTree(proposal, navLabels, blocks, "round-trip"));
    const two = back.children!.at(-1)!;
    expect(two).toMatchObject({
      title: "Two",
      gist: "The second half.",
      sourceHeading: "Heading 8",
      range: [blockId(8), blockId(15)],
    });
    expect(back.children![0]!.children!.map((c) => [c.title, c.range])).toEqual([
      ["One a", [blockId(0), blockId(3)]],
      ["One b", [blockId(4), blockId(7)]],
    ]);
  });

  /**
   * The leaf layer is regrown from the range and carries no decision, so it is
   * dropped — and a node whose children are all leaves comes back childless,
   * which is what makes the round trip idempotent rather than one level deeper
   * every time.
   */
  it("drops the leaf layer, and the labels survive because they are not in the tree", () => {
    const tree = buildTree(proposal, navLabels, blocks, "round-trip");
    const back = proposalFromTree(tree);
    expect(back.children!.at(-1)!.children).toBeUndefined();
    const rebuilt = buildTree(back, navLabels, blocks, "round-trip");
    const labelled = Object.values(rebuilt.nodes).filter((n) => n.navLabel !== undefined);
    expect(labelled.map((n) => [n.range[0], n.navLabel])).toEqual([[blockId(2), "A leaf label"]]);
  });

  it("refuses a tree that names a node it does not hold", () => {
    const tree = buildTree(proposal, navLabels, blocks, "round-trip");
    const broken = { ...tree, nodes: { ...tree.nodes } };
    const orphan = Object.values(broken.nodes).find((n) => n.parent === tree.rootId)!;
    delete broken.nodes[orphan.id];
    expect(() => proposalFromTree(broken)).toThrow(/does not hold/);
  });
});

/* --------------------------------------------------------- completeness -- */

describe("assertCascadeComplete", () => {
  const blocks = article(40);
  const check = (root: CascadeNode, capReached: CascadeState["capReached"] = []) =>
    assertCascadeComplete(state(root, capReached), blocks, CASCADE_RECIPE);

  it("throws when any node is still pending", () => {
    const root = expanded(0, 9, [terminal(0, 4), pending(5, 9)]);
    expect(() => check(root)).toThrow(/root > child 2/);
  });

  /**
   * The control. Without it, a matcher that fires on every state would look
   * exactly like the one above passing — and "no incomplete cascade can
   * materialise as a tree" would be a sentence rather than a check.
   */
  it("accepts a cascade whose every node is terminal or expanded", () => {
    const root = expanded(0, 9, [
      terminal(0, 4),
      expanded(5, 9, [terminal(5, 7), terminal(8, 9)]),
    ]);
    expect(() => check(root)).not.toThrow();
  });

  it("names every pending node, not just the first", () => {
    const root = expanded(0, 9, [pending(0, 4), pending(5, 9)]);
    expect(() => check(root)).toThrow(/root > child 1.*root > child 2/s);
  });

  /**
   * **The state Sol reproduced, and the reason this guard was rewritten.** A
   * ten-structural-block root marked `"expanded"` with no children: the old
   * guard accepted it, because it only looked for `"pending"`; `shouldExpand`
   * said it still needed splitting; and `buildTree` quietly grew ten leaves
   * under it. A whole level of the article gone, and nothing to say so.
   *
   * The cast is the point rather than a convenience: the union now makes this a
   * compile error, and the runtime check exists because a resumed cascade
   * arrives as JSON off a checkpoint where the union has proved nothing.
   */
  it("throws on an expanded node with no children — the state a checkpoint can carry", () => {
    const root = { ...terminal(0, 9), status: "expanded", children: [] } as unknown as CascadeNode;
    expect(() => check(root)).toThrow(/marked expanded with 0 child\(ren\)/);
  });

  it("throws on an expanded node with only one child", () => {
    const root = {
      ...terminal(0, 9),
      status: "expanded",
      children: [terminal(0, 9)],
    } as unknown as CascadeNode;
    expect(() => check(root)).toThrow(/marked expanded with 1 child\(ren\)/);
  });

  /**
   * **A node quietly marked terminal is the failure this guard exists for.**
   * It is indistinguishable from one that legitimately stopped — same shape,
   * same tiling, same gist — and it costs the reader a level. The depth cap is
   * allowed to produce one; what is not allowed is producing one and saying
   * nothing, which is the plan's own ruling: *"Treating such a node as silently
   * terminal is the option that is not available."*
   */
  it("throws on a terminal node the governor would expand, unless capReached says why", () => {
    const root = expanded(0, 19, [terminal(0, 14), terminal(15, 19)]);
    expect(() => check(root)).toThrow(/marked terminal but holds 15 structural block\(s\)/);

    const recorded = [
      { where: "root > child 1", range: [blockId(0), blockId(14)] as const, structuralBlocks: 15 },
    ];
    expect(() => check(root, recorded)).not.toThrow();
  });

  /** Bookkeeping that has drifted from the tree it describes explains nothing. */
  it("throws on a capReached record naming no terminal node in the tree", () => {
    const root = expanded(0, 9, [terminal(0, 4), terminal(5, 9)]);
    const recorded = [
      { where: "root > child 7", range: [blockId(0), blockId(4)] as const, structuralBlocks: 15 },
    ];
    expect(() => check(root, recorded)).toThrow(/names root > child 7, which is not a terminal node/);
  });

  /**
   * **The message reaches the log and the job card**, and `range` is model
   * output behind a cast that need not hold block ids at all. Sol reproduced an
   * error carrying a sentence of the article verbatim. `nameValue` is the rule,
   * and every other throw in the module already used it.
   */
  it("withholds a range that is a sentence of the article rather than a block id", () => {
    const secret = "The claimant was seen leaving the building at half past four.";
    const root = {
      title: "Root",
      range: [secret, blockId(9)],
      status: "pending",
    } as unknown as CascadeNode;
    let message = "";
    try {
      check(root);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("not a block id");
    expect(message).not.toContain(secret);
    expect(message).not.toContain("claimant");
  });
});

describe("finaliseCascade", () => {
  const blocks = article(40);

  /**
   * `CascadeNode` is structurally a `ModelNode`, so `buildTree(state.root, …)`
   * compiles and skips every check. This is the road that does not.
   */
  it("runs the guard before handing back anything buildable", () => {
    const bad = state(expanded(0, 9, [terminal(0, 4), pending(5, 9)]));
    expect(() => finaliseCascade(bad, blocks, CASCADE_RECIPE)).toThrow(/still awaiting expansion/);

    const good = state(expanded(0, 9, [terminal(0, 4), terminal(5, 9)]));
    expect(finaliseCascade(good, blocks, CASCADE_RECIPE)).toBe(good.root);
  });
});
