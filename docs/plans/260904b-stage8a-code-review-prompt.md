# Stage 8a code review — the heading snap in `planChildRanges`

Review the code below, built from
[260904b § Stage 8](260904b-a-long-pdf-finishes-without-a-retry-click.md) in the Spideryarn repo
(`/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry`, branch
`worktree-long-pdf-no-retry`). Read `src/hierarchy.ts` and `docs/project/hierarchy.md § The partition
is derived, not checked` for the surrounding design before judging any line.

## The defect

Stage 4 asks a model to carve an article into nested sections, each with a `[startBlock, endBlock]`
range and often a `sourceHeading` quoting the author's own heading. `planChildRanges` **derives** a
tiling from the answer: a child's *start* is believed, every end is computed from the next start.
`buildTree` then drops a `sourceHeading` claim that no heading block inside the node's derived range
backs up, counting it in `droppedHeadings`.

Measured on a saved structure answer for a 142-page Kuhn paper (2,025 blocks, 254 authored heading
blocks): of 82 non-root nodes, **24 start on a heading block, 53 on the block immediately after
one**, 5 elsewhere. 75 of 82 name a `sourceHeading`. `droppedHeadings: 59`. So the model is already
following the author and is cutting one block late; the heading falls into the previous section's
tail and the claim is then dropped as out of range.

## The change

`snapStartsToHeadings` in `src/hierarchy.ts`: a kept child whose start is the block after a heading
run **whose text its own `sourceHeading` names** moves back to the run's first heading, recorded as a
new `PartitionRepair` kind `"heading"`. `recordBoundaryFaults` is moved to run *before* the snap so
it goes on measuring against the model's raw claims. `PROMPT_VERSION` goes `toc/3` → `toc/4` (the
wire request is unchanged; the checkpoint is keyed on it and the same answer now builds a different
tree).

Explicitly out of scope: the prompt re-scope of the depth/fan-out bullets (stage 8b), and feeding
`src/heading-tree.ts`'s mechanical outline into the prompt (its tag levels lie about this document's
numbering).

## The measurements

Replaying the saved answer through the real `buildTree`, snap off vs on:

| | before | after |
|---|---|---|
| internal nodes | 83 | 83 |
| `sourceHeading` backed | 24 of 75 claimed | 74 of 75 |
| `droppedHeadings` | 59 | 9 |
| headings starting a node | 21 / 254 | 67 / 254 |
| `repairedBlocks` | 40 | 86 |
| `largestRepair` | 5 | 5 |
| repairs by kind | 26 gap, 3 short, 1 overlap | 46 heading, 30 gap, 2 over, 1 short, 1 overlap |
| max section blocks | 241 | 242 |
| sections over `MAX_BATCH` (60) | 5 | 5 |
| `checkTree` problems | 0 | 0 |

No-op control: all 43 saved trees under `evals/results/hierarchy-structure/*/trees/` for which there
are local blocks (noema, openai-huggingface) replay **identically** with the snap off and on. noema
has 0 of 83 starts one-after-a-heading.

`npm test` shows only the three known baseline failures (`client-imports`, `fixture-ids`,
`illustrated-view`), `npm run typecheck` is clean.

## What I want from you

Be specific and cite lines. In particular:

1. **Is the `sourceHeading` gate right?** Without it, the snap takes headings the model deliberately
   left in the previous section (there is a fixture for that). With it, 7 of the 53 one-after starts
   go unrepaired. Is there a better discriminator?
2. **Is the floor correct** — `first = Math.max(runStart, previousKeptStart + 1)`, then skip if
   `first >= start`? Can it produce a non-increasing start sequence, a start outside `[p0, p1]`, or a
   node covering nothing?
3. **The ordering of `recordBoundaryFaults` and the snap.** Does measuring the gap/overlap/short/over
   faults on the raw starts, and the snap separately, double-count or under-count anything
   `repairedBlockCount` then sums? Note `at` for the snap is the *post*-snap coordinate, deliberately,
   so a cascade into the node's own first child folds into one chain.
4. **`repairedBlocks` rising 40 → 86.** Honest, or is the accounting wrong?
5. Anything that makes the tree unsound, loses a block, or makes a title/gist describe prose it was
   not written about.

## The diff

```diff
diff --git a/src/hierarchy.ts b/src/hierarchy.ts
index 24e70488..62384418 100644
--- a/src/hierarchy.ts
+++ b/src/hierarchy.ts
@@ -62,8 +62,15 @@ import { withLedger } from "./cli-ledger.js";
 import { log } from "./log.js";
 
 /* Bumped to 2 when the nav labels moved out to src/labels.ts: this prompt no
-   longer asks for them, and a tree written by toc/1 is a different artefact. */
-export const PROMPT_VERSION = "toc/3";
+   longer asks for them, and a tree written by toc/1 is a different artefact.
+
+   Bumped to 4 for the heading snap (`snapStartsToHeadings`), which is not a
+   prompt change at all: the wire request is byte-identical. The stamp still has
+   to move, because it is what the structure *checkpoint* is keyed on, and the
+   same answer now builds a different tree — a document part-way through the
+   stage would otherwise resume onto the old boundaries and nothing would say
+   so. One replayed call per article in flight, and that is the whole cost. */
+export const PROMPT_VERSION = "toc/4";
 
 /**
  * How hard the model thinks before it starts writing.
@@ -852,8 +859,13 @@ export interface PartitionRepair {
    * Which way the model's two claims about this boundary disagreed: the next
    * section started late (`gap`) or early (`overlap`), or the last child stopped
    * before its parent ended (`short`) or ran past it (`over`).
+   *
+   * `heading` is the odd one out and deliberately a `kind` rather than a
+   * quiet mend: **the model's two claims agreed and were both one block late**,
+   * putting the section's own heading in the section before it, so nothing
+   * above can see it. `snapStartsToHeadings` has the measurement it comes from.
    */
-  kind: "gap" | "overlap" | "short" | "over";
+  kind: "gap" | "overlap" | "short" | "over" | "heading";
   /**
    * **The boundary's coordinate: the index of the first block after it.** A
    * node's own start, a child's start, and one past the parent's last block are
@@ -1162,6 +1174,16 @@ function planChildRanges(
     kept.push({ childIndex: i, start });
   }
 
+  /* **Before the snap, and that order is the whole of it.** This measures the
+     model's two claims about every boundary against where the boundary ended
+     up, so running it afterwards would compare the answer with a value we chose
+     ourselves — a section moved back onto its heading would report a phantom
+     `overlap` against its own correct start, and the snap would be invisible in
+     the telemetry that exists to watch it. `snapStartsToHeadings` records its
+     own repairs; nothing else measures it. */
+  recordBoundaryFaults(kept, spans, parent, where, repairs);
+  snapStartsToHeadings(children, kept, blocks, where, repairs);
+
   const plans: ChildPlan[] = children.map(() => ({ keep: false }));
   for (const [k, child] of kept.entries()) {
     const next = kept[k + 1];
@@ -1176,10 +1198,96 @@ function planChildRanges(
     };
   }
 
-  recordBoundaryFaults(kept, spans, parent, where, repairs);
   return plans;
 }
 
+/**
+ * **A section that begins one paragraph below the heading it names is moved
+ * back onto it.**
+ *
+ * Measured on a 142-page Kuhn paper, 2026-09-04 (Fable): of the model's 82
+ * non-root nodes, 24 started *on* a heading block and **53 on the block
+ * immediately after one**, and every unbacked `sourceHeading` claim reproduced
+ * was at that offset. The model was not overruling the author — it named the
+ * author's heading correctly and put the boundary one block late. The heading
+ * then fell into the previous section's tail, this file believed the start, and
+ * `buildTree` dropped the claim as out of range. `droppedHeadings: 59` was
+ * counting that.
+ *
+ * So the answer is code rather than a prompt line: a prompt can be ignored, and
+ * the model was already doing what a prompt would have asked for.
+ *
+ * ## Why the claim has to match
+ *
+ * The obvious rule — snap any start that sits one block after a heading — takes
+ * headings the model deliberately left in the section before it. The fixture is
+ * already in tests/hierarchy-repairs.test.ts: a model that puts "The First
+ * Part" inside child 1 and starts child 2 on the paragraph beneath it has
+ * proposed a boundary, and moving that heading forward would invent a different
+ * one. **Requiring the child's own `sourceHeading` to name a heading in the run
+ * makes this self-evidencing** — it only ever honours a claim the answer
+ * already made, which is also why it can be a repair rather than a heuristic.
+ * The `typeof` guard is not decoration: `sourceHeading` is model output behind
+ * a cast, and `sameHeading` throws inside `.replace` on a number.
+ *
+ * ## The run, and the floor under it
+ *
+ * Headings come in runs — an `h2` directly beneath an `h1` — and the section
+ * begins at the *first* of the run, not the nearest, because the `h1` above it
+ * introduces the same prose. The floor is the previous kept child's start: a
+ * section cannot begin where its predecessor begins, so a run reaching back to
+ * a heading the previous section starts on is entered at the first block after
+ * it. That is the real case of a sub-section under a part title, not a corner.
+ *
+ * The first kept child is never snapped — it is pinned to its parent's start,
+ * because nothing else can supply that block.
+ *
+ * Mutates `kept` in place, and records one `PartitionRepair` per boundary it
+ * moved. `at` is where the boundary *ended up*, as everywhere else, which is
+ * what lets `repairedBlockCount` see the pin it cascades into one level down as
+ * the same movement rather than a second one.
+ */
+function snapStartsToHeadings(
+  children: ModelNode[],
+  kept: KeptChild[],
+  blocks: Block[],
+  where: string,
+  repairs: PartitionRepair[],
+): void {
+  const heading = (i: number) => blocks[i]?.kind === "heading";
+  for (let k = 1; k < kept.length; k++) {
+    const child = kept[k]!;
+    const start = child.start;
+    // Already on a heading, or not one block after one: nothing to do. This is
+    // the no-op on every document the model gets right.
+    if (heading(start) || !heading(start - 1)) continue;
+
+    const claim = children[child.childIndex]?.sourceHeading;
+    if (typeof claim !== "string" || claim.trim() === "") continue;
+
+    let first = start - 1;
+    while (heading(first - 1)) first -= 1;
+    // The floor: never back onto, or past, the previous section's own start.
+    first = Math.max(first, kept[k - 1]!.start + 1);
+    if (first >= start) continue;
+
+    /* The claim must name one of the headings actually being moved. Read with
+       `sameHeading`, the same tolerant comparison `buildTree` and `checkTree`
+       use to decide whether a claim is backed — a match by any other rule would
+       move a boundary to make a badge that then gets dropped anyway. */
+    const named = blocks.slice(first, start).some((b) => sameHeading(b.text, claim));
+    if (!named) continue;
+
+    repairs.push({
+      where: `${where} > child ${child.childIndex + 1}`,
+      kind: "heading",
+      at: first,
+      size: start - first,
+    });
+    child.start = first;
+  }
+}
+
 /** One kept child: where it sits in the model's proposal, and where it starts. */
 type KeptChild = { childIndex: number; start: number };
 
diff --git a/tests/hierarchy-repairs.test.ts b/tests/hierarchy-repairs.test.ts
index 030c2ab0..8751d3b0 100644
--- a/tests/hierarchy-repairs.test.ts
+++ b/tests/hierarchy-repairs.test.ts
@@ -1155,3 +1155,297 @@ describe("the root, which has no parent to be derived from", () => {
     expect(() => buildTree(bogus, {}, blocks, "bogus", report())).toThrow(/not in blocks\.json/);
   });
 });
+
+/**
+ * **The section that starts one paragraph after its own heading.**
+ *
+ * Measured on a 142-page Kuhn paper, 2026-09-04: of the model's 82 non-root
+ * nodes, 24 started *on* a heading block and **53 on the block immediately
+ * after one**. Every unbacked `sourceHeading` claim reproduced was at offset
+ * −1 — the model named the author's heading correctly and put the boundary on
+ * the first paragraph beneath it. The heading then fell into the previous
+ * section's tail, `planChildRanges` believed the start, and the claim was
+ * dropped as out of range. `droppedHeadings: 59` was counting that, and not the
+ * model overruling the author.
+ *
+ * So the repair is code, not prompt: a kept child that starts one block after a
+ * heading run it *names* moves back onto that run's first heading, recorded as
+ * its own `kind` of `PartitionRepair`.
+ *
+ * **Why the claim has to match.** The unconditional rule — snap any start that
+ * sits one after a heading — takes headings the model deliberately left in the
+ * section before. "closes an overlap, which would otherwise grow two leaves for
+ * one block" above is exactly that case: the model puts "The First Part" inside
+ * child 1 and starts child 2 on the paragraph after it, and moving that heading
+ * forward would be inventing a boundary nobody proposed. Requiring the child's
+ * own `sourceHeading` to name a heading in the run makes the repair
+ * self-evidencing — it only ever honours a claim the answer already made.
+ *
+ * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md § Stage 8.
+ */
+describe("a section that starts one block after the heading it names", () => {
+  /**
+   * The live shape, and it tiles perfectly by the model's own arithmetic: child
+   * 1 ends on the heading, child 2 begins on the paragraph after it. There is
+   * no gap and no overlap to find — the answer is self-consistent, and it still
+   * has the author's heading in the wrong section.
+   */
+  const offByOne: ModelNode = {
+    ...WHOLE,
+    children: [
+      {
+        title: "First",
+        gist: "It opens.",
+        range: ["spya-aaaaaa", "spya-dddddd"],
+        sourceHeading: "The First Part",
+      },
+      {
+        title: "Second",
+        gist: "It closes.",
+        range: ["spya-eeeeee", "spya-ffffff"],
+        sourceHeading: "The Second Part",
+      },
+    ],
+  };
+
+  it("moves the boundary back onto the heading, and counts it", () => {
+    const r = report();
+    const tree = buildTree(offByOne, {}, BLOCKS, "test", r);
+    expect(titled(tree, "First")?.range).toEqual(["spya-aaaaaa", "spya-cccccc"]);
+    expect(titled(tree, "Second")?.range).toEqual(["spya-dddddd", "spya-ffffff"]);
+    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
+    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
+    /* **Exactly one repair, and it is the new kind.** This is also the guard on
+       `recordBoundaryFaults`: it measures the model's two claims about each
+       boundary against where that boundary ended up, so running it after the
+       snap would report a phantom `overlap` of 2 here — the answer disagreeing
+       with a value we chose ourselves. It runs on the raw starts. */
+    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "heading", at: 3, size: 1 }]);
+    expect(repairedBlockCount(r.repairs)).toBe(1);
+  });
+
+  it("stops the heading claim being dropped, which is what the reader sees", () => {
+    const r = report();
+    const tree = buildTree(offByOne, {}, BLOCKS, "test", r);
+    expect(r.droppedHeadings).toEqual([]);
+    expect(titled(tree, "Second")?.sourceHeading).toBe("The Second Part");
+  });
+
+  /** Two headings in a row — an `h2` directly under an `h1`. */
+  const RUN: Block[] = [
+    block("spya-aaaaaa", "Opening paragraph before any heading"),
+    block("spya-bbbbbb", "Part One", "heading", "h1"),
+    block("spya-cccccc", "A Sub Heading", "heading", "h2"),
+    block("spya-dddddd", "Body under the sub heading"),
+    block("spya-eeeeee", "More of the same"),
+  ];
+
+  it("snaps to the first heading of a run, not the nearest", () => {
+    const run: ModelNode = {
+      title: "Whole piece",
+      gist: "The article argues something.",
+      range: ["spya-aaaaaa", "spya-eeeeee"],
+      children: [
+        { title: "Front", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
+        {
+          title: "Part one",
+          gist: "It closes.",
+          range: ["spya-dddddd", "spya-eeeeee"],
+          sourceHeading: "A Sub Heading",
+        },
+      ],
+    };
+    const r = report();
+    const tree = buildTree(run, {}, RUN, "test", r);
+    expect(titled(tree, "Part one")?.range).toEqual(["spya-bbbbbb", "spya-eeeeee"]);
+    expect(titled(tree, "Front")?.range).toEqual(["spya-aaaaaa", "spya-aaaaaa"]);
+    expect(checkTree(RUN, tree).problems).toEqual([]);
+    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "heading", at: 1, size: 2 }]);
+  });
+
+  /**
+   * **The no-op control, and it is the one that matters.** noema's three trees
+   * show 0 of 83 starts one after a heading, so on most documents this repair
+   * must do nothing at all. A repair that fired where the model was already
+   * right would be worse than the fault it mends.
+   */
+  it("does nothing when the start is already on the heading", () => {
+    const sound: ModelNode = {
+      ...WHOLE,
+      children: [
+        {
+          title: "First",
+          gist: "It opens.",
+          range: ["spya-aaaaaa", "spya-cccccc"],
+          sourceHeading: "The First Part",
+        },
+        {
+          title: "Second",
+          gist: "It closes.",
+          range: ["spya-dddddd", "spya-ffffff"],
+          sourceHeading: "The Second Part",
+        },
+      ],
+    };
+    const r = report();
+    const tree = buildTree(sound, {}, BLOCKS, "test", r);
+    expect(titled(tree, "First")?.range).toEqual(["spya-aaaaaa", "spya-cccccc"]);
+    expect(titled(tree, "Second")?.range).toEqual(["spya-dddddd", "spya-ffffff"]);
+    expect(r.repairs).toEqual([]);
+    expect(r.droppedHeadings).toEqual([]);
+  });
+
+  it("does nothing on an article with no headings at all", () => {
+    const plain: Block[] = [
+      block("spya-aaaaaa", "One"),
+      block("spya-bbbbbb", "Two"),
+      block("spya-cccccc", "Three"),
+      block("spya-dddddd", "Four"),
+    ];
+    const headingless: ModelNode = {
+      title: "Whole piece",
+      gist: "The article argues something.",
+      range: ["spya-aaaaaa", "spya-dddddd"],
+      children: [
+        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
+        { title: "Second", gist: "It closes.", range: ["spya-cccccc", "spya-dddddd"] },
+      ],
+    };
+    const r = report();
+    const tree = buildTree(headingless, {}, plain, "test", r);
+    expect(titled(tree, "First")?.range).toEqual(["spya-aaaaaa", "spya-bbbbbb"]);
+    expect(titled(tree, "Second")?.range).toEqual(["spya-cccccc", "spya-dddddd"]);
+    expect(r.repairs).toEqual([]);
+  });
+
+  it("leaves a start alone when the node claims no heading", () => {
+    const unclaimed: ModelNode = {
+      ...WHOLE,
+      children: [
+        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-dddddd"] },
+        { title: "Second", gist: "It closes.", range: ["spya-eeeeee", "spya-ffffff"] },
+      ],
+    };
+    const r = report();
+    const tree = buildTree(unclaimed, {}, BLOCKS, "test", r);
+    expect(titled(tree, "Second")?.range).toEqual(["spya-eeeeee", "spya-ffffff"]);
+    expect(r.repairs).toEqual([]);
+  });
+
+  it("leaves a start alone when the heading before it is not the one claimed", () => {
+    const elsewhere: ModelNode = {
+      ...WHOLE,
+      children: [
+        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-dddddd"] },
+        {
+          title: "Second",
+          gist: "It closes.",
+          range: ["spya-eeeeee", "spya-ffffff"],
+          // The block before this start is "The Second Part". This names the
+          // other one, so nothing here says the boundary is in the wrong place.
+          sourceHeading: "The First Part",
+        },
+      ],
+    };
+    const r = report();
+    const tree = buildTree(elsewhere, {}, BLOCKS, "test", r);
+    expect(titled(tree, "Second")?.range).toEqual(["spya-eeeeee", "spya-ffffff"]);
+    expect(r.repairs).toEqual([]);
+    expect(r.droppedHeadings).toEqual(["root > child 2"]);
+  });
+
+  it("will not take a heading the section before it starts on", () => {
+    const contested: ModelNode = {
+      title: "Whole piece",
+      gist: "The article argues something.",
+      range: ["spya-aaaaaa", "spya-eeeeee"],
+      children: [
+        { title: "Preamble", gist: "Before it all.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
+        {
+          title: "Front",
+          gist: "It opens.",
+          range: ["spya-bbbbbb", "spya-cccccc"],
+          sourceHeading: "Part One",
+        },
+        {
+          title: "Sub",
+          gist: "It closes.",
+          // One block after the whole run, and the run reaches back to the
+          // heading the previous child already starts on.
+          range: ["spya-dddddd", "spya-eeeeee"],
+          sourceHeading: "A Sub Heading",
+        },
+      ],
+    };
+    const r = report();
+    const tree = buildTree(contested, {}, RUN, "test", r);
+    /* Snapped to index 2 — the deepest heading of the run that the previous
+       section does not already start on — never to index 1, which it does. A
+       section cannot begin where its predecessor begins. */
+    expect(titled(tree, "Front")?.range).toEqual(["spya-bbbbbb", "spya-bbbbbb"]);
+    expect(titled(tree, "Sub")?.range).toEqual(["spya-cccccc", "spya-eeeeee"]);
+    expect(checkTree(RUN, tree).problems).toEqual([]);
+    expect(r.repairs).toEqual([{ where: "root > child 3", kind: "heading", at: 2, size: 1 }]);
+  });
+
+  /**
+   * **The snap is a boundary like any other, so it cascades**, and the count
+   * must not charge the article twice for it: the moved start becomes the
+   * node's own `p0` one level down, its first child is pinned to it, and that
+   * pinning is recorded too — one boundary, seen at two depths, at one
+   * coordinate.
+   */
+  it("cascades into the node's own first child without being counted twice", () => {
+    const nested: ModelNode = {
+      ...WHOLE,
+      children: [
+        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-dddddd"] },
+        {
+          title: "Second",
+          gist: "It closes.",
+          range: ["spya-eeeeee", "spya-ffffff"],
+          sourceHeading: "The Second Part",
+          children: [
+            { title: "Inner one", gist: "A point.", range: ["spya-eeeeee", "spya-eeeeee"] },
+            { title: "Inner two", gist: "Another.", range: ["spya-ffffff", "spya-ffffff"] },
+          ],
+        },
+      ],
+    };
+    const r = report();
+    const tree = buildTree(nested, {}, BLOCKS, "test", r);
+    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
+    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
+    expect(titled(tree, "Inner one")?.range).toEqual(["spya-dddddd", "spya-eeeeee"]);
+    expect(new Set(r.repairs.map((x) => x.at))).toEqual(new Set([3]));
+    expect(repairedBlockCount(r.repairs)).toBe(1);
+  });
+
+  /**
+   * **Both faults at once, and the two sizes stay independent.** The model
+   * stopped child 1 three blocks early *and* started child 2 on the paragraph
+   * after the heading it names. The gap is measured against what the answer
+   * said; the snap by how far the boundary then moved.
+   */
+  it("records the gap and the snap separately", () => {
+    const both: ModelNode = {
+      ...WHOLE,
+      children: [
+        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
+        {
+          title: "Second",
+          gist: "It closes.",
+          range: ["spya-eeeeee", "spya-ffffff"],
+          sourceHeading: "The Second Part",
+        },
+      ],
+    };
+    const r = report();
+    const tree = buildTree(both, {}, BLOCKS, "test", r);
+    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
+    expect(r.repairs).toEqual([
+      { where: "root > child 2", kind: "gap", at: 4, size: 3 },
+      { where: "root > child 2", kind: "heading", at: 3, size: 1 },
+    ]);
+  });
+});

```

```
