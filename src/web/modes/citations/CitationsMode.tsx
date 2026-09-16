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
import { useCitations, type CitationsRead } from "../../useCitations.js";
import { CitationsPanel } from "../../CitationsPanel.js";

/**
 * The citations, and the fetch and job that belong to them.
 *
 * A component of its own for the reason every artefact band is — though since
 * 2026-09-16 only half of that reason is still here. The *fetch* moved up to
 * `OwnedReader`, because the citations are now marked in the prose in every
 * mode and a reader who never opens this band needs the list
 * (`useCitationsRead`). What must still die with the band is `useAutoRun`'s
 * owner, so a Citations press cannot be spent after the reader has left, and
 * `useStepJob`'s subscription, which would otherwise hold the job engine to its
 * idle cadence for every reader of every article.
 * `useRenderCount("CitationsBand")` is the throw
 * site tests/a-broken-mode-leaves-the-article-readable.test.tsx § WITNESS uses.
 */
export function CitationsBand({
  slug,
  read,
  onJump,
}: {
  slug: string;
  /**
   * The opening read, mounted once in `OwnedReader` and shared with the prose.
   * `useCitationsRead` says why it is up there and why the job poller, the
   * auto-run and the POST are not.
   */
  read: CitationsRead;
  onJump(id: BlockId): void;
}) {
  useRenderCount("CitationsBand");
  const owner = useCitations(slug, read);
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
