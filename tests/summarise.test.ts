// @vitest-environment jsdom
/**
 * Stage 5e's arithmetic, and the client-side join that reads what it wrote.
 *
 * jsdom rather than node, for one reason: the panel draws block ids, and a
 * block id is an `<a href>` built from `location` (BlockRef.tsx § blockHref) so
 * that the browser's own affordances — status bar, copy link, ⌘-click — work on
 * it. `renderToStaticMarkup` of that in a node environment throws on the bare
 * `location`. Nothing else here needs a DOM.
 *
 * Everything here is deterministic — no network, no model. See
 * docs/project/testing.md for what that division buys and what it leaves out.
 *
 * The three things worth testing are the three that fail *quietly*:
 *
 *  1. **Which nodes earn a summary.** Get this wrong upwards and every article
 *     costs several times what it should; get it wrong downwards and sections
 *     silently have nothing to show. Neither throws.
 *  2. **How an answer is matched back to the sections it is about.** src/arc.ts
 *     refuses to zip its answer to the parts precisely because a shifted zip
 *     produces cells that are individually plausible and collectively a lie.
 *     This stage matches by title and falls back to the echoed number, and the
 *     interesting cases are the ones where those two disagree.
 *  3. **The fallback down the ladder.** A section with no `long` shows its
 *     `short`, and it must say so — a silent fallback is what makes a
 *     partly-written artefact read as a complete one.
 */
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  assign,
  batchesOf,
  BATCH_SIZE,
  buildSummaries,
  countCitations,
  isStale,
  MIN_BLOCKS,
  parseJson,
  renderPrompt,
  rungsFor,
  targetsOf,
  textOf,
} from "../src/summarise.js";
import { SummaryPanel } from "../src/web/SummaryPanel.js";
import { buildSummaryTree, currentEntryId, rungText } from "../src/web/tree.js";
import type { Block, Summaries, Tree, TreeNode } from "../src/types.js";

/* ------------------------------------------------------------- fixtures -- */

function block(id: string, text = "some prose here"): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    html: `<p id="${id}">${text}</p>`,
    gistable: true,
  };
}

/** Ten blocks, `spya-aaaaa0` … `spya-aaaaa9`. */
const BLOCKS: Block[] = Array.from({ length: 10 }, (_, i) => block(`spya-aaaaa${i}`));
const id = (i: number) => `spya-aaaaa${i}`;

function node(over: Partial<TreeNode> & Pick<TreeNode, "id" | "depth" | "range">): TreeNode {
  return {
    parent: null,
    children: [],
    title: over.id,
    gist: `the gist of ${over.id}`,
    ...over,
  } as TreeNode;
}

/**
 * root ─┬─ part-a ─┬─ sec-1  (blocks 0–3, four blocks: earns one)
 *       │          └─ sec-2  (blocks 4–5, two blocks: does not)
 *       └─ part-b            (blocks 6–9, no children)
 */
const TREE: Tree = {
  version: "toc/test",
  generator: "test",
  slug: "fixture",
  rootId: "root",
  nodes: {
    root: node({ id: "root", depth: 0, range: [id(0), id(9)], children: ["part-a", "part-b"] }),
    "part-a": node({
      id: "part-a",
      depth: 1,
      parent: "root",
      range: [id(0), id(5)],
      children: ["sec-1", "sec-2"],
    }),
    "part-b": node({ id: "part-b", depth: 1, parent: "root", range: [id(6), id(9)] }),
    "sec-1": node({ id: "sec-1", depth: 2, parent: "part-a", range: [id(0), id(3)] }),
    "sec-2": node({ id: "sec-2", depth: 2, parent: "part-a", range: [id(4), id(5)] }),
  },
};

/* -------------------------------------------------------- which nodes ---- */

describe("targetsOf", () => {
  it("takes the root, the parts, and the sections that cover enough text", () => {
    expect(targetsOf(TREE, BLOCKS).map((n) => n.id)).toEqual([
      "root",
      "part-a",
      "sec-1",
      "part-b",
    ]);
  });

  it("takes a part that has no sub-sections, because it still covers text", () => {
    // The bug this test was written for: "has children" reads as "is not a
    // leaf" and is one, right up until a part has no sub-sections — at which
    // point it silently loses its summary for a reason unrelated to how much
    // is under it. See src/summarise.ts § targetsOf.
    expect(TREE.nodes["part-b"]?.children).toEqual([]);
    expect(targetsOf(TREE, BLOCKS).map((n) => n.id)).toContain("part-b");
  });

  it("leaves out a section shorter than MIN_BLOCKS", () => {
    // sec-2 covers two blocks. Summarising it would spend a model call to say
    // in a paragraph what its one-sentence gist already says better.
    expect(MIN_BLOCKS).toBeGreaterThan(2);
    expect(targetsOf(TREE, BLOCKS).map((n) => n.id)).not.toContain("sec-2");
  });

  it("takes the root even when the article is tiny", () => {
    // The whole-article summary is the one the previous version actually
    // shipped, and it is the one rung a reader is most likely to want. It is
    // never dropped for being short.
    const tiny: Tree = {
      ...TREE,
      nodes: { root: node({ id: "root", depth: 0, range: [id(0), id(0)] }) },
    };
    expect(targetsOf(tiny, BLOCKS).map((n) => n.id)).toEqual(["root"]);
  });

  it("skips a node whose range does not resolve, rather than counting it as huge", () => {
    // An unresolvable range must not be read as covering the whole article,
    // which is what a naive `hi - lo` on a missing index would do.
    const broken: Tree = {
      ...TREE,
      nodes: {
        ...TREE.nodes,
        "sec-1": node({ id: "sec-1", depth: 2, parent: "part-a", range: ["spya-zzzzzz", id(3)] }),
      },
    };
    expect(targetsOf(broken, BLOCKS).map((n) => n.id)).not.toContain("sec-1");
  });
});

/* ------------------------------------------------------------ batching --- */

describe("batchesOf", () => {
  it("puts the root and its parts in one call, and each part's sections in another", () => {
    const batches = batchesOf(TREE, targetsOf(TREE, BLOCKS));
    expect(batches.map((b) => [b.scope.id, b.targets.map((t) => t.id)])).toEqual([
      ["root", ["root", "part-a", "part-b"]],
      ["part-a", ["sec-1"]],
    ]);
  });

  it("splits a parent with more children than BATCH_SIZE", () => {
    // Their failure was output length, not input length, so a wide parent has
    // to become several calls however good the salvage rules are.
    const wide = wideTree(BATCH_SIZE * 2 + 1);
    const batches = batchesOf(wide.tree, targetsOf(wide.tree, wide.blocks));
    for (const b of batches) expect(b.targets.length).toBeLessThanOrEqual(BATCH_SIZE);
    // Nothing lost in the splitting.
    expect(batches.flatMap((b) => b.targets).length).toBe(
      targetsOf(wide.tree, wide.blocks).length,
    );
  });

  it("covers every target exactly once", () => {
    const targets = targetsOf(TREE, BLOCKS).map((n) => n.id);
    const covered = batchesOf(TREE, targetsOf(TREE, BLOCKS)).flatMap((b) =>
      b.targets.map((t) => t.id),
    );
    expect([...covered].sort()).toEqual([...targets].sort());
  });
});

/** A root with `n` parts, each covering `MIN_BLOCKS` blocks. */
function wideTree(n: number): { tree: Tree; blocks: Block[] } {
  const blocks = Array.from({ length: n * MIN_BLOCKS }, (_, i) => block(`spya-b${i}`));
  const at = (i: number) => `spya-b${i}`;
  const nodes: Record<string, TreeNode> = {
    root: node({
      id: "root",
      depth: 0,
      range: [at(0), at(blocks.length - 1)],
      children: Array.from({ length: n }, (_, i) => `p${i}`),
    }),
  };
  for (let i = 0; i < n; i++) {
    nodes[`p${i}`] = node({
      id: `p${i}`,
      depth: 1,
      parent: "root",
      range: [at(i * MIN_BLOCKS), at(i * MIN_BLOCKS + MIN_BLOCKS - 1)],
      children: [],
    });
  }
  // A depth-1 node with no children still earns a summary — it covers text.
  return { tree: { ...TREE, nodes, rootId: "root" }, blocks };
}

/* ------------------------------------------------- reading the answer ---- */

describe("assign", () => {
  const targets = [
    node({ id: "a", depth: 1, range: [id(0), id(1)], title: "The opening move" }),
    node({ id: "b", depth: 1, range: [id(2), id(3)], title: "The turn" }),
    node({ id: "c", depth: 1, range: [id(4), id(5)], title: "What is left" }),
  ];

  it("matches on the echoed title and number together", () => {
    const out = assign(
      {
        summaries: [
          { n: 1, title: "The opening move", short: "s1", long: "l1" },
          { n: 2, title: "The turn", short: "s2", long: "l2" },
        ],
      },
      targets,
    );
    expect(out.map((a) => [a.node.id, a.short])).toEqual([
      ["a", "s1"],
      ["b", "s2"],
    ]);
  });

  it("does not shift the rest when the model skips one", () => {
    // This is the whole reason the model echoes its own numbering. A positional
    // zip would put "l3" against section b, which reads perfectly plausibly and
    // is wrong — the failure src/arc.ts refuses to risk at all.
    const out = assign(
      { summaries: [{ n: 3, title: "What is left", long: "l3" }] },
      targets,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.node.id).toBe("c");
  });

  it("lets the title win when the number contradicts it", () => {
    // The title is about the section; the number is only about the list.
    const out = assign(
      { summaries: [{ n: 1, title: "What is left", short: "mine" }] },
      targets,
    );
    expect(out[0]?.node.id).toBe("c");
  });

  it("matches a title the model reworded the punctuation of", () => {
    const out = assign(
      { summaries: [{ n: 2, title: "the turn.", short: "s" }] },
      targets,
    );
    expect(out[0]?.node.id).toBe("b");
  });

  it("falls back to the number when the title matches nothing", () => {
    const out = assign(
      { summaries: [{ n: 2, title: "Something else entirely", short: "s" }] },
      targets,
    );
    expect(out[0]?.node.id).toBe("b");
  });

  it("never writes the same section twice", () => {
    const out = assign(
      {
        summaries: [
          { n: 1, title: "The opening move", short: "first" },
          { n: 1, title: "The opening move", short: "second" },
        ],
      },
      targets,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.short).toBe("first");
  });

  it("drops an entry with neither rung rather than counting it as written", () => {
    const out = assign(
      { summaries: [{ n: 1, title: "The opening move", short: "  ", long: "" }] },
      targets,
    );
    expect(out).toEqual([]);
  });

  it("survives an answer that is not the shape it promised", () => {
    // Salvage is the whole point: their handler threw on any malformation and
    // took the good entries with it.
    expect(assign({}, targets)).toEqual([]);
    expect(assign({ summaries: "nope" }, targets)).toEqual([]);
    expect(assign({ summaries: [null, 3, { n: 99 }] }, targets)).toEqual([]);
  });
});

describe("parseJson", () => {
  it("strips a code fence the model was asked not to add", () => {
    expect(parseJson('```json\n{"summaries": []}\n```')).toEqual({ summaries: [] });
  });
});

/* ------------------------------------------------------------- the file -- */

describe("buildSummaries", () => {
  const targets = targetsOf(TREE, BLOCKS);
  const opts = { slug: "fixture", targets, blocks: BLOCKS, sourceHash: "abc", elapsedMs: 1 };

  it("counts what did not come back", () => {
    const built = buildSummaries(
      [{ node: targets[0]!, short: "the article" }],
      opts,
    );
    expect(built.entries).toHaveLength(1);
    expect(built.missing).toBe(targets.length - 1);
  });

  it("stores the block range and never the node id", () => {
    // Node ids are positional; a re-run of `npm run toc` renumbers them, so an
    // id in this file would quietly hand each summary to its neighbour.
    const built = buildSummaries([{ node: targets[1]!, long: "a part" }], opts);
    expect(built.entries[0]).toMatchObject({ range: [id(0), id(5)], depth: 1 });
    expect(JSON.stringify(built)).not.toContain("part-a");
  });

  it("omits a rung that was not written, rather than storing it as undefined", () => {
    // "Absent" is what makes the panel fall back down the ladder; a present-
    // and-undefined key would read as a rung that exists and is blank.
    const built = buildSummaries([{ node: targets[0]!, short: "s" }], opts);
    expect(Object.hasOwn(built.entries[0]!, "long")).toBe(false);
  });

  it("refuses to write a file with nothing in it", () => {
    expect(() => buildSummaries([], opts)).toThrow(/no usable summaries/i);
  });

  it("puts the entries in document order, coarse before fine", () => {
    const built = buildSummaries(
      targets.map((n) => ({ node: n, short: n.id })),
      opts,
    );
    expect(built.entries.map((e) => e.depth)).toEqual([0, 1, 2, 1]);
  });
});

describe("isStale", () => {
  it("is true when the blocks it was written from have changed", () => {
    const built = buildSummaries([{ node: TREE.nodes.root!, short: "s" }], {
      slug: "fixture",
      targets: [TREE.nodes.root!],
      blocks: BLOCKS,
      sourceHash: "not-the-real-hash",
      elapsedMs: 1,
    });
    expect(isStale(built, BLOCKS)).toBe(true);
  });
});

describe("rungsFor", () => {
  it("asks for more from the whole article than from a section", () => {
    // Their adaptive instruction, as a table: "if the text is a paragraph,
    // write a sentence or two … if it's a book, write a page."
    expect(rungsFor(0).longTokens).toBeGreaterThan(rungsFor(1).longTokens);
    expect(rungsFor(1).longTokens).toBeGreaterThan(rungsFor(2).longTokens);
  });

  it("names a length rather than numbering it", () => {
    // The finding this feature rests on: "sentence or two" is a thing a writer
    // can aim at; "level 4" is not.
    expect(rungsFor(0).longName).toMatch(/page/);
    expect(rungsFor(2).longName).toMatch(/paragraph/);
  });
});

/* ------------------------------------------------------- the client join -- */

const SUMMARIES: Summaries = {
  version: "summary/1",
  generator: "test",
  slug: "fixture",
  sourceHash: "abc",
  entries: [
    { range: [id(0), id(9)], depth: 0, short: "article short", long: "article long" },
    { range: [id(0), id(5)], depth: 1, short: "part-a short" },
  ],
  missing: 2,
  generatedAt: "2026-08-26T00:00:00.000Z",
  elapsedMs: 1,
};

describe("buildSummaryTree", () => {
  it("nests the tree and joins the summaries by range", () => {
    const root = buildSummaryTree(TREE, BLOCKS, SUMMARIES);
    expect(root?.long).toBe("article long");
    expect(root?.children.map((c) => c.node.id)).toEqual(["part-a", "part-b"]);
    expect(root?.children[0]?.short).toBe("part-a short");
  });

  it("numbers the entries as the reader addresses them", () => {
    const root = buildSummaryTree(TREE, BLOCKS, SUMMARIES);
    expect(root?.children[1]?.number).toBe("2");
    expect(root?.children[0]?.children[1]?.number).toBe("1.2");
  });

  it("counts the blocks under each entry", () => {
    // The "how much is under this" answer our gist columns cannot give.
    const root = buildSummaryTree(TREE, BLOCKS, SUMMARIES);
    expect(root?.blocks).toBe(10);
    expect(root?.children[1]?.blocks).toBe(4);
  });

  it("works with no summaries at all, on the gists alone", () => {
    // The panel has to be useful before anybody has paid a model call, which
    // is why `gist` is the default rung.
    const root = buildSummaryTree(TREE, BLOCKS, null);
    expect(root?.gist).toBe("the gist of root");
    expect(root?.short).toBeUndefined();
  });

  it("stops at the depth limit", () => {
    const root = buildSummaryTree(TREE, BLOCKS, SUMMARIES, 1);
    expect(root?.children[0]?.children).toEqual([]);
  });

  it("drops an entry whose range matches no node, rather than moving it", () => {
    const wrong: Summaries = {
      ...SUMMARIES,
      entries: [{ range: ["spya-zzzzzz", id(9)], depth: 0, long: "stale" }],
    };
    const root = buildSummaryTree(TREE, BLOCKS, wrong);
    expect(root?.long).toBeUndefined();
  });

  it("skips a node whose own range does not resolve", () => {
    const broken: Tree = {
      ...TREE,
      nodes: {
        ...TREE.nodes,
        "part-b": node({ id: "part-b", depth: 1, parent: "root", range: [id(9), id(6)] }),
      },
    };
    expect(buildSummaryTree(broken, BLOCKS, null)?.children.map((c) => c.node.id)).toEqual([
      "part-a",
    ]);
  });
});

describe("rungText", () => {
  const root = buildSummaryTree(TREE, BLOCKS, SUMMARIES)!;
  const partA = root.children[0]!;
  const partB = root.children[1]!;

  it("gives the rung that was asked for when it exists", () => {
    expect(rungText(root, "long")).toEqual({ text: "article long", rung: "long" });
  });

  it("falls back DOWN the ladder and says which rung it landed on", () => {
    // Silence here is what makes a partly-written artefact read as a complete
    // one — see src/summarise.ts § partial salvage.
    expect(rungText(partA, "long")).toEqual({ text: "part-a short", rung: "short" });
    expect(rungText(partB, "long")).toEqual({ text: "the gist of part-b", rung: "gist" });
  });

  it("never falls UP the ladder", () => {
    // Showing a paragraph where a sentence was asked for would break the one
    // promise the control makes.
    expect(rungText(root, "gist")).toEqual({ text: "the gist of root", rung: "gist" });
    expect(rungText(partA, "short")).toEqual({ text: "part-a short", rung: "short" });
  });

  it("returns null when there is nothing at all", () => {
    // Built by omitting the key rather than by setting it to `undefined`:
    // under `exactOptionalPropertyTypes` those are different types, and the
    // one the artefact actually produces is the omission — see
    // docs/project/typechecking.md.
    const { gist: _gist, ...bare } = partB;
    expect(rungText(bare, "long")).toBeNull();
  });
});

/* ------------------------------------------------------------ the panel -- */

/**
 * The panel, rendered to static markup.
 *
 * `react-dom/server`, not a testing library — react-dom is already a dependency
 * and adding one for this would be a library decision needing its own write-up
 * (docs/reusable/third-party-library-selection.md). What it buys is the two
 * things that are otherwise only checkable by looking: that the component
 * renders at all for each of its states, and that the **rung fallback is
 * visible in the output**, which is the one piece of this feature whose failure
 * mode is silence.
 *
 * What it does NOT check is anything about CSS — position, colour, whether the
 * band is where it should be. That needs a real browser
 * (docs/project/browser-testing.md) and has not been done.
 */
/**
 * The paragraph labels, which are what makes a citation possible at all.
 *
 * A model that cannot see the ids cannot cite them, and nothing about that
 * failure is visible: the summaries come out fluent and uncited, the panel
 * renders them as prose, and the feature is quietly gone. This is the one test
 * standing between here and that.
 */
describe("textOf", () => {
  const order = new Map(BLOCKS.map((b, i) => [b.id, i]));
  const range = (lo: number, hi: number) =>
    ({ id: "n", depth: 1, range: [id(lo), id(hi)] }) as unknown as TreeNode;

  it("labels every paragraph with its block id", () => {
    const text = textOf(range(0, 2), BLOCKS, order);
    expect(text).toContain(`${id(0)}: some prose here`);
    expect(text.match(/spya-/g)).toHaveLength(3);
  });

  it("keeps the blocks in document order", () => {
    const lines = textOf(range(0, 3), BLOCKS, order).split("\n\n");
    expect(lines.map((l) => l.split(":")[0])).toEqual([id(0), id(1), id(2), id(3)]);
  });

  /* An image block has an id and no words. Labelling it would hand the model a
     citable id for a paragraph with nothing in it — an id the reader can press
     that arrives at nothing to read. The filter runs before the labels for
     exactly this reason, which is the sort of ordering that is invisible until
     it is wrong. */
  it("does not label a block with no text of its own", () => {
    const withImage = [block(id(0)), block(id(1), ""), block(id(2))];
    const text = textOf(range(0, 2), withImage, new Map(withImage.map((b, i) => [b.id, i])));
    expect(text).not.toContain(id(1));
    expect(text.match(/spya-/g)).toHaveLength(2);
  });

  it("gives nothing back for a range the blocks do not resolve", () => {
    expect(textOf(range(0, 0), [], new Map())).toBe("");
  });
});

/**
 * The reader's steer, and the two things that must be true of it.
 *
 * It has to reach the model — a box that changes nothing is worse than no box,
 * because the reader believes they steered something. And its *absence* has to
 * leave no trace: a prompt that always carries the header with nothing under it
 * teaches the model to expect an instruction and to look for one in the text.
 */
describe("renderPrompt", () => {
  const targets = targetsOf(TREE, BLOCKS);
  const batch = batchesOf(TREE, targets)[0]!;
  const base = { meta: null, tree: TREE, blocks: BLOCKS, batch };

  it("carries the reader's steer into the prompt", () => {
    const out = renderPrompt({ ...base, guidance: "I care about the evidence" });
    expect(out).toContain("WHAT THIS READER IS AFTER");
    expect(out).toContain("I care about the evidence");
  });

  it("says nothing at all about a steer when there is none", () => {
    expect(renderPrompt(base)).not.toContain("WHAT THIS READER IS AFTER");
  });

  /* The steer is a note about emphasis, and the prompt has to say so where the
     note is, not only three thousand tokens above it in SYSTEM. A constraint
     that far from the thing it constrains is one the model has stopped
     weighing by the time it reads the article. */
  it("re-bounds the steer where it stands", () => {
    const out = renderPrompt({ ...base, guidance: "the economics" });
    expect(out).toContain("never what the article says");
  });

  it("puts the block ids in front of the model", () => {
    expect(renderPrompt(base)).toContain(`${id(0)}: `);
  });
});

/**
 * Counting the doors.
 *
 * Neither number is an error and neither changes what is rendered. They are in
 * the step's log line because a run that quietly starts returning `cited: 0` is
 * the model having stopped citing — which breaks nothing visible and turns a
 * summary back into a substitute for the passage rather than a way into it.
 */
describe("countCitations", () => {
  const withCites = (short: string, long?: string): Summaries => ({
    ...SUMMARIES,
    entries: [{ range: [id(0), id(9)], depth: 0, short, ...(long ? { long } : {}) }],
  });

  it("counts the ids in both rungs", () => {
    const out = countCitations(withCites(`a [${id(1)}]`, `b [${id(2)}] c [${id(3)}]`), BLOCKS);
    expect(out).toEqual({ cited: 3, unknown: 0 });
  });

  it("counts an id the article does not have, and still counts it as cited", () => {
    // Both, deliberately: `cited` answers "is it citing at all" and `unknown`
    // answers "is it citing real things". An invented id is a failure of the
    // second, not evidence of the first.
    const out = countCitations(withCites(`a [spya-zzzzzz]`), BLOCKS);
    expect(out).toEqual({ cited: 1, unknown: 1 });
  });

  it("counts nothing when nothing cites", () => {
    expect(countCitations(withCites("no ids here"), BLOCKS)).toEqual({ cited: 0, unknown: 0 });
  });
});

describe("currentEntryId", () => {
  /* "The relevant one" is the deepest entry that is **actually drawn**, which
     is not the same as the deepest entry containing the reader. The walk has to
     mirror Entry's own `tooDeep` / `openable` / `showChildren` lines, and
     nothing errors when it stops doing so — the panel simply scrolls to an
     element that is not there, or marks a row nobody can see. */
  const tree = () => buildSummaryTree(TREE, BLOCKS, SUMMARIES)!;
  const none: ReadonlySet<string> = new Set();

  it("picks the deepest section on screen", () => {
    expect(currentEntryId(tree(), 2, 2, none)).toBe("sec-1");
  });

  it("stops at the depth cut-off rather than naming a row that is not drawn", () => {
    // At `deep: 1` the sections are gone, and the part the reader is inside is
    // the honest answer to "where am I" as far as this panel goes.
    expect(currentEntryId(tree(), 2, 1, none)).toBe("part-a");
  });

  it("stops at a section the reader closed", () => {
    // Closing a section must not put the mark somewhere invisible.
    expect(currentEntryId(tree(), 2, 2, new Set(["part-a"]))).toBe("part-a");
  });

  it("names the parent when the reader is between its children", () => {
    /* A part's range can cover blocks that none of its sections do. The walk
       finds no child containing the row and correctly stops on the parent,
       rather than returning null and leaving the panel unmarked in the middle
       of an article. */
    const gappy: Tree = {
      ...TREE,
      nodes: {
        ...TREE.nodes,
        "sec-2": node({ id: "sec-2", depth: 2, parent: "part-a", range: [id(4), id(4)] }),
      },
    };
    const root = buildSummaryTree(gappy, BLOCKS, SUMMARIES)!;
    expect(currentEntryId(root, 5, 2, none)).toBe("part-a");
  });

  it("never names the root, and names nothing above the first section", () => {
    // The root covers the whole article, so marking it is a light that is
    // always on. At `deep: 0` it is the only row drawn — correctly nothing.
    expect(currentEntryId(tree(), 2, 0, none)).toBeNull();
    expect(currentEntryId(tree(), null, 2, none)).toBeNull();
  });
});

describe("SummaryPanel", () => {
  /* Typed as the component's own props rather than inferred: an object literal
     infers `status: "ready"` as a literal type, so a spread that overrides it
     with "none" fails to typecheck for a reason that has nothing to do with the
     test. */
  const base: ComponentProps<typeof SummaryPanel> = {
    status: "ready",
    summaries: SUMMARIES,
    stale: false,
    error: null,
    job: null,
    failed: null,
    write: async () => {},
    cancel: () => {},
    root: buildSummaryTree(TREE, BLOCKS, SUMMARIES),
    blocks: new Map(BLOCKS.map((b) => [b.id, b.text])),
    rung: "long",
    onRung: () => {},
    deep: 2,
    onDeep: () => {},
    atRow: null,
    onJump: () => {},
  };

  const html = (over: Partial<ComponentProps<typeof SummaryPanel>> = {}) =>
    renderToStaticMarkup(createElement(SummaryPanel, { ...base, ...over }));

  it("renders the whole ladder and the outline", () => {
    const out = html();
    expect(out).toContain("article long");
    expect(out).toContain("part-a"); // the section titles
    expect(out).toContain(">gist<");
    expect(out).toContain(">long<");
  });

  it("marks a row that fell back to a shorter rung", () => {
    // part-a has no `long`, so it shows its `short` — and must say so. Without
    // this the reader cannot tell a fallback from a section the model had less
    // to say about. See src/summarise.ts § partial salvage.
    const out = html({ rung: "long" });
    expect(out).toContain("part-a short");
    expect(out).toContain("summ-rung-tag");
    expect(out).toContain("fell-back");
  });

  it("does not mark anything when every row has the rung asked for", () => {
    expect(html({ rung: "gist" })).not.toContain("summ-rung-tag");
  });

  it("shows how much is under each section", () => {
    // On the sections, not on the root — the root has no title row to hang it
    // on, and the masthead an inch to the right already says how long the
    // article is.
    const out = html();
    expect(out).toContain("6¶"); // part-a
    expect(out).toContain("4¶"); // sec-1, and part-b
  });

  it("hides the levels below the depth cut-off and says how many", () => {
    const out = html({ deep: 1 });
    expect(out).toContain("+2 sections"); // part-a's two children
    expect(out).not.toContain("sec-1");
  });

  it("disables the generated rungs when nothing has been written", () => {
    const out = html({
      status: "none",
      summaries: null,
      root: buildSummaryTree(TREE, BLOCKS, null),
    });
    // Offered and disabled, not hidden: a control that appears only once you
    // have paid for it gives no clue that paying is what the button is for.
    expect(out).toContain(">short<");
    expect(out).toContain("disabled");
    expect(out).toContain("Write the summaries");
    // And the panel is still useful — the gists are there.
    expect(out).toContain("the gist of root");
  });

  it("says so when the article has moved underneath them", () => {
    expect(html({ stale: true })).toContain("older version of the article");
  });

  it("marks where the reader is, and does not mark the root", () => {
    // atRow 7 is inside part-b (blocks 6-9). The root covers everything and is
    // therefore "here" the whole time, which is a light that is always on.
    const out = html({ atRow: 7 });
    expect(out).toContain("summ-entry d1 here");
    expect(out).not.toContain("summ-entry d0 here");
  });

  it("marks the one row the reader is in, and only its ancestors as `here`", () => {
    /* Greg, 2026-08-26: "highlight and scroll to the relevant Summary section
       that corresponds to the current position of the text". `here` runs the
       whole chain — that is what keeps a shallow cut-off honest — and `now` is
       the single row at the end of it, which is also the row the panel scrolls
       to. Both marks on one row and only the weak one on its parent. */
    const out = html({ atRow: 2 }); // inside sec-1, which is inside part-a
    expect(out).toContain('class="summ-entry d2 here now"');
    expect(out).toContain('class="summ-entry d1 here"'); // part-a: ancestor only
    expect(out).not.toContain('class="summ-entry d1 here now"');
  });

  it("hangs the scroller's target on the row body, never on the `<li>`", () => {
    /* Two rules in one assertion, and the second is a real bug that was caught
       in review rather than in a browser.

       An attribute rather than the `now` class, because a class is a style and
       restyling the mark must not be able to break the scrolling.

       And on `.summ-body` — the header, the summary and the range — rather than
       on the `<li>`, which *contains its whole descendant `<ol>`*. Measured on
       the `<li>`, "is the current row in view" is a question about the row's
       children: a part whose own two lines sit in the middle of the panel reads
       as out of view because a dozen sections under it run off the bottom, and
       the panel scrolls for no reason the reader can see. */
    const out = html({ atRow: 2 });
    expect(out).toContain('class="summ-body" data-follow="sec-1"');
    expect(out).not.toMatch(/<li[^>]*data-follow/);
  });

  it("marks nothing when the reader is above the first section", () => {
    expect(html({ atRow: null })).not.toContain(" now\"");
  });

  it("renders with no tree at all rather than throwing", () => {
    expect(html({ root: null })).toContain("no usable tree");
  });

  /* ------------------------------------------ the ids, and getting to them -- */

  /**
   * The three things Greg asked for on 2026-08-26, in the order he asked them.
   *
   * All three are about the same thing from different sides: a summary is only
   * allowed to exist here if it is a *door* into the passage rather than a
   * substitute for it (vision.md, principle 2). Ids you can press are the door,
   * a bigger click target is the handle, and the steer is what stops a reader
   * asking the model to summarise something other than the article.
   */
  const cited: Summaries = {
    ...SUMMARIES,
    entries: [
      {
        range: [id(0), id(9)],
        depth: 0,
        long: `The argument turns on the body [${id(3)}], not the brain.`,
      },
    ],
  };

  it("draws a cited block id as a link into the article", () => {
    const out = html({ summaries: cited, root: buildSummaryTree(TREE, BLOCKS, cited) });
    // The chip, and a real href — BlockRef renders an `<a>` so ⌘-click, the
    // status bar and copy-link all work. block-ids.md#showing-an-id.
    expect(out).toContain(`at=${id(3)}`);
    expect(out).toContain("block-ref");
    // The prefix is dropped where it is shown and kept in the link.
    expect(out).toContain(">aaaaa3<");
    // And the brackets go: they are punctuation around something that no
    // longer reads as text.
    expect(out).not.toContain(`[${id(3)}]`);
  });

  it("leaves an id the article does not have as plain text", () => {
    /* Not a link that goes nowhere. A dead chip is the worse failure: the
       reader presses it, the page does not move, and nothing distinguishes
       that from a bug in the scrolling. Same contract as chat's — the rule
       lives in citations.ts and is tested there; this is the summary panel
       being wired to it rather than to a copy of it. */
    const bogus: Summaries = {
      ...SUMMARIES,
      entries: [{ range: [id(0), id(9)], depth: 0, long: "As it says [spya-zzzzzz]." }],
    };
    const out = html({ summaries: bogus, root: buildSummaryTree(TREE, BLOCKS, bogus) });
    expect(out).toContain("spya-zzzzzz");
    expect(out).not.toContain("at=spya-zzzzzz");
  });

  it("shows each section's range, so there are ids even at the gist rung", () => {
    // The default rung is `gist`, gists are written by stage 4 and carry no
    // citations, and most articles have never had a model call for the other
    // two. Without the range there would be no ids on screen at all in the
    // ordinary case.
    const out = html({ rung: "gist" });
    expect(out).toContain("summ-range");
    expect(out).toContain("block-range");
  });

  it("makes the whole entry the click target, not just the title", () => {
    // Greg, 2026-08-26: "make it easier to click a section in the summary
    // (right now you have to click the section-title)". The title button is
    // still there — it is the keyboard path — and the body is what widened.
    const out = html();
    expect(out).toContain('class="summ-body"');
    expect(out).toContain('class="summ-title"');
  });

  it("offers a steer, closed, when nobody has given one", () => {
    expect(html()).toContain("Steer these summaries");
    expect(html()).not.toContain("summ-steer-box");
  });

  it("shows the steer these summaries were written with", () => {
    /* Open and filled, which is the honest half of the feature: a steered
       summary that looks like an ordinary one is one the reader cannot weigh.
       It is also what explains why a section reads the way it does. */
    const steered: Summaries = { ...SUMMARIES, guidance: "I care about the evidence" };
    const out = html({ summaries: steered });
    expect(out).toContain("summ-steer-box");
    expect(out).toContain("I care about the evidence");
  });

  it("offers the steer on a stale article too", () => {
    // The foot is hidden while the summaries are stale, so without this the one
    // article most likely to be rewritten is the one you cannot steer.
    expect(html({ stale: true })).toContain("Steer these summaries");
  });
});
