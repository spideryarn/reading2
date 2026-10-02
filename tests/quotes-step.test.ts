/**
 * **‹ › and ← → between quotes** — `stepQuote` in src/web/QuotesPanel.tsx, the
 * one rule the band's stepper, the keys and the prose card share.
 * docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md § 3.
 */
import { describe, expect, it } from "vitest";
import { stepQuote } from "../src/web/QuotesPanel.js";
import type { Quote } from "../src/types.js";

const q = (id: string): Quote => ({ id, blockId: `b-${id}`, text: id, start: 0 }) as unknown as Quote;
const LIST = [q("a"), q("b"), q("c")];

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
