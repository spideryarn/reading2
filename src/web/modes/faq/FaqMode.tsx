/**
 * **FAQ mode's controller.** The owner's band, and — since 2026-09-29 — the
 * visitor's.
 *
 * The shape of `modes/<feature>/` since 2026-09-06
 * (docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md),
 * with two things missing on purpose:
 *
 * - **no passages** — each passage under a question is a jump through `onJump`,
 *   not a selection, so there is no `usePassageLifecycle` here and
 *   `selectPassages` answers `NOTHING` (src/web/reader/passages.ts);
 * - **no selection in the URL** — nothing addresses a question yet. What the
 *   URL does carry, since 2026-09-29, is the order and the bar: `?faqby=` and
 *   `?faqbar=`, shared by both bands through `useFaqControls`, as
 *   `?citeby=`/`?citebar=` are (plan 260929g).
 *
 * **The visitor twin, `VisitorFaqBand`**, draws the stored FAQ off the public
 * payload with no `useFaq` under it, so it can neither read the owner's FAQ nor
 * ask for one. It was `owners-only` until a signed-out reader of a public
 * article was refused a stored Trajectory for the cost of making one
 * (SPIDERYARN-READING2-56,
 * docs/plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md).
 *
 * docs/project/faq.md.
 */

import { useQueryState } from "nuqs";
import type { BlockId } from "../../../types.js";
import type { PublicFaq } from "../../../public-types.js";
import { faqBarParam, faqOrderParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { useFaq } from "../../useFaq.js";
import { FaqPanel } from "../../FaqPanel.js";

/**
 * The FAQ, and the fetch and job that belong to it.
 *
 * A component of its own for the reason every artefact band is: `useFaq`
 * fetches on mount and `useAutoRun`'s owner must die with the band, so neither
 * may be mounted up in `Reader`. `useRenderCount("FaqBand")` is the throw site
 * tests/a-broken-mode-leaves-the-article-readable.test.tsx § WITNESS uses.
 */
export function FaqBand({ slug, onJump }: { slug: string; onJump(id: BlockId): void }) {
  useRenderCount("FaqBand");
  const owner = useFaq(slug);
  const controls = useFaqControls();
  return <FaqPanel access={{ kind: "owner", owner }} {...controls} onJump={onJump} />;
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * The questions came in the page's own payload. No `useFaq`, so no read of
 * `/api/faq/:slug`, no `useAutoRun` and no job — nothing here can ask the
 * model, which is why this is a second band rather than a flag on the first:
 * a hook cannot be called conditionally, so the owner/visitor seam is a
 * component boundary (src/web/reader-capability.ts; `VisitorTimelineBand` is
 * the sibling).
 */
export function VisitorFaqBand({ faq, onJump }: { faq: PublicFaq; onJump(id: BlockId): void }) {
  useRenderCount("VisitorFaqBand");
  const controls = useFaqControls();
  return <FaqPanel access={{ kind: "visitor", faq }} {...controls} onJump={onJump} />;
}

/** `?faqby=` and `?faqbar=`, which both bands share. */
function useFaqControls() {
  const [order, setOrder] = useQueryState("faqby", faqOrderParam);
  /* Null is "nobody has touched the bar", which the panel resolves to
     `FAQ_BAR_DEFAULT` — kept null here so the default is one number in one
     file (src/web/faq-order.ts). */
  const [bar, setBar] = useQueryState("faqbar", faqBarParam);
  return { order, onOrder: setOrder, bar, onBar: setBar };
}
