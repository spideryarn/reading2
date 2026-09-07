/**
 * **Debate mode's controller.** One band, and no passage hook underneath it: a
 * row here is a page on the web rather than a passage in the article, so there
 * is nothing to resolve, keep in step or colour. The docblock below says why that
 * is the design and not a stub.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established a day earlier: a mode's controller, its visitor twin and its hook
 * move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 * The `?name=` wiring below is the one thing that did not come across unchanged: it
 * arrived a day later with Stage P, and its conflict was the whole of `App.tsx`.
 * See docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md.
 */

import { useQueryState } from "nuqs";
import type { BlockId } from "../../../types.js";
import { nameParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { useDebate } from "../../useDebate.js";
import { DebatePanel } from "../../DebatePanel.js";

/**
 * The debate, and the fetch that belongs to it.
 *
 * A component of its own for the reason `TimelineBand` and `IdeasBand` are:
 * `useDebate` fetches on mount, so calling it up in `Reader` would charge every
 * reader of every article a request for a web search almost none of them will
 * open.
 *
 * **The shortest band in this file, and that is the design rather than a stub.**
 * The passage rules its neighbours follow — `usePassageLifecycle`, three of
 * them — are about marks in the prose, and Debate has none: a row is a page on
 * the web, not a passage in the article, so there is no `Found` to resolve, no
 * `openKey` to keep in step and no colour slot to assign. It is also why Debate
 * answers `NO_FOUND` in `selectPassages` (reader/passages.ts) rather than
 * carrying a slot. What it hands down, besides the bar's level, is `onJump`,
 * because a group-two row names the block whose claim it answers and has to
 * offer the way there. Marks
 * are the first thing to add — the plan's § Deliberately not in v1 — and adding
 * them is what would bring the hook and a passage slot with it.
 *
 * **Owner-only, so there is one of these and not two**, until Stage 4 builds
 * the public contract. See the branch above.
 */
export function DebateBand({ slug, onJump }: { slug: string; onJump(id: BlockId): void }) {
  useRenderCount("DebateBand");
  const debate = useDebate(slug);
  /* Null is "nobody has touched the bar", which the panel resolves to
     `DEBATE_LEVEL_DEFAULT` — the same shape as `?bar=` in `QuotesBand`, so the
     default stays one word in one file. See `nameParam` in params.ts. */
  const [level, setLevel] = useQueryState("name", nameParam);
  return (
    <DebatePanel
      access={{ kind: "owner", owner: debate }}
      onJump={onJump}
      level={level}
      onLevel={setLevel}
    />
  );
}
