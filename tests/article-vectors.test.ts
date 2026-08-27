/**
 * **Which paragraphs get a vector, and what we say about the ones that do not**
 * — src/article-vectors.ts.
 *
 * The embedding call itself is not tested here; it belongs to a provider and to
 * `src/embeddings.ts`. What is tested is the rule *around* it, and the rule
 * matters for a reason that is easy to miss: **two features draw pictures from
 * this same set.** The Force picture's dotted lines and the Drift and Trail
 * dots must be about the same paragraphs, or both will say "the article" while
 * meaning two different subsets of it — and nothing anywhere would report that.
 *
 * The counts get their own tests because they are shown to the reader. A picture
 * that quietly leaves out a fifth of the article looks exactly like a picture of
 * all of it (docs/reusable/silent-success.md), so the strip says how many were
 * left out and why — and "why" has to be three numbers rather than one, because
 * "too short to embed" is a fact about the article and "we stopped at 1,500" is
 * a fact about our wallet.
 */
import { describe, expect, it } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { embeddable, MAX_BLOCKS, MAX_CHARS, MIN_WORDS } from "../src/article-vectors.js";

function block(i: number, over: Partial<Block> = {}): Block {
  const words = over.words ?? 40;
  return {
    id: `spya-b${String(i).padStart(4, "0")}` as BlockId,
    tag: "p",
    kind: "text",
    text: Array.from({ length: words }, (_, w) => `word${w}`).join(" "),
    words,
    html: "<p></p>",
    gistable: true,
    ...over,
  };
}

describe("embeddable", () => {
  it("keeps prose and drops what the table of contents already drops", () => {
    const blocks = [
      block(0),
      block(1, { gistable: false, kind: "media", note: "an image" }),
      block(2),
    ];
    const { items, skipped } = embeddable(blocks);
    expect(items.map((i) => i.row)).toEqual([0, 2]);
    expect(skipped).toEqual({ nonProse: 1, tooShort: 0, capped: 0 });
  });

  it("drops a passage too short to mean anything, and says so", () => {
    /* A three-word heading embeds perfectly well and then sits at cosine 0.8
       from every other three-word heading, because what they have in common is
       being short. The tf-idf graph had the same bug in the other measure. */
    const blocks = [block(0, { words: MIN_WORDS - 1 }), block(1, { words: MIN_WORDS })];
    const { items, skipped } = embeddable(blocks);
    expect(items.map((i) => i.row)).toEqual([1]);
    expect(skipped.tooShort).toBe(1);
  });

  it("keeps each block's row in the WHOLE article, not in the filtered list", () => {
    /* Everything downstream reasons about reading order — `similar.ts` excludes
       immediate neighbours, `scatter.ts` puts the article down the page — and a
       compacted index would make two paragraphs adjacent because everything
       between them was too short to embed. */
    const blocks = [
      block(0, { words: 2 }),
      block(1),
      block(2, { words: 2 }),
      block(3, { words: 2 }),
      block(4),
    ];
    const { items } = embeddable(blocks);
    expect(items.map((i) => i.row)).toEqual([1, 4]);
  });

  it("charges the cap only for blocks it would otherwise have embedded", () => {
    /* **The order of the three checks is load-bearing**, and the natural order
       is the wrong one. Budget-first charges every remaining block to the cap,
       so an article that ends in a run of headings reports them as paragraphs
       lost to our budget when they were never eligible. One number is about the
       reader's article and the other is about our wallet; swapping them says
       the second in the words of the first. GPT Sol's finding on the built
       code. */
    const blocks = [
      ...Array.from({ length: MAX_BLOCKS }, (_, i) => block(i)),
      block(MAX_BLOCKS, { words: 2 }),
      block(MAX_BLOCKS + 1, { gistable: false, kind: "media" }),
      block(MAX_BLOCKS + 2),
    ];
    const { items, skipped } = embeddable(blocks);
    expect(items).toHaveLength(MAX_BLOCKS);
    expect(skipped).toEqual({ nonProse: 1, tooShort: 1, capped: 1 });
  });

  it("counts what the spending cap cost rather than merely stopping at it", () => {
    /* `capped` is a different fact from `tooShort` and has to be a different
       number: one says something about the article, the other says we ran out
       of budget. Reporting the second in the words of the first is the kind of
       wrong that reads as fine. */
    const blocks = Array.from({ length: MAX_BLOCKS + 25 }, (_, i) => block(i));
    const { items, skipped } = embeddable(blocks);
    expect(items).toHaveLength(MAX_BLOCKS);
    expect(skipped.capped).toBe(25);
    expect(skipped.tooShort).toBe(0);
  });

  it("has a per-block length cap, because one bad extraction is one huge bill", () => {
    /* Not tested through `embeddable` — it applies where the text is sent — but
       pinned here because it is the constant that stops a single "paragraph"
       that is really the whole document from becoming one enormous billable
       request. It went missing once already, in the first draft of this module,
       when the filter was lifted out of `similar.ts` and the truncation was
       not (GPT Sol's finding, 2026-08-27). A number nobody asserts is a number
       that can quietly become zero. */
    expect(MAX_CHARS).toBeGreaterThan(1000);
    expect(MAX_CHARS).toBeLessThanOrEqual(20000);
  });
});
