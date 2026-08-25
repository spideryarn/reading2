/**
 * Slugs, and whether one is safe to turn into a path — src/ingest.ts.
 *
 * Two reasons this is tested at all. The homepage's add box shows you the slug
 * you are about to get, and the server derives the one it actually uses; they
 * call the same function, and these tests are what keeps that worth relying on.
 * And `isSlug` guards a string that arrives over HTTP and is then joined onto
 * `data/` and `output/` — see docs/project/ingest-queue.md#the-one-security-check.
 */
import { describe, expect, it } from "vitest";
import { isSlug, slugFromUrl } from "../src/ingest.js";

describe("slugFromUrl", () => {
  it("uses the last path segment, which is where the headline lives", () => {
    expect(slugFromUrl("https://www.noemamag.com/the-mythology-of-conscious-ai/")).toBe(
      "the-mythology-of-conscious-ai",
    );
  });

  it("drops the server's file extension", () => {
    expect(slugFromUrl("https://example.com/posts/why-trees.html")).toBe("why-trees");
  });

  it("falls back to the host when there is no path", () => {
    expect(slugFromUrl("https://www.example.com/")).toBe("example");
  });

  it("prefixes the host when the segment is a bare id, which names nothing", () => {
    expect(slugFromUrl("https://site.com/2026/08/12345")).toBe("site-12345");
  });

  it("flattens accents and punctuation rather than dropping the word", () => {
    expect(slugFromUrl("https://example.com/café-du-monde!")).toBe("cafe-du-monde");
  });

  it("returns nothing for something that isn't a URL, so the box stays quiet", () => {
    for (const junk of ["", "  ", "not a url", "example.com"]) {
      expect(slugFromUrl(junk), junk).toBe("");
    }
  });

  it("never produces a slug that would change the shape of a path", () => {
    const slug = slugFromUrl("https://example.com/a/b/c%2Fd");
    expect(slug).not.toContain("/");
    expect(slug).toBe(encodeURIComponent(slug));
  });
});

describe("isSlug", () => {
  /* This is a path-traversal guard, not a tidiness check: the slug on
     POST /api/jobs is joined onto data/ and output/. Each of these is a real
     way in, not a hypothetical one. */
  it("refuses anything that could climb out of data/", () => {
    expect(isSlug("../../.ssh/id_rsa")).toBe(false);
    expect(isSlug("..")).toBe(false);
    expect(isSlug("a/b")).toBe(false);
    expect(isSlug("a\\b")).toBe(false);
    expect(isSlug("")).toBe(false);
    expect(isSlug("-leading-dash")).toBe(false);
    expect(isSlug("Upper")).toBe(false);
    expect(isSlug("has space")).toBe(false);
    expect(isSlug(null)).toBe(false);
    expect(isSlug(42)).toBe(false);
  });

  it("accepts what slugFromUrl produces", () => {
    for (const url of [
      "https://www.noemamag.com/the-mythology-of-conscious-ai/",
      "https://example.com/",
      "https://site.com/2026/08/12345",
      "https://blog.test/caf\u00e9-r\u00e9sum\u00e9.html",
    ]) {
      expect(isSlug(slugFromUrl(url))).toBe(true);
    }
  });
});
