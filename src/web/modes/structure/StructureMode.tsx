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
import { type ArcCell, buildSummaryTree } from "../../tree.js";
import { useColumnContext } from "../../useColumnContext.js";
import type { Section } from "../../position.js";

/** No gist columns in a mode, so nothing to measure rects for. */
const EMPTY_DEPTHS: number[] = [];

/**
 * **The content width, in CSS px, that Structure's two columns need.**
 *
 * Two `GIST_MIN` (176px) tracks and the 12px gutter between them — the number
 * Structure's container query stacked its columns below, until this replaced
 * it. Kept to the pixel, so every band that showed two columns still does, and
 * every band that showed the stacked pair Greg called "very confusing" now shows
 * the list. At a 16px root with the band's 1px border that is a 389px band,
 * which fits inside `MODE_IDEAL` (400) and not inside `MODE_MIN` (288), the two
 * ends of the band's width in layout.ts.
 */
export const TWO_COLUMN_CONTENT_MIN = 364;

/**
 * Structure's horizontal padding on the band, both sides together, in rem —
 * structure-mode.css § `.mode-band.struct`, `0.75rem` a side. **Change one, change
 * both**; the stylesheet's comment says so from its end.
 */
const STRUCTURE_PAD_X_REM = 1.5;

/**
 * **Which face a band gets**, from its border-box width. Pure, for the test.
 *
 * The question is *would Structure's content box be at least
 * `TWO_COLUMN_CONTENT_MIN`* — the question the container query asked — and it
 * is answered from the **border box** with Structure's own padding taken off,
 * whichever face is on screen. That is the one trap here. The two faces pad the
 * band differently (Structure 12px + 12px, Outline 12px + 8px), so reading the
 * mounted face's actual content box would call one 387px band 362px under
 * Structure (→ the list) and 366px under Outline (→ the columns), and flip
 * between them for ever. The border box and the borders are set by the layout,
 * never by the face, so the answer cannot move its own measurement.
 *
 * `borderX` and `rootFontPx` are measured rather than assumed, because each
 * moves the threshold and GPT Sol's review of the plan found both: the padding
 * is in rem, so a 20px root needs a 395px band rather than 389 (layout.ts § the
 * root size is not locked), and a band that covers the prose loses its border
 * (narrow-window.css § `.band-covers`).
 */
export function structureFace(
  bandWidth: number,
  borderX: number,
  rootFontPx: number,
): "columns" | "list" {
  const content = bandWidth - borderX - STRUCTURE_PAD_X_REM * rootFontPx;
  return content >= TWO_COLUMN_CONTENT_MIN ? "columns" : "list";
}

/** The root font size in px, or 16 where nothing is laid out (jsdom). */
function rootFontPx(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

export function StructureBand({
  article,
  leafDepth,
  sections,
  layoutKey,
  supplementOf,
  arcByRow,
  proseBeside,
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
   * mounted by the `band()` arm for this mode, so the guard a hook in `Reader`
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
   * A root font-size change with no change of band width is not observed; it
   * is rare, and the next resize corrects it.
   */
  const [band, setBand] = useState<HTMLElement | null>(null);
  const [face, setFace] = useState<"columns" | "list">("columns");
  useLayoutEffect(() => {
    if (!band) return;
    const measure = () => {
      const width = band.offsetWidth;
      if (width <= 0) return;
      const style = getComputedStyle(band);
      const borderX =
        (Number.parseFloat(style.borderLeftWidth) || 0) +
        (Number.parseFloat(style.borderRightWidth) || 0);
      setFace(structureFace(width, borderX, rootFontPx()));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(band);
    return () => ro.disconnect();
  }, [band]);

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
