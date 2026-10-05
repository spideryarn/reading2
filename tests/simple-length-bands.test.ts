/**
 * **Summary's length follows the length of the piece** —
 * docs/plans/261005b-summary-length-follows-the-length-of-the-piece.md.
 *
 * Greg, 2026-10-04 (spya-gttwhn): *"The length of the summaries should
 * somewhat reflect the length of the text. Not linearly. But a book will
 * surely need (at least somewhat) longer summaries than a short article."*
 *
 * It is Fuller's length that follows it. Brief is one length for every piece:
 * it was banded in the first build and measured worse (the plan's ledger).
 *
 * What is pinned here is the table and its edges. That a request carries its
 * band's prompt is in tests/simple-summary.test.ts § the request, beside the
 * stubbed model; that the standard band is the prompt as it was is the hash
 * in tests/simple-two-levels.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  BAND_FROM,
  FULLER_LENGTH,
  SIMPLE_BANDS,
  SIMPLE_SYSTEMS,
  SIMPLE_SYSTEMS_BY_BAND,
  bandFor,
  lengthFor,
  simpleSystem,
} from "../src/simple-summary.js";
import { SIMPLE_LEVELS, SIMPLE_LIMITS } from "../src/types.js";

const flat = (text: string) => text.replace(/\s+/g, " ");
/** The LENGTH section alone: from its heading to the next one. */
const lengthOf = (system: string) => system.slice(system.indexOf("\nLENGTH\n"), system.indexOf("\nTHE SHAPE\n"));
/** A prompt with its LENGTH section taken out. */
const withoutLength = (system: string) => system.replace(lengthOf(system), "");

describe("the band a piece is in", () => {
  it.each([
    [0, "short"],
    [879, "short"],
    [2_499, "short"],
    [2_500, "standard"],
    [8_580, "standard"],
    [14_999, "standard"],
    [15_000, "long"],
    [39_999, "long"],
    [40_000, "book"],
    [209_227, "book"],
  ] as const)("%i words is %s", (words, band) => {
    expect(bandFor(words)).toBe(band);
  });

  it("has thresholds that rise with the bands, starting at nothing", () => {
    const floors = SIMPLE_BANDS.map((band) => BAND_FROM[band]);
    expect(floors[0]).toBe(0);
    expect(floors).toEqual([...floors].sort((a, b) => a - b));
    expect(new Set(floors).size).toBe(floors.length);
  });
});

describe("what Fuller is asked for in each band", () => {
  it("asks for more words in each longer band", () => {
    const asks = SIMPLE_BANDS.map((band) => FULLER_LENGTH[band].words);
    expect(asks).toEqual([...asks].sort((a, b) => a - b));
    expect(new Set(asks).size).toBe(asks.length);
  });

  it("is not linear: the ask grows far less than the piece does", () => {
    const pieceGrows = BAND_FROM.book / BAND_FROM.standard;
    const askGrows = FULLER_LENGTH.book.words / FULLER_LENGTH.standard.words;
    expect(askGrows).toBeGreaterThan(1);
    expect(askGrows).toBeLessThan(pieceGrows / 4);
  });

  it("says each band's own numbers in its prompt", () => {
    for (const band of SIMPLE_BANDS) {
      const { shape, words, never } = FULLER_LENGTH[band];
      const length = flat(lengthOf(SIMPLE_SYSTEMS_BY_BAND[band].fuller));
      expect(length).toContain(`${shape}. Every sentence under 30 words.`);
      expect(length).toContain(`About ${words} words in all, and never more than ${never}.`);
    }
    expect(flat(SIMPLE_SYSTEMS_BY_BAND.book.fuller)).toContain(
      "Eight to eleven paragraphs, each two to five sentences. Every sentence under 30 words. About 900 words in all, and never more than 1050.",
    );
    expect(flat(SIMPLE_SYSTEMS_BY_BAND.long.fuller)).toContain(
      "Six to nine paragraphs, each two to five sentences. Every sentence under 30 words. About 700 words in all, and never more than 820.",
    );
    expect(flat(SIMPLE_SYSTEMS_BY_BAND.short.fuller)).toContain(
      "Three to five paragraphs, each two to five sentences. Every sentence under 30 words. About 250 words in all, and never more than 330.",
    );
  });

  it("leaves every 'never' under the stored ceiling, with room for the model to run over", () => {
    for (const band of SIMPLE_BANDS) {
      for (const level of SIMPLE_LEVELS) {
        /* A write over the ceiling stores nothing, so the ceiling sits a
           quarter above the most the prompt allows. */
        expect(lengthFor(level, band).never * 1.25).toBeLessThanOrEqual(SIMPLE_LIMITS[level].maxWords);
        expect(lengthFor(level, band).words).toBeLessThan(lengthFor(level, band).never);
      }
    }
  });

  it("changes LENGTH and nothing else", () => {
    const rest = new Set(SIMPLE_BANDS.map((band) => withoutLength(SIMPLE_SYSTEMS_BY_BAND[band].fuller)));
    expect(rest.size).toBe(1);
  });

  it("changes three values in LENGTH and no other word of it", () => {
    const blanked = SIMPLE_BANDS.map((band) => {
      const { shape, words, never } = FULLER_LENGTH[band];
      return lengthOf(SIMPLE_SYSTEMS_BY_BAND[band].fuller)
        .replace(shape, "SHAPE")
        .replace(`About ${words} words`, "About N words")
        .replace(`never more than ${never}`, "never more than M");
    });
    expect(new Set(blanked).size).toBe(1);
    expect(blanked[0]).toContain("SHAPE. Every sentence under 30 words. About N words");
  });

  it("differs in every band", () => {
    expect(new Set(SIMPLE_BANDS.map((band) => SIMPLE_SYSTEMS_BY_BAND[band].fuller)).size).toBe(SIMPLE_BANDS.length);
  });
});

describe("Brief", () => {
  it("is asked the same of every piece, whatever its length", () => {
    expect(new Set(SIMPLE_BANDS.map((band) => SIMPLE_SYSTEMS_BY_BAND[band].brief)).size).toBe(1);
    for (const band of SIMPLE_BANDS) {
      expect(flat(SIMPLE_SYSTEMS_BY_BAND[band].brief)).toContain("About 80 words in all, and never more than 130.");
    }
  });
});

describe("the standard band", () => {
  it("is the default, and what SIMPLE_SYSTEMS holds", () => {
    for (const level of SIMPLE_LEVELS) {
      expect(simpleSystem(level)).toBe(simpleSystem(level, "standard"));
      expect(SIMPLE_SYSTEMS[level]).toBe(SIMPLE_SYSTEMS_BY_BAND.standard[level]);
    }
  });
});
