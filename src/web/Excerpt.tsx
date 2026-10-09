/**
 * **The article's own words, outside the prose** — drawn from the block's
 * markup, so a formula is maths and an italic is italic, as in the paragraph
 * they came from (src/web/excerpt-html.ts, plan 261009k, spya-pqae7m).
 *
 * `Excerpt` finds the block through the reading view's block index
 * (block-link-index.ts § `useBlockLinks`), so a caller passes only the id it
 * already has; `BlockExcerpt` is for a caller already holding the block, or
 * drawn outside that index — the block-link card, the info page. Without a
 * block, or for words the block does not hold, the string is drawn as before.
 *
 * `words` may carry a leading or trailing `…` of the caller's own — a cut
 * quote, a snippet around a hit. That is put back outside the drawn words,
 * because it is not in the block. `near` is excerpt-html.ts § `ExcerptAt`'s.
 */
import { useMemo } from "react";
import type { Block, BlockId } from "../types.js";
import { useBlockLinks } from "./block-link-index.js";
import { excerptFallbackHtml, excerptHtml } from "./excerpt-html.js";

const ELLIPSIS = "…";

interface Words {
  words: string;
  /** Where the words sit in the block's drawn text, when the caller knows — a hit's `Found.start`. */
  near?: number | undefined;
}

export function Excerpt({ blockId, words, near }: Words & { blockId: BlockId | null | undefined }) {
  const index = useBlockLinks();
  return <BlockExcerpt block={blockId ? index?.get(blockId)?.block : undefined} words={words} near={near} />;
}

export function BlockExcerpt({ block, words, near }: Words & { block: Block | undefined }) {
  const drawn = useMemo(() => {
    if (!block) return null;
    const lead = words.startsWith(ELLIPSIS);
    const tail = words.endsWith(ELLIPSIS) && words.length > ELLIPSIS.length;
    const inner = words.slice(lead ? ELLIPSIS.length : 0, tail ? -ELLIPSIS.length : undefined);
    const html =
      excerptHtml(block, inner, near === undefined ? {} : { near }) ?? excerptFallbackHtml(block, inner);
    return html === null ? null : { html, lead, tail };
  }, [block, words, near]);

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
