/**
 * Block ids are the spine — docs/project/block-ids.md. These tests pin the two
 * properties everything downstream assumes: the id is a usable CSS selector,
 * and no two blocks ever share one.
 */
import { describe, expect, it } from "vitest";
import { ID_PATTERN, isSpideryarnId, mintId, mintUniqueId } from "../src/ids.js";

/** A deterministic stand-in for Math.random, so a failure is reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32 — small, deterministic, and not trying to be good randomness.
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

describe("mintId", () => {
  it("mints ids matching the pattern the rest of the pipeline validates against", () => {
    const random = seeded(1);
    for (let i = 0; i < 500; i++) expect(mintId(random)).toMatch(ID_PATTERN);
  });

  it("starts with a letter, so `#id` is a valid CSS selector without escaping", () => {
    const random = seeded(2);
    for (let i = 0; i < 500; i++) expect(mintId(random)[5]).toMatch(/[a-z]/);
  });

  it("never uses the characters people misread when copying an id by hand", () => {
    const random = seeded(3);
    for (let i = 0; i < 500; i++) expect(mintId(random).slice(5)).not.toMatch(/[loi1]/);
  });

  it("is deterministic given a deterministic source of randomness", () => {
    expect(mintId(seeded(42))).toBe(mintId(seeded(42)));
  });
});

describe("isSpideryarnId", () => {
  it("accepts ids we minted", () => {
    expect(isSpideryarnId(mintId(seeded(7)))).toBe(true);
  });

  it("rejects near-misses and non-strings", () => {
    for (const bad of [
      "spya-k3m9q",       // too short
      "spya-k3m9qtx",     // too long
      "spya-3m9qtk",      // leading digit — not a bare CSS selector
      "spya-k3m9ql",      // excluded character
      "k3m9qt",           // no prefix
      "SPYA-K3M9QT",      // wrong case
      "",
      null,
      undefined,
    ]) {
      expect(isSpideryarnId(bad as string), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("mintUniqueId", () => {
  it("skips ids already taken and reserves what it hands out", () => {
    // A rigged source that returns the same value twice, so the first candidate
    // collides with what's already in the set.
    const values = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const random = () => values[i++ % values.length]!;

    const taken = new Set<string>();
    const first = mintUniqueId(taken, random);
    i = 0; // rewind: the next call would otherwise mint something new by luck
    const second = mintUniqueId(taken, random);

    expect(second).not.toBe(first);
    expect(taken).toContain(first);
    expect(taken).toContain(second);
  });

  it("gives up loudly rather than returning a duplicate", () => {
    const taken = new Set<string>();
    const constant = () => 0;
    mintUniqueId(taken, constant);
    expect(() => mintUniqueId(taken, constant)).toThrow(/unique block id/i);
  });
});
