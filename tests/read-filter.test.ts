/**
 * What counts as read — src/web/read-filter.ts.
 * docs/plans/260930e-quiz-only-asks-about-what-you-have-read.md.
 */
import { describe, expect, it } from "vitest";
import type { QuizQuestion } from "../src/types.js";
import { isRead, questionIsRead, READ_ENOUGH, shareRead } from "../src/web/read-filter.js";
import type { ReadLevel } from "../src/web/reading-time.js";

const q = (...ids: string[]): QuizQuestion => ({
  id: "spya-qqqqqq",
  question: "Why?",
  referenceAnswer: "Because.",
  evidence: ids.map((blockId) => ({ blockId, quote: "x", start: 0 })),
});

const levels = (entries: [string, ReadLevel][]) => new Map<string, ReadLevel>(entries);

describe("isRead", () => {
  it("is level 3 and up, and a block with no level is unread", () => {
    expect(READ_ENOUGH).toBe(3);
    const l = levels([
      ["spya-aaaaaa", 2],
      ["spya-bbbbbb", 3],
      ["spya-cccccc", 4],
    ]);
    expect(isRead(l, "spya-aaaaaa")).toBe(false);
    expect(isRead(l, "spya-bbbbbb")).toBe(true);
    expect(isRead(l, "spya-cccccc")).toBe(true);
    expect(isRead(l, "spya-zzzzzz")).toBe(false);
  });
});

describe("questionIsRead", () => {
  const l = levels([
    ["spya-aaaaaa", 4],
    ["spya-bbbbbb", 3],
    ["spya-cccccc", 1],
  ]);

  const current = new Set(["spya-aaaaaa", "spya-bbbbbb", "spya-cccccc"]);

  it("needs every evidence block read, not just one", () => {
    expect(questionIsRead(q("spya-aaaaaa", "spya-bbbbbb"), l, current)).toBe(true);
    expect(questionIsRead(q("spya-aaaaaa", "spya-cccccc"), l, current)).toBe(false);
  });

  it("treats a block with no reading time as unread", () => {
    expect(questionIsRead(q("spya-aaaaaa", "spya-dddddd"), l, new Set([...current, "spya-dddddd"]))).toBe(false);
  });

  it("treats a block the article no longer has as unread, however long it was read", () => {
    /* Reading time keeps totals for removed identities, so a stale quiz's
       evidence can carry a level 4 for a passage that is not on the page. */
    const withGone = levels([...l, ["spya-gonegn", 4]]);
    expect(questionIsRead(q("spya-aaaaaa", "spya-gonegn"), withGone, current)).toBe(false);
    expect(questionIsRead(q("spya-aaaaaa", "spya-gonegn"), withGone, new Set([...current, "spya-gonegn"]))).toBe(true);
  });

  it("never counts a question with no evidence as read", () => {
    /* `[].every` is true, which would put a question about nothing in
       particular in front of a reader who has read nothing. */
    expect(questionIsRead(q(), l, current)).toBe(false);
  });
});

describe("shareRead", () => {
  it("is by words, not by blocks", () => {
    const words = new Map([
      ["spya-headng", 3],
      ["spya-longpr", 297],
    ]);
    expect(shareRead(levels([["spya-headng", 4]]), words)).toBeCloseTo(0.01, 6);
    expect(shareRead(levels([["spya-longpr", 3]]), words)).toBeCloseTo(0.99, 6);
  });

  it("is zero for a piece with no words, rather than NaN", () => {
    expect(shareRead(levels([["spya-aaaaaa", 4]]), new Map([["spya-aaaaaa", 0]]))).toBe(0);
    expect(shareRead(levels([]), new Map())).toBe(0);
  });

  it("ignores levels for blocks the piece does not have", () => {
    expect(shareRead(levels([["spya-other1", 4]]), new Map([["spya-aaaaaa", 100]]))).toBe(0);
  });
});
