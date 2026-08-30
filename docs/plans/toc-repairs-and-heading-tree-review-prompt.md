# Review: two bounded repairs in stage 4, and a design question about the heading tree

You are reviewing **code that is already written and green**, plus **one design decision that is
not yet made**. Weight the code review higher — a plan-stage review cannot find a `PATCH` that
writes one field and then rejects the request.

Repo: `spideryarn2`, an AI-assisted reading app. Stage 4 of the pipeline (`src/toc.ts`) asks a model
for a nested table of contents over a block sequence, then generates one nav label per paragraph.

## The measurement this is built on

A paid calibration run on 2026-08-30 (`evals/results/toc-structure/`) threw on **4 of 13** structure
calls. The failures were bimodal by *kind*, not spread by size:

| family | count | shape |
|---|---|---|
| tiling | 2 | gaps of **exactly one block**, both of them |
| `sourceHeading` | 2 | a heading claimed outside the node's range, on one document, 4 calls in 4 |

Every tiling failure ever recorded in this repo — those two plus two in
`docs/postmortems/the-article-with-one-heading.md` — is off by one block. The structure call takes
~163s and is 88% of the stage's wall clock, so a refusal costs the reader the whole article.

The write-up is `docs/research/opening-an-article-before-the-toc.md` § 7b and § 8 (R2 and R3).

## What the diff does

**R2 — `repairedChildRanges`.** Snaps a child's start (or the last child's end) when the partition
misses by **exactly one block**, before anything is built. Gap, overlap and trailing-short are the
three cases. Bounded at one block; two blocks out still throws, as do a backwards range, an
invented id, and a root that misses the article's ends.

**R3 — unbacked `sourceHeading` is dropped, not thrown on.** `sourceHeading` is provenance: its only
consumer is a `§` badge meaning "the author wrote this heading". The repair reads the same
`sameHeading` predicate `checkTree` uses, over the node's own range.

Both are counted into `TocRun`, printed by the CLI every run including at zero, and logged by
`src/pipeline.ts` — following `strandedSupplement`.

## Questions on the code (please answer each explicitly)

1. **Is the one-block bound actually enforced in every direction?** I convinced myself that
   `Math.abs(lo - cursor) === 1` plus the `cursor <= hi` guard cannot produce an empty or backwards
   range, and that the trailing `cursor === parent[1]` test is exactly "one short". Check the
   arithmetic, especially the trailing case and the interaction when the same last child is both
   snapped at its start and extended at its end.

2. **Does the cascade terminate, and is it correct?** Repairing a node's start moves its first
   child's start too. I handle this by repairing the model's proposal top-down and passing an
   `override` range down the recursion, never mutating `mn`. Is there an input where this cascades
   more than one block, or repairs a node whose parent was *not* repaired into an inconsistent state?

3. **Is R3 provably at least as strict as `checkTree`'s own rule?** My claim: `buildTree` sees
   `body`, `checkTree` sees the full `blocks` array; within a node's range `body` is a subset, so
   anything kept here is kept there, and the invariant can never fail on a claim this let past.
   Is that true given `splitBlocks` / `appendSupplement` (`src/supplement.ts`)? Note `stranded`.

4. **What did I break by making an unbacked `sourceHeading` un-throwable?** I found one:
   `tests/toc-write-guard.test.ts` used exactly that as its vehicle for "buildable but invalid", so
   three tests went green for the wrong reason. I switched the vehicle to a missing gist. **Look for
   any other test, guard, or eval whose red depends on a condition these repairs now fix** — an eval
   arm scored on throw rate, `src/validate-tree.ts`, the publish guard in
   `src/store/pg-revisions.ts`, `evals/toc-structure/`.

5. **Is repairing the right call at all**, or does it hide a prompt regression? My mitigation is the
   counts. Is that enough, and is there a threshold at which the stage should refuse anyway?

6. Anything else: correctness, the error messages, whether any of this can put article prose into a
   log (a hard rule here — `docs/project/logging.md`).

## The design question, not yet built

The second piece of work is **the heading tree**: `evals/toc-structure/heading-tree.ts` builds a
deterministic tree from the article's own `<h2>`/`<h3>` blocks, no model, milliseconds. Measured:
6 of 7 dev documents have usable headings, 4 of 7 match the model's depth-1 carving exactly, and the
rule's thresholds hold on 4 of 5 held-out documents.

I want to promote it into `src/`. **The question is what it should be wired to.** A map of the
consumers (verify this rather than trusting it):

- The publish guard (`src/store/pg-revisions.ts:1131`, `:1135`) refuses an article with no tree, and
  runs `checkTree`. A heading tree has **no gists**, so it fails the gist rule once per section.
- `docs/research/…` § 2 settled that the exemption must be an explicit **tree-level**
  `provisional: "headings"` marker, never inferred from the absent gist — the same reasoning that
  put `treatment` on a node rather than reading the supplement role off a missing gist.
- `structureHash(tree)` (`src/source-hash.ts`) is the staleness input for `arc`, `ideas`, `sketch`
  and `similar`. **Replacing a provisional tree with the model's changes that hash**, which reads as
  stale, which re-buys all of them.
- `src/web/useArc.ts:139-148` **auto-starts the arc job on open** for the owner — the only
  unconditional purchase on opening an article.
- `src/web/DiagramPanel.tsx:499` → `POST /api/similar/:slug` buys embeddings on a *mode toggle*, and
  the tree is in its cache key (`src/similar.ts:243`).

Three candidate wirings:

- **(a) Fallback only.** Use the heading tree only when the structure call fails *after* the repairs
  above. The tree is never replaced later, so no re-buy churn; but a provisional tree does reach the
  reader, so the marker, the `checkTree` exemption and a gate on derived work are all still needed.
- **(b) Open on the heading tree, upgrade in place.** The original ask (open the article before the
  ToC is built). Needs a publication boundary and a tree-replacement seam that do not exist, plus
  handling every re-buy above. Much larger.
- **(c) Feed the author's headings to the structure model as input** and let it modify or replace
  them. No provisional tree ever exists, so none of the above applies; but it changes prompt
  behaviour and would need its own eval to justify.

**Which of these would you build first, and what does (a) cost that I have not listed?** In
particular: is a fallback tree that a reader can open, with no gists and therefore nothing at the
coarse zoom levels, better or worse for that reader than a failed ingest and a visible error? Be
concrete about what breaks.

## The diff

```diff
diff --git a/src/pipeline.ts b/src/pipeline.ts
index a620c94..d37cd33 100644
--- a/src/pipeline.ts
+++ b/src/pipeline.ts
@@ -1465,6 +1465,12 @@ export const STEPS: { [K in StepName]: PipelineStep<K> } = {
           supplementNodes: run.supplementNodes,
           supplementBlocks: run.supplementBlocks,
           strandedSupplement: run.strandedSupplement,
+          /* What the stage forgave the model. Both are bounded repairs of a
+             slip (src/toc.ts § `repairedChildRanges`), and both are logged at
+             zero as well as above it — an operator watching these climb is
+             watching the structure prompt drift. */
+          repairedRanges: run.repairedRanges,
+          droppedHeadings: run.droppedHeadings,
           inputTokens: run.inputTokens,
           outputTokens: run.outputTokens,
           cacheReadTokens: run.cacheReadTokens,
diff --git a/src/toc.ts b/src/toc.ts
index d6feb1e..d3e1f6b 100644
--- a/src/toc.ts
+++ b/src/toc.ts
@@ -39,7 +39,7 @@ import { isBodyEvidence, isStructural } from "./block-policy.js";
 import { isSpideryarnId } from "./ids.js";
 import { generateLabels, mergeLabels } from "./labels.js";
 import { appendSupplement, splitBlocks } from "./supplement.js";
-import { assertTreeSound } from "./tree-invariants.js";
+import { assertTreeSound, sameHeading } from "./tree-invariants.js";
 import { budgetFor, truncationFailure } from "./token-budget.js";
 import type { Block, Tree, TreeNode, NodeId } from "./types.js";
 import { parseJsonFrom, stripFence } from "./parse-json.js";
@@ -459,6 +459,128 @@ function assertChildrenPartition(
   }
 }
 
+/**
+ * **What `buildTree` mended on the way past, and what it refused to.**
+ *
+ * Both fields are filled in by `buildTree` when it is given one, and both are
+ * counted into `TocRun`, printed by the CLI every run including when they are
+ * zero, and logged by src/pipeline.ts. That is deliberate and it follows
+ * `strandedSupplement`: a repair nobody is told about is the same shape as the
+ * bug it repaired (docs/reusable/silent-success.md). If these numbers start
+ * climbing, the prompt is drifting and the repairs are hiding it.
+ */
+export interface BuildReport {
+  /** Off-by-one partitions snapped rather than refused. */
+  repairs: PartitionRepair[];
+  /**
+   * Nodes whose `sourceHeading` claim no heading block in their range backed
+   * up, by position in the model's proposal. The node keeps its title; it
+   * loses only the mark saying the author wrote it.
+   */
+  droppedHeadings: string[];
+}
+
+export interface PartitionRepair {
+  /**
+   * The node's position in the model's own proposal — "root > child 2". Derived
+   * from the shape of the answer rather than anything in it, so it is always
+   * safe to log; see `where` in `buildTree`.
+   */
+  where: string;
+  /** Which end was wrong: the child started late, started early, or stopped early. */
+  kind: "gap" | "overlap" | "short";
+}
+
+/**
+ * **Snap a partition that misses by exactly one block, and only by one.**
+ *
+ * The argument for repairing at all is measured rather than assumed. A paid
+ * calibration of this stage threw on 4 of 13 structure calls, and every tiling
+ * failure anyone has recorded — those two, plus the two in
+ * docs/postmortems/the-article-with-one-heading.md — was **off by a single
+ * block**. So the practical choice is not between trusting the model and
+ * checking it; it is whether a two-and-a-half-minute call that put one boundary
+ * one paragraph out should cost the reader the article. It should not, and a
+ * fifth of structure calls were costing exactly that
+ * (docs/research/opening-an-article-before-the-toc.md § 7b).
+ *
+ * **Why here, on the model's proposal, rather than in `assertChildrenPartition`.**
+ * By the time that check runs, `visit` has already walked the children and
+ * grown their leaves, so moving a boundary there would mean growing a leaf to
+ * match and splicing it into the right position — the tree repairing itself
+ * after the fact, which is the shape that produces two leaves for one block.
+ * Repairing the *proposal* means nothing has been built yet: the recursion then
+ * sees the mended range and grows exactly the leaves it implies. It is also
+ * what makes the cascade fall out for free — moving a node's start moves its
+ * first child's start too, and a repair that stopped at one level would trade a
+ * broken partition at depth 1 for a broken one at depth 2.
+ *
+ * **Bounded at one block, deliberately.** A repair that grew with the size of
+ * the mistake would be the model marking its own homework. Two blocks out is
+ * not a slip, it is a different reading of the article, and it still throws —
+ * as do a backwards range, an invented id, and a root that misses the article's
+ * ends. Nothing is repaired that would leave a node covering no blocks at all.
+ *
+ * Returns one entry per child: a mended `[start, end]`, or `undefined` for
+ * "use what the model wrote".
+ */
+function repairedChildRanges(
+  children: ModelNode[],
+  parent: readonly [number, number],
+  index: Map<string, number>,
+  blocks: Block[],
+  where: string,
+  repairs: PartitionRepair[],
+): (readonly [string, string] | undefined)[] {
+  const out: (readonly [string, string] | undefined)[] = children.map(() => undefined);
+
+  /** A child's range as block indices, or null if it is not a resolvable, forward pair. */
+  const spanOf = (mn: ModelNode): [number, number] | null => {
+    const raw: unknown = mn.range;
+    if (!Array.isArray(raw) || raw.length !== 2) return null;
+    const [a, b] = raw as unknown[];
+    if (typeof a !== "string" || typeof b !== "string") return null;
+    const lo = index.get(a);
+    const hi = index.get(b);
+    return lo === undefined || hi === undefined || lo > hi ? null : [lo, hi];
+  };
+
+  let cursor = parent[0];
+  for (const [i, child] of children.entries()) {
+    const span = spanOf(child);
+    /* Not repairable, and not this function's to report. An unresolvable or
+       backwards range is a different fault with a message of its own, and
+       guessing at a repair here would replace a precise error with a vague
+       one. Stop, and let `visit` and `assertChildrenPartition` say what is
+       wrong — including about the children after this one, whose offsets are
+       now measured from a cursor that means nothing. */
+    if (!span) return out;
+    const [lo, hi] = span;
+    /* `cursor <= hi` is the guard against repairing a node into nothing: an
+       overlap snap moves the start forward, and a single-block child that its
+       neighbour already ate has no snap that leaves it non-empty. Without this
+       the repair would hand `visit` a range running backwards, and the error
+       two lines later would describe a range we wrote ourselves. */
+    if (lo !== cursor && Math.abs(lo - cursor) === 1 && cursor <= hi) {
+      out[i] = [blocks[cursor]!.id, (child.range as [string, string])[1]] as const;
+      repairs.push({ where: `${where} > child ${i + 1}`, kind: lo > cursor ? "gap" : "overlap" });
+    }
+    cursor = hi + 1;
+  }
+
+  /* The same fault at the other end: the last child stops one block before its
+     parent does, and that block would grow no leaf anywhere. `cursor` is one
+     past the last child's end, so `cursor === parent[1]` is exactly one short. */
+  const last = children.length - 1;
+  if (last >= 0 && cursor === parent[1]) {
+    const start = out[last]?.[0] ?? (children[last]!.range as [string, string])[0];
+    out[last] = [start, blocks[parent[1]]!.id] as const;
+    repairs.push({ where: `${where} > child ${last + 1}`, kind: "short" });
+  }
+
+  return out;
+}
+
 /**
  * Flatten the model's nested proposal into the stored map, and grow the leaf
  * layer underneath it. Every block gets exactly one leaf; a leaf carries a
@@ -469,8 +591,17 @@ export function buildTree(
   navLabels: Record<string, string>,
   blocks: Block[],
   slug: string,
+  /**
+   * Filled in with what was mended on the way past. Optional so that the
+   * callers who only want a tree — the tests, src/validate-tree.ts — stay one
+   * argument long; `generateToc` always passes one, because a repair nobody
+   * counts is a repair nobody can notice going wrong.
+   */
+  report?: BuildReport,
 ): Tree {
   const index = new Map(blocks.map((b, i) => [b.id, i]));
+  const repairs = report?.repairs ?? [];
+  const dropped = report?.droppedHeadings ?? [];
   const nodes: Record<NodeId, TreeNode> = {};
   let counter = 0;
   const nextId = () => `n${String(++counter).padStart(4, "0")}`;
@@ -479,20 +610,70 @@ export function buildTree(
      "root > child 2 > child 4". It is derived from the shape of the answer
      rather than from anything in it, so it is always safe to put in a message,
      and it is what tells you which node to go and look at. */
-  const visit = (mn: ModelNode, parent: NodeId | null, depth: number, where: string): NodeId => {
+  const visit = (
+    mn: ModelNode,
+    parent: NodeId | null,
+    depth: number,
+    where: string,
+    /* The range its parent mended for it, when one was mended. The model's own
+       proposal is never mutated: two callers share the same literal in the
+       tests and in the evals, and a repair written back into it would leak from
+       one build into the next. */
+    override?: readonly [string, string],
+  ): NodeId => {
     const id = nextId();
     /* Shape before anything indexes it. `mn.range` is model output behind a
        cast, so it need not be a pair at all: `"range": "spya-a…spya-b"` used to
        reach the lookup below with `range[0] === "s"`, miss, and then fail
        inside `mn.range.join` with "mn.range.join is not a function" — an error
        that named the bug in our code rather than the fault in the answer. */
-    const raw: unknown = mn.range;
+    const raw: unknown = override ?? mn.range;
     const pair = Array.isArray(raw) && raw.length === 2 ? (raw as unknown[]) : [];
     const [start, end] = pair;
     if (typeof start !== "string" || typeof end !== "string") {
       throw new Error(`The node at ${where} has no [start, end] block range.`);
     }
     const range: [string, string] = [start, end];
+    const lo = index.get(range[0]);
+    const hi = index.get(range[1]);
+
+    /**
+     * **An authored heading the node does not contain is dropped, not thrown on.**
+     *
+     * `sourceHeading` is provenance, not structure. Its only consumer is the
+     * `§` badge that tells the reader the author wrote this heading and we did
+     * not (src/web/TableView.tsx, ContextList.tsx, Spine.tsx) — so an unbacked
+     * claim is a badge that would lie, and the whole cost of dropping it is
+     * that one node stops claiming an authorship it never had. Throwing, by
+     * contrast, costs the reader the article: four structure calls in four made
+     * the same wrong claim on the same document, which makes a refusal not an
+     * occasional loss but a guaranteed failure loop for it
+     * (docs/research/opening-an-article-before-the-toc.md § 7b).
+     *
+     * **Read with `sameHeading`, over the same range, so this is a repair and
+     * not a second opinion.** `checkTree` asks the identical question later,
+     * against the full block array; this one asks it against `body`, which
+     * within a node's range is a subset. So anything kept here is kept there,
+     * and the invariant can no longer fail on a claim this line let past —
+     * which is the property that makes the repair worth having rather than a
+     * disagreement waiting to surface downstream (src/tree-invariants.ts).
+     *
+     * The `typeof` guard is not decoration: `mn` is model output behind a cast,
+     * and a number here would reach `sameHeading` and throw inside a `.replace`
+     * on a string that is not one.
+     */
+    const claim =
+      typeof mn.sourceHeading === "string" && mn.sourceHeading.trim() !== ""
+        ? mn.sourceHeading
+        : undefined;
+    const backed =
+      claim !== undefined &&
+      lo !== undefined &&
+      hi !== undefined &&
+      lo <= hi &&
+      blocks.slice(lo, hi + 1).some((b) => b.kind === "heading" && sameHeading(b.text, claim));
+    if (claim !== undefined && !backed) dropped.push(where);
+
     const node: TreeNode = {
       id,
       depth,
@@ -501,12 +682,9 @@ export function buildTree(
       range,
       title: mn.title,
       ...(mn.gist ? { gist: mn.gist } : {}),
-      ...(mn.sourceHeading ? { sourceHeading: mn.sourceHeading } : {}),
+      ...(backed ? { sourceHeading: claim } : {}),
     };
     nodes[id] = node;
-
-    const lo = index.get(range[0]);
-    const hi = index.get(range[1]);
     if (lo !== undefined && hi !== undefined && lo > hi) {
       /* A range that runs backwards. Both ends are real block ids, so every
          lookup succeeds and nothing below objects — the leaf loop simply runs
@@ -520,7 +698,20 @@ export function buildTree(
     }
 
     if (mn.children?.length) {
-      node.children = mn.children.map((c, i) => visit(c, id, depth + 1, `${where} > child ${i + 1}`));
+      /* Mend before descending, so the recursion grows leaves for the range the
+         children will actually be checked against — and so a moved start
+         cascades into that child's own first child. `repairedChildRanges` says
+         why this cannot be done after the walk. A parent whose own range does
+         not resolve is left alone: `assertChildrenPartition` has a precise
+         message for that, and repairing against a cursor that means nothing
+         would bury it. */
+      const mended =
+        lo !== undefined && hi !== undefined
+          ? repairedChildRanges(mn.children, [lo, hi], index, blocks, where, repairs)
+          : mn.children.map(() => undefined);
+      node.children = mn.children.map((c, i) =>
+        visit(c, id, depth + 1, `${where} > child ${i + 1}`, mended[i]),
+      );
       assertChildrenPartition(node, nodes, index, where);
       return id;
     }
@@ -621,6 +812,17 @@ export interface TocRun {
    * make visible (docs/reusable/silent-success.md).
    */
   strandedSupplement: number;
+  /**
+   * **Off-by-one partitions this run snapped shut rather than refused**, and
+   * `sourceHeading` claims it dropped because no heading in the node's range
+   * backed them up. Both are repairs of a model's slip, both are bounded, and
+   * both are reported for the same reason `strandedSupplement` is: a repair
+   * that nobody counts is indistinguishable from the bug it repaired
+   * (docs/reusable/silent-success.md). A run at zero is the normal case; a
+   * number that climbs means the prompt has drifted and these are hiding it.
+   */
+  repairedRanges: number;
+  droppedHeadings: number;
   labelled: number;
   internal: number;
   /**
@@ -791,7 +993,8 @@ export async function generateToc(opts: {
   /* `body`, so the root's range ends at the last body block and every check in
      `buildTree` — the tiling, the "covers the whole article" guard — is asked
      about the argument the model was actually shown. */
-  const structure = appendSupplement(buildTree(root, {}, body, slug), groups);
+  const built: BuildReport = { repairs: [], droppedHeadings: [] };
+  const structure = appendSupplement(buildTree(root, {}, body, slug, built), groups);
 
   /* **Appended before `generateLabels`, not after.** `labels.json` records
      `structureHash(opts.tree)` (src/labels.ts), so a supplement added afterwards
@@ -903,6 +1106,8 @@ export async function generateToc(opts: {
     supplementNodes: groups.length,
     supplementBlocks: blocks.length - body.length,
     strandedSupplement: stranded,
+    repairedRanges: built.repairs.length,
+    droppedHeadings: built.droppedHeadings.length,
     labelled: Object.values(tree.nodes).filter((n) => n.navLabel).length,
     internal: Object.values(tree.nodes).filter((n) => n.children.length > 0).length,
     labelBatches: labelRun.batches,
@@ -959,6 +1164,13 @@ async function main(): Promise<void> {
           `trailing run, so no Notes node was built`
       : `Notes:     ${run.supplementNodes} node(s) over ${run.supplementBlocks} block(s)`,
   );
+  /* Printed every run, including at zero, for the reason the Notes line above
+     is. These are the two places stage 4 now forgives the model, and a number
+     computed and never shown is the same as no number. */
+  console.log(
+    `Repaired:  ${run.repairedRanges} off-by-one range(s), ` +
+      `${run.droppedHeadings} unbacked heading claim(s)`,
+  );
   console.log(`Tokens:    ${run.inputTokens} in, ${run.outputTokens} out`);
   console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
   console.log(`\nWrote:     ${path.resolve(run.outDir)}/tree.json`);
diff --git a/tests/toc-build.test.ts b/tests/toc-build.test.ts
index 7290c42..27df05f 100644
--- a/tests/toc-build.test.ts
+++ b/tests/toc-build.test.ts
@@ -151,15 +151,22 @@ describe("buildTree", () => {
       expect(() => buildTree(overlapping, NAV, BLOCKS, "test")).toThrow(/overlaps the one before/);
     });
 
-    it("refuses children that leave a gap, which would grow no leaf at all", () => {
+    /* **Two blocks, not one.** A gap of exactly one block is now snapped shut
+       rather than refused — every tiling failure ever recorded here was off by
+       one, and a model that put a single boundary a paragraph out was costing
+       the reader the whole article. The repair, its bound and the measurement
+       behind it are in tests/toc-repairs.test.ts. What this case still asserts
+       is the other side of that bound: two blocks out is not a slip, it is a
+       different reading of the article, and it is still a refusal. */
+    it("refuses children that leave a gap wider than the repair, growing no leaf at all", () => {
       const gapped: ModelNode = {
         ...ROOT,
         children: [
           { title: "First", range: ["spya-aaaaaa", "spya-aaaaaa"] },
-          { title: "Second", range: ["spya-cccccc", "spya-dddddd"] },
+          { title: "Second", range: ["spya-dddddd", "spya-dddddd"] },
         ],
       };
-      expect(() => buildTree(gapped, NAV, BLOCKS, "test")).toThrow(/leaves a gap of 1 block/);
+      expect(() => buildTree(gapped, NAV, BLOCKS, "test")).toThrow(/leaves a gap of 2 block/);
     });
 
     it("refuses children that stop before their parent ends", () => {
diff --git a/tests/toc-write-guard.test.ts b/tests/toc-write-guard.test.ts
index 8a359f6..6eef927 100644
--- a/tests/toc-write-guard.test.ts
+++ b/tests/toc-write-guard.test.ts
@@ -172,19 +172,54 @@ describe("generateToc refuses to write an invalid tree", () => {
     expect(await wrote()).toEqual(["labels.json", "tree.json"]);
   });
 
-  it("throws and writes nothing when a node claims a heading it does not contain", async () => {
+  /**
+   * **The vehicle changed on 2026-08-30, and the reason is worth keeping.**
+   *
+   * These tests used to make an invalid tree by claiming a `sourceHeading` the
+   * node does not contain. `buildTree` now drops such a claim instead of
+   * letting it through to `checkTree` (src/toc.ts, tests/toc-repairs.test.ts),
+   * so that stopped being a way to build an invalid tree at all — and every
+   * test here went green for the wrong reason: nothing threw, because nothing
+   * was wrong any more.
+   *
+   * A missing gist replaces it. It is buildable — `buildTree` copies back
+   * whatever the model wrote and has no opinion about an absent gist — and
+   * invalid, because an internal node without one has nothing to render at its
+   * own zoom level (src/tree-invariants.ts § the gist rule). That is the pair
+   * this file needs, and unlike `sourceHeading` it is a rule no repair may ever
+   * relax: the gist rule is stated in both directions precisely so a pipeline
+   * bug that drops a gist cannot be read as a deliberate exception.
+   */
+  it("throws and writes nothing when an internal node has no gist", async () => {
     await rm(path.join(DIR, "tree.json"), { force: true });
     await rm(path.join(DIR, "labels.json"), { force: true });
-    /* Buildable and invalid, which is the pair that matters: `buildTree` has no
-       opinion about `sourceHeading`, and `checkTree` requires the claimed
-       heading to be a heading block inside the node's own range. */
-    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
+    modelTree = wholeArticle({ gist: undefined });
     const { threw } = await run();
     expect(threw).not.toBeNull();
     expect(threw!.message).toContain("is not a valid tree, so it was not written");
     expect(await wrote()).toEqual([]);
   });
 
+  /* The repair, proved at the stage rather than at the function — which is the
+     same reason everything else in this file is an integration test. A claim no
+     block backs up costs the node its provenance mark and costs the reader
+     nothing; before this, four structure calls in four made the same wrong
+     claim on one article and it was a guaranteed failure loop for that
+     document. docs/research/opening-an-article-before-the-toc.md § 7b. */
+  it("writes the tree, minus the claim, when a node claims a heading it does not contain", async () => {
+    await rm(path.join(DIR, "tree.json"), { force: true });
+    await rm(path.join(DIR, "labels.json"), { force: true });
+    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
+    const { threw } = await run();
+    expect(threw).toBeNull();
+    expect(await wrote()).toEqual(["labels.json", "tree.json"]);
+    const written = JSON.parse(await readFile(path.join(DIR, "tree.json"), "utf-8")) as {
+      rootId: string;
+      nodes: Record<string, { sourceHeading?: string }>;
+    };
+    expect(written.nodes[written.rootId]!.sourceHeading).toBeUndefined();
+  });
+
   /* The thrown message is written to the log by src/jobs.ts with `errorFields`,
      which keeps `message` and `stack`. Until 2026-08-29 the `sourceHeading`
      problem quoted the author's own heading back, so wiring this guard in would
@@ -196,10 +231,15 @@ describe("generateToc refuses to write an invalid tree", () => {
     await rm(path.join(DIR, "labels.json"), { force: true });
     const heading = blocks.find((b) => b.kind === "heading");
     expect(heading).toBeDefined(); // the fixture must have one for this to test anything
-    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
+    modelTree = wholeArticle({ gist: undefined });
     const { threw } = await run();
-    expect(threw!.message).not.toContain("A Heading Nobody Wrote");
-    expect(threw!.message).not.toContain(heading!.text);
+    /* Every block's text, not just the heading's. The original version of this
+       test named the one string the one message was known to quote, which
+       checks the bug that happened rather than the rule — and the rule is that
+       nothing this stage throws may carry a line of the article. */
+    for (const b of blocks) {
+      if (b.text.trim().length > 0) expect(threw!.message).not.toContain(b.text);
+    }
   });
 
   /* **The control, and it has to come first for the same reason as the one at
@@ -231,7 +271,7 @@ describe("generateToc refuses to write an invalid tree", () => {
     await rm(path.join(DIR, "tree.json"), { force: true });
     await rm(path.join(DIR, "labels.json"), { force: true });
     labelCalls = 0;
-    modelTree = wholeArticle({ sourceHeading: "A Heading Nobody Wrote" });
+    modelTree = wholeArticle({ gist: undefined });
     const { threw } = await run();
     expect(threw).not.toBeNull();
     expect(labelCalls).toBe(0);

```

## The new test file

```typescript
/**
 * **Two repairs, and the measurement that argues for them.**
 *
 * A paid calibration run of stage 4 on 2026-08-30 threw on 4 of 13 structure
 * calls (31%), and the failures were bimodal by *kind* rather than spread by
 * size — see docs/research/opening-an-article-before-the-toc.md § 7b:
 *
 * | family | count | shape |
 * |---|---|---|
 * | tiling | 2 | gaps of **exactly one block**, both of them |
 * | `sourceHeading` | 2 | a heading claimed outside the node's range |
 *
 * Every tiling failure anyone has observed — those two plus the two in
 * docs/postmortems/the-article-with-one-heading.md — is off by one block. So
 * the choice is not "trust the model" against "check the model"; it is whether
 * a two-and-a-half-minute call that got one boundary off by a single paragraph
 * should cost the reader the whole article. It should not.
 *
 * **What is deliberately NOT relaxed.** The repairs are bounded at one block,
 * and everything else throws exactly as it did: a two-block gap, a backwards
 * range, an invented id, a root that misses the article's ends. A repair that
 * grew with the size of the mistake would be the model marking its own
 * homework, which is the failure this file's neighbours exist to prevent
 * (docs/reusable/silent-success.md).
 *
 * **And nothing is repaired quietly.** `buildTree` takes a report and fills it
 * in; `generateToc` counts it into `TocRun`, the CLI prints it every run
 * including when it is zero, and src/pipeline.ts logs it — the same rule
 * `strandedSupplement` already follows, for the same reason.
 */
import { describe, expect, it } from "vitest";
import { buildTree, type BuildReport, type ModelNode } from "../src/toc.js";
import { checkTree } from "../src/tree-invariants.js";
import type { Block } from "../src/types.js";

function block(id: string, text: string, kind: Block["kind"] = "text", tag = "p"): Block {
  return {
    id,
    tag,
    kind,
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    html: `<${tag} id="${id}">${text}</${tag}>`,
    gistable: kind !== "media",
  };
}

/** Six blocks, two of them the author's own headings. */
const BLOCKS: Block[] = [
  block("spya-aaaaaa", "Opening paragraph before any heading"),
  block("spya-bbbbbb", "The First Part", "heading", "h2"),
  block("spya-cccccc", "Body of the first part"),
  block("spya-dddddd", "The Second Part", "heading", "h2"),
  block("spya-eeeeee", "Body of the second part"),
  block("spya-ffffff", "A closing paragraph"),
];

const report = (): BuildReport => ({ repairs: [], droppedHeadings: [] });

/** Every leaf's block, in tree order — what the reader can actually reach. */
function leafBlocks(tree: ReturnType<typeof buildTree>): string[] {
  return Object.values(tree.nodes)
    .filter((n) => n.children.length === 0)
    .map((n) => n.range[0]);
}

describe("an off-by-one partition is repaired, not refused", () => {
  /** Child 2 starts one block late, so `spya-cccccc` would grow no leaf at all. */
  const gapped: ModelNode = {
    title: "Whole piece",
    gist: "The article argues something.",
    range: ["spya-aaaaaa", "spya-ffffff"],
    children: [
      { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
      { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
    ],
  };

  it("snaps a one-block gap so every block still gets exactly one leaf", () => {
    const r = report();
    const tree = buildTree(gapped, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "gap" }]);
  });

  it("gives the orphaned block to the section that follows it", () => {
    const tree = buildTree(gapped, {}, BLOCKS, "test", report());
    const second = Object.values(tree.nodes).find((n) => n.title === "Second");
    expect(second?.range[0]).toBe("spya-cccccc");
  });

  it("snaps a one-block overlap, which would otherwise grow two leaves for one block", () => {
    const overlapping: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-cccccc", "spya-ffffff"] },
      ],
    };
    const r = report();
    const tree = buildTree(overlapping, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "overlap" }]);
  });

  it("extends a last child that stops one block before its parent ends", () => {
    const short: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
        { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-eeeeee"] },
      ],
    };
    const r = report();
    const tree = buildTree(short, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs).toEqual([{ where: "root > child 2", kind: "short" }]);
  });

  it("cascades into the repaired node's own children, which now start one block late", () => {
    // The whole point of repairing on the model's proposal rather than on the
    // built tree: moving a node's start moves its first child's too, and a
    // repair that stopped at one level would trade a broken partition at depth
    // 1 for a broken one at depth 2.
    const nested: ModelNode = {
      ...gapped,
      children: [
        { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
        {
          title: "Second",
          gist: "It closes.",
          range: ["spya-dddddd", "spya-ffffff"],
          children: [
            { title: "Inner one", gist: "A point.", range: ["spya-dddddd", "spya-eeeeee"] },
            { title: "Inner two", gist: "Another.", range: ["spya-ffffff", "spya-ffffff"] },
          ],
        },
      ],
    };
    const r = report();
    const tree = buildTree(nested, {}, BLOCKS, "test", r);
    expect(leafBlocks(tree).sort()).toEqual(BLOCKS.map((b) => b.id).sort());
    expect(r.repairs.map((x) => x.where)).toEqual(["root > child 2", "root > child 2 > child 1"]);
  });

  it("produces a tree the invariants accept, which is the only claim that matters", () => {
    const tree = buildTree(gapped, {}, BLOCKS, "test", report());
    expect(checkTree(BLOCKS, tree).problems).toEqual([]);
  });

  describe("and the bound is one block, in every direction", () => {
    it("still refuses a two-block gap", () => {
      const wide: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-aaaaaa"] },
          { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
        ],
      };
      expect(() => buildTree(wide, {}, BLOCKS, "test", report())).toThrow(/leaves a gap of 2 block/);
    });

    it("still refuses a two-block overlap", () => {
      const wide: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-dddddd"] },
          { title: "Second", gist: "It closes.", range: ["spya-cccccc", "spya-ffffff"] },
        ],
      };
      expect(() => buildTree(wide, {}, BLOCKS, "test", report())).toThrow(/overlaps the one before/);
    });

    it("still refuses a last child that stops two blocks short", () => {
      const wide: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
          { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-dddddd"] },
        ],
      };
      expect(() => buildTree(wide, {}, BLOCKS, "test", report())).toThrow(/stop 2 block\(s\)/);
    });

    it("does not repair an overlap that would leave the node covering nothing", () => {
      // Child 2 is a single block, and it is the one child 1 already ate. There
      // is no snap that leaves it non-empty, so this stays a refusal rather
      // than becoming a range that runs backwards two lines later.
      const swallowed: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
          { title: "Second", gist: "A point.", range: ["spya-cccccc", "spya-cccccc"] },
          { title: "Third", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
        ],
      };
      expect(() => buildTree(swallowed, {}, BLOCKS, "test", report())).toThrow(/overlaps the one before/);
    });

    it("leaves an invented id to the error that names it, rather than guessing", () => {
      const invented: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-bbbbbb"] },
          { title: "Second", gist: "It closes.", range: ["spya-zzzzzz", "spya-ffffff"] },
        ],
      };
      expect(() => buildTree(invented, {}, BLOCKS, "test", report())).toThrow(/not in blocks\.json/);
    });

    it("records nothing when the model tiled the article correctly", () => {
      const sound: ModelNode = {
        ...gapped,
        children: [
          { title: "First", gist: "It opens.", range: ["spya-aaaaaa", "spya-cccccc"] },
          { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
        ],
      };
      const r = report();
      expect(() => buildTree(sound, {}, BLOCKS, "test", r)).not.toThrow();
      expect(r.repairs).toEqual([]);
    });
  });
});

describe("a sourceHeading no block backs up is dropped, not thrown on", () => {
  /**
   * `sourceHeading` is provenance, not structure. Its only consumer is the `§`
   * badge that tells the reader "the author wrote this heading, we did not" —
   * src/web/TableView.tsx, src/web/ContextList.tsx, src/web/Spine.tsx. So an
   * unbacked claim is a badge that would lie, and dropping it costs the reader
   * a mark of provenance where throwing costs them the article.
   *
   * Four structure calls in four made the same wrong claim on the same
   * article, so throwing on it is not an occasional loss — it is a guaranteed
   * failure loop for that document.
   */
  const claiming = (heading: string): ModelNode => ({
    title: "Whole piece",
    gist: "The article argues something.",
    range: ["spya-aaaaaa", "spya-ffffff"],
    children: [
      {
        title: "First",
        gist: "It opens.",
        range: ["spya-aaaaaa", "spya-cccccc"],
        sourceHeading: heading,
      },
      { title: "Second", gist: "It closes.", range: ["spya-dddddd", "spya-ffffff"] },
    ],
  });

  it("keeps a claim the node's range really contains", () => {
    const r = report();
    const tree = buildTree(claiming("The First Part"), {}, BLOCKS, "test", r);
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBe("The First Part");
    expect(r.droppedHeadings).toEqual([]);
  });

  it("keeps a claim that differs only in punctuation, as the invariant does", () => {
    // `sameHeading` normalises curly quotes and dashes — a model quoting a
    // heading back with the wrong apostrophe broke this once already
    // (docs/postmortems/toc-max-tokens.md).
    const tree = buildTree(claiming("The First Part"), {}, BLOCKS, "test", report());
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBe("The First Part");
  });

  it("drops a claim for a heading that is outside the node's range", () => {
    const r = report();
    const tree = buildTree(claiming("The Second Part"), {}, BLOCKS, "test", r);
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBeUndefined();
    expect(r.droppedHeadings).toEqual(["root > child 1"]);
  });

  it("drops a claim for a heading that is nowhere in the article", () => {
    const tree = buildTree(claiming("A Heading Nobody Wrote"), {}, BLOCKS, "test", report());
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first?.sourceHeading).toBeUndefined();
  });

  it("keeps the node and its title — only the provenance mark goes", () => {
    const tree = buildTree(claiming("A Heading Nobody Wrote"), {}, BLOCKS, "test", report());
    const first = Object.values(tree.nodes).find((n) => n.title === "First");
    expect(first).toBeDefined();
    expect(first?.range).toEqual(["spya-aaaaaa", "spya-cccccc"]);
  });

  it("leaves nothing for the invariant to fail on, which is the point", () => {
    // The repair is deliberately at least as strict as `checkTree`'s own rule:
    // it reads the same `sameHeading` over the same range, so anything it keeps
    // the invariant keeps too. That is what makes this a repair rather than a
    // second opinion.
    const tree = buildTree(claiming("The Second Part"), {}, BLOCKS, "test", report());
    const problems = checkTree(BLOCKS, tree).problems.filter((p) => p.includes("sourceHeading"));
    expect(problems).toEqual([]);
  });

  it("ignores a claim that is not a string at all", () => {
    const bad = claiming("x");
    (bad.children![0] as { sourceHeading?: unknown }).sourceHeading = 42;
    expect(() => buildTree(bad, {}, BLOCKS, "test", report())).not.toThrow();
  });
});

```
