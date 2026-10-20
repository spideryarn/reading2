/**
 * The guide conversation eval must fail closed: every generated row gets one
 * counterpart and one verdict, and the judge sees all of every cited passage.
 * Plan docs/plans/261019p-guide-chat-plainer.md, stage 1.
 */
import { describe, expect, it } from "vitest";

import { citedPassages, median, pairRows, screen, sourceSha256 } from "../evals/guide/conversations.js";
import { unblind } from "../evals/guide/unblind.js";
import type { Block } from "../src/types.js";

describe("guide conversation eval pairs", () => {
  it("refuses a missing or duplicate case/run instead of silently dropping it", () => {
    const a = [
      { case: "one", run: 1 },
      { case: "two", run: 1 },
    ];
    expect(() => pairRows(a, [{ case: "one", run: 1 }])).toThrow(/missing.*two.*run 1/i);
    expect(() => pairRows(a, [{ case: "one", run: 1 }, { case: "one", run: 1 }])).toThrow(/duplicate.*one.*run 1/i);
    expect(() => pairRows([], [])).toThrow(/empty eval arms/i);
  });

  it("shows the judge the complete cited passage", () => {
    const tail = "EVIDENCE AT THE END";
    const block = {
      id: "spya-k3m9qt",
      text: `${"opening ".repeat(80)}${tail}`,
    } as Block;
    expect(citedPassages("See [spya-k3m9qt].", [block]).join("\n")).toContain(tail);
  });

  it("uses the ordinary midpoint for an even-sized sample", () => {
    expect(median([0.75, 0.93])).toBe(0.84);
  });

  it("fingerprints both sources of model-visible instructions changed by this stage", () => {
    expect(sourceSha256()).toEqual({
      converse: expect.stringMatching(/^[0-9a-f]{64}$/),
      chatTools: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("screens the content-answer shape the prompt promises", () => {
    const block = { id: "spya-k3m9qt", text: "Evidence." } as Block;
    const c = {
      id: "content",
      dir: "fixture",
      experience: "a-few" as const,
      about: null,
      why: null,
      history: [],
      question: "What does it mean?",
      wants: ["brief-answer", "cites-each", "ends-on-passage"] as const,
    };
    const scored = screen(
      c,
      "An uncited claim. First [spya-k3m9qt]. Second [spya-k3m9qt]. Third [spya-k3m9qt].",
      [],
      [block],
    );
    expect(scored.problems).toContain("4 answer sentences");
    expect(scored.problems).toContain("1 uncited answer sentence");
    expect(scored.problems).toContain("does not end on a passage");
    expect(screen(c, "Read the relevant passage.", [], [block]).problems).toContain("1 uncited answer sentence");
  });

  it("uses the shipped 60-word ceiling, not a hidden 80-word allowance", () => {
    const c = {
      id: "long",
      dir: "fixture",
      experience: "a-few" as const,
      about: null,
      why: null,
      history: [],
      question: "Where?",
      wants: [] as const,
    };
    expect(screen(c, `${"word ".repeat(61)}.`, [], []).problems).toContain("long (61)");
  });
});

describe("guide conversation eval unblinding", () => {
  const key = [
    "1: X=after Y=before (one run 1)",
    "2: X=before Y=after (two run 1)",
  ].join("\n");

  it("counts one well-formed verdict for every keyed pair", () => {
    expect(unblind(key, "1: X; why: better\n2: same; why: equal", "before", "after")).toMatchObject({
      wins: { before: 0, after: 1, same: 1 },
      sides: { X: 1, Y: 0 },
    });
  });

  it("rejects malformed, missing and duplicate verdicts", () => {
    expect(() => unblind(key, "1: X; why: better\nthis is not a verdict", "before", "after")).toThrow(/bad verdict line/i);
    expect(() => unblind(key, "1: X; why: better", "before", "after")).toThrow(/missing verdict.*2/i);
    expect(() => unblind(key, "1: X; why: better\n1: Y; why: changed\n2: same", "before", "after")).toThrow(
      /duplicate verdict.*1/i,
    );
  });
});
