/**
 * **A work's influence and where it came from: the one read path** —
 * src/citation-effective-influence.ts, plan 261003m stage 2 (GPT Sol's F6, F7).
 *
 * The web one, from a kept *Dig deeper* answer, beats the list's own; a stale
 * version is ignored; with no answer it is the list's; with neither it is
 * unknown. The list's own field is never changed.
 */
import { describe, expect, it } from "vitest";

import { effectiveInfluence, INFLUENCE_VERSION } from "../src/citation-effective-influence.js";
import type { CitationInvestigation, CitationWebInfluence } from "../src/types.js";

const AT = "2026-10-03T12:00:00.000Z";
const WEB: CitationWebInfluence = {
  value: 0.9,
  quote: "widely cited as a seminal work on scaling",
  sourceUrl: "https://en.wikipedia.org/wiki/Scaling_laws",
  sourceTitle: "Scaling Laws - Wikipedia",
  version: INFLUENCE_VERSION,
};
const answer = (influence?: CitationWebInfluence): Pick<CitationInvestigation, "influence" | "at"> => ({
  at: AT,
  ...(influence ? { influence } : {}),
});

describe("effectiveInfluence", () => {
  it("is the web one when a kept answer carries a current one, with where it came from and when", () => {
    expect(effectiveInfluence({ investigation: answer(WEB) })).toEqual({
      value: 0.9,
      from: "web",
      quote: WEB.quote,
      sourceUrl: WEB.sourceUrl,
      sourceTitle: WEB.sourceTitle,
      at: AT,
    });
  });

  it("puts the web one before the list's own, higher or lower", () => {
    expect(effectiveInfluence({ influence: 0.2, investigation: answer(WEB) })).toMatchObject({ value: 0.9, from: "web" });
    expect(effectiveInfluence({ influence: 0.9, investigation: answer({ ...WEB, value: 0.1 }) })).toMatchObject({
      value: 0.1,
      from: "web",
    });
    expect(effectiveInfluence({ influence: 0.9, investigation: answer({ ...WEB, value: 0 }) })).toMatchObject({ value: 0, from: "web" });
  });

  it("never changes the list's own field", () => {
    const work = { influence: 0.2, investigation: answer(WEB) };
    effectiveInfluence(work);
    expect(work.influence).toBe(0.2);
  });

  it("ignores a web one written under another version, and falls back to the list's, or to unknown", () => {
    const stale = answer({ ...WEB, version: "citation-influence/0" });
    expect(effectiveInfluence({ influence: 0.2, investigation: stale })).toEqual({ value: 0.2, from: "list" });
    expect(effectiveInfluence({ investigation: stale })).toBeUndefined();
  });

  it("is the list's own with no answer, or an answer that kept no influence", () => {
    expect(effectiveInfluence({ influence: 0.5 })).toEqual({ value: 0.5, from: "list" });
    expect(effectiveInfluence({ influence: 0.5, investigation: answer() })).toEqual({ value: 0.5, from: "list" });
    expect(effectiveInfluence({ influence: 0 })).toEqual({ value: 0, from: "list" });
  });

  it("is unknown with neither", () => {
    expect(effectiveInfluence({})).toBeUndefined();
    expect(effectiveInfluence({ investigation: answer() })).toBeUndefined();
  });

  it("does not use a web number that is not a number in 0–1", () => {
    for (const value of [Number.NaN, 8000, -1, Number.POSITIVE_INFINITY]) {
      expect(effectiveInfluence({ influence: 0.4, investigation: answer({ ...WEB, value }) })).toEqual({ value: 0.4, from: "list" });
    }
  });

  it("leaves a missing title out rather than inventing one", () => {
    const { sourceTitle: _t, ...untitled } = WEB;
    expect(effectiveInfluence({ investigation: answer(untitled) })).not.toHaveProperty("sourceTitle");
  });
});
