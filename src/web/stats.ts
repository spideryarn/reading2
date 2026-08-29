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
import { supplementIndex } from "../supplement.js";
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
  /* **The apparatus is not part of the argument's shape.** A supplement is a
     depth-one child of the root and its leaves are at depth two, so counting by
     depth alone advertised gwern as having one more part than it argues and
     forty-one more sections than it has — in the masthead, the metadata page
     and the public page, which is a small lie in three of the places a reader
     is deciding whether to start.
     `deriveLibraryScalars` (src/library-scalars.ts) already did this, with the
     reasoning written next to it; this module is the second implementation of
     the same derivation and only one of them was right. tests/block-policy.test.ts
     now holds the two together. GPT Sol, fourth review, 2026-08-29.
     `depth` is excluded for the same reason and one more: it answers "how many
     granularity columns can this article offer", and a shallow body tree with
     an apparatus behind it would claim a rung the argument does not have. */
  const supplement = supplementIndex(article.tree);
  for (const node of Object.values(article.tree.nodes)) {
    if (supplement.has(node.id)) continue;
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
