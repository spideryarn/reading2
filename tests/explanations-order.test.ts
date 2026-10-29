/**
 * **Explanations' orders and prioritised default** — src/web/explanations-order.ts,
 * the rule the band draws. Plan 261029e § 2b: Glossary's rule (the product
 * gates, reading order orders), an unscored explanation survives every bar,
 * and an `explanations/1` list, which has no scores, offers no orders at all.
 */
import { describe, expect, it } from "vitest";
import {
  EXPLANATIONS_BAR_DEFAULT,
  availableOrders,
  barToReveal,
  canPrioritise,
  effectiveOrder,
  orderExplanations,
  rowScores,
} from "../src/web/explanations-order.js";

const e = (id: string, difficulty?: number, centrality?: number) => ({
  id,
  ...(difficulty === undefined ? {} : { difficulty }),
  ...(centrality === undefined ? {} : { centrality }),
});

/* In reading order: products 0.72, 0.04, 0.30, and one unscored. */
const LIST = [e("hard", 0.9, 0.8), e("easy", 0.2, 0.2), e("mid", 0.5, 0.6), e("bare")];

describe("which orders a list offers", () => {
  it("offers none on a list with no scores — an explanations/1 list looks as it did", () => {
    const old = [e("a"), e("b"), e("c")];
    expect(canPrioritise(old)).toBe(false);
    expect(availableOrders(old)).toEqual([]);
    expect(effectiveOrder(old, "prioritised")).toBe("document");
  });

  it("offers Glossary's four on a scored list, with Glossary's labels bar one", () => {
    expect(availableOrders(LIST).map((o) => o.label)).toEqual([
      "prioritised",
      "reading order",
      "hardest",
      "most central",
    ]);
  });

  it("offers none for a single explanation", () => {
    expect(availableOrders([e("one", 0.5, 0.5)])).toEqual([]);
  });

  it("does not offer prioritised when no position of the bar would hide anything", () => {
    const flat = [e("a", 0.5, 0.5), e("b", 0.5, 0.5)];
    expect(availableOrders(flat).map((o) => o.key)).toEqual(["document", "difficulty", "centrality"]);
    expect(effectiveOrder(flat, "prioritised")).toBe("document");
  });
});

describe("the orders", () => {
  it("prioritised gates on difficulty × centrality at 0.10 and keeps reading order; the unscored survive", () => {
    expect(EXPLANATIONS_BAR_DEFAULT).toBe(0.1);
    expect(orderExplanations(LIST, "prioritised").map((x) => x.id)).toEqual(["hard", "mid", "bare"]);
    expect(orderExplanations(LIST, "prioritised", 0.5).map((x) => x.id)).toEqual(["hard", "bare"]);
  });

  it("a score order is every explanation, highest first, a missing score last", () => {
    expect(orderExplanations(LIST, "difficulty").map((x) => x.id)).toEqual(["hard", "mid", "easy", "bare"]);
    expect(orderExplanations(LIST, "centrality").map((x) => x.id)).toEqual(["hard", "mid", "easy", "bare"]);
    expect(orderExplanations(LIST, "document").map((x) => x.id)).toEqual(["hard", "easy", "mid", "bare"]);
  });
});

describe("barToReveal", () => {
  it("lowers the bar to a hidden explanation's own priority, floored to the step", () => {
    expect(barToReveal(LIST, "easy", "prioritised", 0.1)).toBe(0.04);
  });

  it("moves nothing for a shown one, an unscored one, or in another order", () => {
    expect(barToReveal(LIST, "hard", "prioritised", 0.1)).toBeNull();
    expect(barToReveal(LIST, "bare", "prioritised", 0.9)).toBeNull();
    expect(barToReveal(LIST, "easy", "document", 0.1)).toBeNull();
  });
});

describe("rowScores", () => {
  it("draws the scores a row was placed by, never the product", () => {
    const hard = LIST[0]!;
    expect(rowScores(hard, "prioritised").map((s) => [s.key, s.value])).toEqual([
      ["difficulty", 0.9],
      ["centrality", 0.8],
    ]);
    expect(rowScores(hard, "difficulty").map((s) => s.key)).toEqual(["difficulty"]);
    expect(rowScores(hard, "centrality").map((s) => s.key)).toEqual(["centrality"]);
    expect(rowScores(hard, "document")).toEqual([]);
    /* Missing either: the row was not gated, so neither is drawn. */
    expect(rowScores(e("half", 0.4), "prioritised")).toEqual([]);
  });
});
