# Review the code of stage 1, not the plan

This is the **code review** of stage 1 of docs/plans/faster-ingest-and-concurrency.md. You reviewed
the plan earlier and opened with "STOP. Do not build this plan as written"; every P0 you raised was
checked in the code and held, and the plan was recut around them. **Weight this review higher than
that one** — a plan-stage review cannot find a guard that writes one field and then rejects the
request.

Be adversarial. Rank findings. Say what is wrong, what will bite, and what is missing. Some of your
findings will be wrong and I will check each one, so prefer a specific claim I can falsify over a
hedge.

## What stage 1 was for

Two live bugs on the ToC path, both costing real readers, both independent of the design work that
follows.

**1a — the fixture answered to every name.** `candidateDirs` in src/api.ts appended the committed
`example/` directory to the candidate list for *every* slug, so any article without both
`blocks.json` and `tree.json` was served the fixture's prose under the reader's own address with a
200. That covers a slug that does not exist, a path-traversal probe, and — the one that made it
urgent — an article whose blocks are written and whose tree is not, which a later stage makes a
normal few seconds of every ingest. This is the fallback that once hid a path traversal: nothing
about the fixture's 200 distinguishes it from a correct refusal.

**1b — three ways the ToC stage threw away work it had already paid for.**

1. A production ingest failed twice on a 244-block article with *"Nav labels: this call asked for 58
   labels and got 57, missing 4. Nothing has been written."* `missing` is a **list of ordinals, not
   a count** (src/labels.ts:840), so one label was absent, not four; the message read as an
   arithmetic contradiction and cost an hour. Underneath, stage 3 strips that article's 80 Wolfram
   code cells to empty non-gistable `<p>`s, leaving 15 bare lead-in fragments — one is the single
   word "or". The label prompt demands 6-20 words that are "a CLAIM or a MOVE" and forbids
   introducing a fact not in the paragraph; for those blocks that is jointly unsatisfiable, so the
   model skips, every time. The retry was byte-identical because the cause is one line of the input,
   not sampling.
2. `COVERAGE_FLOOR` was tightened from 0.95 to 1 in the same commit that introduced the message
   (051bc0a), on the stated argument *"There is no longer a path by which a block is legitimately
   unlabelled."* That argument was true about the code and silently depended on an unstated
   assumption about the data. This failure is that path.
3. `repairedChildRanges` in src/toc.ts repaired a tiling gap or overlap only when it was exactly one
   block (`Math.abs(lo - cursor) === 1`), with the comment *"Two blocks out is not a slip, it is a
   different reading of the article, and it still throws."* A headingless arXiv PDF failed on
   production with a gap of **three** — one call, completed, $0.1617, article lost. The bound had
   been fitted to four observations, all off by one, all from HTML articles with headings.

## The decisions behind it, so you review the build and not the brief

- **Greg, on gaps:** *"for now, we should allow gaps. It's not ideal, but it's not the end of the
  world, and better than things failing fatally. Perhaps in future, it should trigger a re-run of the
  LLM, where we feed in the previous output, with information about the gaps and ask it to adjust."*
  I read "allow gaps" as **snap them shut at any size and report the size**, not as leaving blocks
  uncovered — a block in no node is unreachable in granularity zoom, so the prose would be on the
  page with nothing able to address it. Tell me if that reading is wrong.
- Partial-accept of a short label batch is bounded per batch at `k = max(1, ceil(0.02 * N))`,
  mirroring how the earlier R2 repair was bounded per answer after your review.

## What I most want challenged

1. **Is the partial-accept safe, or is it a silent success?** An unlabelled leaf renders as *nothing*
   rather than as an error. The mitigation is that the drop is counted and reported. Is the counting
   actually reachable, actually correct, and actually visible — or does it have the shape of a guard
   that cannot fire? Check `MAX_REPAIRED_BOUNDARIES` too: it bounded *distinct boundaries per answer*
   and was a separate protection from the per-repair size bound that has now gone. Does it still do
   anything useful?
2. **Does removing the tiling bound let something genuinely wrong through?** Specifically: can a
   snap now produce a node covering no blocks, a backwards range, or a tree that passes `checkTree`
   while describing a different article? The old bound was doing part of that work.
3. **Did the comments keep up with the code?** Two constants here had comments arguing for the value
   they used to have — that is precisely how `token-budget.ts` came to assert that `src/toc.ts` had
   moved to `effort: "medium"` when it had not, which misled two sessions today. Flag any comment
   that now describes a rule that is gone, in either direction.
4. **Is 1a's blast radius complete or over-wide?** Four sibling modules documented the old fallback
   and one, src/searches.ts, mirrored it in code. Did anything get missed, and did anything get
   changed that did not need to?

## Verification already done, so you can spend your effort elsewhere

`npm test`, `npm run typecheck`, `npm run check`. The suite is noisy because several agents share one
local database: its failure set **moves** between runs and every transient member passes in
isolation. Failures not attributable to this work: tests/store-shelf-reads.test.ts,
tests/store-artefact-manifest.test.ts, and intermittently tests/chat-tools.test.ts,
tests/run-lock.test.ts, tests/store-parity.test.ts, tests/auth-callback.test.ts, tests/doc-links.test.ts,
tests/fixture-ids.test.ts.

## What actually landed, and the four things I most want you to attack

Since the head of this prompt was drafted, the work finished and changed shape. The diff is below.

1. **`detectShift` and the partial accept.** `detectShift` runs *after* the parse, so a short answer
   skipped it. The partial accept makes that the one path where a short answer survives — and it was
   the one path with no shift check. Reproduced: it resolved with nineteen labels each describing the
   *following* paragraph, nothing red. `acceptGap` now runs `detectShift` on exactly the set it keeps.
   **Is that guard placed correctly and is it complete?** Consider the merged set from two calls, and
   whether `MIN_SHIFT_EVIDENCE` can make it a no-op on a small gap.
2. **The tiling bound is gone from both places** — the loop and the tail (`cursor === parent[1]`).
   Any-size snapping. `cursor <= hi` still refuses to repair a child into nothing.
   **Can a snap now produce a node covering no blocks, a backwards range, or a tree that passes
   `checkTree` while describing a different article?** The old bound was doing part of that work.
3. **The reporting is the whole of what replaced the bound.** `PartitionRepair.size` →
   `TocRun.repairedBlocks` and `largestRepair`, CLI, pipeline log; `LabelRun.dropped` → `labels.json`,
   `TocRun.labelsDropped`. **Is any of that unreachable, wrong, or capable of reading zero when it
   should not?** A count that cannot fire is worse than no count, because it licenses the change.
4. **Two ways an article can still be lost, left open deliberately.** Two independent slipped
   boundaries (`MAX_REPAIRED_BOUNDARIES`, still 1, still fitted to four HTML-with-headings
   observations); and a child its neighbour entirely swallowed. **Are these the right two to leave,
   and is there a third I have not noticed?**

Also worth your attention: three tests that asserted refusals now assert the invariant they were
protecting instead; `evals/toc-structure/run.ts` had to be told about repair *size*, because it
recorded counts and scored a one-paragraph slip the same as a forty-block one. If you can find a
third place where a repair silently redefines its own measurement, that is the most valuable thing
you could return.

## The diff


```diff
commit 0062f74901ec655700bfe619c57b32b7bd401a65
Author: Greg Detre <greg@gregdetre.com>
Date:   Sun Aug 30 22:56:32 2026 +0300

    Three ways the stage threw away work it had already paid for
    
    Greg pasted a Wolfram article and the ToC died twice on "asked for 58
    labels and got 57, missing 4". The numbers add up: missing is a LIST of
    ordinals, not a count, so one label was absent, not four. The message cost
    an hour and a wrong hypothesis before anyone read the line that prints it.
    
    Underneath, stage 3 strips that article eighty Wolfram code cells to empty
    paragraphs, leaving fifteen bare lead-ins pointing at nothing; one is the
    single word "or". The prompt asks for 6-20 words that are a CLAIM or a MOVE
    and forbids introducing a fact not in the paragraph. For those blocks that
    is jointly unsatisfiable, so the model skips, and no retry can change it.
    
    So: say what the number is, re-ask for the gap alone rather than re-buying
    the batch, and keep 57 of 58 rather than binning the call. COVERAGE_FLOOR
    goes back to 0.95 with all three versions of its argument written down --
    the 1-era claim that "there is no longer a path by which a block is
    legitimately unlabelled" was true about the code and rested on an unstated
    assumption about the data, and this failure is that path.
    
    The same argument answers a headingless arXiv paper that died on a tiling
    gap of three: one completed call, $0.1617, article lost. The repair was
    bounded at one block, fitted to four observations that all came from HTML
    articles with headings. Greg: allow gaps, better than failing fatally. So
    the bound goes -- from both places it lived, since the tail had its own copy
    and would have mended a gap of forty mid-article while refusing two at the
    end -- and the size of every repair is now reported, because that is all
    that stands where the bound used to.
    
    The thing worth reading is what the partial accept nearly did. detectShift
    runs after the parse, so a short answer skipped it; the accept would have
    made that the one path where a short answer survives and the one path with
    no shift check on it. It resolved with nineteen labels each describing the
    following paragraph. Nothing red. Found by going to look, not by a failure.
    
    And the eval had to be told, again: run.ts recorded repair counts and no
    size, so one boundary a paragraph out and a section handed forty of its
    neighbour blocks both scored ok. Second time this evening that a repair
    inside the thing under measurement silently redefined the measurement.
    
    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01GqAjazpGq85RExHJG8Exyp

 docs/plans/faster-ingest-and-concurrency.md        | 335 +++++++++++--
 docs/postmortems/nav-labels-asked-58-got-57.md     | 172 +++++++
 docs/project/table-of-contents.md                  |  87 +++-
 docs/research/opening-an-article-before-the-toc.md |   7 +
 evals/toc-labels.ts                                |  31 +-
 evals/toc-structure/run.ts                         |  24 +-
 src/labels.ts                                      | 546 ++++++++++++++++++---
 src/pipeline.ts                                    |  37 +-
 src/toc.ts                                         | 248 ++++++++--
 tests/labels-batching.test.ts                      |  51 +-
 tests/labels-shortfall.test.ts                     | 371 ++++++++++++++
 tests/toc-build.test.ts                            |  78 ++-
 tests/toc-repairs.test.ts                          |  94 +++-
 tests/toc-structure-eval.test.ts                   |  17 +-
 tests/toc-write-guard.test.ts                      |   5 +
 15 files changed, 1897 insertions(+), 206 deletions(-)

commit 0062f74901ec655700bfe619c57b32b7bd401a65
Author: Greg Detre <greg@gregdetre.com>
Date:   Sun Aug 30 22:56:32 2026 +0300

    Three ways the stage threw away work it had already paid for
    
    Greg pasted a Wolfram article and the ToC died twice on "asked for 58
    labels and got 57, missing 4". The numbers add up: missing is a LIST of
    ordinals, not a count, so one label was absent, not four. The message cost
    an hour and a wrong hypothesis before anyone read the line that prints it.
    
    Underneath, stage 3 strips that article eighty Wolfram code cells to empty
    paragraphs, leaving fifteen bare lead-ins pointing at nothing; one is the
    single word "or". The prompt asks for 6-20 words that are a CLAIM or a MOVE
    and forbids introducing a fact not in the paragraph. For those blocks that
    is jointly unsatisfiable, so the model skips, and no retry can change it.
    
    So: say what the number is, re-ask for the gap alone rather than re-buying
    the batch, and keep 57 of 58 rather than binning the call. COVERAGE_FLOOR
    goes back to 0.95 with all three versions of its argument written down --
    the 1-era claim that "there is no longer a path by which a block is
    legitimately unlabelled" was true about the code and rested on an unstated
    assumption about the data, and this failure is that path.
    
    The same argument answers a headingless arXiv paper that died on a tiling
    gap of three: one completed call, $0.1617, article lost. The repair was
    bounded at one block, fitted to four observations that all came from HTML
    articles with headings. Greg: allow gaps, better than failing fatally. So
    the bound goes -- from both places it lived, since the tail had its own copy
    and would have mended a gap of forty mid-article while refusing two at the
    end -- and the size of every repair is now reported, because that is all
    that stands where the bound used to.
    
    The thing worth reading is what the partial accept nearly did. detectShift
    runs after the parse, so a short answer skipped it; the accept would have
    made that the one path where a short answer survives and the one path with
    no shift check on it. It resolved with nineteen labels each describing the
    following paragraph. Nothing red. Found by going to look, not by a failure.
    
    And the eval had to be told, again: run.ts recorded repair counts and no
    size, so one boundary a paragraph out and a section handed forty of its
    neighbour blocks both scored ok. Second time this evening that a repair
    inside the thing under measurement silently redefined the measurement.
    
    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01GqAjazpGq85RExHJG8Exyp

diff --git a/src/labels.ts b/src/labels.ts
index 361e50a..e619cc8 100644
--- a/src/labels.ts
+++ b/src/labels.ts
@@ -65,14 +65,41 @@ const PROMPT_VERSION = "labels/1";
  *
  * Everything else — a malformed shape, a duplicate, an empty string — is a
  * plain `Error` and is not retried. Those do not get better on a second ask.
+ *
+ * **`shortfall` is what makes the two retries different.** A truncated response
+ * has nothing to keep and no way to say what is absent, so the answer to it is
+ * room to think and the whole batch again. A well-formed answer that skipped a
+ * paragraph knows exactly which one, and carries the labels it *did* write — so
+ * the answer to it is to ask for the gap alone. Absent on every other failure,
+ * which is precisely how `generateLabels` tells them apart.
  */
+export interface Shortfall {
+  /** Block id → label, for the paragraphs the model did answer about. */
+  partial: Record<string, string>;
+  /** Call-local ordinals with no label, in order. */
+  missing: number[];
+  /**
+   * What the call cost — **attached by `runBatch`, not by the parser.**
+   *
+   * A parser has no idea what was spent, so it cannot fill this in, and an
+   * incomplete answer is still a paid one. Optional for that reason and for no
+   * other: absent means a parser threw on its own, which happens in tests and
+   * nowhere else.
+   */
+  record?: LabelBatchRecord;
+}
+
 export class BatchIncomplete extends Error {
-  constructor(message: string) {
+  readonly shortfall: Shortfall | undefined;
+
+  constructor(message: string, shortfall?: Shortfall) {
     super(message);
     this.name = "BatchIncomplete";
+    this.shortfall = shortfall;
   }
 }
 
+
 /**
  * How hard the model thinks per batch.
  *
@@ -266,6 +293,18 @@ export interface LabelsFile {
    * seam boundaries and cost figures that nothing ever measured.
    */
   batches: LabelBatchRecord[] | null;
+  /**
+   * Blocks the run gave up on — **optional, because most files predate it.**
+   *
+   * Absent and empty mean different things and both are fine here: absent is a
+   * file written before there was such a thing as a dropped label, empty is a
+   * run that dropped none. Nothing branches on the difference; what reads it is
+   * evals/toc-labels.ts, which without this field can only see coverage below 1
+   * and call it INCOMPLETE — a repair inside the code under measurement
+   * silently redefining the measurement, which is the mistake the R2/R3 build
+   * made and wrote down. See `LabelRun.dropped`.
+   */
+  dropped?: string[];
 }
 
 /**
@@ -763,6 +802,36 @@ function describeShape(value: unknown): string {
   return `a ${typeof value}`;
 }
 
+/**
+ * Paragraph numbers, named as paragraph numbers.
+ *
+ * **This wording cost a day of investigation.** A production ingest of a
+ * 244-block article failed on 2026-08-30 with *"this call asked for 58 labels
+ * and got 57, missing 4"*, and every reader of that sentence — including the
+ * plan written from it — read the last number as a count. 58 minus 57 is one,
+ * so the message looked self-contradictory and an investigation went after
+ * arithmetic that had been right all along. It was the ordinal of the one
+ * paragraph with no label.
+ *
+ * So the numbers are announced as what they are, the singular is said out loud
+ * where there is one of them, and the truncation to five carries the total —
+ * "five names and nothing else" has exactly the same ambiguity in its other
+ * direction, because nothing in it says whether five is all of them.
+ * docs/plans/faster-ingest-and-concurrency.md § Stage 1b.
+ *
+ * Ordinals are safe to interpolate. They are integers this file generated from
+ * the batch's own length, never a value read out of the model's response as
+ * text — see `nameValue` in src/toc.ts for the rule and why it matters here.
+ */
+function paragraphList(ns: number[]): string {
+  const shown = ns.slice(0, 5).join(", ");
+  const rest = ns.length - Math.min(ns.length, 5);
+  return (
+    `paragraph${ns.length === 1 ? "" : "s"} ${shown}` +
+    (rest > 0 ? ` and ${rest} others (${ns.length} in all)` : "")
+  );
+}
+
 /**
  * Turn the model's pairs back into block ids, refusing anything that does not
  * match the batch exactly.
@@ -796,6 +865,91 @@ function describeShape(value: unknown): string {
  * It is simply not what gets stored.
  */
 export function parseLabels(raw: string, batch: Batch): Record<string, string> {
+  const seen = readPairs(raw);
+  const expected = batch.blocks.length;
+  const wanted = Array.from({ length: expected }, (_, i) => i + 1);
+  const missing = wanted.filter((n) => !seen.has(n));
+  const extra = [...seen.keys()].filter((n) => n < 1 || n > expected);
+
+  if (missing.length > 0 || extra.length > 0) {
+    throw new BatchIncomplete(
+      `Nav labels: this call asked for ${expected} labels and got ${seen.size}` +
+        (missing.length ? `, missing ${paragraphList(missing)}` : "") +
+        (extra.length
+          ? `, and ${paragraphList(extra)} ${extra.length === 1 ? "was" : "were"} not asked for`
+          : "") +
+        `. Nothing has been written.`,
+      /* What the call did produce, carried on the error rather than lost with
+         it. Everything above this line is unchanged; this is the whole of what
+         makes a shortfall answerable — see `Shortfall`, and `runShortfall` for
+         what is then asked. `extra` deliberately does not get one: an answer
+         with numbers nobody asked for is a model working from something other
+         than this batch, and picking the in-range half out of it would be
+         guessing which half. */
+      extra.length === 0
+        ? { partial: onto(seen, batch, wanted.filter((n) => seen.has(n))), missing }
+        : undefined,
+    );
+  }
+
+  return onto(seen, batch, wanted);
+}
+
+/**
+ * The same wire format, for the re-ask that names its own paragraphs.
+ *
+ * `wanted` is the gap rather than 1…N, and everything else holds: an exact set,
+ * checked, or a `BatchIncomplete` naming what is still absent.
+ *
+ * **In-range numbers outside `wanted` are ignored rather than refused**, and
+ * that is the one place this is looser than `parseLabels`. A model asked to
+ * write the label for paragraph 4 quite often writes the whole section out
+ * again; refusing that answer would throw away the very label we came back for
+ * and drop it instead. The looseness is safe *here* and nowhere else, because
+ * ordinals map to blocks positionally — an extra pair for paragraph 9 can only
+ * overwrite paragraph 9's label, never shift another. Out-of-range numbers are
+ * still a refusal, for the reason `parseLabels` gives.
+ */
+export function parseShortfall(
+  raw: string,
+  batch: Batch,
+  wanted: number[],
+): Record<string, string> {
+  const seen = readPairs(raw);
+  const expected = batch.blocks.length;
+  const missing = wanted.filter((n) => !seen.has(n));
+  const extra = [...seen.keys()].filter((n) => n < 1 || n > expected);
+
+  if (missing.length > 0 || extra.length > 0) {
+    throw new BatchIncomplete(
+      `Nav labels: this call asked again for ${wanted.length} of the batch's ${expected} labels ` +
+        `and got ${seen.size}` +
+        (missing.length ? `, still missing ${paragraphList(missing)}` : "") +
+        (extra.length
+          ? `, and ${paragraphList(extra)} ${extra.length === 1 ? "was" : "were"} not asked for`
+          : "") +
+        `.`,
+      /* Whatever the re-ask *did* answer is still worth having: two paragraphs
+         missing and one repaired is one dropped, not two. Only the ordinals
+         that were asked for, so a model that rewrote the whole section cannot
+         quietly replace labels the first call already got right. */
+      extra.length === 0
+        ? { partial: onto(seen, batch, wanted.filter((n) => seen.has(n))), missing }
+        : undefined,
+    );
+  }
+
+  return onto(seen, batch, wanted);
+}
+
+/**
+ * The pairs, validated as pairs. Says nothing about *which* numbers are owed.
+ *
+ * Split out of `parseLabels` when the shortfall re-ask arrived, so that the two
+ * callers cannot disagree about the wire format — which is the failure a second
+ * hand-written parser produces, and it produces it silently.
+ */
+function readPairs(raw: string): Map<number, string> {
   /* `stripFence` then `parseJsonFrom`, never bare `JSON.parse`. The reasoning
      that used to sit here — including that `redact` is path-based and so reaches
      neither the message nor the stack, and that src/toc.ts learned this before
@@ -828,23 +982,20 @@ export function parseLabels(raw: string, batch: Batch): Record<string, string> {
     if (seen.has(n)) throw new Error(`Nav labels: paragraph ${n} was labelled twice`);
     seen.set(n, label.trim());
   }
+  return seen;
+}
 
-  const expected = batch.blocks.length;
-  const missing = [];
-  for (let n = 1; n <= expected; n++) if (!seen.has(n)) missing.push(n);
-  const extra = [...seen.keys()].filter((n) => n < 1 || n > expected);
-
-  if (missing.length > 0 || extra.length > 0) {
-    throw new BatchIncomplete(
-      `Nav labels: this call asked for ${expected} labels and got ${seen.size}` +
-        (missing.length ? `, missing ${missing.slice(0, 5).join(", ")}` : "") +
-        (extra.length ? `, and ${extra.slice(0, 5).join(", ")} were not asked for` : "") +
-        `. Nothing has been written.`,
-    );
-  }
-
+/** Ordinals onto block ids — and a heading's label read off the block, never the model. */
+function onto(
+  seen: Map<number, string>,
+  batch: Batch,
+  ordinals: number[],
+): Record<string, string> {
   return Object.fromEntries(
-    batch.blocks.map((b, i) => [b.id, isHeading(b) ? b.text : seen.get(i + 1)!]),
+    ordinals.map((n) => {
+      const b = batch.blocks[n - 1]!;
+      return [b.id, isHeading(b) ? b.text : seen.get(n)!];
+    }),
   );
 }
 
@@ -1035,16 +1186,31 @@ export function mergeLabels(tree: Tree, labels: Record<string, string>): Tree {
 export function assertEveryBlockLabelled(
   labels: Record<string, string>,
   blocks: Block[],
+  /**
+   * Blocks a batch consciously gave up on — see `acceptGap`, which is the only
+   * thing allowed to put an id in here, and only after two calls have failed to
+   * label it and the gap has been measured against the batch's budget.
+   *
+   * **The gate is unchanged for everything else, and that is the point of
+   * passing the list rather than a count.** A block with no label and no reason
+   * on record is still the failure this function was written for — a gap
+   * *between* batches, which no per-batch check can see. Taking a number here
+   * would have made "one block lost in the seams" and "one block the model
+   * refused" the same thing, and they need opposite responses.
+   */
+  dropped: string[] = [],
 ): void {
-  const missing = blocks.filter((b) => isStructural(b) && !labels[b.id]);
+  const allowed = new Set(dropped);
+  const missing = blocks.filter((b) => isStructural(b) && !labels[b.id] && !allowed.has(b.id));
   if (missing.length === 0) return;
   const wanted = blocks.filter((b) => isStructural(b)).length;
   throw new Error(
-    `The nav labels cover ${wanted - missing.length} of ` +
+    `The nav labels cover ${wanted - missing.length - allowed.size} of ` +
       `${wanted} paragraphs — ${missing.length} came back ` +
-      `without one (${missing.slice(0, 3).map((b) => b.id).join(", ")}). Every batch is checked ` +
-      `against the exact set it was asked about, so this is a gap between the batches rather ` +
-      `than inside one. Nothing has been written.`,
+      `without one (${missing.slice(0, 3).map((b) => b.id).join(", ")}), and no batch reported ` +
+      `dropping ${missing.length === 1 ? "it" : "them"}. Every batch is checked against the ` +
+      `exact set it was asked about, so this is a gap between the batches rather than inside ` +
+      `one. Nothing has been written.`,
   );
 }
 
@@ -1054,6 +1220,19 @@ export interface LabelRun {
   batches: number;
   /** Sibling sets bigger than one call should be. Worth saying out loud; see `oversizedSets`. */
   oversized: number;
+  /**
+   * Blocks this run gave up on, in document order — **usually empty, and it has
+   * to be looked at anyway.**
+   *
+   * A dropped block is a leaf with no `navLabel`, and that renders as *nothing*:
+   * the outline skips the row (src/web/outline.ts), the spine draws an empty
+   * string. There is no error, no gap, no mark. So the only place a reader of
+   * this system can find out that an article quietly lost ten labels is this
+   * number, which is why `acceptGap` exists on the condition that every caller
+   * reports it — the CLI prints it, the pipeline logs it, `labels.json` records
+   * it, and the eval reads it from there. docs/reusable/silent-success.md.
+   */
+  dropped: string[];
   /**
    * Batches taken from a checkpoint instead of being asked for again.
    *
@@ -1115,15 +1294,32 @@ export interface LabelRun {
   clearCheckpoint: () => Promise<void>;
 }
 
+/**
+ * One call: the batch, or — when `only` is given — the gap left by the last one.
+ *
+ * **The shortfall re-ask sends the same two parts plus a third**, rather than
+ * building a smaller batch out of the missing blocks. Two reasons, and the first
+ * is the rule the whole stage rests on: a label's job is to tell its paragraph
+ * apart from its neighbours, so the model has to see the neighbours, and a
+ * batch of one paragraph is exactly the shape that cannot. The second is the
+ * cache — the shared prefix is byte-identical to the first attempt's, so the
+ * re-ask reads it rather than writing a new one.
+ *
+ * What it saves is therefore the *answer*, not the question: the reasoning and
+ * the output for fifty-seven labels already bought. That is the honest
+ * accounting, and it is worth having — output is where a label batch's cost and
+ * its whole latency sit.
+ */
 async function runBatch(
   batch: Batch,
   blocks: Block[],
   outline: string,
   signal: AbortSignal | undefined,
   headroom: number,
+  only?: number[],
 ): Promise<{ labels: Record<string, string>; record: LabelBatchRecord }> {
   const started = Date.now();
-  const answerTokens = 200 + batch.blocks.length * 55;
+  const answerTokens = 200 + (only ?? batch.blocks).length * 55;
   const maxTokens = budgetFor("nav labels", answerTokens, headroom);
   const { shared, own } = batchParts(batch, blocks, outline);
 
@@ -1171,6 +1367,10 @@ async function runBatch(
             content: [
               { type: "text" as const, text: shared, cache_control: { type: "ephemeral" as const } },
               { type: "text" as const, text: own },
+              /* The re-ask, last, so the two parts above stay byte-identical to
+                 the attempt that just failed — the first of them is the cached
+                 prefix, and a third part appended after it cannot disturb that. */
+              ...(only ? [{ type: "text" as const, text: renderShortfall(only) }] : []),
             ],
           },
         ],
@@ -1222,20 +1422,192 @@ async function runBatch(
     );
   }
 
-  const labels = parseLabels(raw, batch);
+  /* Built before the parse, because a call that answered about most of the
+     batch still cost what it cost. Without this the tokens of a shortfall's
+     first attempt would vanish from `labels.json` and from the run's figures —
+     the ledger would still have them (src/ai-spend.ts records at the wire), so
+     the artefact and the bill would disagree, quietly, on exactly the runs
+     where somebody is looking. */
+  const record: LabelBatchRecord = {
+    blocks: batch.blocks.map((b) => b.id),
+    setStarts: batch.setStarts,
+    inputTokens: message.usage.input_tokens,
+    outputTokens: message.usage.output_tokens,
+    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
+    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
+    ms: Date.now() - started,
+  };
+
+  let labels: Record<string, string>;
+  try {
+    labels = only ? parseShortfall(raw, batch, only) : parseLabels(raw, batch);
+  } catch (err) {
+    if (err instanceof BatchIncomplete && err.shortfall) {
+      throw new BatchIncomplete(err.message, { ...err.shortfall, record });
+    }
+    throw err;
+  }
+  /* Not on the re-ask. `detectShift` needs `MIN_SHIFT_EVIDENCE` labels before
+     it will vote at all, so a call that answered about one paragraph could only
+     ever abstain — and the set worth checking is the merged one, which is where
+     `repairShortfall` checks it. */
+  if (!only) detectShift(labels, batch);
+
+  return { labels, record };
+}
+
+/**
+ * The re-ask, as the model reads it.
+ *
+ * Deliberately short and deliberately not an argument. The paragraphs it names
+ * are the ones a compliant model *chose* to skip — on the article this was
+ * built for, a lead-in fragment whose entire text is the word "or", where
+ * "6–20 words, a CLAIM or a MOVE" and "never introduce a fact that is not in
+ * that paragraph" cannot both be obeyed. Prompting harder at that is asking for
+ * an invented fact, so what this says instead is: shorter is fine, the
+ * paragraph's own words are fine, just do not leave it out.
+ */
+export function renderShortfall(missing: number[]): string {
+  return (
+    `Your last answer left out ${paragraphList(missing)}.\n\n` +
+    `Write labels for ONLY ${missing.length === 1 ? "that paragraph" : "those paragraphs"}, ` +
+    `in the same format: {"labels": [[n, "…"]]}, with one pair for each of ` +
+    `${missing.join(", ")} and no others.\n\n` +
+    `If a paragraph is a fragment with little in it, a short label made of its own words is ` +
+    `fine — better than none. Do not invent anything it does not say.`
+  );
+}
+
+/**
+ * Ask again for the paragraphs the last call skipped, and merge the two answers.
+ *
+ * The labels already paid for are kept. That is the whole saving and it is the
+ * whole risk too: a label written in the first call was written beside the
+ * neighbours it has to be told apart from, and one written here was written
+ * beside the same ones, so the two are comparable — which is exactly what would
+ * *not* be true if the re-ask had been given a fresh batch of one paragraph.
+ * `renderShortfall` is appended to the original prompt for that reason.
+ *
+ * `detectShift` runs on the merged set rather than on either half. Neither half
+ * alone can reach `MIN_SHIFT_EVIDENCE`, and the set that matters is the one
+ * about to be written.
+ */
+async function repairShortfall(
+  first: Shortfall,
+  batch: Batch,
+  blocks: Block[],
+  outline: string,
+  signal: AbortSignal | undefined,
+): Promise<{ labels: Record<string, string>; record: LabelBatchRecord }> {
+  /* `LABEL_HEADROOM`, not double it. The reservation is for the model's
+     reasoning about *this answer*, and this answer is a handful of labels —
+     doubling it here would be inheriting a number from a failure this one is
+     not (see the constant's own comment, and docs/postmortems/toc-max-tokens.md
+     on what a roomy reservation does to adaptive thinking). */
+  const again = await runBatch(batch, blocks, outline, signal, LABEL_HEADROOM, first.missing);
+  const labels = { ...first.partial, ...again.labels };
+  detectShift(labels, batch);
+  return { labels, record: sumRecords(batch, [first.record, again.record]) };
+}
+
+/**
+ * How many labels one batch may lose before the batch is a failure.
+ *
+ * **Per batch, not per article**, which is the same shape the R2 repair budget
+ * took after review (docs/plans/toc-repairs-and-heading-tree.md): a bound spread
+ * over a whole article lets one pathological section spend everybody else's
+ * allowance, and the thing being bounded is a model's behaviour on one call.
+ *
+ * Two percent, and a floor of one. The floor is what makes it work at all: two
+ * percent of a 12-block batch rounds to nothing, so without it a small batch
+ * would be held to a stricter rule than a large one for no reason anybody could
+ * defend. Above fifty blocks the percentage takes over — 2 on a batch of 58,
+ * which is the size the article that prompted this produced.
+ *
+ * The article-level backstop is `COVERAGE_FLOOR` in src/toc.ts, and it is not
+ * redundant with this: the composition of an article's batches is invisible from
+ * here, and a piece cut into twenty tiny sibling sets could spend twenty floors
+ * of one and lose a fifth of its labels while every batch stayed inside budget.
+ */
+export function droppedBudget(batchSize: number): number {
+  return Math.max(1, Math.ceil(0.02 * batchSize));
+}
+
+/**
+ * Take a batch with a hole in it — or refuse to, which is the important half.
+ *
+ * Returns `null` unless **both** attempts were shortfalls (so there is a partial
+ * answer to keep and a known gap), and the gap is inside `droppedBudget`. Any
+ * other failure — a truncation, a refusal, a 429, a malformed shape, a detected
+ * shift — has no `shortfall` on it and lands here as `null`, which is the throw.
+ *
+ * **What this re-opens.** `COVERAGE_FLOOR` was tightened to 1 in 2026-08 on the
+ * argument that a block could no longer be legitimately unlabelled; this is the
+ * path that makes that false again, and an unlabelled leaf renders as *nothing*
+ * rather than as an error (src/web/outline.ts skips the row). So the price of it
+ * is that every drop is named, counted, returned on `LabelRun`, written into
+ * `labels.json` and logged by the step — docs/reusable/silent-success.md, and
+ * the "the eval had to be told" lesson applied before rather than after.
+ */
+function acceptGap(
+  first: BatchIncomplete,
+  again: unknown,
+  batch: Batch,
+): { out: { labels: Record<string, string>; record: LabelBatchRecord }; dropped: string[] } | null {
+  if (!first.shortfall) return null;
+  const second = again instanceof BatchIncomplete ? again.shortfall : undefined;
+  /* The re-ask's own partial answer counts. Two paragraphs missing and one of
+     them repaired is one label dropped, not two — and refusing to look would
+     throw away the call we just paid for. */
+  const labels = { ...first.shortfall.partial, ...(second?.partial ?? {}) };
+  const missing = first.shortfall.missing.filter((n) => !(batch.blocks[n - 1]!.id in labels));
+  if (missing.length === 0 || missing.length > droppedBudget(batch.blocks.length)) return null;
+  /**
+   * **And these labels have never been shift-checked.**
+   *
+   * `runBatch` checks after the parse, and on a short answer the parse throws
+   * first — so without this line the one wrong answer `parseLabels` cannot see
+   * arrives by the one path that skips the check that can. Nineteen confident
+   * labels on the wrong nineteen paragraphs, no gap, nothing red: worse than the
+   * failure the accept exists to avoid. It throws rather than returning null,
+   * because "the model lost its place" is a better thing to put in front of
+   * whoever is reading than "it failed twice".
+   *
+   * This is the *only* shift guard on this path, and it was briefly two: a
+   * `LabelsShifted` subclass refused a rescue whenever the re-ask's own merged
+   * check had already found one. It was deleted the same hour, because no
+   * fixture could tell the two apart — the merged set and this one differ by at
+   * most the handful of labels the budget allows, which cannot move a majority
+   * vote — and a clause nothing can redden is a clause nobody can maintain.
+   */
   detectShift(labels, batch);
+  return {
+    out: { labels, record: sumRecords(batch, [first.shortfall.record, second?.record]) },
+    dropped: missing.map((n) => batch.blocks[n - 1]!.id),
+  };
+}
 
+/**
+ * Two calls for one batch, added up.
+ *
+ * The batch is still one batch — `blocks` and `setStarts` describe what was
+ * asked about, not how many requests it took — but the money is the sum, and
+ * `ms` is too. Reporting only the second call's usage would make a batch that
+ * cost twice look cheap in `labels.json` while the ledger recorded the truth,
+ * and the two disagreeing is worse than either number alone.
+ */
+function sumRecords(batch: Batch, parts: (LabelBatchRecord | undefined)[]): LabelBatchRecord {
+  const real = parts.filter((r): r is LabelBatchRecord => r !== undefined);
+  const total = (pick: (r: LabelBatchRecord) => number): number =>
+    real.reduce((n, r) => n + pick(r), 0);
   return {
-    labels,
-    record: {
-      blocks: batch.blocks.map((b) => b.id),
-      setStarts: batch.setStarts,
-      inputTokens: message.usage.input_tokens,
-      outputTokens: message.usage.output_tokens,
-      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
-      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
-      ms: Date.now() - started,
-    },
+    blocks: batch.blocks.map((b) => b.id),
+    setStarts: batch.setStarts,
+    inputTokens: total((r) => r.inputTokens),
+    outputTokens: total((r) => r.outputTokens),
+    cacheReadTokens: total((r) => r.cacheReadTokens),
+    cacheWriteTokens: total((r) => r.cacheWriteTokens),
+    ms: total((r) => r.ms),
   };
 }
 
@@ -1247,6 +1619,13 @@ async function runBatch(
  * paper over a bad estimate: it is there because one flaky call should not throw
  * away nine good ones and ten minutes of a book. A second failure throws, and
  * the message says which half of the budget overran.
+ *
+ * A batch that comes back *short* — well-formed, and quietly about fewer
+ * paragraphs than it was asked about — takes the other route: `repairShortfall`
+ * asks again for the gap alone, and if that fails too `acceptGap` may keep the
+ * batch and leave a bounded number of leaves bare. Whatever it leaves bare comes
+ * back in `dropped`, and every caller of this function is expected to say so out
+ * loud.
  */
 export async function generateLabels(opts: {
   tree: Tree;
@@ -1358,6 +1737,10 @@ export async function generateLabels(opts: {
 
   let done = 0;
   let resumed = 0;
+  /* Blocks a batch gave up on, from any batch, in whatever order the parallel
+     calls finish. Sorted into document order before it leaves this function —
+     a list whose order depends on the race is a list nobody can diff. */
+  const dropped: string[] = [];
   const report = (): void =>
     opts.onProgress?.(`${done} of ${batches.length} sections labelled`);
   report();
@@ -1404,7 +1787,19 @@ export async function generateLabels(opts: {
              as a rarer, stranger failure rather than as anything red. */
           if (!(err instanceof BatchIncomplete)) throw err;
           try {
-            out = await runBatch(batch, opts.blocks, outline, signal, LABEL_HEADROOM * 2);
+            /* **Two failures, two different retries**, and until 2026-08-30 they
+               shared one. A truncation has nothing to keep and no idea what is
+               absent, so the answer is room to think and the whole batch again.
+               A well-formed answer that skipped a paragraph knows exactly which
+               one — and re-buying the other fifty-seven to get it has now failed
+               to help three times on record, byte-identically, because
+               completions are never cached and `batchFingerprint` excludes
+               `max_tokens` so the retry sends the same bytes. A short answer is
+               the only failure that carries a `shortfall`, and that is what this
+               branch reads — not the message, and not the error's name. */
+            out = err.shortfall
+              ? await repairShortfall(err.shortfall, batch, opts.blocks, outline, signal)
+              : await runBatch(batch, opts.blocks, outline, signal, LABEL_HEADROOM * 2);
           } catch (again) {
             /* An abort is not a second model failure and must not be dressed as
                one. If another batch has already ended the run, or the caller
@@ -1412,28 +1807,40 @@ export async function generateLabels(opts: {
                whoever reads the log a truncation story about a call that never
                happened. Rethrown as itself. GPT-5.6-sol, 2026-08-26. */
             if (signal.aborted) throw again;
-            /* Both attempts, whatever the second one was. They are often
-               different failures — a truncation carries the two budget figures
-               that say which half overran, and losing it because the retry came
-               back one label short instead would throw away the only evidence
-               worth having.
-               The first version guarded this with `if (!(again instanceof
-               BatchIncomplete)) throw again`, which meant a retry that hit a
-               refusal, a 429 or a malformed shape still discarded the first
-               error — the one case where the two messages differ most. Caught by
-               GPT-5.6-sol, 2026-08-26. There is no reason to special-case the
-               second failure's type: what the reader needs is both. */
-            throw new Error(
-              `The nav labels for one section failed twice.\n` +
-                `  First attempt: ${err.message}\n` +
-                `  After a retry with double the reasoning allowance: ` +
-                `${again instanceof Error ? again.message : String(again)}`,
-            );
-            /* No `cause`. src/log.ts follows cause chains, and src/parse-json.ts
-               spells out why that matters here: an attached original error puts
-               whatever it quoted straight back into the log line under a
-               different key. Both messages are already in the text above, which
-               is the part worth keeping. */
+            /* **The bounded partial accept**, and it happens here rather than
+               anywhere earlier on purpose: only at this line have both a full
+               draw and a re-ask for the gap alone failed to produce a label, so
+               only here is "the model will not write this one" a conclusion
+               rather than a guess. `acceptGap` returns null when the gap is
+               bigger than a batch is allowed to lose, and the throw below is
+               then the same one it always was. */
+            const accepted = acceptGap(err, again, batch);
+            if (!accepted) {
+              /* Both attempts, whatever the second one was. They are often
+                 different failures — a truncation carries the two budget figures
+                 that say which half overran, and losing it because the retry came
+                 back one label short instead would throw away the only evidence
+                 worth having.
+                 The first version guarded this with `if (!(again instanceof
+                 BatchIncomplete)) throw again`, which meant a retry that hit a
+                 refusal, a 429 or a malformed shape still discarded the first
+                 error — the one case where the two messages differ most. Caught by
+                 GPT-5.6-sol, 2026-08-26. There is no reason to special-case the
+                 second failure's type: what the reader needs is both. */
+              throw new Error(
+                `The nav labels for one section failed twice.\n` +
+                  `  First attempt: ${err.message}\n` +
+                  `  Second attempt: ` +
+                  `${again instanceof Error ? again.message : String(again)}`,
+              );
+              /* No `cause`. src/log.ts follows cause chains, and src/parse-json.ts
+                 spells out why that matters here: an attached original error puts
+                 whatever it quoted straight back into the log line under a
+                 different key. Both messages are already in the text above, which
+                 is the part worth keeping. */
+            }
+            dropped.push(...accepted.dropped);
+            out = accepted.out;
           }
         }
         done++;
@@ -1450,6 +1857,14 @@ export async function generateLabels(opts: {
            three — a checkpoint that quietly holds less than it should is worse
            than no checkpoint, because the run that resumes from it pays again
            and reports success. */
+        /* A partially-accepted batch is written here like any other, and a later
+           run will not resume it: `coversExactly` demands an entry covering the
+           batch's blocks exactly, and this one is short by whatever was dropped.
+           That is the behaviour we want and it is worth saying out loud, because
+           it looks like a bug — the next run buys the batch again and may come
+           back whole, which is strictly better than resuming a known gap, and
+           the alternative is loosening a guard whose job is to pin an entry to
+           its own batch. */
         kept.push({ fingerprint, labels: out.labels, record: out.record });
         await writeCheckpoint();
         return { ...out, fromCheckpoint: false };
@@ -1478,7 +1893,13 @@ export async function generateLabels(opts: {
     if (!result.fromCheckpoint) paid.push(result.record);
   }
 
-  assertEveryBlockLabelled(labels, opts.blocks);
+  /* Document order, so two runs of the same article produce the same list and a
+     diff of two `labels.json` files means something. `results` is in batch
+     order; `dropped` is in finish order, which is a race. */
+  const order = new Map(opts.blocks.map((b, i) => [b.id, i]));
+  dropped.sort((a, b) => order.get(a)! - order.get(b)!);
+
+  assertEveryBlockLabelled(labels, opts.blocks, dropped);
 
   return {
     labels,
@@ -1491,7 +1912,9 @@ export async function generateLabels(opts: {
       structureVersion: opts.tree.version,
       labels,
       batches: records,
+      dropped,
     },
+    dropped,
     batches: batches.length,
     oversized: oversizedSets(batches).length,
     resumed,
@@ -1650,6 +2073,15 @@ async function main(): Promise<void> {
     );
   }
   console.log(`Labelled:  ${Object.keys(run.labels).length} blocks`);
+  /* The one number in this stage that is invisible everywhere else: a dropped
+     label is a leaf with no row, which looks exactly like a leaf that was never
+     supposed to have one. docs/reusable/silent-success.md. */
+  if (run.dropped.length > 0) {
+    console.log(
+      `Dropped:   ${run.dropped.length} paragraph(s) left bare after a second ask ` +
+        `(${run.dropped.slice(0, 3).join(", ")})`,
+    );
+  }
   console.log(`Tokens:    ${run.inputTokens} in, ${run.outputTokens} out (this run's calls only)`);
   /* Said out loud because the alternative is a pair of zeros in the cache
      figures that a broken cache would produce too. */
diff --git a/src/toc.ts b/src/toc.ts
index 6df1c1c..f0249a9 100644
--- a/src/toc.ts
+++ b/src/toc.ts
@@ -233,27 +233,46 @@ export function structureRequest(body: Block[]): {
 }
 
 /**
- * How much of the article the labels have to reach. **All of it.**
+ * How much of the article the labels have to reach. **Almost all of it.**
  *
- * This was 0.95 when one model call wrote the whole tree, and the missing 5%
- * was an escape hatch: the model was allowed to skip a trivial transition
- * sentence, and an unlabelled gistable leaf is still only a *warning* in
- * [validate-tree.ts](./validate-tree.ts) for that reason
- * (docs/project/table-of-contents.md). The floor existed to tell a used escape
+ * This has been 0.95, then 1, and is 0.95 again. The number matters less than
+ * which argument it is standing on, so here are all three.
+ *
+ * It was **0.95** when one model call wrote the whole tree, because the model
+ * was allowed to skip a trivial transition sentence — an unlabelled gistable
+ * leaf is still only a *warning* in [validate-tree.ts](./validate-tree.ts) for
+ * that reason (docs/project/table-of-contents.md). The floor told a used escape
  * hatch apart from an answer that had quietly stopped early.
  *
- * The split removes the ambiguity. src/labels.ts asks for an exact set of
- * numbered paragraphs per call and refuses a response returning any other set,
- * so a batch is complete or it throws; and `planBatches` puts every gistable
- * block in exactly one batch. There is no longer a path by which a block is
- * legitimately unlabelled, so anything under 100% is a bug in the batching
- * rather than a judgement by the model — and a floor that tolerated it would be
- * hiding the one failure this design can have.
+ * It was tightened to **1** when the label pass split out, on the argument that
+ * *"there is no longer a path by which a block is legitimately unlabelled"*:
+ * every batch is asked for an exact set of numbered paragraphs and refuses any
+ * other set, and `planBatches` puts every gistable block in exactly one batch.
+ *
+ * **That argument is now false, and the failure that falsified it is why this
+ * is 0.95 again.** A production ingest died twice on one absent label out of
+ * fifty-eight, on a paragraph whose entire text was the word "or" — stage 3 had
+ * stripped the code cell the fragment pointed at, leaving the label prompt's
+ * "6–20 words, a CLAIM or a MOVE" and its "never introduce a fact that is not in
+ * that paragraph" jointly unsatisfiable, so skipping was the compliant move and
+ * no retry could change it. src/labels.ts now re-asks for the gap alone and, if
+ * that fails too, may accept the batch and leave those leaves bare. So the path
+ * exists again, deliberately, and it is bounded rather than open.
+ *
+ * **This is the backstop, not the bound.** The real bound is `droppedBudget` in
+ * src/labels.ts — 2% of a batch, floor of one — and it is per batch, which is
+ * the only place a model's behaviour on one call can be judged. What that bound
+ * cannot see is the composition of the whole article: twenty small sibling sets
+ * each spending their floor of one would stay inside budget every time and still
+ * cost a fifth of the article its rows. This floor is what refuses that, and it
+ * is the number to move if the drops ever become normal rather than rare.
  *
- * Every real tree came back at 100% under the old rule anyway: 29 of 29, 117 of
- * 117, 18 of 18. The escape hatch was never once used.
+ * Every real tree came back at 100% under the original rule: 29 of 29, 117 of
+ * 117, 18 of 18. That is still what a healthy article looks like, and
+ * `LabelRun.dropped` — printed by the CLI, logged by the step, recorded in
+ * `labels.json` — is how anybody finds out it has stopped being.
  */
-const COVERAGE_FLOOR = 1;
+const COVERAGE_FLOOR = 0.95;
 
 /**
  * How to name a value from the model in an error message — and when not to.
@@ -361,9 +380,12 @@ export function checkCoverage(
     throw new Error(
       `The table of contents covers ${structural.length - missing.length} of ${structural.length} ` +
         `paragraphs — ${missing.length} have no row (${missing.slice(0, 3).map((b) => b.id).join(", ")}). ` +
-        `Every nav label is asked for by number and every batch is checked against the exact set ` +
-        `it was given, so this is not a model that stopped early. Look at planBatches in ` +
-        `src/labels.ts, and at whether the tree tiles the article. Nothing has been written.`,
+        `A batch may leave a paragraph or two of itself bare when the model will not label them ` +
+        `(src/labels.ts, droppedBudget), and that is what the ${Math.round(
+          (1 - COVERAGE_FLOOR) * 100,
+        )}% here is for; this is past it. ` +
+        `Look at the run's dropped count, at planBatches in src/labels.ts, and at whether the ` +
+        `tree tiles the article. Nothing has been written.`,
     );
   }
 }
@@ -502,6 +524,22 @@ export interface PartitionRepair {
    * child are the same boundary seen at two depths, so they share a coordinate.
    */
   at: number;
+  /**
+   * How many blocks the boundary moved — **the number that used to be the
+   * bound, and is now the whole of what replaced it.**
+   *
+   * While a repair could only ever be one block, its size was not worth
+   * recording: every repair was the same size and the count said everything.
+   * Since the bound was lifted (see `repairedChildRanges`) the count no longer
+   * distinguishes a boundary a paragraph out from a section handed forty blocks
+   * that belonged to its neighbour, and those are not the same event. A repair
+   * nobody is told the size of is now the shape of the bug it repaired, which is
+   * the argument this file already made about the count.
+   *
+   * A cascade reports the same size at each depth, because it is one boundary
+   * moving the same distance; `at` is what tells the two apart.
+   */
+  size: number;
 }
 
 /**
@@ -524,15 +562,31 @@ export interface PartitionRepair {
  * the repair counts now reach the pipeline log, so if answers with two
  * independent slips turn out to be common and their repaired trees turn out to
  * be good, that is the evidence. Thirteen calls is not it.
+ *
+ * **It is now the only bound, and it was one of two.** The per-repair size bound
+ * went on 2026-08-30 (`repairedChildRanges`), so this is what is left between a
+ * slipped boundary and an answer that is misaligned throughout. It still asks
+ * the right question — *how many separate places did the model get wrong*, which
+ * is what distinguishes a slip from a different reading of the article, and
+ * unlike size that does not vary with how long the article is.
+ *
+ * But it is carrying more than it was fitted for, and it is fitted to the same
+ * four HTML-with-headings observations the size bound was. **A headingless PDF
+ * with two independent slips still loses its whole ToC** — which is the fatal
+ * failure Greg's ruling was about, arriving by the other door. That is a known
+ * gap, left open deliberately: one observation is not enough to move two bounds
+ * at once, and the honest fix for both is the re-ask he describes rather than a
+ * larger number here. **It is one character to change when the evidence arrives**
+ * — which is the reason to leave it rather than to guess now.
  */
 const MAX_REPAIRED_BOUNDARIES = 1;
 
 /**
- * **Snap a partition that misses by exactly one block, and only by one.**
+ * **Snap a partition that misses, by however much it misses.**
  *
  * The argument for repairing at all is measured rather than assumed. A paid
  * calibration of this stage threw on 4 of 13 structure calls, and every tiling
- * failure anyone has recorded — those two, plus the two in
+ * failure recorded up to 2026-08-30 — those two, plus the two in
  * docs/postmortems/the-article-with-one-heading.md — was **off by a single
  * block**. So the practical choice is not between trusting the model and
  * checking it; it is whether a two-and-a-half-minute call that put one boundary
@@ -551,11 +605,46 @@ const MAX_REPAIRED_BOUNDARIES = 1;
  * first child's start too, and a repair that stopped at one level would trade a
  * broken partition at depth 1 for a broken one at depth 2.
  *
- * **Bounded at one block, deliberately.** A repair that grew with the size of
- * the mistake would be the model marking its own homework. Two blocks out is
- * not a slip, it is a different reading of the article, and it still throws —
- * as do a backwards range, an invented id, and a root that misses the article's
- * ends. Nothing is repaired that would leave a node covering no blocks at all.
+ * **This was bounded at one block until 2026-08-30, and the bound was overridden
+ * rather than refuted.** The argument for it was: a repair that grows with the
+ * size of the mistake is the model marking its own homework, and two blocks out
+ * is not a slip, it is a different reading of the article. That is still true,
+ * and it is still the reason to be uncomfortable with this function. What
+ * changed is the price of acting on it.
+ *
+ * The bound was fitted to four observations, and they were **all off by one and
+ * all from HTML articles with headings** — the half of the corpus where the
+ * model has the author's own structure to agree with. PDFs are headingless, they
+ * are the half where the model is measured disagreeing with *itself* between
+ * runs (docs/research/opening-an-article-before-the-toc.md § 7b), and PDF ingest
+ * reached production on the day this changed. The first thing it did was fail a
+ * 9-page arXiv paper on a gap of **three**: one completed call, $0.1617 spent,
+ * article lost, and nothing the reader could do about it. Greg, 2026-08-30:
+ *
+ * > I think for now, we should allow gaps. It's not ideal, but it's not the end
+ * > of the world, and better than things failing fatally. Perhaps in future, it
+ * > should trigger a re-run of the LLM, where we feed in the previous output,
+ * > with information about the gaps and ask it to adjust. But that's for later.
+ *
+ * **That re-ask is the proper fix and this is not it.** Snapping puts the
+ * orphaned blocks in the section beside them, which is a guess — the reader gets
+ * a paragraph filed under a heading that may not describe it. The re-ask would
+ * get the model to redraw the boundary it actually meant. What snapping buys in
+ * the meantime is that every block is reachable, which is the invariant that
+ * cannot be traded (a block in no node cannot be addressed by granularity zoom
+ * at all), and an article that opens rather than one that does not.
+ *
+ * **So the size of every repair is reported** — `PartitionRepair.size`, summed
+ * and maxed into `TocRun`, printed by the CLI and logged by src/pipeline.ts.
+ * That is the whole of what stands where the bound used to: if these numbers
+ * start showing sections handed forty blocks that belonged to their neighbour,
+ * the prompt has drifted or the model cannot read this kind of document, and
+ * either way somebody has to be able to see it.
+ *
+ * What still throws, unchanged: an answer with two *independent* slipped
+ * boundaries (`MAX_REPAIRED_BOUNDARIES`), a backwards range, an invented id, a
+ * root that misses the article's ends, and children that run past their parent.
+ * Nothing is repaired that would leave a node covering no blocks at all.
  *
  * Returns one entry per child: a mended `[start, end]`, or `undefined` for
  * "use what the model wrote".
@@ -600,29 +689,62 @@ function repairedChildRanges(
     if (!span) return out;
     const [lo, hi] = span;
     /* `cursor <= hi` is the guard against repairing a node into nothing: an
-       overlap snap moves the start forward, and a single-block child that its
-       neighbour already ate has no snap that leaves it non-empty. Without this
+       overlap snap moves the start forward, and a child its neighbour has
+       already eaten whole has no snap that leaves it non-empty. Without this
        the repair would hand `visit` a range running backwards, and the error
-       two lines later would describe a range we wrote ourselves. */
-    if (lo !== cursor && Math.abs(lo - cursor) === 1 && cursor <= hi && affordable(cursor)) {
+       two lines later would describe a range we wrote ourselves.
+
+       **This one clause still refuses, and it refuses more often now that an
+       overlap of any size is snapped.** A large overlap can swallow the next
+       child entirely, and that is where the repair stops being the same kind of
+       act: moving a boundary keeps every section the model asked for and
+       changes where one ends, while emptying a child *deletes a section* — the
+       model said this article has eight parts and we would be storing seven.
+       Nothing here knows whether the right answer is to drop that section or to
+       give it back a block from either side, and guessing wrong writes a
+       structure nobody proposed. The size bound went because refusing cost the
+       reader an article that was nearly right; this refusal is not that, and it
+       is the one place `repairedChildRanges` still says no to a slip it can see.
+       tests/toc-repairs.test.ts § "does not repair an overlap that would leave
+       the node covering nothing". */
+    if (lo !== cursor && cursor <= hi && affordable(cursor)) {
       out[i] = [blocks[cursor]!.id, (child.range as [string, string])[1]] as const;
       repairs.push({
         where: `${where} > child ${i + 1}`,
         kind: lo > cursor ? "gap" : "overlap",
         at: cursor,
+        size: Math.abs(lo - cursor),
       });
     }
     cursor = hi + 1;
   }
 
-  /* The same fault at the other end: the last child stops one block before its
-     parent does, and that block would grow no leaf anywhere. `cursor` is one
-     past the last child's end, so `cursor === parent[1]` is exactly one short. */
+  /* The same fault at the other end: the children stop before their parent does,
+     and every block after them would grow no leaf anywhere. `cursor` is one past
+     the last child's end, so `cursor <= parent[1]` is short by `parent[1] + 1 -
+     cursor` blocks.
+
+     **`<=`, not `===`, since the size bound went.** It was `=== 1` for the same
+     reason the loop above was, and leaving it behind would have left the repair
+     mending a gap of forty in the middle of an article and refusing a gap of two
+     at the end of it — one rule, applied at both ends, or the next person has to
+     discover which end they are at before they can predict what happens.
+
+     The overrun (`cursor > parent[1] + 1`) is deliberately not repaired here and
+     never was: children claiming blocks their parent does not have is a
+     different fault, and its two honest repairs — shrink the child, or grow the
+     parent — are two different readings of the answer with nothing to choose
+     between them. `assertChildrenPartition` still refuses it. */
   const last = children.length - 1;
-  if (last >= 0 && cursor === parent[1] && affordable(parent[1])) {
+  if (last >= 0 && cursor <= parent[1] && affordable(parent[1])) {
     const start = out[last]?.[0] ?? (children[last]!.range as [string, string])[0];
     out[last] = [start, blocks[parent[1]]!.id] as const;
-    repairs.push({ where: `${where} > child ${last + 1}`, kind: "short", at: parent[1] });
+    repairs.push({
+      where: `${where} > child ${last + 1}`,
+      kind: "short",
+      at: parent[1],
+      size: parent[1] + 1 - cursor,
+    });
   }
 
   return out;
@@ -865,7 +987,7 @@ export interface TocRun {
    */
   strandedSupplement: number;
   /**
-   * **Off-by-one partitions this run snapped shut rather than refused**, and
+   * **Misaligned partitions this run snapped shut rather than refused**, and
    * `sourceHeading` claims it dropped because no heading in the node's range
    * backed them up. Both are repairs of a model's slip, both are bounded, and
    * both are reported for the same reason `strandedSupplement` is: a repair
@@ -874,6 +996,23 @@ export interface TocRun {
    * number that climbs means the prompt has drifted and these are hiding it.
    */
   repairedRanges: number;
+  /**
+   * How far those repairs moved a boundary: blocks moved in total, and the
+   * worst single one.
+   *
+   * **Two numbers because the count stopped being enough** when the size bound
+   * was lifted (src/toc.ts § `repairedChildRanges`). "One repair" now covers
+   * both a boundary a paragraph out and a section handed forty blocks that
+   * belonged to its neighbour, and those need opposite responses: the first is
+   * the slip this stage was built to forgive, the second means the model could
+   * not read the document and the reader is getting prose filed under a heading
+   * that does not describe it.
+   *
+   * `largestRepair` is the one to watch, and it is not derivable from the sum —
+   * six one-block snaps and one six-block snap add up the same.
+   */
+  repairedBlocks: number;
+  largestRepair: number;
   droppedHeadings: number;
   labelled: number;
   internal: number;
@@ -890,6 +1029,17 @@ export interface TocRun {
   labelCalls: number;
   /** Batches taken from a checkpoint left by an earlier, failed run. */
   labelsResumed: number;
+  /**
+   * Paragraphs left with no nav label — **normally 0, and it is reported at 0
+   * as well as above it.**
+   *
+   * A dropped label is invisible in the product: the leaf simply has no row.
+   * The count is the only trace, so it is on the run, in the log line
+   * (src/pipeline.ts), on the CLI, and in `labels.json`. The blocks themselves
+   * are in that file's `dropped`. See `droppedBudget` in src/labels.ts for what
+   * bounds it and `COVERAGE_FLOOR` above for what refuses it.
+   */
+  labelsDropped: number;
   inputTokens: number;
   outputTokens: number;
   /* From the label pass only — the structure call is one call per article and
@@ -1159,12 +1309,17 @@ export async function generateToc(opts: {
     supplementBlocks: blocks.length - body.length,
     strandedSupplement: stranded,
     repairedRanges: built.repairs.length,
+    repairedBlocks: built.repairs.reduce((n, r) => n + r.size, 0),
+    /* `Math.max` of an empty list is -Infinity, which would print and log as
+       nonsense on the run where nothing was repaired — the common case. */
+    largestRepair: built.repairs.reduce((n, r) => Math.max(n, r.size), 0),
     droppedHeadings: built.droppedHeadings.length,
     labelled: Object.values(tree.nodes).filter((n) => n.navLabel).length,
     internal: Object.values(tree.nodes).filter((n) => n.children.length > 0).length,
     labelBatches: labelRun.batches,
     labelCalls: labelRun.calls,
     labelsResumed: labelRun.resumed,
+    labelsDropped: labelRun.dropped.length,
     /* Both passes together. What this number answers is "what did a tree cost",
        and a structure figure alone would now understate it by most of the bill. */
     inputTokens: message.usage.input_tokens + labelRun.inputTokens,
@@ -1204,6 +1359,16 @@ async function main(): Promise<void> {
         ? ` (${run.labelsResumed} of ${run.labelBatches} batches resumed from a checkpoint)`
         : ""),
   );
+  /* Only when it happened, unlike the two lines below — the ratio above already
+     says it every run, and this line is the *reason* for a ratio under one. A
+     dropped label is a leaf that renders as nothing at all, so the run that
+     produced it is the last moment anybody is looking. */
+  if (run.labelsDropped > 0) {
+    console.log(
+      `Dropped:   ${run.labelsDropped} paragraph(s) came back unlabelled twice and were left ` +
+        `bare — see "dropped" in labels.json`,
+    );
+  }
   /* **Said out loud, every run, including when it is zero.** `strandedSupplement`
      is the count of apparatus blocks the split refused to place — non-zero means
      no supplement node was built and the tree is exactly what it would have been
@@ -1219,9 +1384,16 @@ async function main(): Promise<void> {
   /* Printed every run, including at zero, for the reason the Notes line above
      is. These are the two places stage 4 now forgives the model, and a number
      computed and never shown is the same as no number. */
+  /* The size goes on the same line as the count, because the count on its own
+     stopped meaning anything the day the size bound was lifted: one repair can
+     be a paragraph or it can be a section handed forty blocks that belonged to
+     its neighbour. src/toc.ts § `repairedChildRanges`. */
   console.log(
-    `Repaired:  ${run.repairedRanges} off-by-one range(s), ` +
-      `${run.droppedHeadings} unbacked heading claim(s)`,
+    `Repaired:  ${run.repairedRanges} misaligned range(s)` +
+      (run.repairedRanges > 0
+        ? ` moving ${run.repairedBlocks} block(s), largest ${run.largestRepair}`
+        : "") +
+      `, ${run.droppedHeadings} unbacked heading claim(s)`,
   );
   console.log(`Tokens:    ${run.inputTokens} in, ${run.outputTokens} out`);
   console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
```
