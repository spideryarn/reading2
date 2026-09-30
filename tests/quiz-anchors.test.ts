/**
 * Where a quiz question hangs in the prose — src/web/quiz-anchors.ts.
 * docs/plans/260930i-quiz-questions-in-the-prose-and-in-trajectory-stops.md.
 */
import { describe, expect, it } from "vitest";
import type { QuizQuestion } from "../src/types.js";
import { questionsByAnchor } from "../src/web/quiz-anchors.js";

const q = (id: string, ...ids: string[]): QuizQuestion => ({
  id,
  question: `${id}?`,
  referenceAnswer: "Because.",
  evidence: ids.map((blockId) => ({ blockId, quote: "x", start: 0 })),
});

/* Ids chosen so that string order and document order disagree: sorting the ids
   would put `spya-zzzzzz` last, and it is first in the article. */
const ORDER = ["spya-zzzzzz", "spya-mmmmmm", "spya-aaaaaa", "spya-bbbbbb"];

describe("questionsByAnchor", () => {
  it("hangs a question after its last evidence block in document order, not id order", () => {
    const m = questionsByAnchor([q("spya-q00001", "spya-aaaaaa", "spya-zzzzzz", "spya-mmmmmm")], ORDER);
    expect([...m.keys()]).toEqual(["spya-aaaaaa"]);
  });

  it("keeps path order among questions that share a block", () => {
    const m = questionsByAnchor(
      [q("spya-q00002", "spya-bbbbbb"), q("spya-q00001", "spya-mmmmmm", "spya-bbbbbb"), q("spya-q00003", "spya-zzzzzz")],
      ORDER,
    );
    expect(m.get("spya-bbbbbb")?.map((x) => x.id)).toEqual(["spya-q00002", "spya-q00001"]);
    expect(m.get("spya-zzzzzz")?.map((x) => x.id)).toEqual(["spya-q00003"]);
  });

  it("ignores evidence blocks that have gone, and places nothing when all have", () => {
    const m = questionsByAnchor(
      [q("spya-q00001", "spya-mmmmmm", "spya-gone01"), q("spya-q00002", "spya-gone02")],
      ORDER,
    );
    expect([...m.keys()]).toEqual(["spya-mmmmmm"]);
    expect(m.get("spya-mmmmmm")?.map((x) => x.id)).toEqual(["spya-q00001"]);
  });
});
