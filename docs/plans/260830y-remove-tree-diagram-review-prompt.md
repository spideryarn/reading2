# Review: removing the Tree picture from Diagram mode

You are reviewing **built code**, not a plan. Be adversarial. Check each claim
against the diff rather than against the prose describing it.

## What was asked for

Greg, 2026-08-30:

> Remove the "Tree" diagram from Diagram mode (it's not interesting enough to
> keep, and it overlaps too much with Hierarchy and Outline mode etc), but don't
> change the other diagrams.
>
> N.B. I think perhaps that right now if while loading and/or if there's an error
> with one of the others (e.g. with semantic embeddings), it falls back to Tree -
> instead, just show a loading spinner or error.

## What the code was before

Diagram mode had four pictures behind one radiogroup: `tree` (a hand-rolled
outline, laid out in `src/web/diagram.ts` by `layoutTree`), `force` (a d3-force
graph over `src/web/graph.ts`), and `drift` / `trail` (two scatter plots over an
embedding projection the server computes).

`tree` was the **default** and the only free one — it needed no fetch. The other
three each spend a model call: `force` buys "semantic" edges from
`useSimilar` (the dotted lines; its other four kinds of line are free
arithmetic over prose the browser already holds), and `drift`/`trail` buy the
whole picture from `useProjection`.

`layoutDiagram` (`src/web/diagrams.ts`) **fell back to `layoutTree`** whenever a
picture's data had not arrived. The panel then carried a `drawnKind` variable —
"the picture on screen, which is not the toggle that is lit" — because the SVG's
class and `NodeShape`'s per-node branch had to follow what was drawn rather than
what was pressed. That fallback had already caused a shipped bug twice.

## What I changed

1. `DIAGRAMS` is now `["force", "drift", "trail"]`; `layoutTree` and its
   constants are deleted, along with `GIST_PX`, the `tree` entries in `LABEL_PX`
   and `LINE_STEP`, and every `.diag-tree` / `.diag-row` / `.diag-count` /
   `.diag-gist` / `.diag-twist` / `.diag-node.closed .diag-dot` CSS rule.
2. `layoutDiagram` returns `DiagramLayout | null`. Null means "this picture's
   data is not here yet". No picture stands in for another.
3. `drawnKind` is gone. `kind` is now the only answer to "which picture is this".
4. The panel's scroller has three branches: unusable tree (unchanged message) →
   not yet measured (`.diag-measuring`, unchanged) → `layout === null`
   (`<Waiting>`: spinner + sentence, or the ready-but-empty sentence, or the
   error) → the SVG.
5. The `.diag-note` strip for the projection now renders **only** when a picture
   is actually drawn (`drawingPoints && status === "ready"`), so the waiting and
   error states have exactly one voice, in `Waiting`.
6. The default picture is now `force` (`params.ts § diagramParam`).
7. `NodeShape` loses the tree branches: the row rect + dot, the paragraph-count
   text, and the collapse chevron. Collapse survives on ← / → only.
8. Tests and docs updated.

## What to look for, and please do look

- **Anything still reachable that assumes four pictures or a `tree` kind.** I
  grepped, but a `kebab-case`/`camelCase` split or a template string could hide
  one.
- **The `Waiting` branch conditions.** Is there a state where the panel now shows
  nothing at all — no spinner, no error, no picture? Trace `projection.status`
  through `idle → loading → ready(empty) → ready(points) → error`, and the
  slug-change path in `useProjection`. Note `box === null || box.w === 0` is now
  tested *before* `layout === null`; is that ordering right in every case, and
  can `box` become non-null-but-zero again after a picture is drawn?
- **`force` with no graph.** `layoutDiagram` returns null. In the panel `graph`
  is `root && wantsGraph ? buildGraph(...) : null`, and `root === null` is caught
  by the earlier branch — so I claim `Waiting` is unreachable for `force`. But
  `Waiting` renders the *projection's* status, and on `force` the projection hook
  is disabled and sits at `idle`, which would render the spinner and the words
  "Reading the article paragraph by paragraph…". Is that reachable? If so it is
  a lie.
- **The default changing to `force` spends a model call on opening the mode**,
  which the old default did not. I have documented that rather than avoided it.
  Is there a better answer I have missed that does not reintroduce a fourth
  picture?
- **Collapse.** The chevron was the only pointer route to folding a part away and
  it went with the Tree. `collapsed` is still threaded through `buildGraph`, and
  ← / → still toggle. Is anything now dead, or half-dead?
- **The step ladder and `unit`.** `unit` is `drawingPoints ? "paragraph" :
  deepest >= 2 ? "section" : "part"`. With Tree gone, is that still right for
  Force in every shape of article?
- **Accessibility.** `role` is `flat ? "listbox" : "tree"` and `flat` is
  `drawingPoints`. With no fallback, can `flat` and the drawn picture disagree?
- **The tests.** `tests/diagram.test.ts` no longer has a layout to produce nodes
  from, so it builds `DiagramNode`s directly (`nodesOf`) with zeroed geometry. Is
  that honest — do `stepStops`, `nodeAt` or `siblingRuns` read any coordinate?
  And are the new assertions in `tests/diagram-panel-hover.test.tsx` capable of
  going red, or do they pass for a reason unrelated to what they claim?

## Housekeeping about the diff

The working tree is shared with other agents. **Three files in this diff carry
work that is not mine and is not under review** — ignore those hunks:

- `src/web/params.ts`: the whole `MODES → src/modes.ts` move at the top.
- `src/web/styles.css`: the `.summ-steer-*` deletions and the "two free-text
  boxes" comment.
- `src/web/App.tsx`: the `articleWaitTitle` change in `ArticlePage`.

Everything else in the diff is mine.

Report findings with file and line, most serious first, and say for each whether
you confirmed it by reading the code or are inferring it. If a finding is a
matter of taste rather than a defect, say so.
## The diff

```diff
diff --git a/src/web/App.tsx b/src/web/App.tsx
index 07210bd..ef0d42a 100644
--- a/src/web/App.tsx
+++ b/src/web/App.tsx
@@ -134,7 +134,7 @@ import { useComments } from "./useComments.js";
 import { ChatDialog, type ChatTarget } from "./ChatDialog.js";
 import { anchored, countByBlock, useChatAnchors } from "./useChatAnchors.js";
 import { PILL } from "./pill.js";
-import { pageTitle, useDocumentTitle } from "./page-title.js";
+import { articleWaitTitle, pageTitle, useDocumentTitle } from "./page-title.js";
 import { apiFetch, readJson } from "./lib/api.js";
 import { loadPublicArticle } from "./public-api.js";
 import type {
@@ -592,13 +592,22 @@ function ArticlePage({
    * than that here: the title is announced to a screen reader, so a flicker
    * nobody sees is an interruption somebody hears. Until then the previous
    * title stands, which is exactly what a browser does during a real page load.
+   *
+   * **And on a shared link it does not say `Loading…` at all**, because the
+   * server already put the article's real title in the tab and replacing it
+   * would be a step backwards. That decision is `articleWaitTitle` in
+   * page-title.ts, which is where the two guards it needs are explained; this
+   * component's job is to say which of the three states it is in.
    */
   useDocumentTitle(
-    access.kind === "error"
-      ? pageTitle({ kind: "error" })
-      : access.kind === "loading" && slow
-        ? pageTitle({ kind: "loading" })
-        : "",
+    articleWaitTitle(
+      access.kind === "error" ? "error" : access.kind === "loading" && slow ? "loading" : "ready",
+      slug,
+      /* Read at call time rather than captured: the question `articleWaitTitle`
+         asks is whether the tab *still* shows what the server put there, and a
+         value captured earlier could not answer it. */
+      typeof document === "undefined" ? "" : document.title,
+    ),
   );
 
   /* **The one branch with no corner wordmark**, and the reason is that
@@ -3451,21 +3460,25 @@ function useSummaryMode(article: Article, summaries: { entries: SummaryEntry[] }
 }
 
 /**
- * Diagram mode's band — the tree, drawn.
+ * Diagram mode's band — the article, drawn.
  *
  * Same shape as `SummaryBand` above and for the same reasons: `?diagram=` is
  * read here rather than in `Reader`, because it is meaningless outside this mode
  * and a subscription in the parent would cost every render of the reading view.
  *
- * **It takes no `slug` and fetches nothing.** Every number this panel needs is
- * already on the page — stage 4 wrote a gist onto every internal node, and the
- * block ranges give the sizes — so unlike chat, glossary, search and summary
- * there is no artefact to wait for, no job to run, and nothing to pay a model
- * for — and that is what `tree`, the default picture, is drawn from. **The
- * other three all spend a model call**, which is why the default is the free
- * one: opening a mode should not bill you. `useSimilar` and `useProjection`,
- * inside the panel, are what fetch for those three, each gated on its own
- * picture being the one on screen. See docs/project/diagram.md.
+ * **This component fetches nothing**, and that is a statement about this
+ * component rather than about the mode. The shape of the picture comes from
+ * `article.tree` and `article.blocks`, which the page already holds — so unlike
+ * chat, glossary, search and summary there is no artefact to wait for and no
+ * job to run here. The two hooks that do spend money live inside the panel,
+ * each gated on its own picture being the one on screen: `useSimilar` for
+ * Force's dotted lines, `useProjection` for the two scatters' dots. `slug` is
+ * passed for exactly that.
+ *
+ * All three pictures spend a model call since the free one — `tree`, the
+ * outline — was cut on 2026-08-30. Force is the default because it is the only
+ * one that draws something real before its answer lands. See
+ * docs/project/diagram.md.
  */
 function DiagramBand({
   slug,
diff --git a/src/web/DiagramPanel.tsx b/src/web/DiagramPanel.tsx
index ff38b4d..554ea01 100644
--- a/src/web/DiagramPanel.tsx
+++ b/src/web/DiagramPanel.tsx
@@ -3,16 +3,16 @@
  *
  * ```
  *  ┌── spine ──┬────── DIAGRAM (this panel) ──────┬──── the article ────┐
- *  │           │  DIAGRAM  tree · force · drift   │                     │
+ *  │           │  DIAGRAM  force · drift · trail  │                     │
  *  │  ▇▇▇▇▇▇▇  │ ──────────────────────────────── │  Being You opens    │
- *  │  ▇▇▇▇     │ ▐ ▌█ 1  Waking up                │  with a story about │
- *  │  ▇▇▇      │ ▐ ▌█                             │  waking from        │
- *  │  ▇▇▇▇▇▇   │ ▐ ▌█ 1.1 The body as a model     │  anaesthesia…       │
- *  │  ▇▇       │ ▐▶▌█ ◀── you are here            │                     │
- *  │  ▇▇▇▇     │ ▐ ▌█ 2  The hard problem         │  Every paragraph    │
- *  │  ▇▇▇      │ ▐ ▌█                             │  stays where it was.│
+ *  │  ▇▇▇▇     │        ◯───◯                     │  with a story about │
+ *  │  ▇▇▇      │       ╱ ╲ ╱                      │  waking from        │
+ *  │  ▇▇▇▇▇▇   │      ◯───◉····◯  ◀── you are here│  anaesthesia…       │
+ *  │  ▇▇       │       ╲   ╲                      │                     │
+ *  │  ▇▇▇▇     │        ◯───◯                     │  Every paragraph    │
+ *  │  ▇▇▇      │                                  │  stays where it was.│
  *  │           │ ──────────────────────────────── │                     │
- *  │           │  1.1 The body as a model   6 ¶   │  Clicking a band    │
+ *  │           │  1.1 The body as a model   6 ¶   │  Clicking a bubble  │
  *  │           │  Perception is a controlled…     │  scrolls it here.   │
  *  └───────────┴──────────────────────────────────┴─────────────────────┘
  * ```
@@ -57,8 +57,8 @@ import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
 import {
   ChartScatter,
   ChevronDown,
-  ChevronRight,
   ChevronUp,
+  LoaderCircle,
   Network,
   Route,
   Waypoints,
@@ -123,9 +123,10 @@ interface Props {
  *
  * **Three fields rather than one, and the third is the one readers ask for.**
  * `blurb` says what the picture shows; `how` says where it comes from and what
- * it costs. Three of these four spend a model call the first time they are
- * drawn, and a toggle bar that does not say which is a toggle bar where one
- * press is free and the next one bills you — see docs/project/diagram.md.
+ * it costs. All three spend a model call, and they do not spend it on the same
+ * thing: Force's buys the dotted lines onto a picture that is already drawn,
+ * while Drift's and Trail's buy the picture itself — see
+ * docs/project/diagram.md.
  *
  * Both are rendered in a real hover card (Tooltip.tsx) rather than a `title`
  * attribute. The native tooltip waits about a second, cannot be styled, cannot
@@ -133,12 +134,6 @@ interface Props {
  * sentence explaining what a picture *is*, that is close to not being there.
  */
 const KIND_UI: Record<DiagramKind, { label: string; icon: typeof Network; blurb: string; how: string }> = {
-  tree: {
-    label: "Tree",
-    icon: Network,
-    blurb: "The outline as a branching tree — every part, every section, in the order they were written.",
-    how: "Free: drawn from the contents page, which the article already has. Click a row to go there; the chevron folds a part away.",
-  },
   /* Force draws the GRAPH, not the tree — sections joined by the words they
      share as well as by where they sit (src/web/graph.ts). Its blurb says what
      it is *for*, because unlike the tree it is not showing the reader something
@@ -470,12 +465,12 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
     [wantsPoints, blocks, projection.points, projection.k, axis, hue],
   );
 
-  /* **What is actually drawn**, which is not the same as which toggle is
-     pressed: until the projection lands, `layoutDiagram` falls back to `tree`
-     (see diagrams.ts). Deriving the role, the palette and the strip from the
-     *picture on screen* rather than from `kind` is what stops the panel telling
-     a screen reader it is showing a list of paragraphs while it is showing a
-     column of sections. */
+  /* **Whether a scatter has anything to draw yet**, which is exactly the
+     condition `layoutDiagram` returns null on. Since 2026-08-30 no picture
+     stands in for another, so this and `layout !== null` say the same thing for
+     the two scatters — both are kept because this one is also what the strip
+     and the legend below are gated on, and those render outside the scroller
+     where there is no layout to ask. */
   const drawingPoints = wantsPoints && projection.points.length > 0;
   const flat = drawingPoints;
   const ramp = drawingPoints && hue === "progress";
@@ -496,9 +491,9 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
      rather than blocks. */
   const words = useMemo(() => wordsBefore(blocks), [blocks]);
 
-  /* `tree` and `force` return `nowY: null` and never read `atRow`, so for them
-     it was a dependency nobody looked at — and `atRow` changes every time the
-     reader scrolls into a new section.
+  /* `force` returns `nowY: null` and never reads `atRow`, so for it this was a
+     dependency nobody looked at — and `atRow` changes every time the reader
+     scrolls into a new section.
 
      That made scrolling with Force open re-run the whole layout, which is a
      300-tick d3 simulation measured at 39ms on a 60-section article and 113ms
@@ -522,26 +517,24 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
   }, [root, kind, box, collapsed, words, graph, scatter, followsReader]);
 
   /**
-   * **The picture actually on screen, which is not always the toggle that is
-   * pressed** — and everything the renderer branches on has to use this.
+   * **`drawnKind` was here, and its removal is the point of this change.**
    *
-   * `layoutDiagram` falls back to `layoutTree` whenever a picture's data has
-   * not arrived: Drift and Trail before the projection lands or after it fails,
-   * Force before the graph exists. The panel already derived `flat` and `ramp`
-   * from what is drawn; the **`kind` handed to the SVG and to `NodeShape` was
-   * not**, so the fallback came out as Tree geometry wearing Drift's
-   * stylesheet — `.diag-drift .diag-box { fill: transparent; stroke: none }`
-   * erased every row, the tree branch that draws the dot and the chevron never
-   * ran, and no `.diag-drift .diag-label` font size exists so the labels
-   * painted at the browser default. A picture that says "the picture below is
-   * the Tree instead" and then draws a broken one.
+   * A picture with no data used to be handed `layoutTree`, so the toggle that
+   * was pressed and the picture on screen were two different things, and every
+   * branch in this file had to remember which one it wanted. Twice it did not:
+   * the SVG's class and `NodeShape`'s branch both read `kind`, so the fallback
+   * came out as Tree geometry wearing Drift's stylesheet —
+   * `.diag-drift .diag-box { fill: transparent; stroke: none }` erased every
+   * row and no `.diag-drift .diag-label` font size exists, so the labels
+   * painted at the browser default. A picture that said "the picture below is
+   * the Tree instead" and then drew a broken one, with nothing thrown and
+   * nothing logged. GPT Sol found it on the built code on 2026-08-27, and it
+   * had been live in the round before that too, with `strata` in Tree's place.
    *
-   * Nothing throws and nothing logs — GPT Sol's finding on the built code,
-   * 2026-08-27, and it was live in the round before this one too, with `strata`
-   * where `tree` now is.
+   * `layoutDiagram` returns null instead now (diagrams.ts), the scroller shows
+   * a spinner or the error, and `kind` is the only answer to "which picture is
+   * this" — so the class of bug has nowhere left to live.
    */
-  const drawnKind: DiagramKind =
-    (wantsPoints && !drawingPoints) || (kind === "force" && !graph) ? "tree" : kind;
 
   /* The node the reader is standing in — the deepest one drawn, which is the
      same rule the summary panel's follow mark uses. Computed from the LAID OUT
@@ -1001,24 +994,17 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
           worse than useless to a reader who does not know what "variance"
           means. So it is one sentence in ordinary words, and it says the thing
           a percentage cannot: **the projection can only ever pull dots
-          together, never push them apart.** GPT Sol's finding, 2026-08-27. */}
-      {wantsPoints && projection.status !== "idle" && (
+          together, never push them apart.** GPT Sol's finding, 2026-08-27.
+
+          **Only when there is a picture to describe.** Waiting and failing used
+          to be reported here too, back when a fallback picture was drawn
+          underneath and something had to explain it. There is no fallback any
+          more, so those two states belong to `Waiting` inside the scroller —
+          where the picture is missing — and a strip that also announced them
+          would say the same thing twice in two places. */}
+      {drawingPoints && projection.status === "ready" && (
         <p className="diag-note" role="status">
-          {projection.status === "loading" && "Reading the article paragraph by paragraph…"}
-          {projection.status === "ready" && kept(projection)}
-          {/* **The server's own words, not a guess at them.** The route now
-              tells a provider outage apart from a bug of ours and says which;
-              a fixed sentence here would have reported an authentication
-              failure, a network drop and a broken deploy as the embedding model
-              being down. GPT Sol's finding, 2026-08-27. */}
-          {/* **The consequence first, the reason after, and the code last of
-              all.** It read the other way round until 2026-08-28, which put
-              "The picture below is the Tree instead." *after* the bracketed
-              code — so the one thing docs/project/copy.md asks of a code, that
-              it end the sentence and be skippable, was undone at the last
-              step. ⟨Sol⟩ */}
-          {projection.status === "error" &&
-            `The picture below is the Tree instead. ${projection.error ?? "Could not place these paragraphs, and the reason did not come back."}`}
+          {kept(projection)}
         </p>
       )}
 
@@ -1053,14 +1039,29 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
             This article has no usable tree, so there is nothing to draw. Run <code>npm run toc</code>{" "}
             for it and the picture appears.
           </p>
-        ) : layout === null ? (
+        ) : box === null || box.w === 0 ? (
           /* Before the first measure there is no width, and a diagram laid out
              against a guessed width would be visibly wrong for one frame. An
-             empty box for one frame is the cheaper mistake. */
+             empty box for one frame is the cheaper mistake — and it is a
+             *different* thing from waiting for data, which is the branch below,
+             which is why the two are told apart here rather than both falling
+             out of `layout === null`. One frame of spinner would flash. */
           <div className="diag-measuring" aria-hidden="true" />
+        ) : layout === null ? (
+          /**
+           * **Nothing to draw yet — a spinner or the reason, never another
+           * picture.** Greg, 2026-08-30: *"just show a loading spinner or
+           * error"*.
+           *
+           * Only the two scatters can reach this: Force needs no fetch to
+           * draw. **And it is the only voice while it is on screen** — the
+           * `.diag-note` strip above now says only what a *drawn* picture is,
+           * so a reader is never told the same thing twice in two registers.
+           */
+          <Waiting projection={projection} />
         ) : (
           <svg
-            className={`diag-svg diag-${drawnKind}`}
+            className={`diag-svg diag-${kind}`}
             width={layout.width}
             height={layout.height}
             viewBox={`0 0 ${layout.width} ${layout.height}`}
@@ -1070,11 +1071,12 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
                the price of a layout box per node in a picture that can hold a
                hundred of them. */
             /* **A listbox where the picture is a flat list of paragraphs, a
-               tree where it is a tree.** The six tree and graph pictures draw
-               nested sections and honour the whole tree contract; the two
-               scatters draw 276 paragraphs with no nesting and nothing to open,
-               so claiming `tree` there would describe a widget this code does
-               not implement. GPT Sol's finding, 2026-08-27. */
+               tree where it is a tree.** Force draws nested sections and
+               honours the whole tree contract — levels, sibling counts,
+               Left/Right meaning close and open; the two scatters draw 276
+               paragraphs with no nesting and nothing to open, so claiming
+               `tree` there would describe a widget this code does not
+               implement. GPT Sol's finding, 2026-08-27. */
             /* No `biome-ignore` here any more, and that is a consequence of the
                role being a variable: the rule that needed suppressing fires on a
                *literal* role, so a computed one is invisible to it. Left as a
@@ -1083,8 +1085,8 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
             role={flat ? "listbox" : "tree"}
             aria-label={
               flat
-                ? `${KIND_UI[drawnKind].label} view — one dot per paragraph, placed by what it is about`
-                : `${KIND_UI[drawnKind].label} view of the article's structure`
+                ? `${KIND_UI[kind].label} view — one dot per paragraph, placed by what it is about`
+                : `${KIND_UI[kind].label} view of the article's structure`
             }
             onPointerLeave={() => setHover(null)}
             onFocus={() => setHasFocus(true)}
@@ -1150,7 +1152,7 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
               <NodeShape
                 key={n.id}
                 node={n}
-                kind={drawnKind}
+                kind={kind}
                 flat={flat}
                 ramp={ramp}
                 here={n.id === here}
@@ -1162,7 +1164,6 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
                 onHover={setHover}
                 onRove={setRoving}
                 onKeyNav={onKeyNav}
-                onToggle={toggle}
               />
             ))}
             {/* You-are-here, as a line rather than a highlight — only on the
@@ -1239,6 +1240,58 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
   );
 }
 
+/**
+ * **What stands where the picture will be, when there is no picture yet.**
+ *
+ * Greg, 2026-08-30:
+ *
+ * > if while loading and/or if there's an error with one of the others (e.g.
+ * > with semantic embeddings), it falls back to Tree - instead, just show a
+ * > loading spinner or error.
+ *
+ * Only Drift and Trail can get here: Force draws four of its five kinds of line
+ * without asking the server anything. Three states, and they are three
+ * different sentences rather than one with a code appended —
+ *
+ *  - **loading** — the spinner, plus what the wait is *for*. A bare spinner in
+ *    a 288px band says "something", and a reader who has just pressed a chip
+ *    that costs a model call is owed the sentence.
+ *  - **ready with nothing to place** — an article of one long paragraph, or all
+ *    headings, comes back successful and empty. That is not an error and must
+ *    not be dressed as one.
+ *  - **error** — the consequence first, then the server's own words, which end
+ *    in a bracketed code the reader can quote (docs/project/copy.md). A fixed
+ *    sentence here would report an authentication failure, a network drop and a
+ *    broken deploy as the same thing, which is what this said before 2026-08-28.
+ *
+ * One `role="status"`, and only one: while this is on screen the `.diag-note`
+ * strip above says nothing, so a screen reader hears the wait once.
+ */
+function Waiting({ projection }: { projection: UseProjection }) {
+  if (projection.status === "error") {
+    return (
+      <p className="diag-wait" role="status">
+        Could not place these paragraphs.{" "}
+        {projection.error ?? "The reason did not come back."}
+      </p>
+    );
+  }
+  if (projection.status === "ready") {
+    return (
+      <p className="diag-wait" role="status">
+        Nothing here to place — a paragraph needs a dozen words before the model can say what it is
+        about, and this article has fewer than two that qualify.
+      </p>
+    );
+  }
+  return (
+    <p className="diag-wait" role="status">
+      <LoaderCircle className="cmt-spinner" size={14} aria-hidden="true" />
+      Reading the article paragraph by paragraph…
+    </p>
+  );
+}
+
 /**
  * One row of the second control strip — a radiogroup of small chips.
  *
@@ -1325,13 +1378,15 @@ function Choice<T extends string>({
  * half of the answer. GPT Sol's finding, 2026-08-27.
  */
 function kept(p: UseProjection): string {
-  /* **Nothing to draw is its own sentence.** An article of one long paragraph,
-     or one that is all headings, comes back ready and empty — and the general
-     wording below would tell the reader what percentage of the differences this
-     flat view keeps, of a view that is not there. GPT Sol's finding,
-     2026-08-27. */
+  /* **Nothing to draw is its own sentence**, and since 2026-08-30 it is not
+     said here: an article of one long paragraph, or one that is all headings,
+     comes back ready and empty, so there is no picture and this strip does not
+     render at all — `Waiting` says it instead, where the picture is missing.
+     The guard stays because the general wording below would otherwise report
+     what percentage of the differences a flat view keeps, of a view that is not
+     there. GPT Sol's finding, 2026-08-27. */
   if (p.blocks < 2) {
-    return "Not enough prose here to place — a paragraph needs a dozen words before the model can say what it is about. The picture below is the Tree instead.";
+    return "Not enough prose here to place — a paragraph needs a dozen words before the model can say what it is about.";
   }
   const held = Math.round((p.variance[0] + p.variance[1]) * 100);
   const short = p.skipped.tooShort + p.skipped.nonProse;
@@ -1454,7 +1509,6 @@ function NodeShape({
   onHover,
   onRove,
   onKeyNav,
-  onToggle,
 }: {
   node: DiagramNode;
   kind: DiagramKind;
@@ -1472,7 +1526,6 @@ function NodeShape({
   onHover(id: NodeId | null): void;
   onRove(id: NodeId): void;
   onKeyNav(e: React.KeyboardEvent, node: DiagramNode): void;
-  onToggle(id: NodeId): void;
 }) {
   const titles = node.titleLines;
   const step = LINE_STEP[kind];
@@ -1512,9 +1565,8 @@ function NodeShape({
       /* **`node.label` where the picture spends position on something colour is
          also carrying.** A scatter dot's topic and its place in the article are
          in its position and its hue and nowhere else, and colour-scales.md is
-         emphatic that colour is never allowed to be the only carrier. The six
-         other pictures have nothing extra to say and fall through to the
-         default. */
+         emphatic that colour is never allowed to be the only carrier. Force has
+         nothing extra to say and falls through to the default. */
       aria-label={node.label ?? `${label}, ${node.blocks} paragraph${node.blocks === 1 ? "" : "s"}`}
       {...(node.hasChildren && { "aria-expanded": !node.collapsed })}
       onPointerEnter={() => onHover(node.id)}
@@ -1522,12 +1574,7 @@ function NodeShape({
       onClick={() => onJump(node.blockId)}
       onKeyDown={(e) => onKeyNav(e, node)}
     >
-      {kind === "tree" ? (
-        <>
-          <rect className="diag-row" x={node.x} y={node.y} width={node.w} height={node.h} rx={3} />
-          <circle className="diag-dot" cx={node.labelX - 9} cy={node.y + 7.5} r={3.5} />
-        </>
-      ) : kind === "force" ? (
+      {kind === "force" ? (
         /* A bubble, and the box IS the circle here rather than a row around it —
            in a force layout the shape's position is the whole of the
            information, so a rectangular hit target would sit over its
@@ -1568,7 +1615,6 @@ function NodeShape({
             // the string or the width changes.
             // biome-ignore lint/suspicious/noArrayIndexKey: see above
             key={i}
-            className={kind === "tree" && i >= titles ? "diag-gist" : undefined}
             x={node.labelX}
             // The step for a line is the step for the half of the label it is
             // in, and the layout reserved the row's height with exactly these
@@ -1581,36 +1627,13 @@ function NodeShape({
         ))}
       </text>
 
-      {/* The paragraph count, on the pictures that have room for it. The answer
-          to "how much am I not seeing", which nothing else in this picture
-          says. */}
-      {kind === "tree" && (
-        <text className="diag-count" x={node.w - 6} y={node.y + 11} textAnchor="end">
-          {node.blocks}
-        </text>
-      )}
-
-      {node.hasChildren && kind === "tree" && (
-        // biome-ignore lint/a11y/useSemanticElements: SVG has no <button> — see the <svg> above
-        <g
-          className="diag-twist"
-          role="button"
-          tabIndex={-1}
-          aria-label={node.collapsed ? `Open ${label}` : `Close ${label}`}
-          onClick={(e) => {
-            // Or the row's own handler jumps the article at the same time.
-            e.stopPropagation();
-            onToggle(node.id);
-          }}
-        >
-          <rect x={node.labelX - 21} y={node.y} width={14} height={15} fill="transparent" />
-          {node.collapsed ? (
-            <ChevronRight x={node.labelX - 20} y={node.y + 2} size={11} />
-          ) : (
-            <ChevronDown x={node.labelX - 20} y={node.y + 2} size={11} />
-          )}
-        </g>
-      )}
+      {/* **The chevron was here, and it went with the Tree.** It was the only
+          pointer-driven way to fold a part away, and it only ever existed on
+          the Tree's rows — a 14px hit target beside a 7px dot is not something
+          a force bubble has room for. Folding is still in the picture on Force,
+          on ← and →, which is where the tree-view pattern puts it; the paragraph
+          count that sat at the end of a Tree row is in the footer card, where it
+          always also was. */}
     </g>
   );
 }
diff --git a/src/web/diagram.ts b/src/web/diagram.ts
index 6e1d925..6fa16ea 100644
--- a/src/web/diagram.ts
+++ b/src/web/diagram.ts
@@ -1,6 +1,14 @@
 /**
- * **The Diagram mode's shared vocabulary, and the one picture that is an
- * outline** — computed as pure numbers so it can be tested without a browser.
+ * **The Diagram mode's shared vocabulary** — the words every picture is
+ * described in, computed as pure numbers so they can be tested without a
+ * browser.
+ *
+ * No picture is laid out here any more. `force` is
+ * [diagram-d3.ts](./diagram-d3.ts) over [graph.ts](./graph.ts); `drift` and
+ * `trail` are [scatter.ts](./scatter.ts) over the server's projection. What is
+ * left in this file is what all three need — `DiagramNode`, `DiagramLink`,
+ * `walk`, `wrapText`, `LABEL_PX` — plus the two readers of a finished layout,
+ * `stepStops` and `nodeAt`.
  *
  * Greg, 2026-08-26:
  *
@@ -11,12 +19,16 @@
  * > will take up a few columns in the middle, so it should probably be
  * > vertically narrow, and think of the article's ordering as top to bottom.
  *
- * ## Nothing was installed **for these three**, and that is a finding
+ * ## Nothing was installed for the hand-rolled outline, and that is a finding
  *
- * Read this as history rather than as current fact: three more pictures arrived
- * on 2026-08-27 and they *are* D3-driven, over a richer data structure that did
- * not exist when the survey below was run. See [diagram-d3.ts](./diagram-d3.ts)
- * for what changed and why the argument here still stands for the tree pictures.
+ * Read this as history rather than as current fact. It is the survey that was
+ * run for the original `tree` picture, which was hand-rolled here and was cut
+ * on 2026-08-30; the three pictures that are left *are* D3-driven, over a
+ * richer data structure that did not exist when the survey was run. It stays
+ * because it is the reasoning behind the one property none of them gave up —
+ * down the page is later in the article — and because the next person to reach
+ * for a mindmap library should read it before they do. See
+ * [diagram-d3.ts](./diagram-d3.ts) for what changed.
  *
  * GPT-5.6 Luna was sent to survey the field first, per
  * docs/reusable/third-party-library-selection.md — d3-hierarchy, @visx/hierarchy,
@@ -39,40 +51,34 @@
  *  - Markmap and Mermaid mindmaps expand *sideways*. In this band that is not a
  *    styling problem, it is the wrong shape.
  *
- * So: hand-rolled SVG, one dependency-free module, and the layout arithmetic
- * lives here rather than inside a component, because that is what makes the
- * three sorting rules below testable.
+ * So: hand-rolled SVG, dependency-free modules, and the layout arithmetic lives
+ * in its own file rather than inside a component, because that is what makes it
+ * testable.
  *
- * ## What is left, after the cut
+ * ## What is left, after the cuts
  *
  * ```
- *        tree                  force              drift / trail
- *   ┌───────────────┐   ┌───────────────┐    ┌───────────────┐
- *   │ ● Being You   │   │    ◯───◯      │    │  ·   ·  ·     │
- *   │ ├─● 1 Waking  │   │   ╱ ╲ ╱       │    │ ·  ·   ·  ·   │
- *   │ │ └─● 1.1 The │   │  ◯───◯····◯   │    │   ·  ·        │
- *   │ │    body     │   │   ╲   ╲       │    │  ·   ·  ·   · │
- *   │ ├─● 2 The     │   │    ◯───◯      │    │ ·  ·      ·   │
- *   │ └─● 3 Being   │   │                │    │   ·  ·  ·     │
- *   └───────────────┘   └───────────────┘    └───────────────┘
- *    depth as indent    sections pulled       one dot per
- *    and elbows;        together by the       paragraph, placed
- *    one row each       words they share      by what it is about
+ *          force                    drift / trail
+ *   ┌───────────────┐            ┌───────────────┐
+ *   │    ◯───◯      │            │  ·   ·  ·     │
+ *   │   ╱ ╲ ╱       │            │ ·  ·   ·  ·   │
+ *   │  ◯───◯····◯   │            │   ·  ·        │
+ *   │   ╲   ╲       │            │  ·   ·  ·   · │
+ *   │    ◯───◯      │            │ ·  ·      ·   │
+ *   │               │            │   ·  ·  ·     │
+ *   └───────────────┘            └───────────────┘
+ *    sections pulled              one dot per
+ *    together by the              paragraph, placed
+ *    words they share             by what it is about
  * ```
  *
- * Only the first is in this file. `force` is [diagram-d3.ts](./diagram-d3.ts)
- * over [graph.ts](./graph.ts); `drift` and `trail` are
- * [scatter.ts](./scatter.ts) over the server's projection. What they all share
- * — `DiagramNode`, `DiagramLink`, `wrapText`, `LABEL_PX` — lives here, which is
- * why a router that knows about all three is its own file
- * ([diagrams.ts](./diagrams.ts)) rather than a function at the bottom of this
- * one.
+ * Neither is in this file, and what they share is. That is why a router that
+ * knows about both is its own file ([diagrams.ts](./diagrams.ts)) rather than a
+ * function at the bottom of this one.
  *
- * **`tree` keeps document order but not document scale**: every node gets the
- * room its label needs. That was a deliberate split while `strata` existed to
- * be the honest-about-proportion half of the pair, and it is worth saying
- * plainly that the pair is now a single: nothing in this mode is to scale any
- * more. The spine beside the band still is.
+ * **Nothing in this mode is to scale.** That was already true once `strata`
+ * went, and the spine beside the band is still where the reader gets a sense of
+ * proportion.
  *
  * ## Why text is wrapped by counting characters
  *
@@ -92,26 +98,38 @@ import type { SummaryNode } from "./tree.js";
 /**
  * Which picture. In the URL as `?diagram=` — see params.ts § diagramParam.
  *
- * **Four, and there were eight.** Greg cut Strata, Mindmap, Arc and Cluster on
- * 2026-08-27, and the four that went share one property: each of them was a
- * second way of drawing something another picture already draws. Mindmap and
- * Cluster were both the containment tree with different geometry — the
- * comparison GPT Sol had already said `tree` won. Arc drew the vocabulary edges
- * that `force` draws, on a line rather than in a plane. Strata was the odd one
- * out and the real loss: it was to scale, and nothing here is any more. Its
- * question — *how much of the piece is that section?* — is now answered by the
- * spine beside the band and by the paragraph count on a tree row, which is
- * weaker and is the price of a toggle bar you can take in at a glance.
- *
- * What is left is one picture per **kind of thing to say**: `tree` is the
- * outline (this file), `force` is the relationships a tree cannot hold
- * ([diagram-d3.ts](./diagram-d3.ts) over [graph.ts](./graph.ts)), and `drift`
- * and `trail` are the article as paragraphs placed by meaning
- * ([scatter.ts](./scatter.ts)). The order runs from the most faithful to the
- * article's own shape to the most interpretive, which is also from cheapest to
- * most surprising: the first costs nothing, the last three cost a model call.
+ * **Three, and there were eight.** Greg cut Strata, Mindmap, Arc and Cluster on
+ * 2026-08-27, and Tree on 2026-08-30. All five share one property: each was a
+ * second way of drawing something the reader could already get elsewhere.
+ * Mindmap and Cluster were the containment tree with different geometry. Arc
+ * drew the vocabulary edges that `force` draws, on a line rather than in a
+ * plane. And Tree, which outlasted them by three days, was the contents page
+ * with dots on it —
+ *
+ * > it's not interesting enough to keep, and it overlaps too much with
+ * > Hierarchy and Outline mode etc.
+ * >
+ * > — Greg, 2026-08-30
+ *
+ * Strata is still the odd one out and the real loss: it was to scale, and
+ * nothing here is any more. Its question — *how much of the piece is that
+ * section?* — is answered by the spine beside the band, which is weaker and is
+ * the price of a toggle bar you can take in at a glance.
+ *
+ * What is left is one picture per **kind of thing to say**: `force` is the
+ * relationships an outline cannot hold ([diagram-d3.ts](./diagram-d3.ts) over
+ * [graph.ts](./graph.ts)), and `drift` and `trail` are the article as
+ * paragraphs placed by meaning ([scatter.ts](./scatter.ts)). The order runs
+ * from the most faithful to the article's own shape to the most interpretive.
+ *
+ * **All three now cost a model call**, which is what ended the argument for a
+ * free default. `force` is the cheapest of them and the only one that draws
+ * something real before its answer lands — four of its five kinds of line are
+ * arithmetic over prose the browser already holds — so it is the default, and
+ * the other two show a spinner rather than borrowing a picture that is not
+ * theirs. See [diagrams.ts](./diagrams.ts).
  */
-export const DIAGRAMS = ["tree", "force", "drift", "trail"] as const;
+export const DIAGRAMS = ["force", "drift", "trail"] as const;
 export type DiagramKind = (typeof DIAGRAMS)[number];
 
 /**
@@ -194,8 +212,8 @@ export interface DiagramNode {
  * file, and a type going the other way would be an import cycle, which
  * `npm run check` gates on (docs/project/static-analysis.md).
  *
- * The three tree pictures leave `kind` unset: on a tree every line is
- * containment, so naming it would be ceremony.
+ * The cut tree pictures left `kind` unset, on the grounds that on a tree every
+ * line is containment. It is required now — see `DiagramLink.kind` below.
  */
 export type LinkKind = (typeof LINK_KINDS)[number];
 
@@ -222,20 +240,18 @@ export interface DiagramLink {
   d: string;
   part: number;
   /**
-   * **A per-picture rendering band, and it means three different things.**
+   * **A per-picture rendering band, and it means a different thing in each.**
    *
-   * On `tree` and `mindmap` it is the depth of the node the line hangs off. On
-   * `arc` it is the edge's *weight*, quantised into the three stroke widths the
-   * stylesheet has. On `force` it used to be the edge's *kind* — 0 for
-   * sequence, 1 for parent, 2 for vocabulary — which worked for exactly three
-   * kinds and stopped working at five.
+   * On `force` it is the depth of the node the line hangs off; on `trail` it is
+   * the step of the sequential ramp the segment is painted at. It has also been
+   * an edge's quantised *weight* (`arc`, cut) and an edge's *kind* (`force`,
+   * until five kinds outgrew three numbers) — that last use is what `kind`
+   * below replaced.
    *
-   * That third use is what `kind` below replaced. The other two are left alone
-   * because each picture's stylesheet is written against them, and the honest
-   * description of this field is that it is a channel a layout may use, not a
-   * fact about the graph. GPT Sol pointed out that Arc had already made it one;
-   * pretending otherwise here would be the kind of comment that is worse than
-   * none.
+   * The honest description of this field is that it is a channel a layout may
+   * use, not a fact about the graph. GPT Sol pointed out that Arc had already
+   * made it one; pretending otherwise here would be the kind of comment that is
+   * worse than none.
    */
   depth: number;
   /**
@@ -243,9 +259,8 @@ export interface DiagramLink {
    *
    * An optional discriminator would leave the exact trap this replaced: a sixth
    * kind of Force edge could be added, forget to say what it is, and compile.
-   * Every layout therefore names the kind of every line it draws — and on the
-   * tree pictures that is not ceremony, because every line there really is
-   * containment and saying so costs one word.
+   * Every layout therefore names the kind of every line it draws, even where a
+   * picture only ever draws one kind and saying so costs a word.
    */
   kind: LinkKind;
   /**
@@ -363,7 +378,6 @@ const CHAR_W = 0.52;
 export const UNLABELLED: ReadonlySet<DiagramKind> = new Set<DiagramKind>(["drift", "trail"]);
 
 export const LABEL_PX: Record<DiagramKind, Record<number, number>> = {
-  tree: { 0: 12, 1: 12, 2: 12 },
   // Only a number goes inside a force bubble, and it is small.
   force: { 0: 10, 1: 10, 2: 10 },
   /* Nothing is written on a scatter dot at all — `lines` is always empty
@@ -374,9 +388,6 @@ export const LABEL_PX: Record<DiagramKind, Record<number, number>> = {
   trail: { 0: 11, 1: 11, 2: 11 },
 };
 
-/** The gist's size, on the one picture that draws one. Same contract as above. */
-export const GIST_PX = 10.5;
-
 /**
  * Baseline-to-baseline step, by picture and by which half of the label a line
  * is in.
@@ -388,7 +399,6 @@ export const GIST_PX = 10.5;
  * as slightly uneven spacing rather than as an overflow.
  */
 export const LINE_STEP: Record<DiagramKind, { title: number; gist: number }> = {
-  tree: { title: 15, gist: 12 },
   // Force puts one line on a node and the rest in the footer card.
   force: { title: 12, gist: 12 },
   // The two scatters write nothing on a dot; everything is in the card.
@@ -482,11 +492,11 @@ export function wrapText(text: string, maxChars: number, maxLines: number): stri
  *
  * `buildSummaryTree` already stops at 2 by default and `DiagramBand` takes the
  * default, so today this changes nothing. It is here because the layouts
- * silently assume it — `layoutTree` indents by depth and would run a fourth
- * level off the right edge of a 288px band, and the stylesheet has font sizes
- * for `diag-d0` to `diag-d2` and nothing below. Raising `buildSummaryTree`'s
- * limit for some other caller must not quietly change what this file draws, so
- * the ceiling is asserted here rather than inherited.
+ * silently assume it — the stylesheet has font sizes and fills for `diag-d0` to
+ * `diag-d2` and nothing below, and `graph.ts` calls a node at this depth a leaf
+ * whether or not it has children. Raising `buildSummaryTree`'s limit for some
+ * other caller must not quietly change what these pictures draw, so the ceiling
+ * is asserted here rather than inherited.
  */
 export const MAX_DRAWN_DEPTH = 2;
 
@@ -517,98 +527,6 @@ export function walk(
   return out;
 }
 
-/* ── tree: the picture that is legible ──────────────────────────────────── */
-
-const TREE_INDENT = 15;
-const TREE_LEFT = 12;
-const TREE_GAP = 7;
-const DOT_R = 3.5;
-
-/**
- * **Tree** — a vertical outline with elbow connectors, one row per node, each
- * row as tall as its own text needs.
- *
- * Luna's shape, and the reason it is this rather than `d3-hierarchy.tree()`:
- * *"assign `y` by a preorder traversal, advance `y` by the rendered height of
- * each visible node"*. A tidy tree balances leaves against each other; an
- * article outline wants them in the order they were written, each taking the
- * room its own name needs.
- *
- * A gist is drawn only on nodes shallower than 2 — at depth 2 there are enough
- * of them that the picture stops being a picture and becomes the summary panel,
- * which already exists and is better at it.
- */
-export function layoutTree(root: SummaryNode, opts: DiagramOptions): DiagramLayout {
-  const entries = walk(root, opts.collapsed);
-  const nodes: DiagramNode[] = [];
-  const links: DiagramLink[] = [];
-  /** Where each node's dot ended up, so its children can draw back to it. */
-  const anchors = new Map<NodeId, { x: number; y: number }>();
-
-  let y = 10;
-  for (const e of entries) {
-    const { node: n } = e;
-    const depth = n.node.depth;
-    const dotX = TREE_LEFT + depth * TREE_INDENT;
-    const textX = dotX + 9;
-    const avail = opts.width - textX - 26; // 26 keeps the ¶ count clear of the text
-    const label = n.number ? `${n.number}  ${n.node.title}` : n.node.title;
-    const titleLines = wrapText(label, charsThatFit(avail, LABEL_PX.tree[depth] ?? 12), 2);
-    const gistLines =
-      depth < 2 && n.gist && !e.collapsed
-        ? wrapText(n.gist, charsThatFit(avail, GIST_PX), depth === 0 ? 3 : 2)
-        : [];
-    const h = titleLines.length * LINE_STEP.tree.title + gistLines.length * LINE_STEP.tree.gist;
-    const dotY = y + LINE_STEP.tree.title / 2;
-
-    const parent = n.node.parent === null ? undefined : anchors.get(n.node.parent);
-    if (parent) {
-      /* An elbow with a rounded corner: straight down the parent's column, a
-         quarter turn, straight across to the child. Drawn from the PARENT's x
-         so that several children share one vertical stroke — which is what
-         makes the indent read as a tree rather than as a list of dashes. */
-      const r = Math.min(6, Math.max(0, dotX - parent.x), Math.max(0, dotY - parent.y));
-      links.push({
-        id: `${n.node.parent}-${n.node.id}`,
-        d: `M ${parent.x} ${parent.y + DOT_R} V ${dotY - r} Q ${parent.x} ${dotY} ${parent.x + r} ${dotY} H ${dotX - DOT_R}`,
-        part: e.part,
-        depth,
-        kind: "parent",
-      });
-    }
-    anchors.set(n.node.id, { x: dotX, y: dotY });
-
-    nodes.push({
-      id: n.node.id,
-      blockId: n.node.range[0],
-      depth,
-      number: n.number,
-      title: n.node.title,
-      ...(n.gist !== undefined && { gist: n.gist }),
-      blocks: n.blocks,
-      startRow: n.startRow,
-      endRow: n.endRow,
-      part: e.part,
-      // The hit target is the whole row, not the dot: a 7px circle is not a
-      // click target, and the row is what the reader thinks they are pointing at.
-      x: 0,
-      y,
-      w: opts.width,
-      h: h + TREE_GAP,
-      labelX: textX,
-      labelY: y + 11,
-      anchor: "start",
-      lines: [...titleLines, ...gistLines],
-      titleLines: titleLines.length,
-      hasChildren: n.children.length > 0,
-      collapsed: e.collapsed,
-    });
-    y += h + TREE_GAP;
-  }
-
-  return { width: opts.width, height: Math.max(opts.height, y + 10), nodes, links, axis: null, nowY: null };
-}
-
 /**
  * One rung of the step ladder: a row, and what pressing there jumps to.
  *
@@ -626,16 +544,16 @@ export interface StepStop {
  * and what the panel's ↑ / ↓ buttons walk.
  *
  * Rows rather than nodes, and that is the first half of the design. A layout's
- * `nodes` are in *preorder*, so on a tree the root, part 1 and section 1.1 all
+ * `nodes` are in *preorder*, so on Force the root, part 1 and section 1.1 all
  * begin on the same row: stepping by node would press ↓ three times and move
  * the article nowhere, which reads as a broken button. Distinct rows make one
  * press always one visible move — and they make the *unit* come out right by
- * itself, sections on the tree pictures and single paragraphs on the two
- * scatters, because those are the rows those pictures draw.
+ * itself, sections on Force and single paragraphs on the two scatters, because
+ * those are the rows those pictures draw.
  *
  * **The row is the row of `blockId`, not `startRow`, and that is the second
- * half.** They agree on every tree picture, where a node's range begins at the
- * block it jumps to. They do **not** agree on a scatter: a dot's range is
+ * half.** They agree on Force, where a node's range begins at the block it
+ * jumps to. They do **not** agree on a scatter: a dot's range is
  * stretched to tile the article so that a reader standing in a paragraph too
  * short to embed still has a dot answering for them (scatter.ts § dots), so the
  * first dot claims `startRow: 0` while its block may be the third paragraph.
diff --git a/src/web/diagrams.ts b/src/web/diagrams.ts
index 7579d79..3cf8e47 100644
--- a/src/web/diagrams.ts
+++ b/src/web/diagrams.ts
@@ -1,39 +1,51 @@
 /**
- * **Which of the four to draw** — the router, and nothing else.
+ * **Which of the three to draw** — the router, and nothing else.
  *
  * It is its own file for one reason: [diagram.ts](./diagram.ts) owns the shared
- * vocabulary (`DiagramNode`, `wrapText`, `LABEL_PX`) and the one hand-rolled
- * tree picture, and [diagram-d3.ts](./diagram-d3.ts) and
- * [scatter.ts](./scatter.ts) both need all of that to build theirs. So they
- * depend on the tree module, and a router living in the tree module would
- * depend back on them — **an import cycle, which `npm run check` gates on**
- * (docs/project/static-analysis.md). Two modules and a third that knows about
- * both is the shape that has no cycle in it.
+ * vocabulary (`DiagramNode`, `wrapText`, `LABEL_PX`), and
+ * [diagram-d3.ts](./diagram-d3.ts) and [scatter.ts](./scatter.ts) both need all
+ * of that to build theirs. So they depend on the vocabulary module, and a
+ * router living in that module would depend back on them — **an import cycle,
+ * which `npm run check` gates on** (docs/project/static-analysis.md). Two
+ * modules and a third that knows about both is the shape that has no cycle in
+ * it.
  *
- * Everything else about the four lives in the files this imports.
+ * Everything else about the three lives in the files this imports.
  */
 import type { SummaryNode } from "./tree.js";
-import { type DiagramKind, type DiagramLayout, type DiagramOptions, layoutTree } from "./diagram.js";
+import type { DiagramKind, DiagramLayout, DiagramOptions } from "./diagram.js";
 import { layoutForce } from "./diagram-d3.js";
 import type { ArticleGraph } from "./graph.js";
 import { layoutDrift, layoutTrail, type ScatterInput } from "./scatter.js";
 import type { Block } from "../types.js";
 
 /**
- * The one entry point the panel uses.
+ * The one entry point the panel uses. **`null` means "this picture's data is
+ * not here yet"**, and the panel draws a spinner or an error in its place.
  *
- * Force needs the **graph** rather than the tree, and it is optional here
- * rather than required: the graph needs the article's blocks, and a caller
- * holding only a tree should still get a picture rather than an error. Asking
- * for it without one falls back to `tree` — the same "a link from a future
- * version degrades to something real" rule params.ts applies to every parameter
- * it parses.
+ * ## It used to fall back to a picture, and that was the wrong answer
  *
- * **The fallback used to be `strata`**, which was the right choice while it
- * existed: it was the cheapest picture and the only one whose vertical axis was
- * the article, so a reader waiting for embeddings still got something that
- * followed them down the page. `tree` follows the reader too — it marks the
- * node you are standing in — it just cannot draw the line across.
+ * Until 2026-08-30 a picture with no data got `layoutTree` — the outline, which
+ * was free — on the reasoning that *a picture of something real with a line of
+ * explanation beats a spinner over an empty box*. Two things were wrong with
+ * it. The Tree is gone, cut for overlapping the outline and hierarchy views
+ * that already exist. And a mode that answers a question you did not ask, while
+ * a strip above it explains in small type that this is not the picture you
+ * pressed, is a worse failure than an honest wait — it was also the source of a
+ * whole class of bug on its own, because every branch in the panel then had to
+ * remember that `kind` and what is on screen are different things, and twice it
+ * did not.
+ *
+ * Greg, 2026-08-30:
+ *
+ * > if while loading and/or if there's an error with one of the others (e.g.
+ * > with semantic embeddings), it falls back to Tree - instead, just show a
+ * > loading spinner or error.
+ *
+ * So: no picture stands in for another. Force is the exception that proves it —
+ * it needs no fetch to draw, because four of its five kinds of line are
+ * arithmetic over prose the browser already holds, and the model's opinion only
+ * adds the fifth.
  */
 export function layoutDiagram(
   kind: DiagramKind,
@@ -41,24 +53,23 @@ export function layoutDiagram(
   opts: DiagramOptions,
   graph?: ArticleGraph | null,
   scatter?: { blocks: readonly Block[]; input: ScatterInput } | null,
-): DiagramLayout {
+): DiagramLayout | null {
   /* **The two scatters take a fifth argument rather than a fatter
      `DiagramOptions`**, and it is worth saying why: what they need is not a
      *setting*, it is a whole second data source — the server's projection of
-     the article, which arrives after the picture is first drawn and is absent
-     on the other two. Putting it in the options would offer it to layouts that
-     must never look at it, and would make `DiagramOptions` mean two different
-     things. Same reason `graph` is its own argument. */
+     the article, which arrives after the toggle is pressed and is absent on
+     Force. Putting it in the options would offer it to a layout that must never
+     look at it, and would make `DiagramOptions` mean two different things. Same
+     reason `graph` is its own argument. */
   if (kind === "drift" || kind === "trail") {
-    /* Without an answer yet, this falls back to `tree` — the same rule
-       params.ts applies to a parameter from a future version: **degrade to
-       something real rather than to nothing.** The panel's strip is what says
-       the dots are still coming; a blank picture would say nothing at all. */
-    if (!scatter || scatter.input.points.length === 0) return layoutTree(root, opts);
+    if (!scatter || scatter.input.points.length === 0) return null;
     return kind === "drift"
       ? layoutDrift(root, scatter.blocks, opts, scatter.input)
       : layoutTrail(root, scatter.blocks, opts, scatter.input);
   }
-  if (kind === "force") return graph ? layoutForce(graph, opts) : layoutTree(root, opts);
-  return layoutTree(root, opts);
+  /* The graph is built in the browser from blocks the page already has, so in
+     the app this is null only when there is no usable tree — which the panel
+     has already said out loud in words. It is still a null rather than a throw,
+     because a caller holding only a tree should get a wait rather than a crash. */
+  return graph ? layoutForce(graph, opts) : null;
 }
diff --git a/src/web/params.ts b/src/web/params.ts
index efa319f..90f682d 100644
--- a/src/web/params.ts
+++ b/src/web/params.ts
@@ -238,55 +238,25 @@ export const panelParam = createParser<Panel>({
  * (docs/project/summaries.md). Diagram is the fifth
  * (docs/project/diagram.md), and it cost this list one word as well.
  */
-export const MODES = [
-  /* Renamed from `toc` on 2026-08-29, at Greg's request: the reader sees
-     "Hierarchy" and the code now says the same word. It also ends a collision
-     that had lasted as long as the list — `toc` was simultaneously this mode and
-     the *pipeline step* that builds tree.json (src/pipeline.ts § STEP_ORDER), so
-     one word meant two things in one repo. The step keeps the name; the mode
-     gives it up. docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 3. */
-  "hierarchy",
-  "chat",
-  "glossary",
-  "search",
-  "summary",
-  "diagram",
-  "ideas",
-  /* Review is the seventh, 2026-08-27, and the first mode whose content comes
-     from the reader rather than from the article: they say what they took from
-     it and the model helps them find where that comes apart. It cost this list
-     one word, like the five before it. docs/plans/260827ah-review-mode.md.
-
-     There is deliberately no `?stance=` beside `?thread=` below. The stance
-     governs the next answer and changes nothing on screen, which is the rule
-     this file keeps — the closest existing thing is chat's profile checkbox,
-     which is component state for the same reason. */
-  "review",
-  /* The eighth, 2026-08-28: the whole document as one nested list that never
-     scrolls and expands around where the reader is. It costs this list one
-     word like the six before it, and it is the first mode that is a second
-     answer to a question an existing surface already answers — the gist
-     columns' context panels — rather than a new question. That is deliberate
-     and temporary: Greg asked for it as an eighth mode "for now, so that it
-     doesn't mess with what we have, and so that I can go back and forth to
-     compare". docs/plans/260828aw-outline-mode.md § Where it sits, and what happens if
-     it wins. */
-  "outline",
-] as const;
-export type Mode = (typeof MODES)[number];
-
-/**
- * The mode a reader lands in, named once.
- *
- * Two places need it — `modeParam`'s fallback below, and `withMode` in
- * src/web/Dock.tsx, which omits the parameter when it is writing this value. A
- * literal in both would be two copies of one decision, and the copy that drifts
- * is the one that puts a redundant `?mode=` back into every URL.
- */
-export const DEFAULT_MODE: Mode = "hierarchy";
+/* **Moved to src/modes.ts on 2026-08-30**, and re-exported here so that every
+   importer of this file is unchanged. The server composes the same titles now
+   and cannot import anything under `src/web/`; the reasoning and the history of
+   the list are in that file's header. */
+import { isMode } from "../modes.js";
+export { isMode };
+/* Imported as well as re-exported: `export … from` creates no local binding, and
+   `modeParam` below uses all three. */
+import { DEFAULT_MODE, MODES, type Mode } from "../modes.js";
+export { DEFAULT_MODE, MODES, type Mode };
 
 export const modeParam = createParser<Mode>({
-  parse: (v) => (MODES.includes(v as Mode) ? (v as Mode) : null),
+  /* `isMode` and not a second `MODES.includes` here. The serverless function
+     that composes a shared article's `<title>` asks the same question of the
+     same query string (`readMode` in src/vercel.ts), and this file used to
+     answer it independently — so "one place decides what a mode is" was a claim
+     rather than a fact, and no test paired the two on an invalid input. GPT Sol,
+     2026-08-30. */
+  parse: (v) => (isMode(v) ? v : null),
   serialize: (v) => v,
 })
   .withDefault(DEFAULT_MODE)
@@ -748,31 +718,36 @@ export const rungParam = createParser<Rung>({
 /**
  * Which picture the Diagram mode is drawing.
  *
- * Four of them, and the toggle is not a skin — see src/web/diagram.ts for what
- * each one is honest about, and for why there were eight until 2026-08-27.
- * Short version: `tree` is the outline, `force` is the relationships an outline
+ * Three of them, and the toggle is not a skin — see src/web/diagram.ts for what
+ * each one is honest about, and for why there were eight until 2026-08-27 and
+ * four until 2026-08-30. Short version: `force` is the relationships an outline
  * cannot hold, and `drift` and `trail` are the article as paragraphs placed by
  * meaning. That is a real choice a reader makes, so it belongs in the URL like
  * every other bit of view state (docs/project/url-state.md).
  *
- * **`tree` is the default because it is the only one that is free.** The other
- * three all spend a model call the moment they are drawn, and a default that
- * bills the reader for opening a mode is not a default — it is a purchase
- * nobody agreed to. (The old default, `strata`, was free too, and was cut.)
+ * **`force` is the default because it is the only one that draws anything
+ * before its answer lands.** All three spend a model call now that the free
+ * picture — `tree`, the outline — has been cut for overlapping the outline and
+ * hierarchy views that already exist. Force's call only adds the dotted lines;
+ * the rest of it is arithmetic over prose the browser is already holding, so
+ * opening the mode still shows the reader something immediately. Drift and
+ * Trail have nothing at all without the projection, and now say so with a
+ * spinner rather than borrowing another picture.
  *
  * `push`, like `?rung=` and `?cols=`. Switching picture is a deliberate act on
  * the view and Back should undo it — and unlike stepping between glossary terms,
  * you do not do it twice in ten seconds.
  *
- * **A cut picture's name degrades to `tree`** rather than throwing, the same
- * rule as every other parser in this file — which is what stops a link somebody
- * pasted in August, saying `?diagram=strata`, from opening a broken page.
+ * **A cut picture's name degrades to the default** rather than throwing, the
+ * same rule as every other parser in this file — which is what stops a link
+ * somebody pasted in August, saying `?diagram=strata` or `?diagram=tree`, from
+ * opening a broken page.
  */
 export const diagramParam = createParser<DiagramKind>({
   parse: (v) => (DIAGRAMS.includes(v as DiagramKind) ? (v as DiagramKind) : null),
   serialize: (v) => v,
 })
-  .withDefault("tree")
+  .withDefault("force")
   .withOptions({ history: "push" });
 
 /**
diff --git a/src/web/styles.css b/src/web/styles.css
index f335cca..a86a289 100644
--- a/src/web/styles.css
+++ b/src/web/styles.css
@@ -6041,63 +6041,6 @@ td.text.has-hit[data-hues="8"] {
   font-size: 0.78rem;
 }
 
-/* The steer. Collapsed to one quiet line until it has something to say, so the
-   ordinary case — nobody is steering anything — costs the foot one row.
-   SummaryPanel.tsx § the box you steer a rewrite with. */
-.summ-steer-open {
-  display: inline-flex;
-  align-items: center;
-  gap: 0.3rem;
-  margin-bottom: 0.4rem;
-  padding: 0;
-  border: 0;
-  background: transparent;
-  color: var(--ink-faint);
-  font-family: var(--font-ui);
-  font-size: 0.72rem;
-  cursor: pointer;
-}
-.summ-steer-open:hover { color: var(--highlight-ink); }
-
-.summ-steer { margin-bottom: 0.5rem; }
-.summ-steer-label {
-  display: block;
-  margin-bottom: 0.25rem;
-  color: var(--ink-faint);
-  font-family: var(--font-ui);
-  font-size: 0.7rem;
-  letter-spacing: 0.03em;
-  text-transform: uppercase;
-}
-.summ-steer-box {
-  display: block;
-  width: 100%;
-  padding: 0.35rem 0.45rem;
-  border: 1px solid var(--rule-strong);
-  border-radius: 5px;
-  background: var(--surface-raised);
-  color: var(--ink);
-  /* The reading face: this is a sentence somebody writes, not a setting. */
-  font-family: var(--font-reading);
-  font-size: 0.8rem;
-  line-height: 1.4;
-  resize: vertical;
-}
-.summ-steer-box:focus-visible {
-  outline: none;
-  border-color: var(--highlight);
-}
-.summ-steer-box:disabled { opacity: 0.5; }
-/* Said where the reader is typing, not in a doc: this is the promise that makes
-   the box safe to use, and the rules that keep it are in the prompt. */
-.summ-steer-note {
-  margin: 0.3rem 0 0;
-  color: var(--ink-faint);
-  font-family: var(--font-ui);
-  font-size: 0.68rem;
-  line-height: 1.35;
-}
-
 /* The summary panel's run button, its running row and its spinner used to be
    here — .summ-btn, .summ-running, .summ-detail-live, .summ-spin. They went on
    2026-08-26 with the third copy of the component that used them: the glossary,
@@ -6366,10 +6309,12 @@ td.text.has-hit[data-hues="8"] {
   letter-spacing: 0.03em;
   text-transform: uppercase;
 }
-/* Deliberately the same shape as .summ-steer-box: this is the third free-text
-   box in the app about what the reader wants, and the three should not look
-   like three different mechanisms. The reading face, because this is a
-   sentence somebody writes rather than a setting they pick. */
+/* The two free-text boxes in the app about what the reader wants — "about you"
+   and "why you're reading this one" — and they share this so they do not look
+   like two different mechanisms. There were three until 2026-08-30, when the
+   summary steer went (docs/plans/260830o-steer-becomes-the-profile.md) and .summ-steer-box
+   with it. The reading face, because this is a sentence somebody writes rather
+   than a setting they pick. */
 .prof-box-input {
   display: block;
   width: 100%;
@@ -7026,12 +6971,15 @@ td.text.has-hit[data-hues="8"] {
   overflow-y: auto;
   overflow-x: hidden;
   /* **Load-bearing.** The picture is laid out against this element's measured
-     `clientWidth`, and `tree` gets TALLER as it gets narrower (labels wrap onto
-     more lines). Without a reserved gutter that is a loop: content just fits →
-     no scrollbar → wider → wraps to fewer lines → still fits… and on the way
-     back, content just overflows → scrollbar → narrower → wraps to more lines →
-     overflows more. On macOS overlay scrollbars take no width and it never
-     happens, which is exactly why this would have shipped. */
+     `clientWidth`, and a picture whose height depends on that width — the cut
+     Tree got taller as it got narrower, because labels wrapped onto more lines
+     — makes a loop of it: content just fits → no scrollbar → wider → wraps to
+     fewer lines → still fits… and on the way back, content just overflows →
+     scrollbar → narrower → wraps to more lines → overflows more. On macOS
+     overlay scrollbars take no width and it never happens, which is exactly why
+     it would have shipped. Nothing drawn today wraps a label, so this is a
+     guard rather than a fix — and the next picture that wraps one must not have
+     to rediscover it. */
   scrollbar-gutter: stable;
   padding: 0 0.5rem;
 }
@@ -7045,6 +6993,30 @@ td.text.has-hit[data-hues="8"] {
   font-size: 0.8rem;
   line-height: 1.5;
 }
+/* **The wait, and only ever where the picture is missing.** Drift and Trail
+   have nothing at all to draw until the projection lands; until 2026-08-30 they
+   borrowed the Tree, which is the picture this app no longer has. Centred
+   rather than pinned to the top, because it stands in for the whole band and a
+   line of grey text at the top of an empty column reads as a caption for
+   nothing. `.cmt-spinner` is the app's one spinner — docs/project/icons.md. */
+.diag-wait {
+  display: flex;
+  align-items: center;
+  justify-content: center;
+  gap: 0.4rem;
+  /* Not `height: 100%`: the scroller is a flex child with `min-height: 0`, and
+     a percentage height against it collapses to nothing when the panel is
+     short. `min-height` on the paragraph itself is what makes the box real. */
+  min-height: 8rem;
+  margin: 0.9rem 0.2rem;
+  padding: 0 0.6rem;
+  color: var(--ink-faint);
+  font-size: 0.78rem;
+  line-height: 1.5;
+  text-align: center;
+  text-wrap: balance;
+}
+.diag-wait .cmt-spinner { flex: none; }
 
 .diag-svg { display: block; }
 
@@ -7073,13 +7045,11 @@ td.text.has-hit[data-hues="8"] {
    "which part", and overloading it would make the you-are-here mark change
    colour as you read, which is exactly the property a position marker must not
    have. Orange, because that is what "here" is everywhere else in this app. */
-.diag-node.here .diag-box,
-.diag-node.here .diag-row {
+.diag-node.here .diag-box {
   stroke: var(--highlight);
   stroke-width: 1.5;
 }
-.diag-node:focus-visible .diag-box,
-.diag-node:focus-visible .diag-row {
+.diag-node:focus-visible .diag-box {
   stroke: var(--highlight);
   stroke-width: 1.5;
   stroke-dasharray: 3 2;
@@ -7093,7 +7063,7 @@ td.text.has-hit[data-hues="8"] {
 .diag-node.diag-d1 .diag-label { fill: var(--ink-soft); }
 .diag-node.diag-d0 .diag-label { font-weight: 600; }
 
-/* **These nine numbers are duplicated in TypeScript and must not drift.**
+/* **These three numbers are duplicated in TypeScript and must not drift.**
    `LABEL_PX` in diagram.ts cuts every label to fit by counting characters at
    these sizes; this is where they are actually painted. Disagree and nothing
    errors — too small wastes the band, too large runs the text out over the
@@ -7103,46 +7073,28 @@ td.text.has-hit[data-hues="8"] {
 
    Written one rule per picture per depth, at one uniform specificity, rather
    than as a base plus overrides — a base rule beaten by a longer selector is
-   exactly how the tree's titles ended up painted at 10px after being budgeted
-   for 12. */
-.diag-tree .diag-node.diag-d0 .diag-label { font-size: 12px; }
-.diag-tree .diag-node.diag-d1 .diag-label { font-size: 12px; }
-.diag-tree .diag-node.diag-d2 .diag-label { font-size: 12px; }
+   exactly how the cut Tree's titles ended up painted at 10px after being
+   budgeted for 12. There were nine of these until Tree went and the two
+   scatters, which write nothing on a dot, are exempt by name (`UNLABELLED` in
+   diagram.ts); one picture left is not a reason to collapse them to a base
+   rule. */
 .diag-force .diag-node.diag-d0 .diag-label { font-size: 10px; }
 .diag-force .diag-node.diag-d1 .diag-label { font-size: 10px; }
 .diag-force .diag-node.diag-d2 .diag-label { font-size: 10px; }
 
-/* The gist, on the one picture that draws one. It is on the <tspan> rather than
-   the <text>, so it beats the sizes above by being on the element itself —
-   inheritance, not specificity. `GIST_PX` in diagram.ts is the pair. */
-.diag-gist { fill: var(--ink-faint); font-size: 10.5px; }
-.diag-count {
-  fill: var(--ink-faint);
-  font-family: var(--font-ui);
-  font-size: 9.5px;
-  pointer-events: none;
-}
-
-/* ---- tree ---- */
-
-.diag-row { fill: transparent; stroke: none; }
-.diag-node:hover .diag-row,
-.diag-node.on .diag-row { fill: var(--surface-raised); }
+/* The mark inside a scatter's hit rectangle — 3px of dot in a target big enough
+   for a finger. The Tree drew one of these on every row too, and its `.closed`
+   variant (a hollow dot for a folded part) went with it. */
 .diag-dot {
   fill: rgb(var(--cat-rgb) / 0.9);
   stroke: var(--panel);
   stroke-width: 1;
 }
-.diag-node.closed .diag-dot { fill: var(--panel); stroke: rgb(var(--cat-rgb) / 0.9); stroke-width: 1.5; }
-.diag-twist { color: var(--ink-faint); cursor: pointer; }
-.diag-twist:hover { color: var(--ink); }
 
 .diag-link {
   stroke: var(--rule-strong);
   stroke-width: 1;
 }
-.diag-tree .diag-link { stroke: rgb(var(--cat-rgb) / 0.4); }
-.diag-tree .diag-link.diag-d1 { stroke: rgb(var(--cat-rgb) / 0.55); }
 
 /* ---- you are here ---- */
 
diff --git a/src/web/useProjection.ts b/src/web/useProjection.ts
index 414d1d0..8433ef6 100644
--- a/src/web/useProjection.ts
+++ b/src/web/useProjection.ts
@@ -14,19 +14,24 @@
  * **`enabled` is the whole gate.** This and `useSimilar` are the only fetches
  * in the reading view that spend money without a button saying so. Pressing a
  * diagram toggle is not a purchase decision, so the request happens on exactly
- * the two pictures that draw it and never on the other six. The vectors are
+ * the two pictures that draw it and never on the third. The vectors are
  * shared with `useSimilar`'s answer on the server, so a reader who has already
  * opened Force pays only for the arithmetic.
  *
- * **It never blocks the picture.** Unlike Force — which is four fifths drawn
- * without any of this — Drift and Trail have *nothing* to draw without it, so
- * they fall back to `tree` until the answer lands (see `layoutDiagram`) and
- * the strip beside the picture says what is happening. A picture of something
- * real with a line of explanation beats a spinner over an empty box.
+ * **It blocks the picture, and the picture says so.** Unlike Force — which is
+ * four fifths drawn without any of this — Drift and Trail have *nothing* to
+ * draw without it. Until 2026-08-30 they borrowed the Tree while they waited,
+ * on the reasoning that a picture of something real with a line of explanation
+ * beats a spinner over an empty box. The Tree has been cut, and the reasoning
+ * had a hole in it anyway: a mode that answers a question you did not ask,
+ * under small type explaining that it is not the picture you pressed, is a
+ * worse failure than an honest wait. `layoutDiagram` now returns null and the
+ * panel draws the spinner (DiagramPanel.tsx § Waiting).
  *
- * **A failure is not a blank.** If the request fails the strip says so in
- * words, and the fallback picture stays. Silently drawing the wrong picture is
- * the [silent-success](../../docs/reusable/silent-success.md) shape.
+ * **A failure is not a blank.** If the request fails, the reason — the
+ * server's own words, ending in a code the reader can quote — stands where the
+ * picture would have been. Failing to nothing at all is the
+ * [silent-success](../../docs/reusable/silent-success.md) shape.
  */
 import { useEffect, useState } from "react";
 import type { ProjectionPoint, ProjectionResponse, SkipCounts } from "../types.js";
diff --git a/src/web/useSimilar.ts b/src/web/useSimilar.ts
index 1238a8c..41127a7 100644
--- a/src/web/useSimilar.ts
+++ b/src/web/useSimilar.ts
@@ -14,7 +14,7 @@
  * **`enabled` is the whole gate.** This is the only fetch in the reading view
  * that spends money without a button labelled with what it costs. Pressing a
  * diagram toggle is not a purchase decision, so the request happens on exactly
- * one of the six pictures and never on the other five — and the moment `force`
+ * one of the three pictures and never on the other two — and the moment `force`
  * is no longer the picture, nothing further is requested. Cheap, bounded and
  * cached, but the bound has to be somewhere and this is it.
  *
diff --git a/tests/diagram-css.test.ts b/tests/diagram-css.test.ts
index 4ee591d..74c6551 100644
--- a/tests/diagram-css.test.ts
+++ b/tests/diagram-css.test.ts
@@ -21,7 +21,7 @@
  */
 import { readFileSync } from "node:fs";
 import { describe, expect, it } from "vitest";
-import { DIAGRAMS, GIST_PX, LABEL_PX, LINK_KINDS, UNLABELLED } from "../src/web/diagram.js";
+import { DIAGRAMS, LABEL_PX, LINK_KINDS, UNLABELLED } from "../src/web/diagram.js";
 
 const CSS = readFileSync("src/web/styles.css", "utf8");
 
@@ -59,17 +59,14 @@ describe("the diagram's font sizes are declared in both files and match", () =>
     }
   }
 
-  it("the gist", () => {
-    expect(fontSizeOf(".diag-gist")).toBe(GIST_PX);
-  });
-
   it("no bare `.diag-label` font-size, which would beat nothing and be beaten by everything", () => {
-    /* A base size plus per-depth overrides is how the tree's titles ended up at
-       10px: `.diag-node.diag-d1 .diag-label` was written for `strata` and also
-       matched the tree, and a base rule cannot say which. The nine rules above
+    /* A base size plus per-depth overrides is how the cut Tree's titles ended up
+       at 10px: `.diag-node.diag-d1 .diag-label` was written for `strata` and
+       also matched the tree, and a base rule cannot say which. The rules above
        are all at one specificity, so there is nothing left for a base to do —
        and a base that came back would make this suite pass while the browser
-       used a different number. */
+       used a different number. It is more tempting now that Force is the only
+       picture writing a label, which is why this stayed. */
     expect(fontSizeOf(".diag-label")).toBeNull();
   });
 });
diff --git a/tests/diagram-force-links.test.ts b/tests/diagram-force-links.test.ts
index 7e53aac..9b1c59e 100644
--- a/tests/diagram-force-links.test.ts
+++ b/tests/diagram-force-links.test.ts
@@ -22,10 +22,23 @@ import { describe, expect, it } from "vitest";
 import type { Block, BlockId, NodeId, SimilarPair, Tree } from "../src/types.js";
 import { buildGraph } from "../src/web/graph.js";
 import { layoutDiagram } from "../src/web/diagrams.js";
+import type { DiagramLayout } from "../src/web/diagram.js";
 import { arrowPath, type Sim, type SimLink, strengthOf } from "../src/web/diagram-d3.js";
 import { relatedFor } from "../src/web/DiagramPanel.js";
 import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";
 
+/**
+ * `layoutDiagram` returns null when a picture's data has not arrived
+ * (src/web/diagrams.ts). Every call in this file hands it a graph, so a null
+ * here is a bug in the test rather than a case to handle — and it has to throw
+ * rather than be asserted away, or a router that quietly stopped drawing Force
+ * would turn every assertion below into a skipped one.
+ */
+function drawn(layout: DiagramLayout | null): DiagramLayout {
+  if (layout === null) throw new Error("layoutDiagram drew nothing with its data supplied");
+  return layout;
+}
+
 function block(id: string, text: string, html?: string): Block {
   return {
     id: `spya-${id}` as BlockId,
@@ -498,15 +511,15 @@ describe("semantic edges", () => {
        the simulation actually ran with them. */
     const { root, blocks } = twoParts();
     const opts = { width: 320, height: 600, collapsed: NONE };
-    const before = layoutDiagram("force", root, opts, buildGraph(root, blocks));
-    const after = layoutDiagram(
+    const before = drawn(layoutDiagram("force", root, opts, buildGraph(root, blocks)));
+    const after = drawn(layoutDiagram(
       "force",
       root,
       opts,
       buildGraph(root, blocks, NONE, [
         { a: blocks[0]?.id ?? "", b: blocks[6]?.id ?? "", score: 0.95 },
       ]),
-    );
+    ));
     const xOf = (l: typeof before, id: string) => l.nodes.find((n) => n.id === id)?.x ?? 0;
     expect(xOf(after, "n3")).not.toBeCloseTo(xOf(before, "n3"));
   });
@@ -515,27 +528,27 @@ describe("semantic edges", () => {
 // ----------------------------------------------------------------- paint
 
 describe("what the force picture draws", () => {
-  it("names the kind of every line, on every picture", () => {
+  it("names the kind of every line", () => {
     /* `DiagramLink.kind` is required precisely so this cannot regress into a
        line that forgot to say what it claims — but a required field with a
        `?? "parent"` somewhere would satisfy the compiler and not this. */
     const { root, blocks } = twoParts();
     const opts = { width: 320, height: 600, collapsed: NONE };
     const graph = buildGraph(root, blocks);
-    for (const kind of ["tree", "force"] as const) {
-      for (const l of layoutDiagram(kind, root, opts, graph).links) {
-        expect(l.kind, `${kind} link ${l.id}`).toBeTruthy();
-      }
+    for (const l of drawn(layoutDiagram("force", root, opts, graph)).links) {
+      expect(l.kind, `force link ${l.id}`).toBeTruthy();
     }
   });
 
   it("puts an arrow on the sequence chain and on nothing else", () => {
     const { root, blocks } = twoParts();
-    const layout = layoutDiagram(
-      "force",
-      root,
-      { width: 320, height: 600, collapsed: NONE },
-      buildGraph(root, blocks),
+    const layout = drawn(
+      layoutDiagram(
+        "force",
+        root,
+        { width: 320, height: 600, collapsed: NONE },
+        buildGraph(root, blocks),
+      ),
     );
     for (const l of layout.links) {
       expect(Boolean(l.arrow), `${l.kind} ${l.id}`).toBe(l.kind === "sequence");
@@ -548,11 +561,13 @@ describe("what the force picture draws", () => {
        draws, and the feature reads as "the arrows did not work". So every
        sequence line must stop short of both bubbles. */
     const { root, blocks } = twoParts();
-    const layout = layoutDiagram(
-      "force",
-      root,
-      { width: 320, height: 600, collapsed: NONE },
-      buildGraph(root, blocks),
+    const layout = drawn(
+      layoutDiagram(
+        "force",
+        root,
+        { width: 320, height: 600, collapsed: NONE },
+        buildGraph(root, blocks),
+      ),
     );
     const at = (id: string) => {
       const n = layout.nodes.find((x) => x.id === id);
@@ -592,7 +607,9 @@ describe("what the force picture draws", () => {
     ]);
     expect(graph.edges.some((e) => e.kind === "vocabulary")).toBe(true);
 
-    const layout = layoutDiagram("force", root, { width: 320, height: 600, collapsed: NONE }, graph);
+    const layout = drawn(
+      layoutDiagram("force", root, { width: 320, height: 600, collapsed: NONE }, graph),
+    );
     const kinds = layout.links.map((l) => l.kind);
     const lastCheap = Math.max(
       kinds.lastIndexOf("parent"),
diff --git a/tests/diagram-graph.test.ts b/tests/diagram-graph.test.ts
index 89b386c..dc74422 100644
--- a/tests/diagram-graph.test.ts
+++ b/tests/diagram-graph.test.ts
@@ -20,6 +20,7 @@ import { describe, expect, it } from "vitest";
 import type { Block, BlockId, NodeId, Tree } from "../src/types.js";
 import { buildGraph, terms, wordsBefore } from "../src/web/graph.js";
 import { layoutDiagram } from "../src/web/diagrams.js";
+import type { DiagramLayout } from "../src/web/diagram.js";
 import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";
 
 /**
@@ -164,6 +165,18 @@ function articleWithNotes(): { root: SummaryNode; blocks: Block[] } {
 const NONE: ReadonlySet<NodeId> = new Set();
 const OPTS = { width: 320, height: 600, collapsed: NONE };
 
+/**
+ * `layoutDiagram` returns null when a picture's data has not arrived
+ * (src/web/diagrams.ts). Every call below except the one that is *about* the
+ * missing graph hands it one, so a null there is a bug in the test — and it
+ * throws rather than being asserted away, or a router that quietly stopped
+ * drawing Force would turn every assertion into a skipped one.
+ */
+function drawn(layout: DiagramLayout | null): DiagramLayout {
+  if (layout === null) throw new Error("layoutDiagram drew nothing with its data supplied");
+  return layout;
+}
+
 describe("terms", () => {
   it("drops function words and anything under four letters", () => {
     expect(terms("The cat sat on a very large mat about which we shall not speak")).toEqual([
@@ -425,7 +438,7 @@ describe("the Force layout", () => {
   for (const kind of ["force"] as const) {
     it(`${kind} keeps every node and every label inside the band`, () => {
       for (const width of [288, 320, 400]) {
-        const l = layoutDiagram(kind, root, { ...OPTS, width }, graph);
+        const l = drawn(layoutDiagram(kind, root, { ...OPTS, width }, graph));
         expect(l.nodes.length).toBeGreaterThan(0);
         for (const n of l.nodes) {
           for (const v of [n.x, n.y, n.w, n.h, n.labelX, n.labelY]) {
@@ -446,14 +459,18 @@ describe("the Force layout", () => {
     it(`${kind} draws no path containing NaN`, () => {
       // A single NaN in a `d` attribute makes the browser drop the WHOLE path,
       // so one bad number is one invisible connector and no error anywhere.
-      const l = layoutDiagram(kind, root, OPTS, graph);
+      const l = drawn(layoutDiagram(kind, root, OPTS, graph));
       for (const link of l.links) expect(link.d).not.toMatch(/NaN|Infinity|undefined/);
     });
 
-    it(`${kind} falls back to a real picture when handed no graph`, () => {
-      // Rather than throwing: same rule params.ts uses for an unknown value.
-      const l = layoutDiagram(kind, root, OPTS, null);
-      expect(l.nodes.length).toBeGreaterThan(0);
+    it(`${kind} draws nothing at all when handed no graph`, () => {
+      /* **Null rather than a stand-in picture**, since 2026-08-30: it used to
+         fall back to the Tree, which is the picture this app no longer has, and
+         which the panel then had to remember was not the one you pressed. The
+         panel shows a spinner or the error instead. It is still a null rather
+         than a throw — a caller holding only a tree should get a wait, not a
+         crash. */
+      expect(layoutDiagram(kind, root, OPTS, null)).toBeNull();
     });
   }
 
@@ -465,8 +482,8 @@ describe("the Force layout", () => {
        which is a supported call that would make every reload a different
        picture, and it guards a future d3 that changes its mind. Cheap, and the
        failure it catches is one nobody would think to look for. */
-    const a = layoutDiagram("force", root, OPTS, graph).nodes.map((n) => [n.x, n.y]);
-    const b = layoutDiagram("force", root, OPTS, graph).nodes.map((n) => [n.x, n.y]);
+    const a = drawn(layoutDiagram("force", root, OPTS, graph)).nodes.map((n) => [n.x, n.y]);
+    const b = drawn(layoutDiagram("force", root, OPTS, graph)).nodes.map((n) => [n.x, n.y]);
     expect(a).toEqual(b);
   });
 
@@ -475,7 +492,7 @@ describe("the Force layout", () => {
        layout throws away by default. `forceY` is what holds it; drop its
        strength and this is what goes. Compared by centre, since bubbles differ
        in size. */
-    const nodes = layoutDiagram("force", root, OPTS, graph).nodes.filter((n) => n.depth === 2);
+    const nodes = drawn(layoutDiagram("force", root, OPTS, graph)).nodes.filter((n) => n.depth === 2);
     const mid = (n: (typeof nodes)[number]) => n.y + n.h / 2;
     const byDoc = [...nodes].sort((p, q) => p.startRow - q.startRow);
     for (let i = 1; i < byDoc.length; i++) {
@@ -505,7 +522,7 @@ describe("the Force layout", () => {
     const r2 = buildSummaryTree(tree2, blocks2, null);
     expect(r2).not.toBeNull();
     if (!r2) return;
-    const nodes = layoutDiagram("force", r2, OPTS, buildGraph(r2, blocks2)).nodes;
+    const nodes = drawn(layoutDiagram("force", r2, OPTS, buildGraph(r2, blocks2))).nodes;
     for (const depth of [1, 2]) {
       const byDoc = nodes
         .filter((n) => n.depth === depth)
@@ -536,7 +553,7 @@ describe("the Force layout", () => {
        near each other even when the article separates them. 1.1 and 2.2 of the
        fixture are the linked pair; 1.2 sits between them in reading order and is
        about something else entirely. */
-    const nodes = layoutDiagram("force", root, OPTS, graph).nodes;
+    const nodes = drawn(layoutDiagram("force", root, OPTS, graph)).nodes;
     const cx = (id: string) => {
       const n = nodes.find((x) => x.id === id);
       return n ? n.x + n.w / 2 : Number.NaN;
@@ -608,7 +625,7 @@ describe("the Force picture, against the real example article", () => {
       if (!root) return;
       const g = buildGraph(root, blocks);
       for (const width of [288, 320, 400]) {
-        const l = layoutDiagram(kind, root, { ...OPTS, width }, g);
+        const l = drawn(layoutDiagram(kind, root, { ...OPTS, width }, g));
         for (const n of l.nodes) {
           expect(Number.isFinite(n.x + n.y + n.w + n.h)).toBe(true);
           expect(n.x).toBeGreaterThanOrEqual(-0.5);
diff --git a/tests/diagram-panel-hover.test.tsx b/tests/diagram-panel-hover.test.tsx
index be4fb95..9ea6e34 100644
--- a/tests/diagram-panel-hover.test.tsx
+++ b/tests/diagram-panel-hover.test.tsx
@@ -135,47 +135,56 @@ const cardText = () =>
   (host.querySelector(".diag-card")?.textContent ?? "").replace(/\s+/g, " ").trim();
 
 /**
- * **What the fallback is dressed as.**
+ * **What stands where a picture is not, and it is no longer another picture.**
  *
- * Drift and Trail have nothing to draw until the projection lands, so
- * `layoutDiagram` hands back `layoutTree` and the strip says "the picture below
- * is the Tree instead". The panel then has to *render* it as a tree — the SVG's
- * class picks the stylesheet and `NodeShape`'s branch picks the shapes, and
- * both used to come from the toggle rather than from what was drawn.
+ * Drift and Trail have nothing to draw until the projection lands. Until
+ * 2026-08-30 `layoutDiagram` handed back `layoutTree` and a strip said "the
+ * picture below is the Tree instead" — and the panel then had to *render* it as
+ * a tree, because the SVG's class picks the stylesheet and `NodeShape`'s branch
+ * picks the shapes. Twice it did not, and the result was Tree geometry wearing
+ * Drift's stylesheet: `.diag-drift .diag-box { fill: transparent; stroke: none }`
+ * erased every row, and no `.diag-drift .diag-label` font size exists so labels
+ * painted at the browser default. Nothing threw, nothing logged, and the
+ * sentence above it said the right thing while the picture under it was broken
+ * — GPT Sol's finding on the built code, 2026-08-27.
  *
- * The result was Tree geometry wearing Drift's stylesheet:
- * `.diag-drift .diag-box { fill: transparent; stroke: none }` erased every row,
- * the branch that draws a tree's dot and chevron never ran, and no
- * `.diag-drift .diag-label` font size exists so labels painted at the browser
- * default. Nothing throws, nothing logs, and the sentence above it says the
- * right thing while the picture under it is broken — GPT Sol's finding on the
- * built code, 2026-08-27.
+ * Greg cut the Tree on 2026-08-30 and asked for the honest version:
+ *
+ * > just show a loading spinner or error
+ *
+ * So the whole class of bug is gone rather than guarded: there is no second
+ * picture to be dressed as. What these pin is that the panel draws **no
+ * picture at all** and says so, which is the thing a regression would undo.
  */
-describe("a picture drawn without its data", () => {
-  it("wears the stylesheet of the picture it fell back to", () => {
+describe("a picture with no data yet", () => {
+  it("draws no picture at all, rather than borrowing one", () => {
     mount("drift");
-    const svg = host.querySelector("svg.diag-svg");
-    expect(svg, "the panel drew nothing at all").not.toBeNull();
-    expect(svg?.classList.contains("diag-tree")).toBe(true);
-    expect(svg?.classList.contains("diag-drift")).toBe(false);
+    expect(host.querySelector("svg.diag-svg"), "a picture was drawn with no data").toBeNull();
+    /* The specific corpse to watch for. `.diag-tree` is gone from the
+       stylesheet too, so this would now be an unstyled picture — which is
+       exactly the failure that shipped twice. */
+    expect(host.querySelector(".diag-tree")).toBeNull();
+    expect(host.querySelectorAll(".diag-node").length).toBe(0);
   });
 
-  it("draws the tree's own shapes, not a scatter's", () => {
-    /* The class alone is not enough: `NodeShape` branches on the same value,
-       and a row that is a `.diag-box` rather than a `.diag-row` has no fill
-       rule under `.diag-tree` either. */
+  it("shows the spinner and says what the wait is for", () => {
+    // A bare spinner in a 288px band says "something". The reader has just
+    // pressed a chip that costs a model call and is owed the sentence.
     mount("drift");
-    expect(host.querySelectorAll(".diag-node .diag-row").length).toBeGreaterThan(0);
+    const wait = host.querySelector(".diag-wait");
+    expect(wait, "nothing stands where the picture will be").not.toBeNull();
+    expect(wait?.querySelector(".cmt-spinner"), "no spinner").not.toBeNull();
+    expect(wait?.textContent).toContain("paragraph by paragraph");
   });
 
-  it("is still a tree to a screen reader, not a list of paragraphs", () => {
-    // `role` and the `aria-label`'s name both come from what is drawn. Saying
-    // "one dot per paragraph" over a column of sections is the same bug told
-    // to somebody who cannot see the picture to know better.
+  it("announces the wait once, not twice", () => {
+    /* The strip above the picture used to carry these words as well, back when
+       a fallback picture underneath needed explaining. Two `role="status"`
+       elements saying the same thing is the same sentence read aloud twice. */
     mount("drift");
-    const svg = host.querySelector("svg.diag-svg");
-    expect(svg?.getAttribute("role")).toBe("tree");
-    expect(svg?.getAttribute("aria-label")).toContain("Tree");
+    const live = [...host.querySelectorAll('[role="status"]')];
+    expect(live).toHaveLength(1);
+    expect(live[0]?.className).toBe("diag-wait");
   });
 });
 
@@ -258,14 +267,22 @@ describe("hovering a bubble", () => {
 describe("what the panel asks the server for", () => {
   it("asks for the embeddings with POST, and only on the force picture", async () => {
     /* GET is meant to be safe and this call spends money — a prefetcher or a
-       proxy retry may repeat one. And five of the six pictures must not ask at
-       all: pressing a toggle is not a purchase decision. */
+       proxy retry may repeat one. And the other two pictures must not ask for
+       it at all: pressing a toggle is not a purchase decision, and it is
+       certainly not a decision to buy the *other* picture's answer. */
     const calls: [string, string][] = [];
+    /* **A body per route, not one body for everything.** The stub used to hand
+       `useSimilar`'s answer to every request, which was harmless while only
+       Force ever fetched — and mounting Drift here made the panel read
+       `points.length` off an object that had no `points`, taking the whole
+       render down. A stub that answers the wrong shape tests the code against a
+       server that does not exist. */
     vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
       calls.push([String(url), init?.method ?? "GET"]);
-      return new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), {
-        status: 200,
-      });
+      const body = String(url).includes("/api/projection/")
+        ? { model: "m", blocks: 0, k: 0, variance: [0, 0], skipped: { tooShort: 0, nonProse: 0, capped: 0 }, points: [] }
+        : { model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] };
+      return new Response(JSON.stringify(body), { status: 200 });
     });
 
     /* `apiFetch` asks for an auth token before it sends, so the request leaves
@@ -274,15 +291,30 @@ describe("what the panel asks the server for", () => {
        also what a genuinely missing request looks like. */
     const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
 
-    mount("tree");
+    /* **Drift, as the picture that must not buy this one.** It has its own
+       purchase to make — the projection — and the two answers are different
+       things bought from different routes, so a gate that had slipped to "any
+       picture that needs a model" would show up here as a second call. The free
+       picture that used to hold this position, the Tree, was cut on
+       2026-08-30. */
+    mount("drift");
     await settle();
-    expect(calls, "the Tree picture must not buy anything").toEqual([]);
+    expect(
+      calls.filter(([url]) => url.includes("/api/similar/")),
+      "only Force buys the embeddings",
+    ).toEqual([]);
 
     act(() => root.unmount());
     root = createRoot(host);
+    /* From here on, only what Force asked for. `calls` still holds Drift's
+       projection request, and folding the two mounts together would make
+       "every call went to /api/similar" false for a reason that has nothing to
+       do with what this asserts. */
+    const beforeForce = calls.length;
     mount("force");
     await settle();
-    expect(calls.map(([, method]) => method)).toContain("POST");
-    expect(calls.every(([url]) => url.includes("/api/similar/"))).toBe(true);
+    const byForce = calls.slice(beforeForce);
+    expect(byForce.map(([, method]) => method)).toContain("POST");
+    expect(byForce.every(([url]) => url.includes("/api/similar/"))).toBe(true);
   });
 });
diff --git a/tests/diagram.test.ts b/tests/diagram.test.ts
index 81258b2..562bfd3 100644
--- a/tests/diagram.test.ts
+++ b/tests/diagram.test.ts
@@ -15,13 +15,19 @@
  *  2. a collapsed node keeps its own row and loses only its subtree;
  *  3. no picture draws deeper than the layouts assume.
  *
- * **Four pictures here, and there were eight** — Greg cut Strata, Mindmap, Arc
- * and Cluster on 2026-08-27. The tests that went with them went too; what is
- * left is deliberately not a smaller version of the same file, because two of
- * the rules above (siblings partitioning their parent, a picture growing past
- * the scroller to keep a band clickable) were facts about `strata` and about
- * nothing that is still drawn. Keeping them as assertions over `tree` would
- * have been a test that passes for a reason unrelated to why it was written.
+ * **No picture is laid out in diagram.ts any more.** Strata, Mindmap, Arc and
+ * Cluster went on 2026-08-27 and Tree — the last one this module drew — on
+ * 2026-08-30. So what is here is the *vocabulary*: the wrapper, the walk, and
+ * the two functions that read a finished layout. Force's geometry is in
+ * tests/diagram-graph.test.ts and the two scatters' in tests/scatter.test.ts,
+ * each against a picture that has its own data.
+ *
+ * The tests that went with the cut pictures went too, and what is left is
+ * deliberately not a smaller version of the same file: two of the rules above
+ * (siblings partitioning their parent, a picture growing past the scroller to
+ * keep a band clickable) were facts about `strata` and about nothing still
+ * drawn. Keeping them as assertions over whatever picture was left would have
+ * been a test that passes for a reason unrelated to why it was written.
  */
 import { readFileSync } from "node:fs";
 import { describe, expect, it } from "vitest";
@@ -29,12 +35,8 @@ import type { Block, BlockId, NodeId, Tree } from "../src/types.js";
 import {
   charsThatFit,
   DIAGRAMS,
-  type DiagramKind,
   type DiagramNode,
-  GIST_PX,
-  LABEL_PX,
   MAX_DRAWN_DEPTH,
-  layoutTree,
   stepStops,
   nodeAt,
   walk,
@@ -93,7 +95,45 @@ function fixture(): SummaryNode {
 }
 
 const NONE: ReadonlySet<NodeId> = new Set();
-const OPTS = { width: 320, height: 600, collapsed: NONE };
+
+/**
+ * A tree as the preorder run of `DiagramNode`s every layout produces.
+ *
+ * **`layoutTree` used to stand in for this**, on the reasonable grounds that
+ * `stepStops`, `nodeAt` and `siblingRuns` take nodes and any layout makes some.
+ * It was cut on 2026-08-30, and building the nodes here is the better shape
+ * anyway: those three are pure functions of preorder, depth, part and range,
+ * and reaching them through a layout also tested that layout's geometry, which
+ * has a file of its own.
+ *
+ * The geometry is zeroed because **none of the three reads a coordinate** —
+ * checked against each of them, not assumed. If one ever does, this stops being
+ * a valid input and the test that needs it should build a real layout.
+ */
+function nodesOf(root: SummaryNode, collapsed: ReadonlySet<NodeId> = NONE): DiagramNode[] {
+  return walk(root, collapsed).map((e) => ({
+    id: e.node.node.id,
+    blockId: e.node.node.range[0],
+    depth: e.node.node.depth,
+    number: e.node.number,
+    title: e.node.node.title,
+    blocks: e.node.blocks,
+    startRow: e.node.startRow,
+    endRow: e.node.endRow,
+    part: e.part,
+    x: 0,
+    y: 0,
+    w: 0,
+    h: 0,
+    labelX: 0,
+    labelY: 0,
+    anchor: "start" as const,
+    lines: [],
+    titleLines: 0,
+    hasChildren: e.node.children.length > 0,
+    collapsed: e.collapsed,
+  }));
+}
 
 describe("wrapText", () => {
   it("breaks on words and keeps every line inside the budget", () => {
@@ -187,50 +227,6 @@ describe("walk", () => {
   });
 });
 
-describe("layoutTree", () => {
-  it("indents by depth and never runs a label off the right edge", () => {
-    const { nodes } = layoutTree(fixture(), OPTS);
-    const depths = new Map(nodes.map((n) => [n.id, n.labelX]));
-    expect(depths.get("a") ?? 0).toBeGreaterThan(depths.get("root") ?? 0);
-    expect(depths.get("a1") ?? 0).toBeGreaterThan(depths.get("a") ?? 0);
-    for (const n of nodes) {
-      expect(n.labelX).toBeLessThan(OPTS.width);
-      n.lines.forEach((line, i) => {
-        /* Title lines are set at 12px and gist lines at 10.5px — the same two
-           budgets `layoutTree` wraps against. Measuring both at 12 is what this
-           assertion did first, and it failed on a gist line that was in fact
-           perfectly inside the band. Worth keeping in mind: a test of estimated
-           text width has to use the same estimate, or it tests the estimate. */
-        const fontPx = i < n.titleLines ? 12 : 10.5;
-        expect(n.labelX + line.length * fontPx * 0.52).toBeLessThanOrEqual(OPTS.width + 1);
-      });
-    }
-  });
-
-  it("stacks rows top to bottom in document order and never overlaps them", () => {
-    const nodes = layoutTree(fixture(), OPTS).nodes;
-    for (let i = 1; i < nodes.length; i++) {
-      const prev = nodes[i - 1];
-      const cur = nodes[i];
-      if (!prev || !cur) continue;
-      expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.h - 0.001);
-    }
-  });
-
-  it("draws one connector per node except the root", () => {
-    const { nodes, links } = layoutTree(fixture(), OPTS);
-    expect(links).toHaveLength(nodes.length - 1);
-  });
-
-  it("hides a closed node's gist, because a closed node is a summary of itself", () => {
-    const open = layoutTree(fixture(), OPTS).nodes.find((n) => n.id === "a");
-    const shut = layoutTree(fixture(), { ...OPTS, collapsed: new Set(["a" as NodeId]) }).nodes.find(
-      (n) => n.id === "a",
-    );
-    expect((shut?.lines.length ?? 0)).toBeLessThan(open?.lines.length ?? 0);
-  });
-});
-
 describe("stepStops", () => {
   /* The fixture's blocks, so a node's `blockId` has a row to resolve to. Each
      node's `blockId` is `spya-<id>a` (see `node` above), and these are the rows
@@ -250,11 +246,11 @@ describe("stepStops", () => {
   );
 
   it("gives one rung per distinct row, not one per node", () => {
-    /* **The whole reason the step buttons walk rows.** `layoutTree` is
+    /* **The whole reason the step buttons walk rows.** Every layout is
        preorder, so the root, part 1 and section 1.1 all begin on row 0 — a
        ladder built from nodes would spend its first three rungs going nowhere,
        and a button that moves nothing looks broken rather than correct. */
-    const { nodes } = layoutTree(fixture(), OPTS);
+    const nodes = nodesOf(fixture());
     const stops = stepStops(nodes, rows);
     expect(nodes.length).toBeGreaterThan(stops.length);
     expect(stops.map((s) => s.row)).toEqual([0, 4, 10, 50]);
@@ -263,7 +259,7 @@ describe("stepStops", () => {
   it("keeps the deepest node where several share a row", () => {
     // `nodeAt`'s rule: the deepest node is the most specific thing the reader
     // could mean, and the card describes whatever this lands on.
-    const stops = stepStops(layoutTree(fixture(), OPTS).nodes, rows);
+    const stops = stepStops(nodesOf(fixture()), rows);
     expect(stops[0]?.id).toBe("a1");
   });
 
@@ -274,8 +270,8 @@ describe("stepStops", () => {
        from `startRow` puts a rung at row 0 whose jump lands at row 2 — and
        Previous, from row 1, then moves the reader DOWN the page. GPT Sol's
        finding, 2026-08-27. */
-    const tiled: DiagramNode[] = layoutTree(fixture(), OPTS)
-      .nodes.filter((n) => n.depth === 2)
+    const tiled: DiagramNode[] = nodesOf(fixture())
+      .filter((n) => n.depth === 2)
       .map((n) => ({ ...n, startRow: 0 }));
     const stops = stepStops(tiled, rows);
     expect(stops.map((s) => s.row)).toEqual([0, 4, 10, 50]);
@@ -285,7 +281,7 @@ describe("stepStops", () => {
   it("falls back to the range when a block is not in the article", () => {
     // A layout left over from the moment before a re-ingest. A rung in
     // slightly the wrong place beats a button that does nothing.
-    const { nodes } = layoutTree(fixture(), OPTS);
+    const nodes = nodesOf(fixture());
     expect(stepStops(nodes, new Map()).map((s) => s.row)).toEqual([0, 4, 10, 50]);
   });
 
@@ -300,121 +296,76 @@ describe("nodeAt", () => {
   it("marks the deepest node the reader is inside, not the outermost", () => {
     // Marking the part when the section is on screen tells the reader something
     // they already knew. Same rule as the summary panel's follow mark.
-    const { nodes } = layoutTree(fixture(), OPTS);
+    const nodes = nodesOf(fixture());
     expect(nodeAt(nodes, 5)).toBe("a2");
     expect(nodeAt(nodes, 60)).toBe("b2");
   });
 
   it("marks a collapsed node itself rather than nothing", () => {
-    const { nodes } = layoutTree(fixture(), { ...OPTS, collapsed: new Set(["a" as NodeId]) });
+    const nodes = nodesOf(fixture(), new Set(["a" as NodeId]));
     expect(nodeAt(nodes, 5)).toBe("a");
   });
 
   it("is null above the first row, rather than guessing the root", () => {
-    expect(nodeAt(layoutTree(fixture(), OPTS).nodes, null)).toBeNull();
+    expect(nodeAt(nodesOf(fixture()), null)).toBeNull();
   });
 });
 
 /**
- * The same rules, against the **committed example article** rather than a
- * fixture built to be convenient.
- *
- * The tree above has four sections with tidy short titles. This one has 45
- * nodes, real headings, real gists, and a shape nobody chose — which is the
- * only kind of input that catches a budget that was very slightly too generous.
+ * The **committed example article** rather than a fixture built to be
+ * convenient — 45 nodes, real headings, real gists, and a shape nobody chose.
  * `example/` is in git; `data/` is not (version-control.md), so this is the
  * largest real article a test can reach on a fresh clone.
  *
- * Run across the whole width range the band can actually take: `MODE_MIN` is
- * 288 and `MODE_IDEAL` is 400 (src/web/layout.ts), and the narrow end is where
- * a label runs out.
- */
-/**
- * **This loop used to run over `DIAGRAMS` and it was testing one picture four
- * times.** `layoutDiagram` is called with no graph and no scatter input, so
- * Force, Drift and Trail all fall back to `layoutTree` — three green rows
- * saying nothing about three layouts, and a name ("every picture") promising
- * the opposite. GPT Sol's finding, 2026-08-27.
- *
- * The honest split: the tree picture is checked here, Force is checked against
- * the same article in tests/diagram-graph.test.ts (which builds the graph), and
- * the two scatters in tests/scatter.test.ts (which builds a projection). The
- * `FALLS_BACK` case below is what pins the *fallback itself*, which is a real
- * behaviour and was the only thing the old loop was actually exercising.
+ * **Two rules only, and both are about the router.** The width checks that used
+ * to live here ran over `DIAGRAMS` and were testing one picture four times —
+ * `layoutDiagram` was called with no graph and no scatter input, so Force,
+ * Drift and Trail all fell back to `layoutTree`: three green rows saying
+ * nothing about three layouts, under a name promising the opposite. GPT Sol's
+ * finding, 2026-08-27. Force is checked against this same article in
+ * tests/diagram-graph.test.ts, which builds the graph, and the two scatters in
+ * tests/scatter.test.ts, which builds a projection.
  */
-describe("every picture, against the real example article", () => {
+describe("the router, against the real example article", () => {
   const tree = JSON.parse(readFileSync("example/tree.json", "utf8")) as Tree;
   const raw = JSON.parse(readFileSync("example/blocks.json", "utf8")) as unknown;
   const blocks = (Array.isArray(raw) ? raw : (raw as { blocks: Block[] }).blocks) as Block[];
   const real = buildSummaryTree(tree, blocks, null);
 
-  /* The estimate `wrapText` used for this line, which is the only honest ruler
-     for a label it wrapped. Getting THIS wrong is how a check reports a bug that
-     is not there — it happened twice while writing these, both times by
-     measuring a 10.5px gist line at title size. */
-  const lineWidth = (n: DiagramNode, i: number, kind: DiagramKind) =>
-    (n.lines[i]?.length ?? 0) * (i >= n.titleLines ? GIST_PX : (LABEL_PX[kind]?.[n.depth] ?? 12)) * 0.52;
-
-  for (const kind of ["tree"] as const) {
-    for (const width of [288, 320, 400]) {
-      it(`${kind} at ${width}px stays inside the band and draws no impossible box`, () => {
-        expect(real).not.toBeNull();
-        if (!real) return;
-        const layout = layoutDiagram(kind, real, { width, height: 700, collapsed: NONE });
-        expect(layout.nodes.length).toBeGreaterThan(0);
-
-        for (const n of layout.nodes) {
-          for (const v of [n.x, n.y, n.w, n.h, n.labelX, n.labelY]) expect(v).toBeTypeOf("number");
-          for (const v of [n.x, n.y, n.w, n.h, n.labelX, n.labelY]) expect(Number.isFinite(v)).toBe(true);
-          expect(n.w).toBeGreaterThanOrEqual(0);
-          expect(n.h).toBeGreaterThanOrEqual(0);
-          expect(n.x).toBeGreaterThanOrEqual(-0.5);
-          expect(n.x + n.w).toBeLessThanOrEqual(width + 0.5);
-
-          n.lines.forEach((_, i) => {
-            const w = lineWidth(n, i, kind);
-            const left =
-              n.anchor === "start" ? n.labelX : n.anchor === "end" ? n.labelX - w : n.labelX - w / 2;
-            expect(left, `${kind} ${n.number} line ${i} starts left of the band`).toBeGreaterThan(-1);
-            expect(left + w, `${kind} ${n.number} line ${i} runs past the band`).toBeLessThanOrEqual(
-              width + 1,
-            );
-          });
-        }
-      });
-    }
-  }
-
-  it("hands every picture without its data a real one, and says which", () => {
-    /* The fallback, asserted as itself rather than as a side effect of a loop
-       that meant to test something else. What matters is that it is `tree` —
-       the panel derives the SVG's class and `NodeShape`'s branch from this, so
-       a fallback that returned some other shape would be drawn wearing the
-       wrong picture's stylesheet. */
+  it("hands back nothing at all for a picture whose data has not arrived", () => {
+    /* **The behaviour that replaced the fallback**, and the whole point of the
+       2026-08-30 change. Every one of these used to come back as the Tree, and
+       the panel then had to remember that the toggle pressed and the picture on
+       screen were two different things — which it twice did not, rendering tree
+       geometry under another picture's stylesheet with nothing thrown and
+       nothing logged. A null cannot be drawn wearing the wrong clothes: the
+       panel shows a spinner or the error instead (DiagramPanel.tsx § Waiting).
+
+       `force` is in the loop too, and it is not a special case: with no graph
+       it has nothing either. In the app the graph is built in the browser from
+       blocks the page already holds, so this is only reachable there when the
+       tree is unusable — which the panel has already said in words. */
     expect(real).not.toBeNull();
     if (!real) return;
-    const tree = layoutTree(real, { width: 320, height: 700, collapsed: NONE });
     for (const kind of DIAGRAMS) {
-      const l = layoutDiagram(kind, real, { width: 320, height: 700, collapsed: NONE });
-      expect(l.nodes.map((n) => n.id), `${kind} without its data`).toEqual(
-        tree.nodes.map((n) => n.id),
-      );
+      expect(
+        layoutDiagram(kind, real, { width: 320, height: 700, collapsed: NONE }),
+        `${kind} without its data`,
+      ).toBeNull();
     }
   });
 
-  it("never draws deeper than MAX_DRAWN_DEPTH, whatever the tree holds", () => {
-    /* The example tree goes to depth 3. The layouts assume 2 — `layoutTree`
-       indents by depth and would run a fourth level off a 288px band, and the
-       stylesheet has font sizes for `diag-d0` to `diag-d2` and nothing below.
-       `buildSummaryTree` stops at 2 today, so this is guarding the assumption
-       rather than the current caller. */
+  it("never walks deeper than MAX_DRAWN_DEPTH, whatever the tree holds", () => {
+    /* The example tree goes to depth 3. The pictures assume 2 — the stylesheet
+       has font sizes and fills for `diag-d0` to `diag-d2` and nothing below,
+       and graph.ts calls a node at this depth a leaf whether or not it has
+       children. `buildSummaryTree` stops at 2 today, so this is guarding the
+       assumption rather than the current caller. */
     expect(Math.max(...Object.values(tree.nodes).map((n) => n.depth))).toBeGreaterThan(
       MAX_DRAWN_DEPTH,
     );
     if (!real) return;
-    for (const n of layoutTree(real, { width: 320, height: 700, collapsed: NONE }).nodes) {
-      expect(n.depth).toBeLessThanOrEqual(MAX_DRAWN_DEPTH);
-    }
+    for (const n of nodesOf(real)) expect(n.depth).toBeLessThanOrEqual(MAX_DRAWN_DEPTH);
   });
 });
 
@@ -428,7 +379,7 @@ describe("every picture, against the real example article", () => {
  */
 describe("siblingRuns", () => {
   it("counts each node among its own siblings, not among its level", () => {
-    const { nodes } = layoutTree(fixture(), OPTS);
+    const nodes = nodesOf(fixture());
     const runs = siblingRuns(nodes);
     const of = (id: string) => runs[nodes.findIndex((n) => n.id === id)];
 
@@ -443,7 +394,7 @@ describe("siblingRuns", () => {
   });
 
   it("counts a closed parent's siblings without counting its hidden children", () => {
-    const { nodes } = layoutTree(fixture(), { ...OPTS, collapsed: new Set(["a" as NodeId]) });
+    const nodes = nodesOf(fixture(), new Set(["a" as NodeId]));
     const runs = siblingRuns(nodes);
     const of = (id: string) => runs[nodes.findIndex((n) => n.id === id)];
     expect(of("a")).toEqual({ size: 2, pos: 1 });
diff --git a/tests/url-state.test.ts b/tests/url-state.test.ts
index 7ea9146..749f3d6 100644
--- a/tests/url-state.test.ts
+++ b/tests/url-state.test.ts
@@ -508,23 +508,25 @@ describe("runsParam and the legacy run= it replaced", () => {
  * every other parser in params.ts makes, and worth pinning for the two newest.
  */
 describe("the diagram parameters", () => {
-  it("takes any of the four pictures and falls back to the free one", () => {
-    expect(diagramParam.parse("tree")).toBe("tree");
+  it("takes any of the three pictures and falls back to the one that draws first", () => {
     expect(diagramParam.parse("force")).toBe("force");
     expect(diagramParam.parse("drift")).toBe("drift");
     expect(diagramParam.parse("trail")).toBe("trail");
     // A picture from a version this build has never heard of.
     expect(diagramParam.parse("hyperbolic")).toBeNull();
-    /* **And one this build used to have.** Strata, Mindmap, Arc and Cluster
-       were cut on 2026-08-27, and a `?diagram=strata` in somebody's bookmark
-       has to open the Tree rather than a broken page — which is the same rule
-       as the line above, and the one that has an actual link behind it. */
+    /* **And ones this build used to have.** Strata, Mindmap, Arc and Cluster
+       were cut on 2026-08-27 and Tree on 2026-08-30, and a `?diagram=strata` or
+       `?diagram=tree` in somebody's bookmark has to open a real picture rather
+       than a broken page — the same rule as the line above, and the one that
+       has an actual link behind it. `tree` is the one to watch: it was the
+       default for three days, so it is in the most bookmarks. */
     expect(diagramParam.parse("strata")).toBeNull();
     expect(diagramParam.parse("mindmap")).toBeNull();
-    /* `tree` because it is the only picture that costs nothing: the other three
-       all spend a model call the moment they are drawn, and a URL somebody
-       mistyped should not bill them. */
-    expect(diagramParam.defaultValue).toBe("tree");
+    expect(diagramParam.parse("tree")).toBeNull();
+    /* `force` because it is the only one that draws anything before a model has
+       answered: four of its five kinds of line are arithmetic over prose the
+       browser already holds. The other two would open on a spinner. */
+    expect(diagramParam.defaultValue).toBe("force");
   });
 
   it("defaults sideways to lanes, and refuses anything it cannot draw", () => {
```
