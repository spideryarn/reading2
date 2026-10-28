/**
 * **Explanations mode's controller** — the owner's band, and only the owner's.
 *
 * The shape of `modes/<feature>/` (FaqMode.tsx is the sibling), with three
 * things missing on purpose:
 *
 * - **no visitor twin** — the explanations are written for the owner's profile
 *   and there is no public projection, so a visitor's band is `VisitorBand`
 *   saying the mode is the owner's (src/web/visitor.ts § POLICY);
 * - **no passages** — each quote is a jump, so `selectPassages` answers
 *   `NOTHING` (src/web/reader/passages.ts);
 * - **no URL state** — nothing addresses an explanation yet.
 *
 * docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md.
 */
import type { BlockId, Explanation } from "../../../types.js";
import type { ItemFocus } from "../../item-focus.js";
import { ExplanationsPanel } from "../../ExplanationsPanel.js";
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
  return (
    <ExplanationsPanel owner={owner} onJump={onJump} onAsk={onAsk} focus={focus} onFocusTaken={onFocusTaken} />
  );
}
