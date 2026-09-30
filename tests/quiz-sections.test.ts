/**
 * **The quiz's per-section picture** — src/web/quiz-sections.ts.
 *
 * Pure, so every rule can be tested one cell at a time and the panel test only
 * has to show it is wired. The cases worth having are the quiet ones: a tally
 * that counted nothing, or put every question in one section, would still draw
 * a tidy list (docs/reusable/silent-success.md). So:
 *
 * - a question counts in every distinct section its evidence is in, and once
 *   per section however many of its blocks are there;
 * - **no verdict is not evidence** — it can never put a section on the list;
 * - a block the page does not have, and a section with no title, count nowhere;
 * - weakest is the largest share wrong, then most wrong, then article order,
 *   at most three.
 *
 * docs/plans/260930i-quiz-scores-answers-by-section-and-says-where-to-look-again.md.
 */
import { describe, expect, it } from "vitest";
import type { BlockId, QuizQuestion, QuizVerdict } from "../src/types.js";
import type { Section } from "../src/web/position.js";
import { firstWrongIn, type SectionTally, sectionTally, weakSections } from "../src/web/quiz-sections.js";

const bid = (n: number) => `spya-b${String(n).padStart(5, "0")}` as BlockId;
const rowOf = new Map(Array.from({ length: 12 }, (_, i) => [bid(i), i] as const));

/** Intro 0–2, Body 3–5, an untitled one 6–8, Close 9–11. */
const sections: Section[] = [
  { row: 0, blockId: bid(0), nodeId: "n1", title: "Intro" },
  { row: 3, blockId: bid(3), nodeId: "n2", title: "Body" },
  { row: 6, blockId: bid(6), nodeId: "n3", title: "  " },
  { row: 9, blockId: bid(9), nodeId: "n4", title: "Close" },
];

function q(id: string, ...at: number[]): QuizQuestion {
  return {
    id,
    question: `${id}?`,
    referenceAnswer: "",
    evidence: at.map((n) => ({ blockId: n >= 0 ? bid(n) : ("spya-gone00" as BlockId), quote: "x", start: 0 })),
  } as QuizQuestion;
}

const v = (entries: [string, QuizVerdict][]) => new Map(entries);
const titles = (rows: SectionTally[]) => rows.map((r) => r.section.title);

describe("sectionTally", () => {
  it("puts each question in the sections its evidence is in, once each, in article order", () => {
    const questions = [q("q1", 4, 10), q("q2", 1), q("q3", 1, 2), q("q4", 7), q("q5", -1)];
    const tally = sectionTally(questions, v([]), sections, rowOf);
    expect(tally.map((s) => [s.section.title, s.questionIds])).toEqual([
      ["Intro", ["q2", "q3"]],
      ["Body", ["q1"]],
      ["Close", ["q1"]],
    ]);
  });

  it("counts the latest verdicts, and no verdict as neither", () => {
    const questions = [q("q1", 1), q("q2", 2), q("q3", 1), q("q4", 4)];
    const tally = sectionTally(questions, v([["q1", "wrong"], ["q2", "right"], ["q4", "wrong"]]), sections, rowOf);
    expect(tally.map((s) => [s.section.title, s.right, s.wrong])).toEqual([
      ["Intro", 1, 1],
      ["Body", 0, 1],
    ]);
  });
});

describe("weakSections", () => {
  const row = (title: string, right: number, wrong: number): SectionTally => ({
    section: { row: 0, blockId: bid(0), nodeId: title, title },
    questionIds: [],
    right,
    wrong,
  });

  it("lists only sections with a wrong answer: largest share wrong, then most wrong, then article order, at most three", () => {
    const tally = [row("A", 1, 1), row("B", 3, 0), row("C", 20, 2), row("D", 0, 1), row("E", 0, 2), row("F", 1, 1)];
    expect(titles(weakSections(tally))).toEqual(["E", "D", "A"]);
    expect(titles(weakSections(tally, 10))).toEqual(["E", "D", "A", "F", "C"]);
    expect(weakSections([row("B", 3, 0)])).toEqual([]);
  });
});

describe("firstWrongIn", () => {
  it("is the first question in path order whose latest verdict is wrong, among those allowed", () => {
    const section: SectionTally = { section: sections[0] as Section, questionIds: ["q1", "q2", "q3"], right: 1, wrong: 2 };
    const verdicts = v([["q1", "right"], ["q2", "wrong"], ["q3", "wrong"]]);
    expect(firstWrongIn(section, verdicts, () => true)).toBe("q2");
    expect(firstWrongIn(section, verdicts, (id) => id !== "q2")).toBe("q3");
    expect(firstWrongIn(section, verdicts, () => false)).toBeUndefined();
  });
});
