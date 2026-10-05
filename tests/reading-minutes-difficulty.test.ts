/**
 * **The reading-time multiplier** — src/reading-time.ts, plan 261005j.
 *
 * Every expected number here is a literal worked out by hand from the table in
 * the plan, never recomputed from the constants under test: a multiplier that
 * always answered 1 would pass any check that only compared the code with
 * itself (GPT Sol, plan review F7).
 */
import { describe, expect, it } from "vitest";

import {
  DIFFICULTY_CEILING,
  DIFFICULTY_FLOOR,
  IDEAS_FACTOR,
  LANGUAGE_FACTOR,
  difficultyMultiplier,
  readingMinutes,
  readingRange,
  type DifficultyLevel,
} from "../src/reading-time.js";

const LEVELS: readonly DifficultyLevel[] = [1, 2, 3, 4, 5];

describe("difficultyMultiplier", () => {
  it("is exactly 1 for an unrated piece and for the neutral case, language 3 and ideas 2", () => {
    expect(difficultyMultiplier()).toBe(1);
    expect(difficultyMultiplier(undefined)).toBe(1);
    expect(difficultyMultiplier({ language: 3, ideas: 2 })).toBe(1);
  });

  it("is the product of the two tables, for pairs worked out by hand", () => {
    // 1.17 × 1.20
    expect(difficultyMultiplier({ language: 5, ideas: 5 })).toBeCloseTo(1.404, 10);
    // 0.85 × 0.95
    expect(difficultyMultiplier({ language: 1, ideas: 1 })).toBeCloseTo(0.836, 10);
    // Plain words, hard ideas: 0.92 × 1.12
    expect(difficultyMultiplier({ language: 2, ideas: 4 })).toBeCloseTo(1.0304, 10);
    // Hard words, nothing new to hold: 1.08 × 0.95
    expect(difficultyMultiplier({ language: 4, ideas: 1 })).toBeCloseTo(1.026, 10);
  });

  it("holds the table the plan gives, cell by cell", () => {
    expect(LANGUAGE_FACTOR).toEqual({ 1: 0.88, 2: 0.92, 3: 1, 4: 1.08, 5: 1.17 });
    expect(IDEAS_FACTOR).toEqual({ 1: 0.95, 2: 1, 3: 1.05, 4: 1.12, 5: 1.2 });
    expect(DIFFICULTY_FLOOR).toBe(0.8);
    expect(DIFFICULTY_CEILING).toBe(1.45);
  });

  it("keeps every pair inside the bounds", () => {
    for (const language of LEVELS) {
      for (const ideas of LEVELS) {
        const m = difficultyMultiplier({ language, ideas });
        expect(m).toBeGreaterThanOrEqual(0.8);
        expect(m).toBeLessThanOrEqual(1.45);
      }
    }
  });

  it("is never quicker for a harder level, on either scale, and is slower somewhere", () => {
    for (const fixed of LEVELS) {
      for (const level of [1, 2, 3, 4] as const) {
        const next = (level + 1) as DifficultyLevel;
        expect(difficultyMultiplier({ language: next, ideas: fixed })).toBeGreaterThan(
          difficultyMultiplier({ language: level, ideas: fixed }),
        );
        expect(difficultyMultiplier({ language: fixed, ideas: next })).toBeGreaterThan(
          difficultyMultiplier({ language: fixed, ideas: level }),
        );
      }
    }
  });
});

describe("readingMinutes with a rating", () => {
  it("multiplies before it rounds: 360 words at (5,5) is 2 minutes, not 3", () => {
    // Flat: 360 / 238 = 1.51, shown as 2. Rated: 1.51 × 1.404 = 2.12, shown as 2.
    // Multiplying the rounded 2 would give 2.81, shown as 3.
    expect(readingMinutes(360)).toBe(2);
    expect(readingMinutes(360, { language: 5, ideas: 5 })).toBe(2);
  });

  it("moves a long piece both ways, by numbers worked out by hand", () => {
    // 11,900 / 238 = 50 exactly.
    expect(readingMinutes(11_900)).toBe(50);
    // 50 × 1.0304 = 51.52
    expect(readingMinutes(11_900, { language: 2, ideas: 4 })).toBe(52);
    // 50 × 1.404 = 70.2
    expect(readingMinutes(11_900, { language: 5, ideas: 5 })).toBe(70);
    // 50 × 0.836 = 41.8
    expect(readingMinutes(11_900, { language: 1, ideas: 1 })).toBe(42);
    // The neutral case changes nothing.
    expect(readingMinutes(11_900, { language: 3, ideas: 2 })).toBe(50);
  });

  it("applies the one-minute floor after the multiplier, not before", () => {
    // 100 / 238 = 0.42; × 0.836 = 0.35. Still a minute.
    expect(readingMinutes(100, { language: 1, ideas: 1 })).toBe(1);
    // 300 / 238 = 1.26, shown as 1; × 1.404 = 1.77, shown as 2.
    expect(readingMinutes(300)).toBe(1);
    expect(readingMinutes(300, { language: 5, ideas: 5 })).toBe(2);
    expect(readingMinutes(0, { language: 5, ideas: 5 })).toBe(1);
  });

  it("answers what it did before for an unrated piece", () => {
    expect(readingMinutes(2380)).toBe(10);
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(123_456)).toBe(519);
  });
});

describe("readingRange with a rating", () => {
  it("scales both ends by the same multiplier, before rounding", () => {
    // Flat: 11,900 / 300 = 39.67 and 11,900 / 175 = 68.
    expect(readingRange(11_900)).toEqual({ quick: 40, slow: 68 });
    // × 1.404: 55.69 and 95.47.
    expect(readingRange(11_900, { language: 5, ideas: 5 })).toEqual({ quick: 56, slow: 95 });
    // × 0.836: 33.16 and 56.85.
    expect(readingRange(11_900, { language: 1, ideas: 1 })).toEqual({ quick: 33, slow: 57 });
  });

  it("keeps the headline inside its own range for every rating", () => {
    for (const language of LEVELS) {
      for (const ideas of LEVELS) {
        for (const words of [0, 1, 40, 238, 500, 5_000, 123_456]) {
          const rating = { language, ideas };
          const { quick, slow } = readingRange(words, rating);
          expect(quick).toBeGreaterThanOrEqual(1);
          expect(quick).toBeLessThanOrEqual(readingMinutes(words, rating));
          expect(slow).toBeGreaterThanOrEqual(readingMinutes(words, rating));
        }
      }
    }
  });
});
