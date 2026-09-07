/**
 * **Summary mode's controller.** The band, and the hook underneath it:
 * `?deep=`, the summary tree, and the row the reader is standing on.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established two days earlier: a mode's controller, its visitor twin and its
 * hook move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. Summary has no
 * visitor twin — see the docblock below for why there is nothing to own. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */

import { useMemo } from "react";
import { useQueryState } from "nuqs";
import type { Article, BlockId } from "../../../types.js";
import { currentAt, deepParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { buildSummaryTree } from "../../tree.js";
import { SummaryPanel } from "../../SummaryPanel.js";

/**
 * The summary outline, and the two bits of view state that belong to it.
 *
 * A component of its own even though it fetches nothing, for the reason the
 * `?deep=` parameter gives: it is meaningless outside summary mode, and reading
 * it in `Reader` would put a parameter subscription on every render of the
 * reading view for a value only this component uses.
 *
 * **Owner and visitor get the same component, because there is nothing to
 * own.** Until 2026-08-31 there were two bands, an owner's `useSummaries` fetch
 * and a visitor's `PublicSummaries` from the page payload, both feeding a panel
 * that took an `access` prop. All of that was carrying the generated length
 * ladder; the gists come down inside the article itself, and the two arms
 * collapse into this. docs/plans/260831s-gist-only-summaries.md.
 *
 * See docs/project/summaries.md.
 */
export function SummaryBand({
  article,
  onJump,
}: {
  article: Article;
  onJump(id: BlockId): void;
}) {
  useRenderCount("SummaryBand");
  return <SummaryPanel {...useSummaryMode(article)} onJump={onJump} />;
}

/**
 * Everything the summary band does that is not rendering.
 *
 * `?deep=` lives here for the reason it used to live in the band: it is
 * meaningless outside summary mode, and reading it in `Reader` would put a
 * parameter subscription on every render of the reading view for a value only
 * this mode uses.
 */
function useSummaryMode(article: Article) {
  const [deep, setDeep] = useQueryState("deep", deepParam);

  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks),
    [article.tree, article.blocks],
  );

  /* Read, never written, and not a subscription — see `currentAt` in
     params.ts.

     Turned into a row index here rather than passed down as an id, because the
     panel's question is "is the reader inside this range", and a range is a
     pair of row indices — comparing ids would be comparing random strings for
     order, which is the one thing block-ids.md forbids. */
  const at = currentAt();
  const atRow = useMemo(() => {
    if (at === null) return null;
    const i = article.blocks.findIndex((b) => b.id === at);
    return i === -1 ? null : i;
  }, [at, article.blocks]);

  return { root, deep, onDeep: (next: number) => void setDeep(next), atRow };
}
