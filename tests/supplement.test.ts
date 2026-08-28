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
 * of them (docs/plans/footnotes.md § The tree).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { partsOf, buildArc } from "../src/arc.js";
import { deriveLibraryScalars } from "../src/library-scalars.js";
import { structureHash } from "../src/source-hash.js";
import { targetsOf } from "../src/summarise.js";
import {
  appendSupplement,
  isSupplementNode,
  splitBlocks,
  supplementIndex,
  supplementNodes,
} from "../src/supplement.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block, NodeId, Summaries, SummaryEntry, Tree, TreeNode } from "../src/types.js";
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

/** The article the real pipeline would produce: body tree, then the apparatus. */
function withNotes(count: number, role: NonNullable<Block["role"]> = "footnote"): { blocks: Block[]; tree: Tree } {
  const notes = Array.from({ length: count }, (_, i) => note(i + 1, role));
  const blocks = [...bodyBlocks, ...notes];
  const split = splitBlocks(blocks);
  expect(split.stranded).toBe(0);
  return { blocks, tree: appendSupplement(bodyTree, split.groups) };
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

/* --------------------------------------- the failure invisible everywhere -- */

describe("the whole-article summary", () => {
  /**
   * **The required deliverable of this stage.** Both joins key on a pair of
   * block ids, and appending a supplement changes exactly one range: the
   * root's. Keyed by range, the article-level summary's entry then misses and
   * `buildSummaryTree` drops it *without a word* — on every article summarised
   * before this stage, with `sourceHash` still current because no block
   * changed. docs/plans/footnotes.md § The invisible stage-4 failure.
   */
  const writtenBefore: SummaryEntry[] = [
    { range: [...bodyTree.nodes[bodyTree.rootId]!.range], depth: 0, short: "The whole piece." },
    ...partsOf(bodyTree).map((p) => ({
      range: [...p.range] as [string, string],
      depth: 1,
      short: `About ${p.title}.`,
    })),
  ];

  /* A whole `Summaries`, assigned to a variable rather than passed as a literal.
     `buildSummaryTree` reads nothing but `entries`, and another session is in the
     middle of narrowing its parameter to exactly that — through a variable this
     satisfies the wide signature and the narrow one both, where a literal is
     rejected by whichever is not current. The same trick, and the same reason, as
     tests/block-roles.test.ts, on the public DTO. */
  const written = (entries: SummaryEntry[]): Summaries => ({
    version: "test",
    generator: "test",
    slug: "supplement",
    sourceHash: "0000000000000000",
    entries,
    missing: 0,
    generatedAt: "2026-08-28T00:00:00.000Z",
    elapsedMs: 0,
  });

  it("survives the supplement being appended", () => {
    const before = buildSummaryTree(bodyTree, bodyBlocks, written(writtenBefore));
    expect(before!.short).toBe("The whole piece.");

    const after = buildSummaryTree(tree, blocks, written(writtenBefore));
    expect(after!.short).toBe("The whole piece.");
    // The parts keep theirs by range, which is the join that must not change.
    const parts = after!.children.filter((c) => !isSupplementNode(c.node));
    expect(parts.map((c) => c.short)).toEqual(before!.children.map((c) => c.short));
    // And the apparatus is in the panel, titled, with no rung of any kind —
    // present in the structure, absent from the argument.
    const notes = after!.children.find((c) => isSupplementNode(c.node))!;
    expect(notes.node.title).toBe("Notes");
    expect([notes.gist, notes.short, notes.long]).toEqual([undefined, undefined, undefined]);
  });

  it("would be lost if the root were still matched by range", () => {
    /* The control: without this, "the summary is still there" is a sentence
       about a test that could never have failed. The root's range genuinely
       moved, so a range join genuinely misses. */
    const rootKey = `${tree.nodes[tree.rootId]!.range[0]}|${tree.nodes[tree.rootId]!.range[1]}`;
    const oldKey = `${writtenBefore[0]!.range[0]}|${writtenBefore[0]!.range[1]}`;
    expect(rootKey).not.toBe(oldKey);
  });

  it("still drops a root summary when an ordinary body paragraph is appended", () => {
    /* **The guarantee the new match nearly gave away.** Keyed on range, an
       entry written against a different shape of the article missed and was
       dropped. Keyed on `depth === 0` and the start id alone, it comes back:
       appending an ordinary paragraph moves the root's end for a reason that
       has nothing to do with the apparatus, the start is unchanged, and a stale
       whole-article summary is shown as current. GPT Sol's review of stage 4.

       So the stored end must be the root's own end, or the last body block —
       the one shift a supplement causes. Anything else is a body edit. */
    const grown = structuredClone(bodyTree);
    const extraId = "spya-zzzzzz";
    const grownBlocks = [...bodyBlocks, { ...bodyBlocks[bodyBlocks.length - 1]!, id: extraId }];
    grown.nodes[grown.rootId]!.range = [grown.nodes[grown.rootId]!.range[0], extraId];

    const built = buildSummaryTree(grown, grownBlocks, written(writtenBefore));
    expect(built).not.toBeNull();
    /* Dropped, not re-attached. The control below proves the entry is otherwise
       a perfectly good match — same depth, same start — so this is the end
       check doing the work and not some unrelated miss. */
    expect(built!.short).toBeUndefined();
    expect(writtenBefore[0]!.depth).toBe(0);
    expect(writtenBefore[0]!.range[0]).toBe(grown.nodes[grown.rootId]!.range[0]);
  });

  it("is never written for the apparatus", () => {
    const targets = targetsOf(tree, blocks);
    expect(targets.some((n) => isSupplementNode(n))).toBe(false);
    // Nor for anything under it — a note leaf is not a summary target either.
    const under = supplementIndex(tree);
    expect(targets.some((n) => under.has(n.id))).toBe(false);
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
    expect(() => buildArc(sentences, tree, "example")).not.toThrow();
    // And the reverse: one per depth-1 child, apparatus included, is refused.
    const tooMany = [...sentences, "A sentence about the endnotes."];
    expect(() => buildArc(tooMany, tree, "example")).toThrow(/Refusing to guess/);
  });

  it("numbers the argument only — 3 / 7, never 3 / 9", () => {
    const geometry = buildGeometry(tree, blocks);
    const arc = buildArc(
      partsOf(tree).map((_, i) => `Sentence ${i + 1}.`),
      tree,
      "example",
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
    const plan = navPlan(geometry, [1, depth], false, false);
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

  it("and the arc's numbering agrees with all three", () => {
    const arc = buildArc(partsOf(tree).map(() => "A sentence."), tree, "example");
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
});
