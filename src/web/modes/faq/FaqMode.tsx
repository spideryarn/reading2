/**
 * **FAQ mode's controller.** The owner's band, and nothing else.
 *
 * The shape of `modes/<feature>/` since 2026-09-06
 * (docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md),
 * with three things missing on purpose:
 *
 * - **no visitor twin** — `POLICY.faq` is `owners-only` for v1, so a visitor
 *   meets `VisitorBand`'s sentence, not this (src/web/visitor.ts);
 * - **no passages** — each passage under a question is a jump through `onJump`,
 *   not a selection, so there is no `usePassageLifecycle` here and
 *   `selectPassages` answers `NOTHING` (src/web/reader/passages.ts);
 * - **no URL parameters** — nothing addresses a question yet.
 *
 * docs/project/faq.md.
 */

import type { BlockId } from "../../../types.js";
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
  return <FaqPanel owner={owner} onJump={onJump} />;
}
