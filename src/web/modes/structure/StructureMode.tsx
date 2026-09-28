/**
 * **Structure mode's controller.** The tree it draws, where the reader is
 * standing in it, and **which of its two faces fits the band**.
 *
 * The shape `IdeasMode.tsx` established and the other ten follow: the mode's
 * controller lives in `src/web/modes/<feature>/`, the panel it renders stays at
 * `src/web/`, and `Reader` stops knowing what is inside either.
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 *
 * **Two faces since 2026-09-10.** Where the band has room, Structure's own two
 * linked columns (`StructurePanel`); where it does not, the nested list that was
 * Outline mode (`OutlinePanel`), which stopped being a mode of its own the same
 * day. Greg, 2026-09-08:
 *
 * > if the page is wide, show the current Structure 2-column mode. If it's
 * > narrower, show the current Outline mode. And get rid of Outline mode
 * > altogether (because it will have been subsumed by Structure mode).
 *
 * docs/plans/260910g-structure-mode-subsumes-outline.md.
 *
 * **Owner and visitor get the same component, because there is nothing to
 * own** — the same position Summary is in. Nothing here is fetched: the tree
 * arrives in the page's own payload, so a visitor gets the whole of the mode
 * (src/web/visitor.ts § `POLICY`).
 */

import { useLayoutEffect, useMemo, useState } from "react";
import type { Article, BlockId, NodeId, TreeNode } from "../../../types.js";
import { paragraphLabelsReady } from "../../nav-labels.js";
import { OutlinePanel } from "../../OutlinePanel.js";
import { useRenderCount } from "../../perf.js";
import { StructurePanel } from "../../StructurePanel.js";
import { structureColumnsBand } from "../../layout.js";
import { type ArcCell, buildSummaryTree } from "../../tree.js";
import { useColumnContext } from "../../useColumnContext.js";
import type { Section } from "../../position.js";

/** No gist columns in a mode, so nothing to measure rects for. */
const EMPTY_DEPTHS: number[] = [];

/**
 * **Which face a band gets**, from its border-box width. Pure, for the test.
 *
 * The threshold is `structureColumnsBand` in layout.ts — the same number
 * `fitMode` sizes Structure's band from, so a band handed out for the columns
 * is always drawn as the columns and a band too narrow for them is the ordinary
 * one with the list in it. Since 2026-09-28 that is two columns of 17rem of
 * content each, a 609px band at a 16px root (a 1165px window beside the prose);
 * it was two 176px tracks, a 389px band, until then — Greg found the columns
 * "really narrow". docs/plans/260928a-structure-two-columns-readable.md.
 *
 * **A band that covers the article always gets the list**, however wide it is
 * painted. Below `bandCoversProse`'s crossover the band is the whole window less
 * the rail, so measuring it would draw the columns in a 620–699px window and the
 * list in a 288px band at 700 — a wider window, a narrower face. GPT Sol's plan
 * review, finding 1. It is also what keeps the columns off a phone.
 *
 * It is answered from the **border box**, whichever face is on screen. The two
 * faces pad the band differently (Structure 12px + 12px, Outline 12px + 8px), so
 * reading the mounted face's content box would give one band two answers
 * depending on which face measured it, and flip between them for ever. The
 * border box is set by the layout — it is `--mode-w`, exactly the number
 * `fitMode` chose — never by the face.
 *
 * `rootFontPx` is measured rather than assumed: the columns are in rem, so a
 * 20px root needs a wider band (layout.ts § the root size is not locked).
 */
export function structureFace(
  bandWidth: number,
  rootFontPx: number,
  proseBeside: boolean,
): "columns" | "list" {
  if (!proseBeside) return "list";
  return bandWidth >= structureColumnsBand(rootFontPx).min ? "columns" : "list";
}

export function StructureBand({
  article,
  leafDepth,
  sections,
  layoutKey,
  supplementOf,
  arcByRow,
  proseBeside,
  rootFontPx,
  onJump,
}: {
  article: Article;
  /** `Geometry.leafDepth` — how far down `buildSummaryTree` should walk. */
  leafDepth: number;
  /** The article's sections, for the focus-line sampler. `buildSections`. */
  sections: Section[];
  /** Re-measure when the columns change — the same key the `?at=` tracker uses. */
  layoutKey: string;
  /** `Geometry.supplementOf` — the list face draws the apparatus unnumbered. */
  supplementOf: ReadonlyMap<NodeId, TreeNode>;
  /** The arc, keyed by the row each part starts on — the list face's rung 4. */
  arcByRow: Map<number, ArcCell> | null;
  /**
   * Whether the band sits beside the prose rather than covering it —
   * `fit.modeW > 0` (layout.ts).
   *
   * It gates paragraph rows in both faces, and the reason is the substitution
   * principle rather than fit: a paragraph row may fall back to its
   * `navLabel`, and a `navLabel` is a pointer to prose that must never stand
   * *in place of* prose that could be shown. On a window where the band covers
   * the article, it would.
   */
  proseBeside: boolean;
  /**
   * The same measured root size `fitView` used to choose the band's width.
   * Sharing the value is what makes the fit and the face one decision even when
   * the root size changes without changing the band's border-box width.
   */
  rootFontPx: number;
  onJump(id: BlockId): void;
}) {
  useRenderCount("StructureBand");

  /**
   * The tree, full depth — the same one for both faces.
   *
   * `buildSummaryTree` with no summaries, because this mode reads nothing that
   * stage 6 writes: a title, a gist and a navLabel are all on `tree.json`
   * already. Full depth rather than the default 2, because both faces can
   * expand the current section into its paragraphs and those are leaves.
   *
   * **No `mode === "structure"` guard on the `useMemo`**: this component is only
   * mounted by the `modeBand()` arm for this mode, so the guard a hook in `Reader`
   * would need — it runs on every render of the reading view in every mode — is
   * exactly the cost that keeping the controller out here removed.
   */
  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks, leafDepth),
    [article.tree, article.blocks, leafDepth],
  );

  /**
   * Where the reader is — the same sampler the gist columns' panels use, so the
   * two faces, and the gist columns, can never disagree about which section is
   * under the focus line. A face change at a resize must not also move "here".
   *
   * `enabled: true` because mounting is the condition — see the `useMemo`
   * above. `depths: []` because a mode has no gist columns and this band wants
   * none of the rects, only `focusRow`. **Section-granular**: `focusRow` is a
   * section's first row, never the exact block, which is why no paragraph in
   * either face is ever marked current.
   */
  const live = useColumnContext({
    sections,
    depths: EMPTY_DEPTHS,
    enabled: true,
    layoutKey,
  });

  /**
   * **Both halves of "may we draw paragraph rows", answered here rather than in
   * a panel**, because they are facts about the page and the article rather
   * than about the drawing.
   *
   * `paragraphLabelsReady` is the one GPT Sol's review of Structure added
   * (260907c, finding 3): stage 5 writes the leaves' navLabels, and until it
   * has, a paragraph layer draws blanks that read as *missing article
   * structure* rather than as work in progress. Both faces withhold the whole
   * layer for it and say nothing — nobody asked for the layer, so a sentence in
   * place of it would answer a question the reader never put.
   */
  const labelsReady = paragraphLabelsReady(article.navLabelStatus);

  /**
   * **The band's own width, measured — and the face chosen from it.**
   *
   * Measured rather than derived from `fit.modeW`, because `fitMode` reports
   * `modeW: 0` exactly when the band *covers* the prose, while the CSS expands
   * it to the whole viewport (narrow-window.css) — so a width read off the
   * layout would call the widest band on a phone the narrowest. Asking the
   * element is the only question with a true answer; it is the reason
   * Structure's columns were switched by a container query before this, and
   * the reason `OutlinePanel` measures whether it covers.
   *
   * `offsetWidth` rather than `getBoundingClientRect`, so a transform on the
   * band (a slide-in) cannot report a width the layout does not have. A width of
   * 0 — nothing laid out yet, or jsdom — keeps the face it has: the columns on
   * first mount, which is what a test with no layout has always seen.
   *
   * **The first frame is the columns, and it is never painted on a narrow
   * band**: the callback ref lands the element in the commit, and this layout
   * effect measures it *synchronously*, before the browser paints — a narrow
   * answer re-renders before anything is shown. The observer is only for later
   * changes; its callbacks do not run in the layout phase, so the synchronous
   * `measure()` ahead of it is the part that keeps the first frame right. The
   * element changes when the face does (each face renders its own `<aside>`
   * through `ModeSurface`), so the state holding it is what re-arms both.
   *
   * `rootFontPx` is the value the parent handed to `fitView`, rather than a
   * second read from the DOM. A ResizeObserver cannot see a root-size change
   * when the band's fixed-pixel border box stays the same; putting the shared
   * value in this effect's dependencies keeps the face and the fit together in
   * that case too.
   */
  const [band, setBand] = useState<HTMLElement | null>(null);
  const [face, setFace] = useState<"columns" | "list">("columns");
  useLayoutEffect(() => {
    if (!band) return;
    const measure = () => {
      const width = band.offsetWidth;
      if (width <= 0) return;
      setFace(structureFace(width, rootFontPx, proseBeside));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(band);
    return () => ro.disconnect();
  }, [band, proseBeside, rootFontPx]);

  if (face === "list") {
    return (
      <OutlinePanel
        surfaceRef={setBand}
        root={root}
        supplementOf={supplementOf}
        arcByRow={arcByRow}
        focusRow={live.focusRow}
        proseBeside={proseBeside}
        paragraphLabels={labelsReady}
        onJump={onJump}
      />
    );
  }
  return (
    <StructurePanel
      surfaceRef={setBand}
      root={root}
      focusRow={live.focusRow}
      allowParagraphs={proseBeside && labelsReady}
      onJump={onJump}
    />
  );
}
