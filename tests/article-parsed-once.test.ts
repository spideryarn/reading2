// @vitest-environment jsdom
/**
 * The article is parsed once per array of blocks, not once per question asked
 * about it — src/web/search-hits.ts § `page`.
 *
 * `renderedText` (annotate.ts) is `document.createElement("div")`, an
 * `innerHTML =` and a `textContent` read: **a full HTML parse per block**.
 * `page(blocks)` calls it for every block, and six exported resolvers call
 * `page`. Two of them do it inside a loop — one `resolveClaim` per shown claim
 * in ClaimsPanel, one `resolveCriterion` per ticked criterion in CriteriaPanel
 * — so referee mode was O(claims x blocks) parses, and a search paid a whole
 * pass per keypress.
 *
 * These tests count the parses rather than the milliseconds, for the reason
 * docs/reusable/silent-success.md gives: a timing assertion on a shared box is
 * a test that goes red for somebody else's reasons, and a cache that quietly
 * stopped working would still be fast enough to pass one. The count is exact.
 *
 * The spy has to be installed with `vi.mock`, not by wrapping the import here,
 * because `search-hits.ts` holds its own binding to `renderedText` — reassigning
 * ours would leave its copy untouched. `vi.hoisted` for the counter, since the
 * mock factory is lifted above every import in this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, SearchHit } from "../src/types.js";

const spy = vi.hoisted(() => ({ parses: 0 }));

vi.mock("../src/web/annotate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/annotate.js")>();
  return {
    ...actual,
    renderedText: (html: string) => {
      spy.parses += 1;
      return actual.renderedText(html);
    },
  };
});

const { findLiteral, resolveHits } = await import("../src/web/search-hits.js");

const block = (id: string, html: string): Block => {
  const stripped = html.replace(/<[^>]+>/g, "");
  return {
    id,
    tag: "p",
    kind: "text",
    text: stripped,
    words: stripped.split(/\s+/).length,
    html,
    gistable: true,
  };
};

/**
 * Ten blocks, so "parsed the article again" is a number nobody could misread.
 *
 * A **function**, because both caches are keyed on the array's identity and a
 * `WeakMap` entry outlives the test that made it. A shared `const` would let one
 * test measure the previous test's leftovers, which reads as a passing cache and
 * is really two tests testing one thing.
 */
const freshBlocks = (): Block[] =>
  Array.from({ length: 10 }, (_, i) =>
    block(`spya-aaaa${i}z`, `<p>Block ${i}: the mind is <em>software</em> on wet hardware.</p>`),
  );

const BLOCKS: Block[] = freshBlocks();

const run = (hits: SearchHit[]) => [{ id: "spya-run2aa", slot: 0, hits }];

const HITS: SearchHit[] = [
  { blockId: BLOCKS[2]!.id, quote: "software", start: 10, confidence: 90, reasoning: "it says so" },
];

beforeEach(() => {
  spy.parses = 0;
});

describe("the blocks are parsed once per array identity", () => {
  it("parses every block on the first question", () => {
    resolveHits(BLOCKS, run(HITS));
    expect(spy.parses).toBe(BLOCKS.length);
  });

  /**
   * The referee-mode shape: the same `blocks` array, asked again. This is the
   * one that was O(claims x blocks).
   */
  it("parses nothing on a second question about the same blocks", () => {
    resolveHits(BLOCKS, run(HITS));
    spy.parses = 0;
    resolveHits(BLOCKS, run(HITS));
    expect(spy.parses).toBe(0);
  });

  /**
   * The search shape: a literal search re-run as the reader types another
   * character. `findLiteral` built its own copy of the same loop.
   */
  it("parses nothing when a literal search runs again over the same blocks", () => {
    findLiteral(BLOCKS, "software");
    spy.parses = 0;
    findLiteral(BLOCKS, "softwar");
    expect(spy.parses).toBe(0);
  });

  /** And the cache is keyed on the array, so a different article still parses. */
  it("parses again for a different blocks array", () => {
    findLiteral(BLOCKS, "software");
    spy.parses = 0;
    const other = BLOCKS.slice(0, 4);
    findLiteral(other, "software");
    expect(spy.parses).toBe(other.length);
  });
});

/**
 * The other half of the per-keypress cost, and the one that survives fixing the
 * parse: `literalSpans` used to `foldCase` its block, which walks the text by
 * code point and allocates a `number[]` as long as it — once per block, per
 * keypress.
 *
 * Counted through `String.prototype.toLowerCase`, because the fold cache is
 * private and a timing assertion on a shared box is a test that goes red for
 * somebody else's reasons. **`foldCase` is not the only caller of it on this
 * path** — `quote-match.ts` lowercases too, and an early draft of this test
 * asserted zero and was wrong by 52. So every assertion here is about the
 * *difference* a whole-article fold makes, which is hundreds of calls against a
 * needle's eight, and not about an absolute count.
 *
 * Each test builds its own `blocks` array. The caches are keyed on array
 * identity and outlive a test, so sharing one array between two tests makes the
 * second one measure the first one's leftovers — which is exactly how the first
 * draft of this block failed.
 */
describe("the article is case-folded once per array identity", () => {
  const withLowerCaseCounted = <T,>(body: () => T): { result: T; calls: number } => {
    const real = String.prototype.toLowerCase;
    let calls = 0;
    String.prototype.toLowerCase = function counted(this: string) {
      calls += 1;
      return real.call(this);
    };
    try {
      return { result: body(), calls };
    } finally {
      String.prototype.toLowerCase = real;
    }
  };

  it("folds the whole article on the first search and not on the next keystroke", () => {
    const fresh = freshBlocks();
    const first = withLowerCaseCounted(() => findLiteral(fresh, "software"));
    const again = withLowerCaseCounted(() => findLiteral(fresh, "softwar"));
    // Ten blocks of ~60 characters, folded by code point: hundreds of calls.
    expect(first.calls).toBeGreaterThan(400);
    // The needle, and whatever `quote-match` does. Not the article.
    expect(again.calls).toBeLessThan(150);
    expect(first.result).toHaveLength(10);
    expect(again.result).toHaveLength(10);
  });

  /**
   * Folding is **lazy**, and this is what makes that observable: if `page` folded
   * eagerly, the resolvers would have paid for it and the search after one would
   * be cheap. It is not — the article is still unfolded when `findLiteral`
   * arrives. Most readers never type in the find box, and they should not be
   * holding an offset map the length of the article in case they do.
   *
   * **Said plainly: this one was never watched red**, unlike the three above it.
   * It guards a decision (lazy, not eager) rather than a bug that existed, so
   * the only way to see it fail is to write the eager version first. It fails
   * against that; it does not fail against the code this replaced.
   */
  it("does not fold for a resolver that does not search", () => {
    const fresh = freshBlocks();
    resolveHits(fresh, run(HITS));
    const { calls } = withLowerCaseCounted(() => findLiteral(fresh, "software"));
    expect(calls).toBeGreaterThan(400);
  });
});
