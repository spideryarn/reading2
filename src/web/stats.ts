/**
 * Everything countable about an article, derived rather than stored.
 *
 * Pulled out of Masthead.tsx on 2026-08-25 because two places now need it: the
 * facts line under the title, and the drawer's "About this article" panel
 * (Dock.tsx). Pure and DOM-free, like layout.ts and comment-nav.ts, so the
 * arithmetic can be checked without rendering anything.
 *
 * Nothing here is persisted. Counts change whenever the article is re-extracted
 * or the tree is regenerated, and a stored copy would be a second truth that
 * quietly drifts from the first — see docs/project/architecture.md.
 */
import { articleWordCounts } from "../block-policy.js";
import { readingMinutes } from "../reading-time.js";
import type { Article } from "../types.js";

export interface Stats {
  /**
   * **The body's words.** The apparatus — footnotes, endnotes, bibliography —
   * is on the page and is not part of what the masthead is promising, and the
   * shelf card must say the same number. `articleWordCounts` in
   * src/block-policy.ts is the one derivation both reach for; before it they
   * each summed `b.words` and agreed by coincidence.
   */
  words: number;
  minutes: number;
  blocks: number;
  /** Depth-1 nodes: the article's top-level parts. */
  parts: number;
  /** Depth-2 nodes: the sections inside those parts. */
  sections: number;
  /**
   * How many rungs the tree has below the root — 3 means parts, sections and
   * leaves. It is the number of granularity columns the article can offer, so
   * it is the honest answer to "why does this one only have two levels?".
   */
  depth: number;
}

export function articleStats(article: Article): Stats {
  const words = articleWordCounts(article.blocks).body;
  const byDepth = new Map<number, number>();
  let deepest = 0;
  for (const node of Object.values(article.tree.nodes)) {
    byDepth.set(node.depth, (byDepth.get(node.depth) ?? 0) + 1);
    deepest = Math.max(deepest, node.depth);
  }
  return {
    words,
    // Borrowed, never restated. This module used to carry its own `WPM = 230`
    // and its own `Math.max(1, ...)` — a second copy of the one number
    // src/reading-time.ts exists to keep in one place. The two agreed, so
    // nothing would ever have reported the drift: the library card would have
    // said 47 min and the masthead 54, and both would have looked reasonable on
    // their own page. See docs/reusable/silent-success.md.
    minutes: readingMinutes(words),
    blocks: article.blocks.length,
    parts: byDepth.get(1) ?? 0,
    sections: byDepth.get(2) ?? 0,
    depth: deepest,
  };
}
