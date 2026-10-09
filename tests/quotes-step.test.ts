// @vitest-environment jsdom
/**
 * **‹ › and ← → between quotes** — `stepQuote` in src/web/QuotesPanel.tsx is
 * the rule the band's stepper and the keys share; the prose card walks the
 * filled quotes in document order.
 * docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md § 3.
 */
import { describe, expect, it } from "vitest";
import { barToReveal, stepQuote } from "../src/web/QuotesPanel.js";
import { quoteCardQuotes } from "../src/web/reader/useQuoteMarks.js";
import { quoteMarkKey, type Found } from "../src/web/search-hits.js";
import type { Quote } from "../src/types.js";

const q = (id: string): Quote => ({ id, blockId: `b-${id}`, text: id, start: 0 }) as unknown as Quote;
const LIST = [q("a"), q("b"), q("c")];

const marked = (quote: Quote): Found =>
  ({
    key: quoteMarkKey(quote.id, quote.blockId),
    blockId: quote.blockId,
    runId: "quotes",
    slot: 0,
    quoteStroke: { tier: "light", alpha: 0.8 },
  }) as unknown as Found;

describe("stepQuote", () => {
  it("steps through the list in the order it is shown", () => {
    expect(stepQuote(LIST, "a", 1)?.id).toBe("b");
    expect(stepQuote(LIST, "c", -1)?.id).toBe("b");
  });

  it("starts at the first, whichever way, when nothing is selected", () => {
    expect(stepQuote(LIST, null, 1)?.id).toBe("a");
    expect(stepQuote(LIST, null, -1)?.id).toBe("a");
  });

  it("treats a selection the list no longer shows as nothing selected", () => {
    /* The bar hid it, or Find more replaced the list: stepping from a quote
       nobody can see would land on a neighbour of nothing. */
    expect(stepQuote(LIST, "hidden", 1)?.id).toBe("a");
  });

  it("goes to the first again on ← from the first — Skim's rule", () => {
    expect(stepQuote(LIST, "a", -1)?.id).toBe("a");
  });

  it("does not wrap: → from the last takes nothing, so the key goes back to the browser", () => {
    expect(stepQuote(LIST, "c", 1)).toBeNull();
  });

  it("has nowhere to go in an empty list", () => {
    expect(stepQuote([], null, 1)).toBeNull();
    expect(stepQuote([], "a", -1)).toBeNull();
  });
});

describe("the quotes available to the prose card", () => {
  it("includes every filled quote in document order, including a Skim stop hidden by the bar", () => {
    const search = {
      key: "search:b:0",
      blockId: LIST[1]!.blockId,
      runId: "search",
      slot: 1,
      quoteStroke: null,
    } as unknown as Found;
    /* `c` stands in for Skim's current stop: `proseFound` puts that hidden
       quote before the threshold-visible marks, so this must recover the
       artefact's document order rather than inherit the merged array's order. */
    const card = quoteCardQuotes(LIST, [marked(LIST[2]!), search, marked(LIST[0]!)]);

    expect(card.listed.map((quote) => quote.id)).toEqual(["a", "c"]);
    expect([...card.byKey.values()].map((quote) => quote.id)).toEqual(["a", "c"]);
  });

  it("lowers a prioritised bar enough for Open in Quotes to keep the row selected", () => {
    const hidden = { ...LIST[1]!, importance: 0.42 };
    const all = [
      { ...LIST[0]!, importance: 0.9 },
      hidden,
      { ...LIST[2]!, importance: 0.7 },
    ];

    expect(barToReveal(all, hidden.id, "prioritised", 0.8)).toBe(0.42);
    expect(barToReveal(all, hidden.id, "document", 0.8)).toBeNull();
    expect(barToReveal(all, hidden.id, "prioritised", 0.4)).toBeNull();
  });
});
