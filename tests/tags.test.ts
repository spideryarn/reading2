/**
 * What counts as a tag — src/tags.ts. The database's CHECK is the same rule,
 * tested against a real Postgres in tests/store-tags-pg.test.ts.
 */

import { describe, expect, it } from "vitest";

import { compareTags, normaliseTag, TAG_MAX_LENGTH } from "../src/tags.js";

const tag = (raw: string) => {
  const r = normaliseTag(raw);
  return r.ok ? r.tag : `refused: ${r.reason}`;
};

describe("normaliseTag", () => {
  it("lowercases, trims, and collapses inner whitespace of every kind", () => {
    expect(tag("  Machine   Learning ")).toBe("machine learning");
    expect(tag("deep\tlearning\nnow")).toBe("deep learning now");
    expect(tag("no break")).toBe("no break");
  });

  it("composes accents, so one word typed two ways is one tag", () => {
    expect(tag("café")).toBe(tag("café"));
  });

  it("counts characters rather than UTF-16 units", () => {
    expect(tag("🧠".repeat(TAG_MAX_LENGTH))).toBe("🧠".repeat(TAG_MAX_LENGTH));
    expect(tag("x".repeat(TAG_MAX_LENGTH + 1))).toMatch(/^refused/);
  });

  it("refuses empty, commas and invisible control characters", () => {
    expect(tag("   ")).toMatch(/^refused/);
    expect(tag("a,b")).toMatch(/^refused/);
    expect(tag("a\u0000b")).toMatch(/^refused/);
    expect(tag("a\u0085b")).toMatch(/^refused/); // NEL is not whitespace to JS: a C1 control
    expect(tag("a\u009bb")).toMatch(/^refused/);
  });

  it("refuses lone UTF-16 surrogates instead of letting the database change them", () => {
    expect(tag("before\ud800after")).toMatch(/^refused/);
    expect(tag("before\udc00after")).toMatch(/^refused/);
    /* A real surrogate pair is a valid code point and remains accepted. */
    expect(tag("🧠")).toBe("🧠");
  });
});

describe("compareTags", () => {
  it("is a total order the server and the client share", () => {
    expect(["b", "a c", "a"].sort(compareTags)).toEqual(["a", "a c", "b"]);
  });
});
