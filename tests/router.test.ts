/**
 * Path routing — src/web/router.ts. Pure string work, no DOM.
 *
 * The case worth having a test for is the *degradation*: an address nobody
 * meant to type has to land somewhere sensible rather than render nothing. A
 * blank page from a stray slash is the sort of failure that looks like the app
 * is broken rather than like the link was.
 */
import { describe, expect, it } from "vitest";
import { carriedSearch, parseRoute, readHref } from "../src/web/router.js";

describe("parseRoute", () => {
  it("reads the slug out of /read/<slug>", () => {
    expect(parseRoute("/read/noema-mythology-of-conscious-ai")).toEqual({
      kind: "read",
      slug: "noema-mythology-of-conscious-ai",
      view: "article",
    });
  });

  it("accepts the trailing slash, because links gain and lose them", () => {
    expect(parseRoute("/read/example/")).toEqual({
      kind: "read",
      slug: "example",
      view: "article",
    });
  });

  it("decodes an escaped slug", () => {
    expect(parseRoute("/read/a%20b")).toEqual({ kind: "read", slug: "a b", view: "article" });
  });

  it("reads the third segment as the view", () => {
    expect(parseRoute("/read/example/metadata")).toEqual({
      kind: "read",
      slug: "example",
      view: "metadata",
    });
    expect(parseRoute("/read/example/tweets")).toEqual({
      kind: "read",
      slug: "example",
      view: "tweets",
    });
  });

  it("accepts the trailing slash on a view too — Greg wrote the route with one", () => {
    expect(parseRoute("/read/example/metadata/")).toEqual({
      kind: "read",
      slug: "example",
      view: "metadata",
    });
  });

  it("falls back to the library for anything else", () => {
    for (const path of ["/", "/read", "/read/", "/read/a/b", "/nonsense", ""]) {
      expect(parseRoute(path), path).toEqual({ kind: "library" });
    }
  });

  it("sends an unknown view to the library rather than a blank article page", () => {
    for (const path of ["/read/example/nonsense", "/read/example/metadata/x"]) {
      expect(parseRoute(path), path).toEqual({ kind: "library" });
    }
  });

  it("survives a malformed escape rather than throwing out of the render", () => {
    expect(parseRoute("/read/%E0%A4%A")).toEqual({ kind: "library" });
  });
});

describe("readHref", () => {
  it("round-trips through parseRoute", () => {
    const slug = "a-slug-with-dashes";
    expect(parseRoute(readHref(slug))).toEqual({ kind: "read", slug, view: "article" });
  });

  it("escapes a slug that would otherwise change the shape of the path", () => {
    expect(readHref("a/b")).toBe("/read/a%2Fb");
    expect(parseRoute(readHref("a/b"))).toEqual({ kind: "read", slug: "a/b", view: "article" });
  });

  it("carries view state across, with or without the leading question mark", () => {
    expect(readHref("x", "cols=0,1")).toBe("/read/x?cols=0,1");
    expect(readHref("x", "?cols=0,1")).toBe("/read/x?cols=0,1");
    expect(readHref("x", "")).toBe("/read/x");
  });

  it("spells the view as the third segment, and round-trips it", () => {
    expect(readHref("x", "", "metadata")).toBe("/read/x/metadata");
    expect(readHref("x", "at=spya-k3m9qt", "tweets")).toBe("/read/x/tweets?at=spya-k3m9qt");
    for (const view of ["article", "metadata", "tweets"] as const) {
      expect(parseRoute(readHref("x", "", view)), view).toEqual({
        kind: "read",
        slug: "x",
        view,
      });
    }
  });
});

describe("carriedSearch", () => {
  it("keeps the reader's place when they step off the article and back", () => {
    expect(carriedSearch("?at=spya-k3m9qt&cols=0,1&text=0")).toBe(
      "at=spya-k3m9qt&cols=0,1&text=0",
    );
  });

  it("leaves the commas in cols alone, so a pasted link stays readable", () => {
    expect(carriedSearch("?cols=0,1,2")).toContain("cols=0,1,2");
  });

  it("drops the drawer, which is not a place you were", () => {
    expect(carriedSearch("?panel=questions&at=spya-k3m9qt")).toBe("at=spya-k3m9qt");
    expect(carriedSearch("?panel=questions")).toBe("");
  });

  it("takes a search string with or without the question mark, and an empty one", () => {
    expect(carriedSearch("text=0")).toBe("text=0");
    expect(carriedSearch("")).toBe("");
    expect(carriedSearch("?")).toBe("");
  });
});
