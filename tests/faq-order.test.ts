/**
 * The FAQ's prioritised order (src/web/faq-order.ts), and the track arithmetic
 * it shares with the Glossary and Citations (src/web/threshold.ts § the track).
 * docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md.
 */
import { describe, expect, it } from "vitest";
import {
  canPrioritise,
  defaultView,
  effectiveOrder,
  FAQ_BAR_DEFAULT,
  orderQuestions,
  priorityOf,
} from "../src/web/faq-order.js";
import {
  applyThreshold,
  canThreshold,
  floorToGateStep,
  GATE_STEP,
  thresholdMax,
  thresholdTop,
} from "../src/web/threshold.js";

const same = (x: number | undefined) => x;
/** A question with no scores — every list before `faq/4`. Typed, because `{ id }` alone shares no key with the scores. */
const bare = (id: string): { id: string; difficulty?: number; centrality?: number } => ({ id });

describe("the shared track", () => {
  /* Sol's invariant, F5: whether a list can be thresholded is exactly whether
     the bar at the data's own top stop hides something. */
  const invariant = (scores: (number | undefined)[]) =>
    canThreshold(scores, same) ===
    applyThreshold(scores, thresholdTop(scores, same), same).hiddenCount > 0;

  it.each([
    ["two scores on either side of a stop", [0.2, 0.6]],
    ["two scores inside one hundredth", [0.501, 0.509]],
    ["everything under one hundredth", [0.005, 0.009]],
    ["the float trap at 0.57 and 0.58", [0.57, 0.58]],
    ["nothing scored", [undefined, undefined]],
    ["one scored, one not", [0.9, undefined]],
  ])("holds canThreshold ⇔ the top stop hides something: %s", (_name, scores) => {
    expect(invariant(scores)).toBe(true);
  });

  it("floors onto the grid without losing a step to binary floating point", () => {
    expect(floorToGateStep(0.57)).toBe(0.57);
    expect(floorToGateStep(0.58)).toBe(0.58);
    expect(floorToGateStep(0.8 * 0.8)).toBe(0.64);
  });

  it("folds an off-range value into the rendered max, but never into the question of whether to offer the bar", () => {
    const scores = [0.2, 0.4];
    expect(thresholdMax(scores, 0.9, same)).toBe(0.9);
    expect(thresholdTop(scores, same)).toBe(0.4);
    expect(thresholdMax([undefined], 0, same)).toBe(GATE_STEP);
    expect(canThreshold([0.4, 0.4], same)).toBe(false);
  });
});

describe("the FAQ's compound", () => {
  it("is centrality × (1 − difficulty), and nothing when either is missing", () => {
    expect(priorityOf({ difficulty: 0.25, centrality: 0.8 })).toBeCloseTo(0.6);
    expect(priorityOf({ difficulty: 0, centrality: 0 })).toBe(0);
    expect(priorityOf({ centrality: 0.8 })).toBeUndefined();
    expect(priorityOf({ difficulty: 0.2 })).toBeUndefined();
  });

  it("puts the approachable central question above the dense central one — the Glossary's product would not", () => {
    const broad = { id: "broad", difficulty: 0.1, centrality: 0.9 };
    const dense = { id: "dense", difficulty: 0.9, centrality: 0.9 };
    expect(orderQuestions([dense, broad], "prioritised", 0).map((q) => q.id)).toEqual(["broad", "dense"]);
  });

  it("breaks ties by reading order, and puts the unscored last in reading order", () => {
    const a = { id: "a", difficulty: 0.5, centrality: 0.6 };
    const b = bare("b");
    const c = { id: "c", difficulty: 0.5, centrality: 0.6 };
    const d = bare("d");
    const e = { id: "e", difficulty: 0, centrality: 1 };
    expect(orderQuestions([a, b, c, d, e], "prioritised", 0).map((q) => q.id)).toEqual(["e", "a", "c", "b", "d"]);
  });

  it("treats a partly scored question as unscored: always visible and after complete scores", () => {
    const low = { id: "low", difficulty: 0.8, centrality: 0.5 };
    const centralityOnly = { id: "partial", centrality: 1 };
    const high = { id: "high", difficulty: 0.1, centrality: 0.9 };
    expect(canPrioritise([low, centralityOnly, high])).toBe(true);
    expect(orderQuestions([low, centralityOnly, high], "prioritised", 0.9).map((q) => q.id)).toEqual([
      "partial",
    ]);
  });

  it("falls back to reading order for a list with no scores, and so does the default view", () => {
    const old = [bare("x"), bare("y")];
    expect(canPrioritise(old)).toBe(false);
    expect(effectiveOrder(old, "prioritised")).toBe("document");
    expect(defaultView(old).map((q) => q.id)).toEqual(["x", "y"]);
  });

  it("gives back a copy in reading order, never the stored array", () => {
    const stored = [bare("x"), bare("y")];
    const out = orderQuestions(stored, "document");
    expect(out).toEqual(stored);
    expect(out).not.toBe(stored);
  });

  it("starts the bar low enough to let most questions in", () => {
    expect(FAQ_BAR_DEFAULT).toBeGreaterThan(0);
    expect(FAQ_BAR_DEFAULT).toBeLessThanOrEqual(0.2);
  });
});
