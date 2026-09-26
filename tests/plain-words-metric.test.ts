/**
 * The hard-word screen in evals/plain-words/run.ts — what it counts as a word,
 * and what it counts as common. docs/plans/260926a-plainer-summaries-and-glossary.md.
 */
import { describe, expect, it } from "vitest";
import { hardShare, isCommon, wordsIn } from "../evals/plain-words/run.js";

describe("the plain-words metric", () => {
  it("tokenises names, possessives and compounds as one word each", () => {
    expect(wordsIn("Möbius's non-specialist reader — 4 arguments.")).toEqual(["Möbius's", "non-specialist", "reader", "arguments"]);
  });

  it("calls everyday words common, including their inflections", () => {
    for (const w of ["the", "reader", "readers", "argues", "studied", "running", "easily", "author's", "well-read"]) {
      expect(isCommon(w), w).toBe(true);
    }
  });

  it("calls jargon, acronyms and unfamiliar names hard", () => {
    for (const w of ["synergistic", "entropy", "PID", "superposition", "Möbius", "stochastic", "non-overlapping"]) {
      expect(isCommon(w), w).toBe(false);
    }
  });

  it("reports the share, and the words that made it", () => {
    const h = hardShare(["Synergistic information is the part neither source carries alone."]);
    expect(h.words).toBe(9);
    expect(h.hard).toBe(1);
    expect(h.top).toEqual(["synergistic×1"]);
  });
});
