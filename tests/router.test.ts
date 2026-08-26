/**
 * Path routing — src/web/router.ts. Pure string work, no DOM.
 *
 * The case worth having a test for is the *degradation*: an address nobody
 * meant to type has to land somewhere sensible rather than render nothing. A
 * blank page from a stray slash is the sort of failure that looks like the app
 * is broken rather than like the link was.
 */
import { describe, expect, it } from "vitest";
import { addHref, addUrlFrom, carriedSearch, parseRoute, readHref } from "../src/web/router.js";

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

/**
 * `/add/<a whole URL>` — the one route whose parameter is somebody else's
 * address rather than one of our slugs.
 *
 * Two spellings reach `parseRoute`: the raw paste Greg asked for, and the
 * percent-encoded one `addHref` mints. The tests that matter are the ones where
 * telling them apart could go wrong — a URL with a query string, which the
 * browser splits off into `location.search` unless it has been encoded, and a
 * URL with a port, whose extra colon must not confuse the raw/encoded test.
 */
describe("the add route", () => {
  it("reads a raw pasted URL straight out of the path", () => {
    expect(parseRoute("/add/https://example.com/an-essay")).toEqual({
      kind: "add",
      url: "https://example.com/an-essay",
    });
  });

  it("reads the encoded spelling addHref mints", () => {
    expect(parseRoute(addHref("https://example.com/an-essay?utm=1"))).toEqual({
      kind: "add",
      url: "https://example.com/an-essay?utm=1",
    });
  });

  it("round-trips a URL with a query string, which raw form cannot", () => {
    const url = "https://example.com/x?a=1&b=2#frag";
    const route = parseRoute(addHref(url));
    expect(route).toEqual({ kind: "add", url });
  });

  it("is not confused by a port, whose colon is not an encoding signal", () => {
    expect(parseRoute("/add/http://localhost:3000/x")).toEqual({
      kind: "add",
      url: "http://localhost:3000/x",
    });
  });

  it("sends /add and /add/ to the shelf, where the add box is", () => {
    expect(parseRoute("/add")).toEqual({ kind: "library" });
    expect(parseRoute("/add/")).toEqual({ kind: "library" });
  });

  it("survives a hand-mangled escape rather than blanking the page", () => {
    // `decodeURIComponent` throws on this; an uncaught URIError during render
    // is a white screen over a typo in the address bar.
    expect(parseRoute("/add/%E0%A4%A")).toEqual({ kind: "add", url: "%E0%A4%A" });
  });

  it("does not encode twice when it is already encoded", () => {
    const once = addHref("https://example.com/a b");
    expect(parseRoute(once)).toEqual({ kind: "add", url: "https://example.com/a b" });
  });
});

/**
 * The half `parseRoute` cannot do, because it is only ever handed a pathname:
 * a raw paste has had its query string and fragment taken off it by the browser
 * before anybody looks, and main.tsx is the only place they can be put back.
 */
describe("addUrlFrom", () => {
  it("puts a raw URL's query string and fragment back on", () => {
    expect(addUrlFrom("/add/https://example.com/x", "?a=1&b=2", "#frag")).toBe(
      "https://example.com/x?a=1&b=2#frag",
    );
  });

  it("leaves an encoded segment alone — its search belongs to us, not to it", () => {
    expect(addUrlFrom(addHref("https://example.com/x?a=1"), "", "")).toBe(
      "https://example.com/x?a=1",
    );
  });

  it("is empty for anything that is not an add address", () => {
    expect(addUrlFrom("/read/example")).toBe("");
    expect(addUrlFrom("/add/")).toBe("");
  });
});
