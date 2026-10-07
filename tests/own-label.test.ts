/**
 * **A table read by a value the server sent** (src/web/lib/own-label.ts).
 *
 * The inherited names are the point: a bare `TABLE["__proto__"]` answers with
 * an object and `TABLE["toString"]` with a function, and neither is
 * `undefined`, so `??` never reaches the fallback. The sites that use this are
 * each tested where they draw; this is the helper on its own.
 */
import { describe, expect, it } from "vitest";
import { ownLabel, plainWords } from "../src/web/lib/own-label.js";

const TABLE: Record<string, string> = { "tiny-font": "Text at a size nobody reads" };

describe("ownLabel", () => {
  it("answers for a key the table holds", () => {
    expect(ownLabel(TABLE, "tiny-font")).toBe("Text at a size nobody reads");
  });

  it.each(["a-newer-value", "__proto__", "constructor", "toString", "hasOwnProperty", ""])(
    "answers undefined for %s, where a bare lookup may not",
    (key) => {
      expect(ownLabel(TABLE, key)).toBeUndefined();
    },
  );

  it("is not the bare lookup (the premise)", () => {
    const bare = (key: string) => TABLE[key];
    expect(bare("__proto__")).not.toBeUndefined();
    expect(bare("toString")).not.toBeUndefined();
  });
});

describe("plainWords", () => {
  it("reads a hyphenated value as words", () => {
    expect(plainWords("screen-reader-only")).toBe("screen reader only");
  });

  it("is empty, not the word undefined, for a value that never arrived", () => {
    expect(plainWords(undefined as unknown as string)).toBe("");
    expect(plainWords(null as unknown as string)).toBe("");
  });
});
