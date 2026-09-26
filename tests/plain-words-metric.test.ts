/**
 * The hard-word screen in evals/plain-words/run.ts — what it counts as a word,
 * and what it counts as common. docs/plans/260926a-plainer-summaries-and-glossary.md.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { blindCoin, hardShare, isCommon, wordsIn } from "../evals/plain-words/run.js";

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

  it("does not teach the glossary to break its own first-sentence and provenance rules", () => {
    const source = fs.readFileSync(new URL("../src/glossary.ts", import.meta.url), "utf8");
    const backgroundGood = source.match(/GOOD — "background": "([^"]+)"/)?.[1];
    expect(backgroundGood).toBeDefined();
    expect(backgroundGood).not.toMatch(/distributed systems|byword/i);
    const good = source.match(/GOOD — "senseHere": "([^"]+)"/)?.[1];
    expect(good).toBeDefined();
    const first = good!.split(/(?<=[.!?])\s+/)[0]!;
    expect(wordsIn(first).length).toBeLessThanOrEqual(20);
    expect(source).toMatch(
      /An economics paper defines "moral hazard" in its own terms and uses an insured\s+driver as its example\./,
    );
    expect(source).toMatch(
      /The first sentence of each field is at most 20 words and has no hard word in\s+it but the term itself or a proper name\./,
    );
    const allusionGood = source.match(/GOOD — "background": "(A game where[^"]+)"/)?.[1];
    expect(allusionGood).toBeDefined();
    expect(wordsIn(allusionGood!.split(/(?<=[.!?])\s+/)[0]!).length).toBeLessThanOrEqual(20);
  });

  it("shuffles both arms across the two blind sides", () => {
    const coin = blindCoin();
    const flips = Array.from({ length: 100 }, coin);
    const onX = flips.filter(Boolean).length;
    expect(onX).toBeGreaterThan(35);
    expect(onX).toBeLessThan(65);
    expect(Array.from({ length: 100 }, blindCoin())).toEqual(flips);
  });
});
