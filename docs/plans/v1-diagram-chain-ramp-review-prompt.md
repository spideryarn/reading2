# Review: the sequence chain fades outward from the reader

You are reviewing a small, finished change to Spideryarn's Diagram mode, built
from a one-line ask rather than from a plan. Weight this as a **code** review:
the diff is the evidence, not a proposal.

## The ask

> For the diagrams in Diagram mode, we're showing the sequence-arrow
> connections. That's great. Let's improve things by making the connections
> directly either side of the current node most prominent. Then a bit fainter
> for the ones at one remove, then a bit fainter for the ones at two removes,
> etc etc.
>
> — Greg, 2026-08-30

Greg then chose, when asked: apply it to **both** pictures that draw a chain
(Force and Trail), and centre it on **where the reader is standing**, not on
what they are hovering.

## Context you need

- `src/web/diagram.ts` is Diagram mode's shared vocabulary — pure functions, no
  React, no layout.
- `src/web/diagram-d3.ts` lays out the **Force** picture: a d3 force simulation
  over `src/web/graph.ts`, several hundred ticks. Its layout is memoised on the
  tree, the box, the collapse set and the graph — deliberately **not** on the
  reader's scroll row, because re-running the simulation on every scroll would
  be absurd.
- `src/web/scatter.ts` lays out **Drift** and **Trail**. Trail's layout *does*
  take `atRow`.
- `src/web/DiagramPanel.tsx` is the React component. It computes `here` (the
  node the reader is standing in) from the laid-out nodes.
- A `DiagramLink` has a `depth` field which is **a per-picture rendering
  channel, not a depth** — on Force it is the depth of the node the line hangs
  off; on Trail it is a step of a fade.

## What was built

The chain's reader-relative styling moved out of the layouts and into a shared
pure function, `chainNearness` in `diagram.ts`, which the panel calls and turns
into a `diag-near-0` … `diag-near-7` class on each `sequence` path. Each layout
now names the two nodes each chain link joins (`from`/`to` on `DiagramLink`).

Trail previously did this itself, inside `chainStep`: a flat run of seventeen
segments at a top step (`depth === 8`) with a hard edge back to a global fade.
That half of `chainStep` is gone; what is left is only "how far through the
article is this segment". Trail still uses `here` for one thing — **which
segments get an arrowhead** — because a segment carrying a head is trimmed
further back to make room for it, so that decision is geometry and cannot be
deferred to a stylesheet.

## What I want from you

Findings, not praise. In particular:

1. **Correctness of `chainNearness`.** Is the hop-distance walk right? Does the
   scaling (`round(d / reach * 8)`) do what the comment claims? Are there chain
   shapes — a one-link chain, a chain the reader is not on, a collapsed article
   where the chain is empty, a Force graph where a node appears in the chain
   twice — that produce something wrong rather than something empty?
2. **The `from`/`to` fields.** They are optional on `DiagramLink` and set only
   for `sequence`. Is there a way for a non-chain edge to end up in the walk, or
   for the walk to cross the article on an edge it should not follow?
3. **The reach rule** (`chainReach`). It replaced a rule that capped the run at
   1/16 of the chain with one that caps at 1/6, on the argument that a *graded*
   run costs the picture less than a plateau did. Is that argument sound? Does
   the floor of 3 do something bad on a very short article (3 or 4 sections)?
4. **The Trail arrowhead rule.** It is now `|i - here| * 2 < chainReach(...)`,
   over `placed.length - 1` rather than over the links actually drawn. Where
   does that differ from the panel's reach, and does the difference matter?
5. **Does the CSS actually grade what the code computes?** Especially: the Force
   ramp uses `opacity` rather than `stroke`, on the claim that `opacity` on an
   SVG `<path>` also fades that path's `marker-end` arrowhead while `stroke`
   would not. Is that claim true? If it is false the arrowheads stay bright over
   faint lines, which is the visible failure this choice was made to prevent.
   Note the trail rules must beat the `diag-d*` rules they follow — check the
   specificity and the source order actually give that.
6. **The tests.** Each new assertion was probed against a deliberately broken
   implementation and the probe is named in its comment. Are any of them testing
   something other than what their comment claims? Is there a way this change
   could be wrong that none of them would catch?

Be concrete: name the file and the line, say what input produces the wrong
output, and say what you would do instead. If a finding is a taste rather than a
defect, say so.

## The diff

```diff
diff --git a/src/web/DiagramPanel.tsx b/src/web/DiagramPanel.tsx
index 80a6337..73ef4ff 100644
--- a/src/web/DiagramPanel.tsx
+++ b/src/web/DiagramPanel.tsx
@@ -67,6 +67,7 @@ import {
 import type { Block, BlockId, NodeId } from "../types.js";
 import {
   DIAGRAMS,
+  chainNearness,
   type DiagramKind,
   LINE_STEP,
   type DiagramLayout,
@@ -597,6 +598,25 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
      closed section rather than vanishing. */
   const here = useMemo(() => nodeAt(layout?.nodes ?? [], atRow), [layout, atRow]);
 
+  /**
+   * **The sequence chain, graded by how far each line is from the reader.**
+   *
+   * Greg, 2026-08-30: *"making the connections directly either side of the
+   * current node most prominent. Then a bit fainter for the ones at one remove,
+   * then a bit fainter for the ones at two removes, etc etc."*
+   *
+   * Here rather than in either layout, and centred on `here` rather than on
+   * `shown`. `here` is where the reader is *standing*; `shown` follows the
+   * pointer, and a chain that re-centres itself under the mouse would stop
+   * being a position readout the moment you tried to read anything else with
+   * it. The one place in this panel where hover deliberately changes nothing.
+   *
+   * Memoised on the layout and on `here`, which between them are the only two
+   * inputs — so scrolling within one section costs nothing, and crossing into
+   * the next costs one walk of the chain.
+   */
+  const nearness = useMemo(() => chainNearness(layout?.links ?? [], here), [layout, here]);
+
   /* `aria-setsize` / `aria-posinset` for every node, computed once per layout
      rather than twice per node per render — the walk is O(n) each and there are
      sixty of them. */
@@ -1073,7 +1093,20 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
 
       {kind === "force" && similar.status !== "idle" && (
         <p className="diag-note" role="status">
-          {similar.status === "loading" && "Reading the article for related passages…"}
+          {/* **The spinner, in the strip rather than over the picture.** Greg,
+              2026-08-30: *"Make sure the diagrams in Diagram mode show loading
+              spinners if they're generating."* Force is four fifths drawn while
+              this call is in flight, so a spinner across it would say the wrong
+              thing about what is missing — but a line of 10.5px grey that only
+              changes its *words* when the answer lands does not read as work in
+              progress either, it reads as a caption. Size 11 to sit on this
+              strip's own line rather than doubling its height. */}
+          {similar.status === "loading" && (
+            <>
+              <LoaderCircle className="cmt-spinner" size={11} aria-hidden="true" />
+              Reading the article for related passages…
+            </>
+          )}
           {/* **Counted from the lines actually drawn, not from the pairs that
               came back.** Those are different numbers: the client drops pairs
               whose passages sit in one section, and pairs whose sections the
@@ -1091,8 +1124,17 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
               allowed to use the model, which no amount of reaching would have
               fixed. It also threw away a bracketed code the reader could quote.
               ⟨Sol⟩, 2026-08-28. */}
-          {similar.status === "error" &&
-            `There are no dotted lines, and the rest of the picture is unaffected. ${similar.error ?? "The reason did not come back."}`}
+          {similar.status === "error" && (
+            <>
+              {`There are no dotted lines, and the rest of the picture is unaffected. ${similar.error ?? "The reason did not come back."}`}{" "}
+              {/* **A verb to go with the reason.** The fetch runs once from an
+                  effect, so without this the reader has the failure on screen
+                  and nothing to do about it — the only way back is to leave the
+                  mode and come in again, which nothing says. Greg, 2026-08-30:
+                  *"And/or a button to trigger generation if needed."* */}
+              <TryAgain onClick={similar.retry} what="the dotted lines" />
+            </>
+          )}
         </p>
       )}
 
@@ -1231,8 +1273,17 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
                 /* `kind` where the picture has kinds, `depth` where it does not.
                    Both classes are emitted rather than one, because the three
                    tree pictures' stylesheets are written against `diag-d*` and
-                   this must not change what they draw. */
-                className={`diag-link diag-d${l.depth}${l.kind ? ` diag-link-${l.kind}` : ""}`}
+                   this must not change what they draw.
+
+                   `diag-near-*` is the third, and only the sequence chain ever
+                   gets one — see `nearness` above. It is absent, rather than set
+                   to its faintest step, on every line the ramp does not reach
+                   and on every line at all when the reader is nowhere; the
+                   stylesheet's job is then to make the ramp's last step land on
+                   what an unclassed chain already looks like. */
+                className={`diag-link diag-d${l.depth}${l.kind ? ` diag-link-${l.kind}` : ""}${
+                  nearness.has(l.id) ? ` diag-near-${nearness.get(l.id)}` : ""
+                }`}
                 style={slotStyle(l.part)}
                 d={l.d}
                 fill="none"
@@ -1370,7 +1421,10 @@ function Waiting({ projection }: { projection: UseProjection | null }) {
     return (
       <p className="diag-wait" role="status">
         Could not place these paragraphs.{" "}
-        {projection.error ?? "The reason did not come back."}
+        {projection.error ?? "The reason did not come back."}{" "}
+        {/* Unlike Force, this failure leaves the band with nothing in it at all,
+            so the button is the only thing on screen the reader can press. */}
+        <TryAgain onClick={projection.retry} what="this picture" />
       </p>
     );
   }
@@ -1394,6 +1448,32 @@ function Waiting({ projection }: { projection: UseProjection | null }) {
   );
 }
 
+/**
+ * **The second try**, shown beside a failure and nowhere else.
+ *
+ * Both fetches in this panel run once from an effect, and until 2026-08-30 a
+ * reader whose request failed had the server's reason on screen and no verb
+ * anywhere — the way back was to leave the mode and come in again, which nothing
+ * said. Greg: *"And/or a button to trigger generation if needed."*
+ *
+ * A plain `<button>` rather than shadcn's, because both places it lands are a
+ * sentence of 10.5–12.5px chrome and a real button in the middle of a sentence
+ * changes the line height around it. It is inline text with a hit area, which is
+ * what `.diag-again` gives it.
+ *
+ * `what` goes in the accessible name, never in the visible label: two failures
+ * can be on screen at once — the projection's, in the band, and the
+ * embeddings', in the strip above it — and "Try again" twice over is a screen
+ * reader announcing two identical buttons that do different things.
+ */
+function TryAgain({ onClick, what }: { onClick(): void; what: string }) {
+  return (
+    <button type="button" className="diag-again" onClick={onClick} aria-label={`Try ${what} again`}>
+      Try again
+    </button>
+  );
+}
+
 /**
  * One row of the second control strip — a radiogroup of small chips.
  *
diff --git a/src/web/diagram-d3.ts b/src/web/diagram-d3.ts
index 340ddff..f3a896b 100644
--- a/src/web/diagram-d3.ts
+++ b/src/web/diagram-d3.ts
@@ -326,7 +326,13 @@ export function layoutForce(graph: ArticleGraph, opts: DiagramOptions): DiagramL
          node the line hangs off. The stylesheet now reads `kind`. */
       depth: l.source.n.depth,
       kind: l.e.kind,
-      ...(l.e.kind === "sequence" ? { arrow: true } : {}),
+      /* Endpoints only on the chain, because `chainNearness` (diagram.ts) is
+         the only reader of them and it walks the chain. Emitting them on all
+         five kinds would invite the vocabulary mesh into that walk, where every
+         node is a hop from every other and the ramp would come out flat. */
+      ...(l.e.kind === "sequence"
+        ? { arrow: true, from: l.source.n.id, to: l.target.n.id }
+        : {}),
     }));
 
   return { width: opts.width, height, nodes: out, links: drawnLinks, axis: null, nowY: null };
diff --git a/src/web/diagram.ts b/src/web/diagram.ts
index 2709243..cd00507 100644
--- a/src/web/diagram.ts
+++ b/src/web/diagram.ts
@@ -272,6 +272,170 @@ export interface DiagramLink {
    * writes.
    */
   arrow?: boolean;
+  /**
+   * The two nodes this line runs between, in the direction it is drawn.
+   *
+   * **Set by every picture that draws a `sequence` chain, and read by
+   * `chainNearness` below** — which is the only thing in the app that needs to
+   * know a line's endpoints rather than just its `d`. Optional because the
+   * other four kinds have no use for it and a `parent` line's endpoints are
+   * already obvious from the tree.
+   *
+   * Node *ids*, not indices. A chain is built from a sorted subset of the drawn
+   * nodes on Force and from every dot on Trail, so an index into "the links
+   * array" means a different thing in each — and the panel, which is where the
+   * two meet, holds neither array's ordering.
+   */
+  from?: NodeId;
+  to?: NodeId;
+}
+
+/**
+ * How many steps of the ramp the sequence chain gets, nearest the reader first.
+ *
+ * Greg, 2026-08-30:
+ *
+ * > making the connections directly either side of the current node most
+ * > prominent. Then a bit fainter for the ones at one remove, then a bit
+ * > fainter for the ones at two removes, etc etc.
+ *
+ * Eight, because the range the ramp has to spend is about 0.45 of opacity — the
+ * chain sits at 0.5 and the top of the ramp is as bright as its colour goes —
+ * and eight steps of it is 0.06 apiece, which is roughly the smallest change in
+ * a 2px stroke that reads as a difference rather than as the same line. More
+ * steps would be a finer gradient than an eye can pick up; fewer would show the
+ * banding.
+ *
+ * Level 8 is *not* a class. It is the chain's ordinary styling, which is what
+ * the ramp lands on — see `chainNearness`.
+ */
+export const CHAIN_NEAR_LEVELS = 8;
+
+/**
+ * How far the ramp reaches along the chain, in hops — the distance at which it
+ * has finished fading back into the chain's ordinary styling.
+ *
+ * Capped at `CHAIN_NEAR_LEVELS` so no two adjacent segments share a level, and
+ * **capped again at a sixth of the whole chain**. The second cap is the one
+ * that was learnt rather than chosen: Trail's chain runs to 359 segments on a
+ * long article and 29 on a short one, and a fixed reach of eight is a local
+ * landmark on the first and *most of the picture* on the second — a "you are
+ * here" covering three fifths of the chain is not a landmark, it is a wash.
+ * That was caught by a test rather than by looking, because at 320 pixels wide
+ * both versions look like a picture with a bright bit in it.
+ *
+ * The floor of 3 is so that a twelve-section article still gets a gradient
+ * rather than one bright pair and a hard edge. A sixth where the plateau this
+ * replaced used a sixteenth, for the same reason: the run is *graded* now, so
+ * its outer segments are already back at the chain's own weight and reaching
+ * further costs the picture almost nothing.
+ */
+export function chainReach(segments: number): number {
+  return Math.min(CHAIN_NEAR_LEVELS, Math.max(3, Math.round(segments / 6)));
+}
+
+/** Every chain link touching a node, so a walk can step from one to the next. */
+function chainAdjacency(chain: readonly DiagramLink[]): Map<NodeId, DiagramLink[]> {
+  const touching = new Map<NodeId, DiagramLink[]>();
+  for (const l of chain) {
+    for (const end of [l.from as NodeId, l.to as NodeId]) {
+      const at = touching.get(end);
+      if (at) at.push(l);
+      else touching.set(end, [l]);
+    }
+  }
+  return touching;
+}
+
+/**
+ * How many links along the chain each node is from `here`, out to `reach`.
+ *
+ * Node distances rather than link distances, because a link's distance is then
+ * the *nearer* of its two ends — which is what makes the two lines either side
+ * of the reader both come out at zero. Walking link to link instead needs this
+ * same map to find the neighbours and then has to remember not to count the
+ * node they share.
+ */
+function hopsFrom(
+  touching: ReadonlyMap<NodeId, DiagramLink[]>,
+  here: NodeId,
+  reach: number,
+): Map<NodeId, number> {
+  const hops = new Map<NodeId, number>([[here, 0]]);
+  let frontier: NodeId[] = [here];
+  for (let d = 1; d <= reach && frontier.length > 0; d++) {
+    const next: NodeId[] = [];
+    for (const n of frontier) {
+      for (const l of touching.get(n) ?? []) {
+        const other = (l.from === n ? l.to : l.from) as NodeId;
+        if (hops.has(other)) continue;
+        hops.set(other, d);
+        next.push(other);
+      }
+    }
+    frontier = next;
+  }
+  return hops;
+}
+
+/**
+ * Which step of the ramp each sequence link is painted at — 0 for the two lines
+ * that touch the node the reader is standing in, rising to `CHAIN_NEAR_LEVELS`
+ * for everything far enough away to be drawn as the chain always was.
+ *
+ * **Computed here rather than in the layouts, and that is the point.** Force's
+ * layout is a d3 simulation of several hundred ticks; handing it the reader's
+ * scroll position would re-run the whole thing on every scroll in order to
+ * change a class name. Trail's layout does already take `atRow` — it needs it
+ * for the arrowheads, which are geometry — but having it decide brightness too
+ * left two pictures computing one idea in two files and two units. So the
+ * layouts say what the chain *is* (`from`/`to` on `DiagramLink`) and this says
+ * where the reader is standing on it.
+ *
+ * **The ramp only ever brightens.** Its far end is the chain's ordinary
+ * styling, so a link past the reach is left unclassed rather than dimmed — the
+ * alternative, fading the distant chain away, puts a visible cliff wherever the
+ * ramp stops and takes the far half of the article with it. Emphasis near the
+ * reader and emphasis-by-dimming-everything-else look the same to an eye and
+ * are not the same picture.
+ *
+ * A breadth-first walk rather than index arithmetic, because "the chain" is a
+ * path the layout built and not a property of the array's order: Force sorts
+ * its chain by `startRow` and puts the parent, anchor, vocabulary and semantic
+ * edges in the same array, and Trail drops any segment whose two dots coincide.
+ * Neither array means "index i joins node i to node i+1".
+ *
+ * Returns an empty map when the reader is nowhere — no `?at=`, or above the
+ * article — which leaves the chain unmodulated rather than silently picking the
+ * first node as a centre.
+ */
+export function chainNearness(
+  links: readonly DiagramLink[],
+  here: NodeId | null,
+): Map<string, number> {
+  const out = new Map<string, number>();
+  if (here === null) return out;
+
+  const chain = links.filter((l) => l.kind === "sequence" && l.from && l.to);
+  const touching = chainAdjacency(chain);
+  if (!touching.has(here)) return out;
+
+  const reach = chainReach(chain.length);
+  const hops = hopsFrom(touching, here, reach);
+
+  for (const l of chain) {
+    const a = hops.get(l.from as NodeId);
+    const b = hops.get(l.to as NodeId);
+    if (a === undefined && b === undefined) continue;
+    const d = Math.min(a ?? Number.POSITIVE_INFINITY, b ?? Number.POSITIVE_INFINITY);
+    /* Scaled to the reach rather than used raw, so the ramp spans the same
+       eight steps whether it is walking 8 segments of a long article or 3 of a
+       short one — and so its far end always lands on `CHAIN_NEAR_LEVELS`, the
+       unclassed chain, rather than stopping part-way down and leaving a step. */
+    const level = Math.round((d / reach) * CHAIN_NEAR_LEVELS);
+    if (level < CHAIN_NEAR_LEVELS) out.set(l.id, level);
+  }
+  return out;
 }
 
 export interface DiagramLayout {
diff --git a/src/web/scatter.ts b/src/web/scatter.ts
index e4452fc..30e0b41 100644
--- a/src/web/scatter.ts
+++ b/src/web/scatter.ts
@@ -63,6 +63,7 @@
 import { isBody } from "../block-policy.js";
 import type { Block, BlockId, NodeId, ProjectionPoint } from "../types.js";
 import {
+  chainReach,
   type DiagramLayout,
   type DiagramLink,
   type DiagramNode,
@@ -118,21 +119,14 @@ const ROW = 6;
  */
 const TRAIL_MIN_H = 260;
 
-/** How many steps of fade the chain gets, oldest to newest. Matches the CSS. */
-const CHAIN_STEPS = 9;
 /**
- * How many segments either side of the reader are drawn at full strength, at
- * most — **and it scales down on a short article**.
- *
- * Eight either side is a bright run of seventeen, which on a 275-dot chain is a
- * local landmark and on a 29-dot chain is most of the picture. A "you are here"
- * that covers three fifths of the chain is not a landmark, it is a wash. Caught
- * by the test rather than by looking, which is the point of having one: at 320
- * pixels wide both versions look like a picture with a bright bit in it.
+ * How many steps of fade the chain gets, oldest to newest. Matches the CSS.
+ *
+ * **Seven, and it was nine.** The top two were reserved for the reader's own
+ * stretch, which is `chainNearness` in diagram.ts now (see `chainStep`), so the
+ * global ramp has its whole range back.
  */
-const NEAR_READER = 8;
-/** …but never more than this share of the whole chain. */
-const NEAR_READER_SHARE = 0.06;
+const CHAIN_STEPS = 7;
 /**
  * The shortest segment worth putting an arrowhead on, in px.
  *
@@ -622,10 +616,13 @@ function laneX(kept: readonly Dot[], k: number, left: number, right: number): (d
  *  - the chain is a hairline, and its **opacity ramps with reading position**,
  *    so the beginning of the article is a whisper and the end is clear. Even in
  *    the tangle the eye can find which way the piece was going.
- *  - **an arrowhead every eighth segment**, plus the last. 359 heads in this
- *    box is a texture rather than a direction.
- *  - **the reader's own position is drawn strongly** by the panel, so the
- *    picture can be read while scrolling.
+ *  - **arrowheads only on the reader's own stretch**, and none at all before
+ *    `?at=` exists. 359 heads in this box is a texture rather than a direction.
+ *  - **the reader's own position is drawn strongly**, as a ramp that is
+ *    brightest on the two segments either side of them and fades back into the
+ *    chain over the next few — `chainNearness` in diagram.ts, painted by the
+ *    panel — so the picture can be read while scrolling rather than only
+ *    studied.
  *  - colour by **progress** is the sensible default here, where the section
  *    hues are the default everywhere else — this is the one picture with no
  *    axis carrying position, so without it nothing says which end of the
@@ -691,7 +688,12 @@ export function layoutTrail(
   for (let i = 0; i + 1 < placed.length; i++) {
     const a = placed[i];
     const b = placed[i + 1];
-    if (!a || !b) continue;
+    /* The two drawn nodes, taken alongside the two placed dots so the segment
+       can name its endpoints — `nodes` is `placed` mapped one to one, so these
+       are the same two things and the guard is for the type checker. */
+    const an = nodes[i];
+    const bn = nodes[i + 1];
+    if (!a || !b || !an || !bn) continue;
     const dx = b.cx - a.cx;
     const dy = b.cy - a.cy;
     const len = Math.hypot(dx, dy);
@@ -712,15 +714,32 @@ export function layoutTrail(
        arrow**. Direction is carried by the other heads and by the fade; a gap
        would be carried by nothing. */
     const head = b.r + HEAD_GAP;
-    const step = chainStep(i, placed.length, here);
-    /* **Every segment of the bright run gets a head, and nothing else gets
-       one.** Globally there are none, which is the change two design reviews
-       and a browser pass reached independently, 2026-08-27: thirty-odd heads
-       scattered through a hairball of 263 crossing segments are clutter, and
-       *direction along a path you cannot trace is not information*. Inside the
-       run the path genuinely is traceable, and there it is a dozen or so heads
-       on a line the eye can follow — so every one of them earns its ink. */
-    const wanted = step === CHAIN_STEPS - 1;
+    const step = chainStep(i, placed.length);
+    /* **Every segment of the reader's own run gets a head, and nothing else
+       gets one.** Globally there are none, which is the change two design
+       reviews and a browser pass reached independently, 2026-08-27: thirty-odd
+       heads scattered through a hairball of 263 crossing segments are clutter,
+       and *direction along a path you cannot trace is not information*. Inside
+       the run the path genuinely is traceable, and there it is a dozen or so
+       heads on a line the eye can follow — so every one of them earns its ink.
+
+       **This is the one thing left here that needs `here`, and it is geometry
+       rather than styling**: a segment carrying a head is trimmed further back
+       so the head has room (`stop` below), so the decision cannot be deferred
+       to the panel the way the brightness ramp now is.
+
+       **The inner half of the ramp, not all of it.** `chainReach` is
+       diagram.ts's, so the heads and the ramp are the same rule over the same
+       chain rather than two numbers somebody has to keep in step — near enough,
+       anyway: the count here is the segments this loop is *about* to consider
+       and the panel's is the ones it drew, which differ by however many were
+       dropped for coincident dots. Both round to the same reach on anything but
+       a picture of a dozen dots.
+
+       Halved because the ramp's outer steps are back at the chain's own weight
+       by design, and a head out there is the clutter this rule exists to
+       prevent; the inner half is where the line is still bold enough to follow. */
+    const wanted = here >= 0 && Math.abs(i - here) * 2 < chainReach(placed.length - 1);
     const arrow = wanted && len > tail + head + MIN_ARROW_RUN;
     const stop = arrow ? head : b.r + 0.5;
     /* Two dots on top of one another — the article saying the same thing twice
@@ -734,14 +753,24 @@ export function layoutTrail(
       // chain that took its colour from one end would look like a claim about
       // which section owns the transition.
       part: -1,
-      /* **`depth` carries how far through the article this segment is**, 0–8,
+      /* **`depth` carries how far through the article this segment is**, 0–6,
          and the stylesheet reads it back as opacity. It is not a depth here and
          there is no tree to have one — the field is the one channel a link
          already has, and inventing a second would mean touching every picture's
          stylesheet. Written down because `diagram.ts` is emphatic that `depth`
-         stopped being used as a kind, and this is a third use of it. */
+         stopped being used as a kind, and this is a third use of it.
+
+         It used to carry the reader's position too, as a top step the segments
+         around them jumped to. That half moved to `chainNearness` (diagram.ts)
+         on 2026-08-30, so this is now only the global ramp — see `chainStep`. */
       depth: step,
       kind: "sequence",
+      /* The chain's topology, for the ramp the panel paints around the reader.
+         Trail's links array is *not* "index i joins dot i to dot i+1" — the
+         `continue` above drops any segment whose two dots coincide — so the
+         endpoints have to be said rather than inferred. */
+      from: an.id,
+      to: bn.id,
       /* `arrow`, not `wanted`. The first version computed the room-for-a-head
          check into a variable and then emitted the raw every-eighth rule here,
          so a segment with no room got its arrowhead anyway — a 6px marker on a
@@ -759,30 +788,33 @@ function round(v: number): number {
 }
 
 /**
- * How strongly to draw one segment of the chain, 0 (a whisper) to 8 (clear).
- *
- * Two things at once, and they are meant to be:
- *
- * - **globally**, the chain brightens as the article goes on, so even in the
- *   tangle the eye can tell which end it started at;
- * - **locally**, the eight segments either side of where the reader is standing
- *   are drawn at full strength, so the picture can be read *while* scrolling
- *   rather than only studied.
- *
- * The local half is the one that does real work. GPT Sol's review, 2026-08-27,
- * was blunt that fading a 359-segment chain changes its styling and not its
- * information density — which is true, and the answer is not a prettier fade
- * but a picture that answers "where am I in this?" A bright run of sixteen
- * segments is a route a reader can actually follow.
- *
- * The global half is therefore compressed into the lower steps, so that the
- * brightest thing on the picture is always the reader rather than the ending.
+ * How strongly to draw one segment of the chain from how far through the
+ * article it is — 0 (a whisper) to 6 (clear).
+ *
+ * The chain brightens as the article goes on, so even in the tangle the eye can
+ * tell which end it started at.
+ *
+ * **This used to do two things, and the other one has left.** It also lifted
+ * the sixteen segments either side of the reader to a top step, which is what
+ * made the picture readable while scrolling rather than only studiable — GPT
+ * Sol's review, 2026-08-27, was blunt that fading a 359-segment chain changes
+ * its styling and not its information density, and a bright run the reader can
+ * follow was the answer to that.
+ *
+ * That half is now `chainNearness` in diagram.ts, painted by the panel, for two
+ * reasons. Greg asked for the run to be *graded* rather than a plateau —
+ * "directly either side of the current node most prominent … then a bit fainter
+ * for the ones at one remove", 2026-08-30 — and the Force picture wanted the
+ * same thing, which it could not have from here: its layout is a d3 simulation
+ * and giving it the reader's scroll position would re-run several hundred ticks
+ * to change a class name.
+ *
+ * What is left is therefore only the global half, and it no longer needs to
+ * hold itself below a reserved top step: it spans the whole of its own range.
  */
-function chainStep(i: number, total: number, here: number): number {
-  const near = Math.min(NEAR_READER, Math.max(2, Math.round(total * NEAR_READER_SHARE)));
-  if (here >= 0 && Math.abs(i - here) <= near) return CHAIN_STEPS - 1;
+function chainStep(i: number, total: number): number {
   const progress = total > 1 ? (i + 1) / total : 1;
-  return Math.min(CHAIN_STEPS - 3, Math.floor(progress * (CHAIN_STEPS - 2)));
+  return Math.min(CHAIN_STEPS - 1, Math.floor(progress * CHAIN_STEPS));
 }
 
 /* ── naming the topics ────────────────────────────────────────────────────── */
diff --git a/tests/diagram-css.test.ts b/tests/diagram-css.test.ts
index 74c6551..9c14760 100644
--- a/tests/diagram-css.test.ts
+++ b/tests/diagram-css.test.ts
@@ -21,7 +21,13 @@
  */
 import { readFileSync } from "node:fs";
 import { describe, expect, it } from "vitest";
-import { DIAGRAMS, LABEL_PX, LINK_KINDS, UNLABELLED } from "../src/web/diagram.js";
+import {
+  CHAIN_NEAR_LEVELS,
+  DIAGRAMS,
+  LABEL_PX,
+  LINK_KINDS,
+  UNLABELLED,
+} from "../src/web/diagram.js";
 
 const CSS = readFileSync("src/web/styles.css", "utf8");
 
@@ -158,6 +164,50 @@ describe("the Force picture's five kinds of line", () => {
     expect(line).toContain(`var(${token})`);
   });
 
+  it("draws the reader's own stretch of the chain more strongly than the rest", () => {
+    /* Greg, 2026-08-30: *"making the connections directly either side of the
+       current node most prominent. Then a bit fainter for the ones at one
+       remove, then a bit fainter for the ones at two removes, etc etc."*
+
+       `chainNearness` (src/web/diagram.ts) emits `diag-near-0` … `diag-near-7`
+       and nothing else, so a level with no rule is a segment silently drawn at
+       the base weight — the exact failure this whole block exists for: the
+       picture still draws, and the ramp just has a hole in it. */
+    for (const picture of ["force", "trail"]) {
+      const missing = Array.from({ length: CHAIN_NEAR_LEVELS }, (_, i) => i).filter(
+        (i) => !new RegExp(`\\.diag-${picture} [^{]*\\.diag-near-${i}[\\s,{]`).test(CSS),
+      );
+      expect(missing, `${picture} is missing a step`).toEqual([]);
+    }
+  });
+
+  it("lands the ramp's far end on the weight the chain has anyway", () => {
+    /* **The ramp only ever brightens** — see `chainNearness`. Its last step has
+       to equal the unclassed chain, or every article gets a visible edge at the
+       point the ramp stops, which is worse than no ramp: it reads as a boundary
+       in the article rather than as the end of a highlight.
+
+       Force only. Trail's chain has a global fade underneath it, so its far
+       step is a blend rather than a match, and asserting equality there would
+       be asserting a number nobody chose. */
+    const base = /\.diag-force \.diag-link-sequence\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
+    const last =
+      new RegExp(
+        `\\.diag-force \\.diag-link-sequence\\.diag-near-${CHAIN_NEAR_LEVELS - 1}\\s*\\{([^}]*)\\}`,
+      ).exec(CSS)?.[1] ?? "";
+    const of = (rule: string, prop: string) =>
+      Number(new RegExp(`${prop}:\\s*([\\d.]+)`).exec(rule)?.[1] ?? Number.NaN);
+    expect(of(base, "opacity")).toBeGreaterThan(0);
+    expect(of(last, "opacity")).toBe(of(base, "opacity"));
+    expect(of(last, "stroke-width")).toBe(of(base, "stroke-width"));
+
+    // And step 0 really is the loud end, or the ramp is pointing the wrong way.
+    const first =
+      /\.diag-force \.diag-link-sequence\.diag-near-0\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
+    expect(of(first, "opacity")).toBeGreaterThan(of(last, "opacity"));
+    expect(of(first, "stroke-width")).toBeGreaterThan(of(last, "stroke-width"));
+  });
+
   it("puts the marker's tip at the end of the path, in fixed units", () => {
     /* `arrowPath` trims the line to `r + HEAD_GAP` **because** the tip lands
        exactly on the last point. That is only true when `refX` equals the
diff --git a/tests/diagram-force-links.test.ts b/tests/diagram-force-links.test.ts
index 9b1c59e..526a816 100644
--- a/tests/diagram-force-links.test.ts
+++ b/tests/diagram-force-links.test.ts
@@ -206,6 +206,38 @@ describe("the sequence chain", () => {
     ]);
   });
 
+  it("carries its own endpoints, and only the chain does", () => {
+    /* **The ramp around the reader walks these.** `chainNearness`
+       (src/web/diagram.ts) is handed the drawn links and has to find the chain
+       in among the parent, anchor, vocabulary and semantic lines — so the chain
+       says which two nodes it joins and the other four kinds say nothing, or
+       the walk crosses the article on a vocabulary edge and comes out flat.
+
+       Watched fail with the endpoints emitted for every kind: the ramp then
+       reaches the whole picture in two hops. */
+    const { root, blocks } = twoParts();
+    const out = drawn(
+      layoutDiagram(
+        "force",
+        root,
+        { width: 320, height: 600, collapsed: NONE },
+        buildGraph(root, blocks),
+      ),
+    );
+    const seq = out.links.filter((l) => l.kind === "sequence");
+    expect(seq.length).toBeGreaterThan(0);
+    expect(seq.map((l) => [l.from, l.to])).toEqual([
+      ["n3", "n4"],
+      ["n4", "n6"],
+      ["n6", "n7"],
+    ]);
+    for (const l of out.links) {
+      if (l.kind === "sequence") continue;
+      expect(l.from, `a ${l.kind} line named its endpoints`).toBeUndefined();
+      expect(l.to).toBeUndefined();
+    }
+  });
+
   it("draws no chain at all when the root itself is closed", () => {
     const { root, blocks } = twoParts();
     // Nothing but the root is drawn, and the root is not on the picture. A
diff --git a/tests/diagram-panel-hover.test.tsx b/tests/diagram-panel-hover.test.tsx
index dcdae6e..fb3b999 100644
--- a/tests/diagram-panel-hover.test.tsx
+++ b/tests/diagram-panel-hover.test.tsx
@@ -104,6 +104,39 @@ function rootOnlyArticle(): { root: SummaryNode; blocks: Block[] } {
   return { root: summary, blocks };
 }
 
+/**
+ * Twelve sections over twelve paragraphs, so the reading-order chain is long
+ * enough to have a middle — the two-section fixture above has one link in it,
+ * and a ramp with one step in it proves nothing about a ramp.
+ */
+function longArticle(): { root: SummaryNode; blocks: Block[] } {
+  const blocks = Array.from({ length: 12 }, (_, i) =>
+    block(`b${i}`, `${TOPICS[i % TOPICS.length]} ${i}`),
+  );
+  const mk = (i: number) => ({
+    id: `n${i + 2}`,
+    depth: 1,
+    parent: "n1",
+    children: [],
+    range: [blocks[i]?.id, blocks[i]?.id],
+    title: `Section ${i}`,
+    gist: `Gist ${i}`,
+  });
+  const tree = {
+    version: "1", generator: "t", slug: "s", rootId: "n1",
+    nodes: {
+      n1: {
+        id: "n1", depth: 0, parent: null, children: blocks.map((_, i) => `n${i + 2}`),
+        range: [blocks[0]?.id, blocks[11]?.id], title: "Section n1", gist: "Gist for n1",
+      },
+      ...Object.fromEntries(blocks.map((_, i) => [`n${i + 2}`, mk(i)])),
+    },
+  } as unknown as Tree;
+  const summary = buildSummaryTree(tree, blocks, null);
+  if (!summary) throw new Error("fixture tree is unusable");
+  return { root: summary, blocks };
+}
+
 let host: HTMLDivElement;
 let root: Root;
 
@@ -128,7 +161,11 @@ afterEach(() => {
   vi.unstubAllGlobals();
 });
 
-function mount(kind: DiagramKind = "force", from: () => { root: SummaryNode; blocks: Block[] } = article) {
+function mount(
+  kind: DiagramKind = "force",
+  from: () => { root: SummaryNode; blocks: Block[] } = article,
+  atRow = 0,
+) {
   const { root: tree, blocks } = from();
   act(() => {
     root.render(
@@ -137,7 +174,7 @@ function mount(kind: DiagramKind = "force", from: () => { root: SummaryNode; blo
         root={tree}
         kind={kind}
         onKind={() => {}}
-        atRow={0}
+        atRow={atRow}
         onJump={() => {}}
         blocks={blocks}
         /* The two scatter pictures' controls. Passed because the panel requires
@@ -411,3 +448,141 @@ describe("what the panel asks the server for", () => {
     expect(byForce.every(([url]) => url.includes("/api/similar/"))).toBe(true);
   });
 });
+
+/**
+ * **A wait the reader can see, and a failure they can act on.**
+ *
+ * Greg, 2026-08-30:
+ *
+ * > Make sure the diagrams in Diagram mode show loading spinners if they're
+ * > generating. And/or a button to trigger generation if needed.
+ *
+ * Two states were text-only. Force's strip said *"Reading the article for
+ * related passages…"* in the same faint grey as the sentence it shows when the
+ * answer has landed — a line that changes its words and nothing else does not
+ * read as *working*, it reads as a caption. And a failed request, on any of the
+ * three, left the reader with a reason and no verb: the fetch runs once from an
+ * effect, so the only way back was to leave the mode and come in again, which
+ * nothing on screen said.
+ */
+describe("saying it is working, and offering a second try", () => {
+  /* A request that never answers, so the panel stays in the state this is
+     about. Returning a pending promise rather than a slow one keeps the test
+     free of timers. */
+  const neverAnswers = () => vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
+  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
+
+  /** The Force strip — the one line of chrome that picture grows, and on Force
+      the only `.diag-note` there is: the projection's own strip belongs to the
+      two scatters. Found by class rather than by its words, so a state that has
+      lost its sentence fails here rather than quietly matching nothing. */
+  const strip = () => host.querySelector(".diag-note");
+
+  it("spins while Force is buying the embeddings", async () => {
+    neverAnswers();
+    mount("force");
+    await settle();
+    const note = strip();
+    expect(note, "the strip says nothing while the call is in flight").not.toBeNull();
+    expect(note?.textContent).toContain("related passages");
+    expect(note?.querySelector(".cmt-spinner"), "no spinner while a model call is in flight").not.toBeNull();
+  });
+
+  it("stops spinning once the embeddings have landed", async () => {
+    mount("force");
+    await settle();
+    expect(strip()?.querySelector(".cmt-spinner"), "still spinning after the answer").toBeNull();
+  });
+
+  it("gives Force a way to ask again when the embeddings fail", async () => {
+    let asked = 0;
+    vi.stubGlobal("fetch", async () => {
+      asked += 1;
+      return new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
+    });
+    mount("force");
+    await settle();
+    expect(asked, "the panel never asked").toBeGreaterThan(0);
+    expect(strip()?.textContent, "the failure is not on screen").toContain("E_QUOTA");
+    const again = strip()?.querySelector<HTMLButtonElement>("button") ?? null;
+    expect(again, "a failure with no verb — the reader can only leave the mode").not.toBeNull();
+    const before = asked;
+    await act(async () => {
+      again?.click();
+      await new Promise((r) => setTimeout(r, 0));
+    });
+    expect(asked, "the button did not start a second request").toBeGreaterThan(before);
+  });
+
+  it("gives Drift a way to ask again when the projection fails", async () => {
+    let asked = 0;
+    vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
+      if (!String(url).includes("/api/projection/")) {
+        return new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), { status: 200 });
+      }
+      asked += 1;
+      return new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
+    });
+    mount("drift");
+    await settle();
+    const wait = host.querySelector(".diag-wait");
+    expect(wait?.textContent, "the failure is not on screen").toContain("Could not place");
+    const again = wait?.querySelector<HTMLButtonElement>("button") ?? null;
+    expect(again, "a failure with no verb — the reader can only leave the mode").not.toBeNull();
+    const before = asked;
+    await act(async () => {
+      again?.click();
+      await new Promise((r) => setTimeout(r, 0));
+    });
+    expect(asked, "the button did not start a second request").toBeGreaterThan(before);
+  });
+});
+
+/**
+ * **The ramp along the sequence chain, at the one seam nothing else covers.**
+ *
+ * `chainNearness` is tested as arithmetic in tests/diagram.test.ts and the
+ * stylesheet's steps are checked in tests/diagram-css.test.ts — and both of
+ * those stay green if the panel never puts the class on the path. That is the
+ * whole failure: every level computed, every rule written, and a chain drawn
+ * flat, with nothing thrown and nothing logged.
+ *
+ * Greg, 2026-08-30: *"making the connections directly either side of the
+ * current node most prominent. Then a bit fainter for the ones at one remove,
+ * then a bit fainter for the ones at two removes, etc etc."*
+ */
+describe("the chain's ramp reaches the DOM", () => {
+  const levels = () =>
+    [...host.querySelectorAll(".diag-link-sequence")].map((el) =>
+      Number(/diag-near-(\d+)/.exec(el.getAttribute("class") ?? "")?.[1] ?? Number.NaN),
+    );
+
+  it("brightens the two lines either side of the section the reader is in", () => {
+    mount("force", longArticle, 6);
+    const on = levels();
+    expect(on.length).toBeGreaterThan(6);
+    // Exactly the pair touching the reader's own section is at the top step.
+    expect(on.filter((l) => l === 0)).toHaveLength(2);
+    // And the ramp really is a ramp rather than one bright pair and a cliff.
+    expect(new Set(on.filter((l) => Number.isFinite(l))).size).toBeGreaterThan(2);
+  });
+
+  it("moves the bright pair when the reader moves", () => {
+    /* The property a static class name would pass without: the ramp has to
+       follow `atRow`. Watched fail with the memo keyed on the layout alone. */
+    mount("force", longArticle, 1);
+    const early = levels();
+    mount("force", longArticle, 10);
+    const late = levels();
+    expect(early).not.toEqual(late);
+    expect(early.indexOf(0)).toBeLessThan(late.indexOf(0));
+  });
+
+  it("leaves the chain unclassed when the reader is above the article", () => {
+    /* `nodeAt` answers null for a reader who has not reached the first section,
+       and the chain must then look exactly as it always did rather than picking
+       the first node as a centre. */
+    mount("force", longArticle, -1);
+    expect(levels().every((l) => Number.isNaN(l))).toBe(true);
+  });
+});
diff --git a/tests/diagram.test.ts b/tests/diagram.test.ts
index 562bfd3..d9698b4 100644
--- a/tests/diagram.test.ts
+++ b/tests/diagram.test.ts
@@ -33,8 +33,12 @@ import { readFileSync } from "node:fs";
 import { describe, expect, it } from "vitest";
 import type { Block, BlockId, NodeId, Tree } from "../src/types.js";
 import {
+  CHAIN_NEAR_LEVELS,
+  chainNearness,
+  chainReach,
   charsThatFit,
   DIAGRAMS,
+  type DiagramLink,
   type DiagramNode,
   MAX_DRAWN_DEPTH,
   stepStops,
@@ -401,3 +405,103 @@ describe("siblingRuns", () => {
     expect(of("b1")).toEqual({ size: 2, pos: 1 });
   });
 });
+
+/**
+ * **The ramp along the sequence chain**, which is the one thing in Diagram mode
+ * that both pictures compute the same way and neither picture owns.
+ *
+ * Greg, 2026-08-30: *"making the connections directly either side of the
+ * current node most prominent. Then a bit fainter for the ones at one remove,
+ * then a bit fainter for the ones at two removes, etc etc."*
+ *
+ * Tested on a synthetic chain rather than through a layout, because the two
+ * properties that matter here are hard to see through one: what happens on a
+ * chain too short for the full reach, and what happens when the chain is not
+ * the only thing in the links array. Both draw perfectly well when wrong.
+ */
+describe("chainNearness", () => {
+  /** `n` links joining `n + 1` nodes, in order. */
+  function chain(n: number): DiagramLink[] {
+    return Array.from({ length: n }, (_, i) => ({
+      id: `l${i}`,
+      d: "",
+      part: -1,
+      depth: 0,
+      kind: "sequence" as const,
+      from: `n${i}` as NodeId,
+      to: `n${i + 1}` as NodeId,
+    }));
+  }
+
+  it("puts the two links either side of the reader at step 0", () => {
+    const near = chainNearness(chain(20), "n10" as NodeId);
+    expect(near.get("l9")).toBe(0);
+    expect(near.get("l10")).toBe(0);
+    expect(near.get("l8")).toBeGreaterThan(0);
+    expect(near.get("l11")).toBeGreaterThan(0);
+  });
+
+  it("never falls as it walks away, in either direction", () => {
+    const near = chainNearness(chain(40), "n20" as NodeId);
+    for (let i = 9; i >= 0; i--) {
+      const inner = near.get(`l${20 + i}`);
+      const outer = near.get(`l${20 + i + 1}`);
+      if (inner !== undefined && outer !== undefined) expect(outer).toBeGreaterThanOrEqual(inner);
+      const innerBack = near.get(`l${19 - i}`);
+      const outerBack = near.get(`l${19 - i - 1}`);
+      if (innerBack !== undefined && outerBack !== undefined) {
+        expect(outerBack).toBeGreaterThanOrEqual(innerBack);
+      }
+    }
+  });
+
+  /**
+   * **The one that separates the scaled hop count from the raw one**, and the
+   * reason it needs a short chain: on anything long enough for the full reach
+   * the two are the same number, so tests/scatter.test.ts cannot see the
+   * difference and says so.
+   *
+   * A three-hop reach with a raw count tops out at step 2 of 8 — the ramp then
+   * stops a long way above the chain's own weight, and every article shorter
+   * than fifty sections gets a visible edge where the run ends. Probed by
+   * replacing the scaling with `d` on 2026-08-30: this reddens, and nothing in
+   * scatter.test.ts does.
+   */
+  it("spans its whole range on a chain too short for the full reach", () => {
+    const short = chain(12);
+    const reach = chainReach(short.length);
+    expect(reach).toBeLessThan(CHAIN_NEAR_LEVELS); // precondition
+    const near = chainNearness(short, "n6" as NodeId);
+    expect(Math.max(...near.values())).toBeGreaterThanOrEqual(CHAIN_NEAR_LEVELS - 3);
+  });
+
+  it("stops at the reach, leaving the far chain unclassed", () => {
+    const near = chainNearness(chain(60), "n30" as NodeId);
+    expect(near.has("l0")).toBe(false);
+    expect(near.has("l59")).toBe(false);
+    expect(near.size).toBeLessThan(60);
+  });
+
+  /**
+   * **The vocabulary mesh must not be a shortcut.** Force puts all five kinds
+   * of edge in one array, and on a well-connected article the vocabulary edges
+   * join nearly everything to nearly everything — so a walk that followed them
+   * would reach the end of the article in two hops and paint the whole chain at
+   * step 0 or 1. It would look like a picture with a slightly brighter chain,
+   * which is why this is a test rather than a comment.
+   */
+  it("walks the chain only, never a vocabulary edge across the article", () => {
+    const links: DiagramLink[] = [
+      ...chain(30),
+      { id: "v", d: "", part: -1, depth: 0, kind: "vocabulary", from: "n0" as NodeId, to: "n29" as NodeId },
+    ];
+    const near = chainNearness(links, "n1" as NodeId);
+    expect(near.has("v")).toBe(false);
+    expect(near.has("l28")).toBe(false);
+  });
+
+  it("says nothing at all when the reader is nowhere, or is off the chain", () => {
+    expect(chainNearness(chain(20), null).size).toBe(0);
+    expect(chainNearness(chain(20), "n99" as NodeId).size).toBe(0);
+  });
+});
diff --git a/tests/scatter.test.ts b/tests/scatter.test.ts
index 4a1532e..54c1782 100644
--- a/tests/scatter.test.ts
+++ b/tests/scatter.test.ts
@@ -15,7 +15,7 @@
  */
 import { describe, expect, it } from "vitest";
 import type { Block, BlockId, NodeId, ProjectionPoint } from "../src/types.js";
-import { nodeAt, type DiagramOptions } from "../src/web/diagram.js";
+import { chainNearness, chainReach, nodeAt, type DiagramOptions } from "../src/web/diagram.js";
 import { laneTerms, layoutDrift, layoutTrail, type ScatterInput } from "../src/web/scatter.js";
 import type { SummaryNode } from "../src/web/tree.js";
 
@@ -353,8 +353,17 @@ describe("trail", () => {
     const arrows = out.links.filter((l) => l.arrow);
     expect(arrows.length).toBeGreaterThan(0);
     expect(arrows.length).toBeLessThan(out.links.length / 8);
-    // And every one of them is on a segment of the bright run.
-    for (const a of arrows) expect(a.depth).toBe(8);
+
+    /* **And they are all in one place**, which used to be checked by reading
+       `depth === 8` off the link. The top step is gone — brightness around the
+       reader is `chainNearness` in diagram.ts now, painted by the panel — so
+       what is left to assert here is the property that step was standing in
+       for: every head is inside one short window of the chain, rather than
+       sprinkled along it. A rule that emitted every eighth head globally would
+       pass the count above and fail this. */
+    const at = arrows.map((l) => Number(/^trail(\d+)-/.exec(l.id)?.[1]));
+    expect(at.every((n) => Number.isInteger(n))).toBe(true);
+    expect(Math.max(...at) - Math.min(...at)).toBeLessThan(chainReach(out.links.length));
   });
 
   it("never draws an arrow it has no room for", () => {
@@ -374,24 +383,65 @@ describe("trail", () => {
     }
   });
 
-  it("draws the chain brightest where the reader is standing", () => {
-    /* The mitigation that does the real work: a bright run of segments around
-       the reader is a route they can follow, where a fade over 359 segments is
-       only styling. Everything else must be dimmer, or the reader's own stretch
-       is not findable. */
+  it("fades the chain from beginning to end, and says nothing about the reader", () => {
+    /* `depth` used to carry two things: how far through the article a segment
+       is, and whether it was one of the seventeen around the reader. The second
+       left on 2026-08-30 (`chainStep`), and this is the test that it really did
+       — the same layout at two reading positions has to produce the *same*
+       depths, or the panel's ramp is fighting a second one underneath it. */
+    const early = layoutTrail(root, bs, opts({ atRow: 3 }), input(pts));
+    const late = layoutTrail(root, bs, opts({ atRow: 200 }), input(pts));
+    const nobody = layoutTrail(root, bs, opts({ atRow: null }), input(pts));
+    expect(early.links.map((l) => l.depth)).toEqual(nobody.links.map((l) => l.depth));
+    expect(late.links.map((l) => l.depth)).toEqual(nobody.links.map((l) => l.depth));
+
+    // And it is still a ramp: 0 at the top of the article, 6 at the bottom.
+    const depths = nobody.links.map((l) => l.depth);
+    expect(Math.min(...depths)).toBe(0);
+    expect(Math.max(...depths)).toBe(6);
+    for (let i = 1; i < depths.length; i++) {
+      expect(depths[i]!).toBeGreaterThanOrEqual(depths[i - 1]!);
+    }
+  });
+
+  it("grades the chain outward from the dot the reader is standing on", () => {
+    /* The mitigation that does the real work: a run of segments around the
+       reader is a route they can follow, where a fade over 359 segments is only
+       styling. Greg asked for it graded rather than flat, 2026-08-30 — so what
+       has to hold is that the two segments touching the reader's dot are at
+       step 0, and that the step never *falls* as you walk away from them.
+
+       Probed on 2026-08-30: a `chainNearness` that returns 0 for everything in
+       the run — the plateau this replaced — reddens this. The *scaling* of the
+       hop count is not tested here and cannot be: this fixture's chain is long
+       enough that the reach is the full eight, where scaled and raw are the
+       same number. tests/diagram.test.ts has the short chain that separates
+       them. */
     const at = 30;
     const out = layoutTrail(root, bs, opts({ atRow: at }), input(pts));
-    const top = out.links.filter((l) => l.depth === 8);
-    expect(top.length).toBeGreaterThan(0);
-    expect(top.length).toBeLessThan(out.links.length / 2);
-    for (const l of out.links) {
-      expect(l.depth).toBeGreaterThanOrEqual(0);
-      expect(l.depth).toBeLessThanOrEqual(8);
+    const near = chainNearness(out.links, nodeAt(out.nodes, at));
+    expect(near.size).toBeGreaterThan(0);
+
+    const index = (id: string) => Number(/^trail(\d+)-/.exec(id)?.[1]);
+    const zeros = [...near].filter(([, lvl]) => lvl === 0).map(([id]) => index(id));
+    // Either side of one dot: two segments, or one at the ends of the article.
+    expect(zeros.length).toBeGreaterThanOrEqual(1);
+    expect(zeros.length).toBeLessThanOrEqual(2);
+    expect(Math.max(...zeros) - Math.min(...zeros)).toBeLessThanOrEqual(1);
+
+    // Monotonic outward, in both directions, and it does use more than one step.
+    const centre = (Math.min(...zeros) + Math.max(...zeros)) / 2;
+    const byDistance = [...near]
+      .map(([id, lvl]) => ({ d: Math.abs(index(id) - centre), lvl }))
+      .sort((a, b) => a.d - b.d);
+    for (let i = 1; i < byDistance.length; i++) {
+      expect(byDistance[i]!.lvl).toBeGreaterThanOrEqual(byDistance[i - 1]!.lvl);
     }
-    // With no reader anywhere, nothing gets the top step — the fade is then
-    // only the global one, which is what the stylesheet's opacity rules expect.
-    const nobody = layoutTrail(root, bs, opts({ atRow: null }), input(pts));
-    expect(nobody.links.some((l) => l.depth === 8)).toBe(false);
+    expect(new Set([...near.values()]).size).toBeGreaterThan(3);
+
+    // With no reader anywhere, no segment is on the ramp at all — the chain is
+    // then only the global fade, which is what the stylesheet expects.
+    expect(chainNearness(out.links, null).size).toBe(0);
   });
 });
 
@@ -465,13 +515,21 @@ describe("a reader inside the apparatus", () => {
   });
 
   /* **What the reader actually sees is Trail's chain going bright around them.**
-     `here` is the dot index the reader is standing on, and it only surfaces as
-     link brightness — `chainStep` lights the segments either side of it at the
-     top step. With the apparatus swallowed by the last dot's range, standing in
-     the notes lit the end of the *argument*: the brightest thing in the picture
-     was a paragraph the reader had already left. */
-  const brightest = (links: readonly { depth?: number | undefined }[]) =>
-    links.filter((l) => l.depth === 8).length;
+     `here` is the dot index the reader is standing on. With the apparatus
+     swallowed by the last dot's range, standing in the notes lit the end of the
+     *argument*: the brightest thing in the picture was a paragraph the reader
+     had already left.
+
+     **The probe moved from `depth === 8` to the arrowheads**, because that is
+     where `here` surfaces in this layout now. Brightness around the reader is
+     `chainNearness` in diagram.ts and it is computed from the node the panel
+     says the reader is in, not from the row — so it cannot see this bug and a
+     test written against it would be green either way. The heads are still
+     decided here, from `here`, and they are still drawn only on the reader's
+     own run. Probed on 2026-08-30: putting the tiling back reddens both of the
+     tests below. */
+  const brightest = (links: readonly { arrow?: boolean | undefined }[]) =>
+    links.filter((l) => l.arrow).length;
 
   it("trail: does not light the end of the argument for a reader in the notes", () => {
     const out = layoutTrail(tree(body), all, opts({ atRow: firstNoteRow + 2 }), input(points(body)));
```

## The stylesheet, separately (the same file also holds a peer's unrelated work)

```diff
 .diag-force .diag-link-sequence {
   stroke: var(--diag-seq);
   stroke-width: 2.2;
   stroke-linecap: round;
+  /* **0.56 over an alpha of 0.9 is the 0.5 this line has always been drawn at**,
+     and it is split in two so that the ramp below has something to turn up. A
+     colour token at full strength plus an `opacity` the ramp overrides beats
+     seven `stroke` colours, for one reason that is not tidiness: `opacity`
+     applies to an element's markers as well as its stroke, and `stroke` does
+     not. Grading the line without the arrowhead would leave a bright head on a
+     faint line at the far end of every article. */
+  opacity: 0.56;
 }
 .diag-force .diag-arrowhead { fill: var(--diag-seq); }
 
+/* **The reader's own stretch of the chain, and it fades outward.**
+ *
+ * Greg, 2026-08-30: *"making the connections directly either side of the
+ * current node most prominent. Then a bit fainter for the ones at one remove,
+ * then a bit fainter for the ones at two removes, etc etc."*
+ *
+ * `diag-near-0` is the two lines touching the section the reader is standing
+ * in; the level is a hop count scaled to the chain's length, so the ramp spans
+ * the same eight steps on a nine-section article and a fifty-section one
+ * (`chainNearness`, src/web/diagram.ts).
+ *
+ * **It brightens toward the reader and never dims below the base**, which is
+ * why the last step is 0.56 — exactly the rule above. Dimming the far chain
+ * instead would put a visible edge wherever the ramp stopped and would take the
+ * rest of the article down with it; this way the ramp simply stops mattering.
+ * Width moves with it, a little, because opacity alone on a 2.2px line is a
+ * difference you have to look for.
+ */
+.diag-force .diag-link-sequence.diag-near-0 { opacity: 1; stroke-width: 3.2; }
+.diag-force .diag-link-sequence.diag-near-1 { opacity: 0.94; stroke-width: 3; }
+.diag-force .diag-link-sequence.diag-near-2 { opacity: 0.87; stroke-width: 2.8; }
+.diag-force .diag-link-sequence.diag-near-3 { opacity: 0.8; stroke-width: 2.7; }
+.diag-force .diag-link-sequence.diag-near-4 { opacity: 0.73; stroke-width: 2.5; }
+.diag-force .diag-link-sequence.diag-near-5 { opacity: 0.67; stroke-width: 2.4; }
+.diag-force .diag-link-sequence.diag-near-6 { opacity: 0.61; stroke-width: 2.3; }
+.diag-force .diag-link-sequence.diag-near-7 { opacity: 0.56; stroke-width: 2.2; }
+
 /* Shared distinctive words. Sky blue, medium — the measure the picture has
    always had, unchanged so a reader who knew this picture still recognises it. */
 /* 0.5 → 0.4, not → 0.3. Measured: 0.5 is 2.87:1 against the page, 0.4 is
@@ -7976,7 +8033,7 @@ tr:hover .block-chat,
 .sk-scene.on { color: var(--ink); border-color: var(--rule-strong); background: var(--surface-raised); }
 .sk-scene:focus-visible { outline: 2px solid var(--highlight); outline-offset: 1px; }
 
-.sk-crumb, .sk-zoom {
+.sk-up, .sk-crumb, .sk-zoom {
   display: inline-flex; align-items: center; gap: 0.2rem;
   border: 1px solid var(--rule); border-radius: 4px;
   padding: 0.15rem 0.4rem;
@@ -7984,8 +8041,68 @@ tr:hover .block-chat,
   font-family: inherit; font-size: inherit;
 }
 .sk-zoom { margin-left: auto; }
-.sk-crumb:hover, .sk-zoom:hover { background: var(--surface-raised); color: var(--ink); }
-.sk-crumb:focus-visible, .sk-zoom:focus-visible { outline: 2px solid var(--highlight); outline-offset: 1px; }
+.sk-up:hover, .sk-crumb:hover, .sk-zoom:hover { background: var(--surface-raised); color: var(--ink); }
+.sk-up:focus-visible, .sk-crumb:focus-visible, .sk-zoom:focus-visible { outline: 2px solid var(--highlight); outline-offset: 1px; }
+/* Up sits before the scene row, not after it: it is the way out of where you
+   are, and the row is a list of where you could be. */
+.sk-up { flex: none; }
+
+/* ---- a region's name, when it opens the part it names ---- */
+
+.sk-region-open { cursor: pointer; }
+.sk-region-open .sk-region-label { text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; }
+.sk-region-open:hover .sk-region-label { fill: rgb(var(--cat-rgb, var(--cat-7-rgb))); text-decoration-style: solid; }
+.sk-region-open:focus-visible { outline: none; }
+/* The ring goes on the hit rectangle rather than the group, because a `<g>` has
+   no box of its own for an outline to follow — it is exactly its children's
+   extent, and the text's extent is not the target's. */
+.sk-region-open:focus-visible .sk-hit { stroke: var(--highlight); stroke-width: 2; rx: 3; }
+
+/* ---- full screen ---- */
+
+/*
+ * The same `<dialog>` `showModal()` Lightbox.tsx uses, and for its four reasons:
+ * Escape closes it, the background goes `inert`, focus is trapped and restored,
+ * and it paints in the top layer without joining the z-index budget.
+ *
+ * **Why full screen rather than a wider band.** The band's width is the output
+ * of a negotiation in layout.ts between the rail, the band and `PROSE_MIN`, and
+ * a band that grew to fit a diagram would take that width from the article —
+ * which is what the reader is here to read. A modal takes it from nothing.
+ */
+.sk-full {
+  width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh;
+  margin: 0; padding: 0; border: none; background: transparent;
+  display: none;
+}
+.sk-full[open] { display: flex; align-items: flex-start; justify-content: center; }
+.sk-full::backdrop { background: rgb(0 0 0 / 0.72); }
+.sk-in-full {
+  /* Wide enough that a 760-unit canvas lands near 1.4x — text at 17px — and
+     capped so an ultrawide window does not scale it to something silly. */
+  width: min(94vw, 1120px);
+  height: 100dvh;
+  background: var(--page);
+  border-left: 1px solid var(--rule); border-right: 1px solid var(--rule);
+  display: flex; flex-direction: column;
+}
+/* The picture is the thing with room now, so the card can afford two more
+   lines of the sentence it was clamping. */
+.sk-in-full .sk-card { height: 7.5rem; }
+.sk-in-full .sk-card-detail { -webkit-line-clamp: 3; }
+.sk-in-full .sk-bar { padding: 0.5rem 0.8rem; font-size: 0.78rem; }
+.sk-in-full .sk-scene { max-width: 20rem; }
+/* Stops a trackpad flick inside a tall picture scrolling the article behind it
+   — the case that actually happens. Lightbox.tsx § two things `<dialog>` does
+   not do has the reasoning, including why locking `body` was rejected. */
+.sk-in-full .sk-scroll { overscroll-behavior: contain; }
+
+/* What the band says while the overlay has the picture. */
+.sk.away { justify-content: flex-start; }
+.sk-elsewhere {
+  margin: 0; padding: 0.75rem 0.7rem;
+  font-family: var(--font-ui); font-size: 0.75rem; line-height: 1.45; color: var(--ink-faint);
+}
 
 .sk-note {
   margin: 0 0.6rem 0.3rem;
@@ -7993,12 +8110,12 @@ tr:hover .block-chat,
   color: var(--ink-faint);
 }
 
-/* **`auto` on both axes, and that is what the Read button is for.** At Fit the
-   svg is `width: 100%` and there is nothing to scroll sideways; at Read it is
-   760px in a 288px band and both scrollbars are the point. */
+/* The svg is always `width: 100%`, so there is nothing to scroll sideways and
+   `overflow-y` is what actually does the work — a tall picture in a short band.
+   `auto` on both axes anyway, because a scene may be wider than tall in the
+   overlay and a clipped edge is worse than a scrollbar. */
 .sk-scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 0.4rem; }
 .sk-svg { display: block; }
-.sk-scroll.big .sk-svg { max-width: none; }
 
 /* ---- the primitives ---- */
 
@@ -8084,6 +8201,18 @@ tr:hover .block-chat,
 
 .sk-wait, .sk-empty { padding: 0.75rem 0.7rem; font-family: var(--font-ui); font-size: 0.75rem; color: var(--ink-soft); }
 .sk-wait { display: flex; align-items: center; gap: 0.4rem; }
+/* A redraw already under way, over a picture that is still readable. Above the
+   notes rather than below, because it is the one line here about *now*. */
+.sk-busy {
+  display: flex;
+  align-items: center;
+  gap: 0.4rem;
+  margin: 0;
+  padding: 0.15rem 0.7rem 0.3rem;
+  font-family: var(--font-ui);
+  font-size: 0.7rem;
+  color: var(--ink-faint);
+}
 .sk-empty p { margin: 0 0 0.5rem; line-height: 1.45; }
 .sk-empty-why { font-size: 0.7rem; color: var(--ink-faint); }
 .sk-run { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-start; }
@@ -8242,12 +8371,16 @@ tr:hover .block-chat,
 }
 
 /* The chain, on Trail. **`depth` is not a depth here** — scatter.ts writes how
-   strongly to draw the segment into it, 0 to 8, because a link already has that
+   strongly to draw the segment into it, 0 to 6, because a link already has that
    field and inventing a second one would mean touching every picture's
-   stylesheet. Two things are folded into the one number: the chain brightens as
-   the article goes on, and the sixteen segments around wherever the reader is
-   standing jump to the top step. The second is what makes the picture readable
-   while scrolling rather than only studiable. */
+   stylesheet. It says one thing and one only: how far through the article this
+   segment is, so the chain brightens as the piece goes on and the eye can tell
+   which end it started at.
+
+   Where the reader is standing is the *other* ramp, `diag-near-*` below, and it
+   is deliberately not folded into this number: it comes from the panel rather
+   than from the layout, so that Force can have the same ramp without re-running
+   a force simulation on every scroll. */
 .diag-trail {
   --diag-chain: var(--cat-7-rgb);
 }
@@ -8269,10 +8402,6 @@ tr:hover .block-chat,
      this picture. */
   mix-blend-mode: plus-lighter;
 }
-/* The bright run is a line to follow rather than texture to accumulate, so it
-   comes out of the additive layer — otherwise it would blow out wherever it
-   crossed the chain, which is the one place the reader is looking. */
-.diag-trail .diag-link.diag-d8 { mix-blend-mode: normal; }
 .diag-trail .diag-link.diag-d0 { opacity: 0.16; }
 .diag-trail .diag-link.diag-d1 { opacity: 0.2; }
 .diag-trail .diag-link.diag-d2 { opacity: 0.25; }
@@ -8280,15 +8409,83 @@ tr:hover .block-chat,
 .diag-trail .diag-link.diag-d4 { opacity: 0.36; }
 .diag-trail .diag-link.diag-d5 { opacity: 0.42; }
 .diag-trail .diag-link.diag-d6 { opacity: 0.5; }
-/* The reader's own stretch. Brighter, thicker, and the only part of the chain
-   drawn as a line you are meant to follow rather than as texture. */
-.diag-trail .diag-link.diag-d8 {
+
+/* **The reader's own stretch, and it fades outward rather than stopping.**
+ *
+ * Greg, 2026-08-30: *"making the connections directly either side of the
+ * current node most prominent. Then a bit fainter for the ones at one remove,
+ * then a bit fainter for the ones at two removes, etc etc."*
+ *
+ * This used to be one step — `diag-d8`, seventeen segments at full strength and
+ * a hard edge back to the global fade — decided inside `chainStep` in
+ * scatter.ts. It is now eight steps decided by `chainNearness` in diagram.ts,
+ * which is the same code the Force chain uses, so the two pictures cannot drift
+ * apart in what "near the reader" means.
+ *
+ * Two things ride the ramp, and only the first is obvious. The **hue** walks
+ * from the chain's own violet at the far end to the marker colour at the
+ * reader's feet, because opacity alone on a hairline that is already glowing
+ * additively does not separate the run from the tangle. And **`plus-lighter`
+ * comes off** at the near end: the bright run is a line to follow rather than
+ * texture to accumulate, and left in the additive layer it blows out wherever
```
