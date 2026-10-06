/**
 * **The Recall eval's heuristics, checked without running the eval.**
 *
 * `evals/learn-recall.ts` spends money and is read by a person. What it
 * counts is only a prompt to look, but a count that misreports is worse than
 * none: before this, every correct hinted reply would have been counted as "not
 * ending on a question" and its hint's words charged to the 120-word ceiling
 * (GPT Sol's plan review, F7). So the checks are a pure module, and this pins
 * them — above all that an id **somewhere** in the reply does not count as the
 * question's own link, which is the thing Greg's report was about.
 * docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md
 */
import { describe, expect, it } from "vitest";
import { checkReply } from "../evals/learn-recall-checks.js";

const KNOWN = new Set(["spya-aaaaaa", "spya-bbbbbb", "spya-cccccc"]);
const check = (text: string) => checkReply(text, KNOWN);

describe("is the question itself linked to its passage?", () => {
  it("counts an id inside the question", () => {
    const out = check(
      "The piece turns on search [spya-aaaaaa]. Do you remember what researchers kept doing [spya-bbbbbb]?\n\nHint: He names two games [spya-cccccc].",
    );
    expect(out.questionLink).toBe("linked");
    expect(out.questionIds).toEqual(["spya-bbbbbb"]);
  });

  it("counts an id straight after the question mark", () => {
    const out = check("Do you remember what researchers kept doing? [spya-bbbbbb]\n\nHint: He names two games.");
    expect(out.questionLink).toBe("linked");
    expect(out.questionIds).toEqual(["spya-bbbbbb"]);
  });

  it("does not count the correction's id", () => {
    const out = check(
      "He says search won [spya-aaaaaa]. Do you remember what comes next?\n\nHint: He names two games.",
    );
    expect(out.questionLink).toBe("no-id");
    expect(out.questionIds).toEqual([]);
    /* The reply as a whole still cites, which is the old check passing. */
    expect(out.citations).toBe(1);
  });

  it("does not count the hint's id", () => {
    const out = check("Do you remember what comes next?\n\nHint: He names two games [spya-cccccc].");
    expect(out.questionLink).toBe("no-id");
    expect(out.citations).toBe(1);
  });

  it("says when the question's id is not one the article has", () => {
    const out = check("Do you remember what researchers kept doing [spya-zzzzzz]?\n\nHint: He names two games.");
    expect(out.questionLink).toBe("unknown-id");
    expect(out.questionIds).toEqual(["spya-zzzzzz"]);
  });

  it("takes a question that starts a new paragraph as its own sentence", () => {
    const out = check("He says search won [spya-aaaaaa]\n\nDo you remember why?\n\nHint: He names two games.");
    expect(out.questionLink).toBe("no-id");
  });

  it("reports a reply that asks nothing as having no question", () => {
    const out = check('He says "we have to learn the bitter lesson" [spya-aaaaaa].');
    expect(out.questionLink).toBe("no-question");
    expect(out.endsInQuestion).toBe(false);
    expect(out.nudgeWithoutHint).toBe(false);
  });

  it("cannot tell a clarification from a bare nudge, and says so by flagging both", () => {
    /* `unclear` should be exactly this: one question, no id, no hint. It shows
       up in both counts and the person reading decides. */
    const out = check("Did you mean his point about the brain, or the one about prediction?");
    expect(out.endsInQuestion).toBe(true);
    expect(out.questionLink).toBe("no-id");
    expect(out.hint).toBeNull();
    expect(out.nudgeWithoutHint).toBe(true);
  });
});

describe("the hint is measured apart from the body", () => {
  const body = "Do you remember what researchers kept doing [spya-bbbbbb]?";

  it("judges question-last and the word ceiling on the body alone", () => {
    const longHint = `Hint: ${"word ".repeat(29)}[spya-cccccc].`;
    const out = check(`${body}\n\n${longHint}`);
    expect(out.endsInQuestion).toBe(true);
    expect(out.bodyWords).toBe(8);
    expect(out.hintWords).toBe(30);
    expect(out.hintProblems).toEqual(["over 25 words"]);
  });

  it("flags a hint that asks a question", () => {
    expect(check(`${body}\n\nHint: Was it chess [spya-cccccc]?`).hintProblems).toEqual(["asks a question"]);
  });

  it("finds nothing wrong with a short statement", () => {
    const out = check(`${body}\n\nHint: He names two games [spya-cccccc].`);
    expect(out.hintProblems).toEqual([]);
    expect(out.nudgeWithoutHint).toBe(false);
    expect(out.strayHint).toBe(false);
  });

  it("requires the hint's own block id, and checks that the article has it", () => {
    expect(check(`${body}\n\nHint: He names two games.`).hintProblems).toEqual(["has no block id"]);
    expect(check(`${body}\n\nHint: He names two games [spya-zzzzzz].`).hintProblems).toEqual([
      "has an unknown block id",
    ]);
  });

  it("counts a nudge that came with no hint", () => {
    const out = check(body);
    expect(out.nudgeWithoutHint).toBe(true);
    expect(out.strayHint).toBe(false);
  });

  it("counts a hint in a spelling the panel will not hide", () => {
    for (const marker of ["**Hint:**", "Hint -", "hint:", "*Hint*:"]) {
      const out = check(`${body}\n\n${marker} He names two games.`);
      expect(out.hint, marker).toBeNull();
      expect(out.strayHint, marker).toBe(true);
    }
  });

  it("counts a correctly spelt hint the panel still will not hide, because nothing was asked", () => {
    const out = check("He says search won [spya-aaaaaa].\n\nHint: He names two games.");
    expect(out.hint).toBeNull();
    expect(out.strayHint).toBe(true);
  });

  it("does not call an ordinary sentence about a hint a stray one", () => {
    expect(check("There is a hint of this earlier [spya-aaaaaa]. Do you remember where [spya-bbbbbb]?").strayHint).toBe(
      false,
    );
  });
});
