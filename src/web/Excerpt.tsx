/**
 * **The article's own words, outside the prose** — drawn from the block's
 * markup, so a formula is maths and an italic is italic, as in the paragraph
 * they came from (src/web/excerpt-html.ts, plan 261009k, spya-pqae7m).
 *
 * The block is found through the reading view's block index
 * (BlockLinkCard.tsx § `useBlockLinks`), so a caller passes only the id it
 * already has. Outside the reading view, for a block the article no longer
 * has, or for words the block does not hold, the string is drawn as before.
 *
 * `words` may carry a leading or trailing `…` of the caller's own — a cut
 * quote, a snippet around a hit. That is put back outside the drawn words,
 * because it is not in the block.
 */
import { useMemo } from "react";
import type { BlockId } from "../types.js";
import { useBlockLinks } from "./BlockLinkCard.js";
import { excerptFallbackHtml, excerptHtml } from "./excerpt-html.js";

const ELLIPSIS = "…";

export function Excerpt({ blockId, words }: { blockId: BlockId | null | undefined; words: string }) {
  const index = useBlockLinks();
  const block = blockId ? index?.get(blockId)?.block : undefined;
  const drawn = useMemo(() => {
    if (!block) return null;
    const lead = words.startsWith(ELLIPSIS);
    const tail = words.endsWith(ELLIPSIS) && words.length > ELLIPSIS.length;
    const inner = words.slice(lead ? ELLIPSIS.length : 0, tail ? -ELLIPSIS.length : undefined);
    const html = excerptHtml(block, inner) ?? excerptFallbackHtml(block, inner);
    return html === null ? null : { html, lead, tail };
  }, [block, words]);

  if (!drawn) return <>{words}</>;
  return (
    <>
      {drawn.lead && ELLIPSIS}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the block's own markup, cut down to inline formatting and put back through the article policy — excerpt-html.ts. */}
      <span className="excerpt" dangerouslySetInnerHTML={{ __html: drawn.html }} />
      {drawn.tail && ELLIPSIS}
    </>
  );
}
