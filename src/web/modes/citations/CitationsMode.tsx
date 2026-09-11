/**
 * **Citations mode's controller.** The owner's band and the two URL parameters
 * under the reader's hand — `?citeby=` and `?citebar=` (src/web/params.ts says
 * why they are not the glossary's `sort` and `gate`).
 *
 * The shape of `modes/<feature>/` since 2026-09-06
 * (docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md),
 * with two things missing on purpose:
 *
 * - **no visitor twin** — `POLICY.citations` is `owners-only` for v1, so a
 *   visitor meets `VisitorBand`'s sentence, not this (src/web/visitor.ts);
 * - **no passages** — the row's "first cited" is a jump through `onJump`, not a
 *   selection, so there is no `usePassageLifecycle` here and `selectPassages`
 *   answers `NO_FOUND` (src/web/reader/passages.ts).
 *
 * docs/project/citations.md.
 */

import { useQueryState } from "nuqs";
import type { BlockId } from "../../../types.js";
import { citeBarParam, citeOrderParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { useCitations } from "../../useCitations.js";
import { CitationsPanel } from "../../CitationsPanel.js";

/**
 * The citations, and the fetch and job that belong to them.
 *
 * A component of its own for the reason every artefact band is: `useCitations`
 * fetches on mount and `useAutoRun`'s owner must die with the band, so neither
 * may be mounted up in `Reader`. `useRenderCount("CitationsBand")` is the throw
 * site tests/a-broken-mode-leaves-the-article-readable.test.tsx § WITNESS uses.
 */
export function CitationsBand({ slug, onJump }: { slug: string; onJump(id: BlockId): void }) {
  useRenderCount("CitationsBand");
  const owner = useCitations(slug);
  const [order, setOrder] = useQueryState("citeby", citeOrderParam);
  /* Null is "nobody has touched the bar", which the panel resolves to
     `CITATION_BAR_DEFAULT` — kept null here so the default is one number in one
     file. */
  const [bar, setBar] = useQueryState("citebar", citeBarParam);
  return (
    <CitationsPanel
      owner={owner}
      order={order}
      onOrder={setOrder}
      bar={bar}
      onBar={setBar}
      onJump={onJump}
    />
  );
}
