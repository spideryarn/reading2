/**
 * **Structure mode's controller.** The tree it draws, and where the reader is
 * standing in it.
 *
 * The shape `IdeasMode.tsx` established and the other ten follow: the mode's
 * controller lives in `src/web/modes/<feature>/`, the panel it renders stays at
 * `src/web/`, and `Reader` stops knowing what is inside either.
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 *
 * **Owner and visitor get the same component, because there is nothing to
 * own** — the same position Outline and Summary are in. Nothing here is
 * fetched: the tree arrives in the page's own payload, so a visitor gets the
 * whole of the mode (src/web/visitor.ts § `POLICY`).
 *
 * See docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md.
 */

import { useMemo } from "react";
import type { Article, BlockId } from "../../../types.js";
import { paragraphLabelsReady } from "../../nav-labels.js";
import { useRenderCount } from "../../perf.js";
import { StructurePanel } from "../../StructurePanel.js";
import { buildSummaryTree } from "../../tree.js";
import { useColumnContext } from "../../useColumnContext.js";
import type { Section } from "../../position.js";

/** No gist columns in a mode, so nothing to measure rects for. */
const EMPTY_DEPTHS: number[] = [];

export function StructureBand({
  article,
  leafDepth,
  sections,
  layoutKey,
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
  /**
   * Whether the band sits beside the prose rather than covering it —
   * `fit.modeW > 0` (layout.ts), which is the same input `OutlinePanel` takes
   * for the same decision.
   *
   * It gates paragraph rows, and the reason is the substitution principle rather
   * than fit: a paragraph row may fall back to its `navLabel`, and a `navLabel`
   * is a pointer to prose that must never stand *in place of* prose that could
   * be shown. On a window where the band covers the article, it would.
   */
  proseBeside: boolean;
  onJump(id: BlockId): void;
}) {
  useRenderCount("StructureBand");

  /**
   * The tree, full depth.
   *
   * `buildSummaryTree` with no summaries, because this mode reads nothing that
   * stage 6 writes: a title, a gist and a navLabel are all on `tree.json`
   * already. Full depth rather than the default 2, because column B expands the
   * current section into its paragraphs and those are leaves.
   *
   * **No `mode === "structure"` guard on the `useMemo`**, unlike `Reader`'s
   * `outlineRoot`. It does not need one and must not have one: this component
   * is only mounted by the `band()` arm for this mode, so the guard `Reader`
   * carries — a hook that runs on every render of the reading view in every
   * mode — is exactly the cost that moving the controller out here removed.
   */
  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks, leafDepth),
    [article.tree, article.blocks, leafDepth],
  );

  /**
   * Where the reader is — the same sampler the gist columns' panels and Outline
   * use, so the three views can never disagree about which section is under the
   * focus line. That agreement is not a nicety here: the mode exists to be
   * flipped between the other two at one scroll position, and a second answer
   * to "where am I" would make the flip land somewhere else.
   *
   * `enabled: true` because mounting is the condition — see the `useMemo`
   * above. `depths: []` because a mode has no gist columns and this band wants
   * none of the rects, only `focusRow`.
   */
  const live = useColumnContext({
    sections,
    depths: EMPTY_DEPTHS,
    enabled: true,
    layoutKey,
  });

  /**
   * **Both halves of "may we draw paragraph rows", answered here rather than in
   * the panel**, because they are facts about the page and the article rather
   * than about the drawing.
   *
   * `paragraphLabelsReady` is the one GPT Sol's review added (finding 3): stage
   * 5 writes the leaves' navLabels, and until it has, a paragraph layer draws
   * blanks that read as *missing article structure* rather than as work in
   * progress. Outline withholds the whole layer for this and says nothing about
   * it — nobody asked for the layer, so a sentence in place of it would answer a
   * question the reader never put — and Structure takes the same rule from the
   * same input.
   */
  const allowParagraphs = proseBeside && paragraphLabelsReady(article.navLabelStatus);

  return (
    <StructurePanel
      root={root}
      focusRow={live.focusRow}
      allowParagraphs={allowParagraphs}
      onJump={onJump}
    />
  );
}
