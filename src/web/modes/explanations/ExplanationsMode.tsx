/**
 * **Explanations mode's controller** — the owner's band, and only the owner's.
 *
 * The shape of `modes/<feature>/` (FaqMode.tsx is the sibling), with three
 * things missing on purpose — and, since 2026-10-29, the order and the bar in
 * the URL: `?explby=` and `?explbar=`, FAQ's pattern (plan 261029e § 2b, Sol
 * F3). Both are remembered with the article's view (last-view.ts), as
 * `faqby`/`faqbar` are.
 *
 * - **no visitor twin** — the explanations are written for the owner's profile
 *   and there is no public projection, so a visitor's band is `VisitorBand`
 *   saying the mode is the owner's (src/web/visitor.ts § POLICY);
 * - **no passages** — each quote is a jump, so `selectPassages` answers
 *   `NOTHING` (src/web/reader/passages.ts);
 * - **no selection in the URL** — nothing addresses an explanation yet; the
 *   margin's *Open in Explanations* is an in-memory focus (item-focus.ts).
 *
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md.
 */
import { useQueryState } from "nuqs";
import type { BlockId, Explanation } from "../../../types.js";
import type { ItemFocus } from "../../item-focus.js";
import { ExplanationsPanel } from "../../ExplanationsPanel.js";
import { explanationBarParam, explanationOrderParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { useExplanations } from "../../useExplanations.js";

/**
 * The explanations, and the fetch and job that belong to them. A component of
 * its own for the reason every artefact band is: `useExplanations` fetches on
 * mount and `useAutoRun`'s owner must die with the band. `useRenderCount`'s
 * label is the throw site tests/a-broken-mode-leaves-the-article-readable.test.tsx
 * § WITNESS uses.
 */
export function ExplanationsBand({
  slug,
  onJump,
  onAsk,
  focus = null,
  onFocusTaken,
}: {
  slug: string;
  onJump(id: BlockId): void;
  onAsk(explanation: Explanation): void;
  /** One explanation to bring into view once — the margin's *Open in Explanations*. */
  focus?: ItemFocus | null;
  onFocusTaken?: (focus: ItemFocus) => void;
}) {
  useRenderCount("ExplanationsBand");
  const owner = useExplanations(slug);
  const [order, setOrder] = useQueryState("explby", explanationOrderParam);
  /* Null is "nobody has touched the bar", which the panel resolves to
     `EXPLANATIONS_BAR_DEFAULT` — kept null here so the default is one number
     in one file (src/web/explanations-order.ts). */
  const [bar, setBar] = useQueryState("explbar", explanationBarParam);
  return (
    <ExplanationsPanel
      owner={owner}
      order={order}
      onOrder={setOrder}
      bar={bar}
      onBar={setBar}
      onJump={onJump}
      onAsk={onAsk}
      focus={focus}
      onFocusTaken={onFocusTaken}
    />
  );
}
