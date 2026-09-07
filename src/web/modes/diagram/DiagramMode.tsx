/**
 * **Diagram mode's controller.** One band, owner and visitor alike, holding
 * `?diagram=`, `?dx=` and `?dhue=` and the tree the pictures are drawn from.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established two days earlier: a mode's controller, its visitor twin and its
 * hook move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. Diagram's
 * owner/visitor seam is a prop rather than a second band — `DiagramAccess`. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */

import { useMemo } from "react";
import { useQueryState } from "nuqs";
import type { Article, BlockId } from "../../../types.js";
import { diagramAxisParam, diagramHueParam, diagramParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { buildSummaryTree } from "../../tree.js";
import { DiagramPanel, type DiagramAccess } from "../../DiagramPanel.js";

/**
 * Diagram mode's band — the article, drawn.
 *
 * Same shape as `SummaryBand` above and for the same reasons: `?diagram=` is
 * read here rather than in `Reader`, because it is meaningless outside this mode
 * and a subscription in the parent would cost every render of the reading view.
 *
 * **This component fetches nothing**, and that is a statement about this
 * component rather than about the mode. The shape of the picture comes from
 * `article.tree` and `article.blocks`, which the page already holds — so unlike
 * chat, glossary, search and summary there is no artefact to wait for and no
 * job to run here. The two hooks that do spend money live inside the panel,
 * each gated on its own picture being the one on screen: `useSimilar` for
 * Force's dotted lines, `useProjection` for the two scatters' dots. `slug` is
 * passed for exactly that.
 *
 * Every picture here spends a model call, since the free one — `tree`, the
 * outline — was cut on 2026-08-30. **Sketch is the default since
 * 2026-09-04**, and it is the one picture here that draws nothing at all until
 * the reader asks: what an owner arriving here meets is an invitation with the
 * price and the wait on it (SketchView.tsx § the empty state), and opening the
 * mode still buys nothing (activation.ts § `MODE_TARGET`). Force held the
 * default before that, for the opposite reason — it was the only one that drew
 * something real before its answer landed — and it is now behind the
 * experimental-features switch with Drift, Trail and Illustrated. See
 * docs/project/diagram.md.
 */
export function DiagramBand({
  access,
  experimental,
  slug,
  article,
  at,
  onJump,
}: {
  /** Owner or visitor — DiagramPanel.tsx § DiagramAccess is the whole argument. */
  access: DiagramAccess;
  /**
   * The experimental-features switch, as the chip row sees it — passed straight
   * through. `Reader` reads the hook once and hands the answer to both the bar
   * and this band, which is what stops them disagreeing.
   * DiagramPanel.tsx § `experimental`.
   */
  experimental: boolean;
  slug: string;
  article: Article;
  /**
   * Where the reader is, **from `useReadingPosition`'s own state rather than
   * from `location.search`.**
   *
   * The other bands read the address at render time, and that is fine for them.
   * It is not fine here, because this panel has buttons that *move* the reader
   * and then compute their next move from where they think the reader is.
   * `jumpTo` writes the URL with `throttle(0)`, which lands on the next task —
   * so a render triggered by the state change can still see the old
   * `location.search`, and a second press inside that window steps from the
   * stale row and lands on the rung it has just used. GPT Sol, 2026-08-30.
   */
  at: BlockId | null;
  onJump(id: BlockId): void;
}) {
  useRenderCount("DiagramBand");
  const [kind, setKind] = useQueryState("diagram", diagramParam);
  /* The two scatter controls, in the URL beside the picture they belong to —
     `?dx=` and `?dhue=`. They live here rather than in the panel for the same
     reason `?diagram=` does: every bit of view state is in the address
     (docs/project/url-state.md), and unlike the collapse set these are stable
     words rather than positional ids, so a pasted link cannot become quietly
     wrong after a re-ingest. */
  const [axis, setAxis] = useQueryState("dx", diagramAxisParam);
  const [hue, setHue] = useQueryState("dhue", diagramHueParam);

  /* Titles, gists and sizes, all of which are on the tree — which is what keeps
     a diagram from ever being blank on an article nobody has paid for. */
  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks),
    [article.tree, article.blocks],
  );

  /* Turned into a row index because the question is "which node contains the
     reader", and containment is a comparison of row indices. Block ids carry no
     order. */
  const atRow = useMemo(() => {
    if (at === null) return null;
    const i = article.blocks.findIndex((b) => b.id === at);
    return i === -1 ? null : i;
  }, [at, article.blocks]);

  return (
    <DiagramPanel
      access={access}
      experimental={experimental}
      slug={slug}
      root={root}
      kind={kind}
      onKind={(next) => void setKind(next)}
      atRow={atRow}
      onJump={onJump}
      blocks={article.blocks}
      axis={axis}
      onAxis={(next) => void setAxis(next)}
      hue={hue}
      onHue={(next) => void setHue(next)}
    />
  );
}
