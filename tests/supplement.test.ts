/**
 * **The supplement node** (src/supplement.ts): the apparatus, present in the
 * structure and absent from the argument.
 *
 * Written against the `example/` fixture — 34 blocks, 2 parts, 8 sections —
 * with synthetic endnotes appended, because that is the shape the real pipeline
 * produces: `buildTree` over the body alone, then `appendSupplement`.
 *
 * **Every check here has been watched go red.** The six invariants are mutated
 * one at a time rather than by deleting the node and watching validation fail,
 * which mostly re-tests the old coverage invariant and proves nothing about any
 * of them (docs/plans/260828o-footnotes.md § The tree).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { partsOf, buildArc } from "../src/arc.js";
import { deriveLibraryScalars } from "../src/library-scalars.js";
import { hashBlocks, structureHash } from "../src/source-hash.js";
import {
  appendSupplement,
  isSupplementNode,
  splitBlocks,
  supplementIndex,
  supplementNodes,
} from "../src/supplement.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";
import { itemsFromCells, currentIndex } from "../src/web/context.js";
import { navPlan, stepTarget } from "../src/web/keynav.js";
import { activeSectionIndex, buildSections, sectionDepth } from "../src/web/position.js";
import {
  buildArcColumn,
  buildGeometry,
  buildOutline,
  buildSummaryTree,
  navigableItems,
} from "../src/web/tree.js";

/** The arc's input fingerprint is not what these tests are about; see tests/arc-freshness.test.ts. */
const FIXTURE_HASH = "0000000000000000.0000000000000000.0000000000000000";

const bodyBlocks: Block[] = JSON.parse(readFileSync("example/blocks.json", "utf8")).blocks;
const bodyTree: Tree = JSON.parse(readFileSync("example/tree.json", "utf8"));

/** A note block, in the shape stage 3 leaves them: body-looking, apparatus-marked. */
function note(i: number, role: NonNullable<Block["role"]> = "footnote"): Block {
  return {
    id: `spya-note${i}`,
    tag: "p",
    kind: "text",
    text: `Note ${i}. Some further reading nobody reads front to back.`,
    words: 10,
    html: `<p id="spya-note${i}">Note ${i}.</p>`,
    gistable: true,
    role,
    treatment: "supplement",
    noteId: `n${i}`,
  };
}

/**
 * A copy of the body tree one level deeper — every leaf gains a single child,
 * so `leafDepth` goes 3 → 4 and the sections column moves to depth 3.
 *
 * **Why a test needs this shape at all.** A supplement is always depth 1 with
 * its leaves at depth 2, so a note's chain is three nodes long however deep the
 * body is. Once the body is deeper than that, the supplement's cells at the
 * sections column are *continuations* — and the fisheye drops continuations
 * while the saved position keeps them, so the apparatus vanished from one panel
 * and not the other. Nothing forbids this tree: `buildTree` accepts arbitrary
 * depth, the invariants impose no maximum, and the prompt asking for three
 * levels is not a contract the model is held to. GPT Sol, 2026-08-29.
 */
function deepen(tree: Tree): Tree {
  const deep = JSON.parse(JSON.stringify(tree)) as Tree;
  let n = 9000;
  for (const node of Object.values({ ...deep.nodes })) {
    if (node.children.length > 0) continue;
    const id = `n${++n}` as NodeId;
    deep.nodes[id] = {
      id,
      parent: node.id,
      depth: node.depth + 1,
      children: [],
      range: [...node.range],
      title: "",
    };
    node.children = [id];
    // It has just become internal, so it owes a gist — or `checkTree` would
    // redden for a reason that has nothing to do with what is under test.
    node.gist ??= "A gist, so that the tree this fixture builds is a sound one.";
  }
  return deep;
}

/** The article the real pipeline would produce: body tree, then the apparatus. */
function withNotes(
  count: number,
  role: NonNullable<Block["role"]> = "footnote",
  deeper = false,
): { blocks: Block[]; tree: Tree } {
  const notes = Array.from({ length: count }, (_, i) => note(i + 1, role));
  const blocks = [...bodyBlocks, ...notes];
  const split = splitBlocks(blocks);
  expect(split.stranded).toBe(0);
  const body = deeper ? deepen(bodyTree) : bodyTree;
  return { blocks, tree: appendSupplement(body, split.groups) };
}

/** A deep copy, so a mutation cannot leak into the next test. */
const clone = (tree: Tree): Tree => JSON.parse(JSON.stringify(tree)) as Tree;

const NOTES = 6;
const { blocks, tree } = withNotes(NOTES);
const supplement = supplementNodes(tree)[0]!;
/** The first row of the apparatus — where a reader "standing mid-Notes" is. */
const firstNoteRow = bodyBlocks.length;
const midNoteRow = bodyBlocks.length + 3;

describe("splitBlocks", () => {
  it("cuts the trailing run off the body and names it", () => {
    const split = splitBlocks(blocks);
    expect(split.body.length).toBe(bodyBlocks.length);
    expect(split.groups.length).toBe(1);
    expect(split.groups[0]!.title).toBe("Notes");
    expect(split.groups[0]!.blocks.length).toBe(NOTES);
  });

  it("leaves an article with no apparatus exactly as it was", () => {
    const split = splitBlocks(bodyBlocks);
    expect(split.groups).toEqual([]);
    expect(split.stranded).toBe(0);
    expect(appendSupplement(bodyTree, split.groups)).toBe(bodyTree);
  });

  it("cuts two nodes where the source has Notes and References", () => {
    // Only `"footnote"` is ever assigned in v1, so this is the shape the second
    // role has to land in rather than something that happens today.
    const mixed = [...bodyBlocks, note(1), note(2), note(3, "reference")];
    const split = splitBlocks(mixed);
    expect(split.groups.map((g) => g.title)).toEqual(["Notes", "References"]);
    const two = appendSupplement(bodyTree, split.groups);
    expect(supplementNodes(two).map((n) => n.title)).toEqual(["Notes", "References"]);
    expect(checkTree(mixed, two).problems).toEqual([]);
  });

  it("refuses an article that is nothing but apparatus", () => {
    // There is no body to build a tree from, so there is nothing to append a
    // supplement to. Same answer as a stranded note: publish as before, and say
    // the number out loud.
    const allNotes = [note(1), note(2), note(3)];
    const split = splitBlocks(allNotes);
    expect(split.groups).toEqual([]);
    expect(split.stranded).toBe(3);
    expect(split.body.length).toBe(3);
  });

  it("refuses the whole split when a note is stranded in the body", () => {
    /* The fallback, and the reason it is total rather than partial: a
       supplement node that covered only *some* of the apparatus would break
       invariant 4 the moment it existed, so an article of this shape publishes
       exactly as it did before this stage — with the count said out loud rather
       than swallowed. */
    const stranded = [...bodyBlocks.slice(0, 5), note(99), ...bodyBlocks.slice(5), note(1)];
    const split = splitBlocks(stranded);
    expect(split.groups).toEqual([]);
    expect(split.stranded).toBe(1);
    expect(split.body.length).toBe(stranded.length);
  });

  /**
   * **The count is the only thing that says this happened, and it was silent in
   * the one shape that reaches it most often.**
   *
   * The scan walks back from the end looking for the trailing apparatus run. If
   * the *last* block is body there is no run, and the function returned `none`
   * — with `stranded: 0` — before counting anything earlier. So an article
   * whose apparatus sits mid-body and whose last block is an ordinary paragraph
   * reported no apparatus at all: no Notes node built, the note buried under an
   * ordinary structural branch, `HierarchyRun.strandedSupplement` zero, and the
   * CLI printing its usual "0 nodes over 0 blocks".
   *
   * `openai-huggingface` is exactly that article — a stranded footnote at index
   * 93 followed by a blog footer reading "No posts" — and the root clamp
   * (src/hierarchy.ts) has just made it publishable, so this stops being a
   * latent hole and starts being something we do. Nothing about `body` or
   * `groups` changes; what changes is that the run says so.
   * docs/reusable/silent-success.md.
   */
  it("counts a stranded note even when the article ends on body", () => {
    const stranded = [...bodyBlocks.slice(0, 5), note(99), ...bodyBlocks.slice(5)];
    const split = splitBlocks(stranded);
    expect(split.groups).toEqual([]);
    expect(split.stranded).toBe(1);
    // Unchanged, and that is the point: this is a reporting fix, not a
    // behaviour change. Every block is still body and nothing is grouped.
    expect(split.body.length).toBe(stranded.length);
  });

  it("still says nothing happened when nothing did", () => {
    /* The control. The assertion above would also pass if `stranded` had become
       "how many blocks are there", so this is what says zero is still reachable. */
    const split = splitBlocks(bodyBlocks);
    expect(split.groups).toEqual([]);
    expect(split.stranded).toBe(0);
    expect(split.body.length).toBe(bodyBlocks.length);
  });
});

describe("the appended tree", () => {
  it("is one depth-one node with a title, no gist, and a leaf per note", () => {
    expect(supplement.depth).toBe(1);
    expect(supplement.parent).toBe(tree.rootId);
    expect(supplement.title).toBe("Notes");
    expect(supplement.gist).toBeUndefined();
    expect(supplement.treatment).toBe("supplement");
    expect(supplement.children.length).toBe(NOTES);
    for (const id of supplement.children) {
      const leaf = tree.nodes[id]!;
      expect(leaf.children).toEqual([]);
      expect(leaf.navLabel).toBeUndefined();
    }
  });

  it("extends the root's range and changes no body part's", () => {
    // The half of the join hazard that is safe by construction — and it is only
    // *because* it is safe that the summary fix below can be this small.
    expect(tree.nodes[tree.rootId]!.range[1]).toBe(blocks.at(-1)!.id);
    for (const part of partsOf(bodyTree)) {
      expect(tree.nodes[part.id]!.range).toEqual(part.range);
    }
  });

  it("passes every invariant", () => {
    expect(checkTree(blocks, tree).problems).toEqual([]);
  });
});

/* ------------------------------------------------- the six, one at a time --

   Each mutation below is a separate, plausible way the pipeline could get this
   wrong, and each must redden a message that names the supplement — not the
   general coverage rule that would fire anyway. */

describe("the six invariants", () => {
  const problemsOf = (mutate: (t: Tree) => void, bs: Block[] = blocks): string[] => {
    const t = clone(tree);
    mutate(t);
    return checkTree(bs, t).problems;
  };

  it("1 — a supplement is a depth-one child of the root", () => {
    const problems = problemsOf((t) => {
      const part = partsOf(t)[0]!;
      const s = t.nodes[supplement.id]!;
      // Re-parented under the first part, which is how a supplement would land
      // if it were built from inside the body tree rather than appended to it.
      t.nodes[t.rootId]!.children = t.nodes[t.rootId]!.children.filter((id) => id !== s.id);
      t.nodes[part.id]!.children.push(s.id);
      s.parent = part.id;
      s.depth = 2;
    });
    expect(problems.some((p) => /supplement is depth 2 under/.test(p))).toBe(true);
  });

  it("2 — it covers exactly one contiguous range", () => {
    // Two supplements over one range. A second node arriving on an article that
    // already has one is the shape the References group will one day have.
    const overlap = problemsOf((t) => {
      const twin: TreeNode = {
        ...JSON.parse(JSON.stringify(t.nodes[supplement.id]!)),
        id: "n9001" as NodeId,
        children: [],
      };
      twin.range = [blocks[firstNoteRow]!.id, blocks.at(-1)!.id];
      t.nodes[twin.id] = twin;
      t.nodes[t.rootId]!.children.push(twin.id);
    });
    expect(overlap.some((p) => /supplement overlaps supplement/.test(p))).toBe(true);

    const backwards = problemsOf((t) => {
      t.nodes[supplement.id]!.range = [blocks.at(-1)!.id, blocks[firstNoteRow]!.id];
    });
    expect(backwards.some((p) => /supplement range runs backwards/.test(p))).toBe(true);
  });

  it("3 — it contains only supplement blocks", () => {
    /* The direction that matters most: a body paragraph swallowed by the
       apparatus disappears from the argument, from every summary and from the
       arc, and every other check in the file still passes. */
    const problems = problemsOf((t) => {
      const s = t.nodes[supplement.id]!;
      const swallowed = blocks[firstNoteRow - 1]!;
      s.range = [swallowed.id, s.range[1]];
      const leafId = "n9100" as NodeId;
      t.nodes[leafId] = {
        id: leafId,
        depth: 2,
        parent: s.id,
        children: [],
        range: [swallowed.id, swallowed.id],
        title: "",
      };
      s.children.unshift(leafId);
    });
    expect(problems.some((p) => /which is body/.test(p))).toBe(true);
  });

  it("4 — it contains every supplement block", () => {
    /* The first note handed back to the last body section, which keeps the
       tiling, the coverage and the root's range all correct — so nothing but
       the supplement's own rule can catch it. */
    const problems = problemsOf((t) => {
      const s = t.nodes[supplement.id]!;
      const orphanLeaf = t.nodes[s.children[0]!]!;
      s.children = s.children.slice(1);
      s.range = [blocks[firstNoteRow + 1]!.id, s.range[1]];
      const lastPart = partsOf(t).at(-1)!;
      const lastSection = t.nodes[lastPart.children.at(-1)!]!;
      lastSection.children.push(orphanLeaf.id);
      orphanLeaf.parent = lastSection.id;
      orphanLeaf.depth = lastSection.depth + 1;
      lastSection.range = [lastSection.range[0], orphanLeaf.range[1]];
      t.nodes[lastPart.id]!.range = [lastPart.range[0], orphanLeaf.range[1]];
    });
    expect(problems.some((p) => /sit outside every supplement node/.test(p))).toBe(true);
    // And nothing else: this tree tiles, covers and partitions correctly.
    expect(problems.filter((p) => !/sit outside every supplement node/.test(p))).toEqual([]);
  });

  it("5 — only leaves sit beneath it", () => {
    const problems = problemsOf((t) => {
      const s = t.nodes[supplement.id]!;
      const wrapped = s.children.slice(0, 2);
      const groupId = "n9200" as NodeId;
      t.nodes[groupId] = {
        id: groupId,
        depth: 2,
        parent: s.id,
        children: wrapped,
        range: [t.nodes[wrapped[0]!]!.range[0], t.nodes[wrapped[1]!]!.range[1]],
        title: "First two notes",
        gist: "A gist, so that only invariant 5 can be what reddens this.",
      };
      for (const id of wrapped) {
        t.nodes[id]!.parent = groupId;
        t.nodes[id]!.depth = 3;
      }
      s.children = [groupId, ...s.children.slice(2)];
    });
    expect(problems.some((p) => /only leaves may sit under a supplement/.test(p))).toBe(true);
  });

  /* Invariant 5 says "no child of mine has children", which a supplement with
     *no* children satisfies vacuously. The generic tiling rule catches most of
     that shape — a childless node spanning three blocks is a leaf that spans
     three blocks — but it cannot see the one-note article, where the range is a
     single block and "leaf spans 1 block" is exactly right. Measured: with six
     notes the mutation reddens `leaf spans 6 blocks, expected 1`; with one note
     it reddened nothing at all before this rule existed. GPT Sol, F6. */
  it("5b — and at least one leaf does, even when the article has a single note", () => {
    const one = withNotes(1);
    const only = supplementNodes(one.tree)[0]!;
    expect(only.range[0]).toBe(only.range[1]); // the shape the tiling rule cannot see
    const stripped = clone(one.tree);
    for (const id of stripped.nodes[only.id]!.children) delete stripped.nodes[id];
    stripped.nodes[only.id]!.children = [];
    const problems = checkTree(one.blocks, stripped).problems;
    expect(problems.some((p) => /supplement has no leaves/.test(p))).toBe(true);
  });

  it("6 — no gist, never nested, never the root", () => {
    const gisted = problemsOf((t) => {
      t.nodes[supplement.id]!.gist = "Forty endnotes, summarised — which is the promise broken.";
    });
    expect(gisted.some((p) => /supplement carries a gist/.test(p))).toBe(true);

    const nested = problemsOf((t) => {
      const s = t.nodes[supplement.id]!;
      const inner: TreeNode = {
        id: "n9300" as NodeId,
        depth: 2,
        parent: s.id,
        children: s.children,
        range: [...s.range],
        title: "Notes",
        treatment: "supplement",
      };
      for (const id of s.children) {
        t.nodes[id]!.parent = inner.id;
        t.nodes[id]!.depth = 3;
      }
      t.nodes[inner.id] = inner;
      s.children = [inner.id];
    });
    expect(nested.some((p) => /supplement nested inside supplement/.test(p))).toBe(true);

    const rooted = problemsOf((t) => {
      t.nodes[t.rootId]!.treatment = "supplement";
    });
    expect(rooted.some((p) => /the root is the whole article/.test(p))).toBe(true);
  });

  it("states the gist rule in both directions", () => {
    /* Keyed on the absence of a gist alone, a pipeline bug that drops one would
       be indistinguishable from a deliberate supplement — and the dangerous
       outcome here is acceptance, not rejection. So the body direction has to
       still fail. */
    const dropped = problemsOf((t) => {
      const part = partsOf(t)[0]!;
      delete t.nodes[part.id]!.gist;
    });
    expect(dropped.some((p) => /internal node has no gist/.test(p))).toBe(true);

    // And a gistless body node cannot buy the exception by calling itself
    // apparatus: the other five checks are what it then has to pass.
    const disguised = problemsOf((t) => {
      const part = partsOf(t)[0]!;
      delete t.nodes[part.id]!.gist;
      t.nodes[part.id]!.treatment = "supplement";
    });
    expect(disguised.some((p) => /which is body/.test(p))).toBe(true);
  });
});

/* ------------------------------------------- the apparatus in the panel -- */

describe("the summary panel's tree", () => {
  /**
   * **What is left of this block after 2026-08-31.**
   *
   * It used to be about the whole-article *summary* — a `short` and a `long`
   * written by stage 5e and joined onto the tree by block range — and the
   * failure it was written for was that appending a supplement moves exactly
   * one range, the root's, so the article-level entry missed and was dropped
   * without a word (docs/plans/260828o-footnotes.md § The invisible stage-4 failure).
   * That join is gone with the ladder (docs/plans/260831s-gist-only-summaries.md), and
   * with it the whole class of bug: there is nothing to match, because the gist
   * is on the node.
   *
   * What survives is the promise the apparatus makes, and it is the half that
   * was never about the join: the notes are **one row, titled, with no summary
   * of any kind**, and `buildSummaryTree` must not descend into them. Six
   * phantom rows saying "No summary for this section" is what this stops.
   */
  it("draws the apparatus as one row, with no gist and no children", () => {
    const built = buildSummaryTree(tree, blocks);
    expect(built).not.toBeNull();
    const notes = built!.children.find((c) => isSupplementNode(c.node));
    expect(notes).toBeDefined();
    expect(notes!.node.title).toBe("Notes");
    /* No gist — a supplement node never has one, which is the whole promise
       (src/supplement.ts) — and no children, whatever the tree says. */
    expect(notes!.gist).toBeUndefined();
    expect(notes!.children).toEqual([]);
    // And it is not counted into the argument's numbering.
    expect(notes!.number).toBe("");
  });

  it("keeps the body parts numbered as if the apparatus were not there", () => {
    const built = buildSummaryTree(tree, blocks)!;
    const body = built.children.filter((c) => !isSupplementNode(c.node));
    /* **The expected list comes from somewhere else**, and the first version of
       this did not: it compared `body` against `body.map((_, i) => …)`, so if
       every body part vanished from the panel it compared `[]` with `[]` and
       passed. GPT Sol's review of the built code, 2026-08-31.

       `partsOf(bodyTree)` is a different tree walked by a different function —
       the article before the apparatus was appended — so it answers "how many
       parts are there" without asking the thing under test. The length
       assertion is what stops *that* going empty and taking the comparison with
       it. */
    const expected = partsOf(bodyTree).map((_, i) => String(i + 1));
    expect(expected.length, "the fixture has no body parts to number").toBeGreaterThan(1);
    expect(body.map((c) => c.number)).toEqual(expected);
  });
});

/* ------------------------------------------------------------- the arc -- */

describe("the arc", () => {
  it("does not count the apparatus as a part", () => {
    expect(partsOf(tree).length).toBe(partsOf(bodyTree).length);
    expect(partsOf(tree).some((p) => isSupplementNode(p))).toBe(false);
  });

  it("does not throw when the model returns one sentence per real part", () => {
    const sentences = partsOf(tree).map((_, i) => `Sentence ${i + 1}.`);
    expect(() => buildArc(sentences, tree, "example", FIXTURE_HASH)).not.toThrow();
    // And the reverse: one per depth-1 child, apparatus included, is refused.
    const tooMany = [...sentences, "A sentence about the endnotes."];
    expect(() => buildArc(tooMany, tree, "example", FIXTURE_HASH)).toThrow(/Refusing to guess/);
  });

  it("numbers the argument only — 3 / 7, never 3 / 9", () => {
    const geometry = buildGeometry(tree, blocks);
    const arc = buildArc(
      partsOf(tree).map((_, i) => `Sentence ${i + 1}.`),
      tree,
      "example",
      FIXTURE_HASH,
    );
    const cells = [...buildArcColumn(geometry, arc)!.values()];
    const numbered = cells.filter((c) => c.index !== undefined);
    const parts = partsOf(tree).length;
    expect(numbered.map((c) => c.index)).toEqual(
      Array.from({ length: parts }, (_, i) => i + 1),
    );
    for (const cell of numbered) expect(cell.total).toBe(parts);
    // The apparatus gets a cell — a missing <td> shifts every later cell one
    // column left — but no number and no sentence.
    const apparatus = cells.filter((c) => c.supplement);
    expect(apparatus.length).toBe(1);
    expect(apparatus[0]!.index).toBeUndefined();
    expect(apparatus[0]!.text).toBeUndefined();
    expect(apparatus[0]!.node.title).toBe("Notes");
    // Every row is still covered: the cells tile the article.
    expect(cells.reduce((n, c) => n + c.rowSpan, 0)).toBe(blocks.length);
  });
});

/* ---------------------------------------- the fisheye and its three peers -- */

describe("a reader standing mid-Notes", () => {
  const geometry = buildGeometry(tree, blocks);
  const depth = sectionDepth(geometry);

  it("is one item, not one per note, at the sections column", () => {
    const items = navigableItems(geometry.cells[depth]!, geometry.supplementOf);
    const collapsed = items.filter((i) => i.supplement);
    expect(collapsed.length).toBe(1);
    expect(collapsed[0]!.rowSpan).toBe(NOTES);
    expect(collapsed[0]!.startRow).toBe(firstNoteRow);
    expect(collapsed[0]!.node.id).toBe(supplement.id);
  });

  it("is IN the Notes item in the fisheye", () => {
    const { items, starts } = itemsFromCells(
      geometry.cells[depth]!,
      (row) => blocks[row]?.id,
      geometry.supplementOf,
    );
    const cur = currentIndex(starts, midNoteRow);
    expect(cur).not.toBe(-1); // not nowhere
    expect(items[cur]!.node.title).toBe("Notes"); // not the last part of the argument
    expect(items[cur]!.supplement).toBe(true);
    expect(items[cur]!.blockId).toBe(blocks[firstNoteRow]!.id);
    // One entry for the apparatus, not six.
    expect(items.filter((i) => i.supplement).length).toBe(1);
  });

  it("is in the same item as far as keyboard navigation is concerned", () => {
    const plan = navPlan(geometry, [1, depth], false);
    const starts = plan.starts[depth]!;
    expect(starts.filter((s) => s >= firstNoteRow)).toEqual([firstNoteRow]);
    // ↑ from inside the notes goes to the top of the notes, not back a note.
    expect(stepTarget(starts, midNoteRow, -1)).toBe(firstNoteRow);
    // ↓ from inside them runs off the end of the article rather than stepping
    // through five more nameless endnote rows.
    expect(stepTarget(starts, midNoteRow, 1)).toBeNull();
  });

  it("is in the same item as far as the saved reading position is concerned", () => {
    const sections = buildSections(geometry, blocks);
    const inNotes = sections.filter((s) => s.row >= firstNoteRow);
    expect(inNotes.length).toBe(1);
    expect(inNotes[0]!.title).toBe("Notes");
    expect(inNotes[0]!.blockId).toBe(blocks[firstNoteRow]!.id);
    // `?at=` therefore stores the supplement's first block, whatever note the
    // reader stopped on.
    const active = activeSectionIndex(sections.map((s) => s.row), midNoteRow);
    expect(sections[active]!.title).toBe("Notes");
  });

  /* **The same agreement, over every supplement shape the invariants admit** —
     and compared against the *fisheye*, not against `buildSections`.

     The first version of this compared `navigableItems` with `buildSections`,
     which was tautological: `buildSections` is a thin wrapper over
     `navigableItems`, so the two agreed by construction and the test would have
     passed with the bug below fully present. It also ran all three cases over
     one depth-3 topology. GPT Sol caught both, 2026-08-29.

     What the comparison has to be is `itemsFromCells` — the fisheye — against
     `buildSections`, because the fisheye applies a filter of its own that the
     saved position does not: it drops continuation items. That is the seam the
     two can actually part company at, and `deepened()` below is the shape where
     they did. */
  const shapes: Array<[string, number, "footnote" | "reference", boolean]> = [
    ["one note", 1, "footnote", false],
    ["six notes", 6, "footnote", false],
    ["six references", 6, "reference", false],
    // The one that was broken: a body tree one level deeper than the apparatus.
    ["one note under a deeper body", 1, "footnote", true],
    ["six notes under a deeper body", 6, "footnote", true],
  ];

  it.each(shapes)(
    "shows the apparatus in the fisheye and in ?at= alike — %s",
    (_name, count, role, deeper) => {
      const article = withNotes(count, role, deeper);
      // A precondition, not a formality: the whole point is that this tree is
      // *valid* and the two projections still disagreed.
      expect(checkTree(article.blocks, article.tree).problems).toEqual([]);
      const geo = buildGeometry(article.tree, article.blocks);
      const d = sectionDepth(geo);
      const fisheye = itemsFromCells(
        geo.cells[d]!,
        (row) => article.blocks[row]?.id,
        geo.supplementOf,
      ).items.filter((i) => i.supplement);
      const sections = buildSections(geo, article.blocks).filter((sec) => sec.title === "Notes" || sec.title === "References");

      expect(fisheye.length).toBe(1);
      expect(sections.length).toBe(1);
      // Same anchor block, which is what "the same item" has to mean: it is the
      // id `?at=` stores and the row the fisheye marks current.
      expect(fisheye[0]!.blockId).toBe(sections[0]!.blockId);
    },
  );

  /* **Two supplements side by side, under a deeper body.** Only `"footnote"` is
     assigned in v1, so Notes-then-References is the shape the second role has
     to land in rather than one that occurs today — and it is the shape where a
     collapsing bug would show as one row swallowing the other. Asked for by
     GPT Sol's second review. */
  it("keeps Notes and References as two rows, under a deeper body", () => {
    const blocksTwo = [...bodyBlocks, note(1), note(2), note(3, "reference")];
    const treeTwo = appendSupplement(deepen(bodyTree), splitBlocks(blocksTwo).groups);
    expect(checkTree(blocksTwo, treeTwo).problems).toEqual([]);
    const geo = buildGeometry(treeTwo, blocksTwo);
    const d = sectionDepth(geo);
    const fisheye = itemsFromCells(geo.cells[d]!, (r) => blocksTwo[r]?.id, geo.supplementOf);
    const supplements = fisheye.items.filter((i) => i.supplement);
    expect(supplements.length).toBe(2);
    expect(supplements.map((i) => i.node.title)).toEqual(["Notes", "References"]);
    const sections = buildSections(geo, blocksTwo).filter(
      (sec) => sec.title === "Notes" || sec.title === "References",
    );
    expect(sections.map((sec) => sec.title)).toEqual(["Notes", "References"]);
    expect(supplements.map((i) => i.blockId)).toEqual(sections.map((sec) => sec.blockId));
  });

  /* **No two items may be anchored on one row.** `currentIndex` walks `starts`
     and takes the last one at or before the reader's row, so a duplicate makes
     one of the two unreachable — the reader could never be "in" it however far
     they scrolled. Cheap to state, and it is the one thing about the
     continuation change I could not rule out by argument. */
  it.each(shapes)("anchors every item on its own row — %s", (_name, count, role, deeper) => {
    const article = withNotes(count, role, deeper);
    const geo = buildGeometry(article.tree, article.blocks);
    const { starts } = itemsFromCells(
      geo.cells[sectionDepth(geo)]!,
      (row) => article.blocks[row]?.id,
      geo.supplementOf,
    );
    expect(starts.length).toBeGreaterThan(0);
    expect(new Set(starts).size).toBe(starts.length);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  /* And the reader standing mid-Notes is IN it, in the deep shape too —
     `currentIndex` reads the fisheye's own `starts`, so an apparatus the
     fisheye dropped puts the reader in the last part of the argument instead of
     in the notes. The count above would not notice that on its own. */
  /* **Summary mode treated the apparatus as argument structure.** The summary
     tree descended into the supplement, so `SummaryPanel` numbered "Notes" as
     part 3, gave it children 3.1 … 3.6 — one phantom row per endnote, each with
     no title and no gist — and put "No summary for this section" under every one
     of them. It is the same promise being broken as everywhere else in this
     stage: the notes are in the structure and are not part of the argument, so
     they are never summarised and never reported as missing a summary.
     GPT Sol, second review, 2026-08-29. */
  it("does not descend into the apparatus, or number it, in summary mode", () => {
    const article = withNotes(6, "footnote", true);
    const summary = buildSummaryTree(article.tree, article.blocks, 3)!;
    const notes = summary.children.find((c) => c.node.title === "Notes")!;
    expect(notes).toBeDefined();
    expect(notes.supplement).toBe(true);
    // No phantom row per endnote — that was 3.1 … 3.6, each blank.
    expect(notes.children).toEqual([]);
    // And it is not part 3 of an argument that has two parts.
    expect(notes.number).toBe("");
    // The parts of the argument keep their own numbering, unshifted.
    const argument = summary.children.filter((c) => !c.supplement);
    expect(argument.map((c) => c.number)).toEqual(
      argument.map((_c, i) => String(i + 1)),
    );
  });

  it("puts a reader standing mid-Notes in the Notes item, under a deeper body", () => {
    const article = withNotes(6, "footnote", true);
    const geo = buildGeometry(article.tree, article.blocks);
    const d = sectionDepth(geo);
    const { items, starts } = itemsFromCells(
      geo.cells[d]!,
      (row) => article.blocks[row]?.id,
      geo.supplementOf,
    );
    const cur = currentIndex(starts, bodyBlocks.length + 3);
    expect(cur).not.toBe(-1);
    expect(items[cur]!.supplement).toBe(true);
    expect(items[cur]!.node.title).toBe("Notes");
  });

  it("and the arc's numbering agrees with all three", () => {
    const arc = buildArc(partsOf(tree).map(() => "A sentence."), tree, "example", FIXTURE_HASH);
    const cells = buildArcColumn(geometry, arc)!;
    const rows = [...cells.keys()].sort((a, b) => a - b);
    const startingAtOrBefore = rows.filter((r) => r <= midNoteRow).at(-1)!;
    expect(cells.get(startingAtOrBefore)!.supplement).toBe(true);
    expect(startingAtOrBefore).toBe(firstNoteRow);
  });
});

/* ------------------------------------------------- the rest of the stage -- */

describe("the spine", () => {
  it("gives the apparatus one band, dimmed, at its true height", () => {
    const outline = buildOutline(tree, blocks, 3);
    const band = outline.find((e) => e.supplement)!;
    expect(band).toBeDefined();
    expect(band.node.title).toBe("Notes");
    // Its real extent — the rail must not lie about pixels.
    expect(band.startRow).toBe(firstNoteRow);
    expect(band.endRow).toBe(blocks.length - 1);
    // And one band, not one per note: the spine never descends into it.
    expect(band.children).toEqual([]);
    expect(outline.filter((e) => e.supplement).length).toBe(1);
  });
});

describe("the shelf card's counts", () => {
  it("exclude the supplement and its leaves", () => {
    const before = deriveLibraryScalars({ blocks: bodyBlocks, tree: bodyTree });
    const after = deriveLibraryScalars({ blocks, tree });
    expect(after.partCount).toBe(before.partCount);
    expect(after.sectionCount).toBe(before.sectionCount);
    // The control: the tree really did grow, so equal counts are a decision
    // rather than a fixture that never changed.
    expect(Object.keys(tree.nodes).length).toBeGreaterThan(
      Object.keys(bodyTree.nodes).length,
    );
  });
});

/* --------------------------------------- the ladder the article offers -- */

/**
 * **The apparatus must not add a granularity column.**
 *
 * A supplement is depth 1 with its leaves at depth 2, so an article whose body
 * tree is only parts-deep gains a whole rung it does not have: `buildGeometry`
 * took `leafDepth` from every node, offered an L2 gist column, and the only
 * thing in it was a note leaf with no gist and no navLabel. The metadata page's
 * "Levels" stat, which `articleStats.depth` feeds, said 1 at the same moment.
 * Two answers to "how many levels does this piece have", and the reader could
 * see both. GPT Sol, fifth review, 2026-08-29.
 */
describe("a shallow article with an apparatus", () => {
  const shallowBlocks: Block[] = [
    { ...note(1), id: "spya-body01", text: "The first half.", role: undefined, treatment: undefined, noteId: undefined },
    { ...note(2), id: "spya-body02", text: "The second half.", role: undefined, treatment: undefined, noteId: undefined },
    note(3),
  ].map((b) => {
    const { role, treatment, noteId, ...rest } = b;
    return role === undefined ? (rest as Block) : b;
  });

  const shallowTree = appendSupplement(
    {
      version: "1", generator: "t", slug: "s", rootId: "n0",
      nodes: {
        n0: { id: "n0", depth: 0, parent: null, children: ["n1", "n2"],
          range: ["spya-body01", "spya-body02"], title: "All", gist: "g" },
        n1: { id: "n1", depth: 1, parent: "n0", children: [],
          range: ["spya-body01", "spya-body01"], title: "One" },
        n2: { id: "n2", depth: 1, parent: "n0", children: [],
          range: ["spya-body02", "spya-body02"], title: "Two" },
      },
    } as unknown as Tree,
    splitBlocks(shallowBlocks).groups,
  );

  it("is a valid tree whose body is only one level deep", () => {
    // The preconditions. Without them this is a test about some other article.
    expect(checkTree(shallowBlocks, shallowTree).problems).toEqual([]);
    expect(supplementNodes(shallowTree).length).toBe(1);
    const supplement = supplementIndex(shallowTree);
    const bodyDeepest = Math.max(
      ...Object.values(shallowTree.nodes).filter((n) => !supplement.has(n.id)).map((n) => n.depth),
    );
    expect(bodyDeepest).toBe(1);
  });

  it("offers no column for a rung the argument does not have", () => {
    const geo = buildGeometry(shallowTree, shallowBlocks);
    expect(geo.leafDepth).toBe(1);
    expect(geo.columnDepths).toEqual([0, 1]);
  });

  /* And the apparatus is still *in* the columns that do exist — the point is to
     drop the phantom rung, not the notes. Without this the fix could be "stop
     projecting the supplement" and every assertion above would still pass. */
  it("still shows the apparatus in the column it does have", () => {
    const geo = buildGeometry(shallowTree, shallowBlocks);
    const items = navigableItems(geo.cells[1]!, geo.supplementOf).filter((i) => i.supplement);
    expect(items.length).toBe(1);
    expect(items[0]!.node.title).toBe("Notes");
  });
});

/* ------------------------------------------- a tree that is not a tree -- */

/**
 * **`supplementIndex` is asked about every article a reader opens**, including
 * ones whose stored tree is not the shape the types promise.
 *
 * It became reachable from `articleStats` (src/web/stats.ts) so the masthead
 * could stop counting the apparatus as parts of the argument — and that put it
 * on the path of every page load, where a root node with no `children` array
 * threw `Cannot read properties of undefined (reading 'map')` and took the
 * whole view down. Twelve tests in tests/article-rename.test.tsx caught it,
 * which is what a suite is for.
 *
 * The rule everywhere else in this app is that a malformed tree **renders
 * visibly short** rather than throwing or silently claiming the whole article
 * (src/web/tree.ts § buildChains). A projection helper is no place to make an
 * exception.
 */
describe("a malformed tree", () => {
  const bare = (root: Record<string, unknown>): Tree =>
    ({ version: "1", generator: "t", slug: "s", rootId: "n0", nodes: { n0: root } }) as unknown as Tree;

  it("has no supplements rather than throwing, when the root has no children", () => {
    const tree = bare({ id: "n0", depth: 0, parent: null, title: "All" });
    expect(() => supplementIndex(tree)).not.toThrow();
    expect(supplementIndex(tree).size).toBe(0);
    expect(supplementNodes(tree)).toEqual([]);
  });

  it("has no supplements rather than throwing, when a child is missing entirely", () => {
    const tree = bare({ id: "n0", depth: 0, parent: null, title: "All", children: ["gone"] });
    expect(() => supplementIndex(tree)).not.toThrow();
    expect(supplementIndex(tree).size).toBe(0);
  });

  /* The control: the same helpers still find a real supplement, so the two
     above cannot pass because the whole thing has been made to return nothing. */
  it("still finds the apparatus in a well-formed tree", () => {
    expect(supplementIndex(tree).size).toBeGreaterThan(0);
    expect(supplementNodes(tree).length).toBe(1);
  });
});

describe("structureHash", () => {
  it("is byte-identical on a supplement-free tree", () => {
    /* Pinned against a hex string computed before any of this was written, over
       `example/tree.json`. Today's whole corpus predates the supplement node, so
       a hash that moved here would invalidate every labels.json, ideas.json and
       similarity artefact on disk at once. */
    expect(structureHash(bodyTree)).toBe("5bb2ef0284bce2cd");
  });

  it("moves when a supplement is appended", () => {
    expect(structureHash(tree)).not.toBe(structureHash(bodyTree));
  });

  it("distinguishes a supplement from a body node with the same shape", () => {
    // The whole reason `treatment` is in the canonical form: without it these
    // two trees hash the same, and `labels.json` reports itself current against
    // a tree that changed what the apparatus is.
    const asBody = clone(tree);
    delete asBody.nodes[supplement.id]!.treatment;
    expect(structureHash(asBody)).not.toBe(structureHash(tree));
  });

  /* ------------------------------------------ the delimiter, both hashes --

     The legacy forms are not framings, they are rarer delimiters: fields joined
     with U+0000 and rows with a newline in `structureHash`, `id \t text` joined
     with a newline in `hashBlocks`. `title` and `gist` are model prose and
     `text` is the article's own, so neither delimiter is under our control, and
     an unescaped separator is a collision waiting for the page that contains
     one. A fingerprint collision means two different articles each reporting
     that nothing has changed.

     Both were reproduced before either was fixed. GPT Sol found the first; the
     second is the same bug in the more reachable hash and was not in the eight.

     What the fix must NOT do is move a hash any real article already has —
     measured across data/: 890 blocks in 8 articles, and not one `text`
     contains a tab or a newline, nor one title or gist a NUL. So the fix routes
     only the ambiguous inputs to the safe framing, and the pinned hash above is
     what proves it. */
  const NUL = "\u0000";
  const oneNode = (title: string, gist: string): Tree =>
    ({
      rootId: "r",
      nodes: {
        r: { id: "r", parent: null, depth: 0, range: ["a", "b"], title, gist, children: [] },
      },
    }) as unknown as Tree;

  it("does not collide when a NUL sits inside a title or a gist", () => {
    // Same fields, different split: "A<NUL>B" + "C" versus "A" + "B<NUL>C".
    expect(structureHash(oneNode(`A${NUL}B`, "C"))).not.toBe(
      structureHash(oneNode("A", `B${NUL}C`)),
    );
  });

  it("hashBlocks does not collide when a newline and a tab sit inside a block's text", () => {
    /* One block whose text spans what reads as a second row, against the two
       real blocks it imitates. Both canonical strings are `b1 \t a \n b2 \t c`. */
    const one = hashBlocks([{ id: "b1", text: "a\nb2\tc" }]);
    const two = hashBlocks([
      { id: "b1", text: "a" },
      { id: "b2", text: "c" },
    ]);
    expect(one).not.toBe(two);
  });

  it("leaves every hash a real article already has exactly where it was", () => {
    /* The other half, and the one that costs money if it is wrong: ordinary
       prose carries no delimiter, so both must still take the legacy path.
       **Both pins are literal hex.** The first draft of this asserted
       `hashBlocks(bodyBlocks) === hashBlocks(bodyBlocks.map((b) => ({ ...b })))`,
       which is tautological — it compares a hash against a hash of a copy of its
       own input and would hold just as well if the routing change had
       invalidated the entire corpus. GPT Sol, 2026-08-29. */
    expect(structureHash(bodyTree)).toBe("5bb2ef0284bce2cd");
  });

  /* Its own test rather than a second line in the one above, because a failing
     assertion ends its test: with both in one, the `structureHash` pin masked
     the `hashBlocks` pin entirely, and a probe that forced every field down the
     framed branch reddened one guard while the other never ran. Two clauses
     need two probes. Both were watched go red — `49189e0dee442198` and
     `5d66606f5fd03635` under that probe. */
  it("leaves the block fingerprint of a real article where it was too", () => {
    expect(hashBlocks(bodyBlocks)).toBe("21189fa4eb0bceca");
  });
});
