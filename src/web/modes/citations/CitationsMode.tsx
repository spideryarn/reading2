/**
 * **Citations mode's controller.** The owner's band and the two URL parameters
 * under the reader's hand — `?citeby=` and `?citebar=` (src/web/params.ts says
 * why they are not the glossary's `sort` and `gate`).
 *
 * The shape of `modes/<feature>/` since 2026-09-06
 * (docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md),
 * with one thing missing on purpose:
 *
 * - **no passages** — the row's "first cited" is a jump through `onJump` (with a
 *   `citePassageKey` so it lands on the citing words, plan 260930i), not a
 *   selection, so there is no `usePassageLifecycle` here and `selectPassages`
 *   answers `NO_FOUND` (src/web/reader/passages.ts).
 *
 * **And a visitor twin since 2026-09-29**, `VisitorCitationsBand`: the stored
 * list off the public payload, with no `useCitations`, `useAutoRun` or
 * `useStepJob` under it, so it can neither read the owner's list nor ask for
 * one, and its rows draw no *Find it*. It was `owners-only` until a signed-out
 * reader of a public article was refused a stored Trajectory for the cost of
 * making one (SPIDERYARN-READING2-56,
 * docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md).
 *
 * docs/project/citations.md.
 */

import { useQueryState } from "nuqs";
import type { BlockId } from "../../../types.js";
import type { PublicCitations } from "../../../public-types.js";
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
  onJump(id: BlockId, passage?: string): void;
}) {
  useRenderCount("CitationsBand");
  const owner = useCitations(slug, read);
  const controls = useCitationControls();
  return <CitationsPanel access={{ kind: "owner", owner }} {...controls} onJump={onJump} />;
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * The list came in the page's own payload, every address already re-judged at
 * the public boundary (src/public/dto.ts § `publicCitedWork`). No
 * `useCitations`, so no read of `/api/citations/:slug`, no job and no *Find
 * it* — a second band rather than a flag on the first, because a hook cannot be
 * called conditionally (src/web/reader-capability.ts; `VisitorTimelineBand` is
 * the sibling). The order and the bar are the reader's own URL, so a visitor
 * has them too.
 */
export function VisitorCitationsBand({
  citations,
  onJump,
}: {
  citations: PublicCitations;
  onJump(id: BlockId, passage?: string): void;
}) {
  useRenderCount("VisitorCitationsBand");
  const controls = useCitationControls();
  return <CitationsPanel access={{ kind: "visitor", citations }} {...controls} onJump={onJump} />;
}

/** `?citeby=` and `?citebar=`, which both bands share. */
function useCitationControls() {
  const [order, setOrder] = useQueryState("citeby", citeOrderParam);
  /* Null is "nobody has touched the bar", which the panel resolves to
     `CITATION_BAR_DEFAULT` — kept null here so the default is one number in one
     file. */
  const [bar, setBar] = useQueryState("citebar", citeBarParam);
  return { order, onOrder: setOrder, bar, onBar: setBar };
}
