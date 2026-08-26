/**
 * Path routing — src/web/router.ts. Pure string work, no DOM.
 *
 * The case worth having a test for is the *degradation*: an address nobody
 * meant to type has to land somewhere sensible rather than render nothing. A
 * blank page from a stray slash is the sort of failure that looks like the app
 * is broken rather than like the link was.
 */
import { describe, expect, it } from "vitest";
import {
  addHref,
  addUrlFrom,
  addUrlFromQuery,
  canonicalAddHref,
  carriedSearch,
  parseRoute,
  readHref,
} from "../src/web/router.js";

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

  /* Not a round trip: the point is that the ENCODED form of a URL which is
     itself full of escapes survives being read as an encoded segment, rather
     than being decoded a second time down to the bare characters. */
  it("decodes exactly once, however many escapes the URL itself carries", () => {
    const url = "https://example.com/a%2Fb%20c";
    expect(parseRoute(addHref(url))).toEqual({ kind: "add", url });
    // And the segment really is doubly-escaped in the address.
    expect(addHref(url)).toContain("%252F");
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

/**
 * The rewrite that runs before React mounts — `canonicalAddHref`, called from
 * main.tsx.
 *
 * It is a function rather than four lines inside main.tsx **because of this
 * block**. Module-init side effects cannot be tested, and every case below was
 * a real bug found by reading rather than by running: GPT Sol's review,
 * 2026-08-26.
 */
describe("canonicalAddHref", () => {
  const encoded = (url: string) => addHref(url);

  it("canonicalises a raw pasted URL, query string and all", () => {
    expect(canonicalAddHref("/add/https://x.test/a", "?utm=1", "")).toBe(
      encoded("https://x.test/a?utm=1"),
    );
  });

  /* Each of these was eaten by one of the three legacy rewrites in main.tsx,
     which used to run first. They read `location.search` and `location.hash`,
     and on a raw add address those belong to the PASTED url. */
  describe("survives the query strings the legacy rewrites are looking for", () => {
    it("?slug=, which used to navigate to /read/ and queue nothing at all", () => {
      expect(canonicalAddHref("/add/https://x.test/a", "?slug=story", "")).toBe(
        encoded("https://x.test/a?slug=story"),
      );
    });

    it("?about=, which used to strip the query and add a different page", () => {
      expect(canonicalAddHref("/add/https://x.test/a", "?about=1", "")).toBe(
        encoded("https://x.test/a?about=1"),
      );
    });

    it("#spya-…, which used to become a real ?at= parameter", () => {
      expect(canonicalAddHref("/add/https://x.test/a", "", "#spya-k6fpme")).toBe(
        encoded("https://x.test/a#spya-k6fpme"),
      );
    });
  });

  it("keeps a query string on a scheme-less URL, which has no : and no / to go by", () => {
    // The classifier reads a segment with neither as already-encoded. A query
    // string settles it before the segment's shape is looked at — without that
    // this lost `?edition=2` and added a different article.
    expect(canonicalAddHref("/add/example.com", "?edition=2", "")).toBe(
      encoded("example.com?edition=2"),
    );
  });

  it("takes the whole rest of the query for ?add=, & and ? included", () => {
    expect(canonicalAddHref("/", "?add=https://x.test/a?x=1&y=2", "")).toBe(
      encoded("https://x.test/a?x=1&y=2"),
    );
  });

  it("leaves a + alone in ?add=, because a URL is not a form", () => {
    expect(canonicalAddHref("/", "?add=https://x.test/a+b", "")).toBe(
      encoded("https://x.test/a+b"),
    );
  });

  it("accepts an encoded ?add= too", () => {
    expect(canonicalAddHref("/", `?add=${encodeURIComponent("https://x.test/a?x=1")}`, "")).toBe(
      encoded("https://x.test/a?x=1"),
    );
  });

  /* Each of these is a second-pass finding (GPT Sol, 2026-08-26): the first
     round of fixes introduced two of them and left one. */
  describe("does not let the target URL's own shape hijack the rewrite", () => {
    it("keeps an add= that belongs to the article, not to us", () => {
      // With ?add= consulted before the path, this canonicalised to /add/2 —
      // the target URL's own parameter read as ours, and replaced it.
      expect(canonicalAddHref("/add/https://x.test/article", "?add=2", "")).toBe(
        encoded("https://x.test/article?add=2"),
      );
    });

    it("ignores an add= that is not at a parameter boundary", () => {
      // Only the first `?` in a URL begins its query; `[?&]` matched the one
      // inside a value too.
      expect(addUrlFromQuery("?next=/somewhere?add=x")).toBe("");
      expect(canonicalAddHref("/", "?next=/somewhere?add=x", "")).toBeNull();
    });

    it("decodes an encoded segment before putting its query back on", () => {
      // Reading the mere presence of a query as proof the segment was raw
      // double-encoded this into something that is not a URL at all.
      expect(canonicalAddHref("/add/https%3A%2F%2Fx.test%2Fa", "?edition=2", "")).toBe(
        encoded("https://x.test/a?edition=2"),
      );
      expect(parseRoute(addHref("https://x.test/a?edition=2"))).toEqual({
        kind: "add",
        url: "https://x.test/a?edition=2",
      });
    });
  });

  it("is null when there is nothing to rewrite", () => {
    expect(canonicalAddHref("/", "", "")).toBeNull();
    expect(canonicalAddHref("/read/example", "?at=spya-k6fpme", "")).toBeNull();
    expect(canonicalAddHref("/add/", "", "")).toBeNull();
    // Already canonical: no second replaceState, and no rewrite loop.
    const href = encoded("https://x.test/a?x=1");
    expect(canonicalAddHref(href, "", "")).toBeNull();
  });

  it("is idempotent, so a rewrite can never chase its own tail", () => {
    const once = canonicalAddHref("/add/https://x.test/a", "?x=1", "");
    expect(once).not.toBeNull();
    expect(canonicalAddHref(once as string, "", "")).toBeNull();
  });
});

describe("addUrlFromQuery", () => {
  it("ignores a parameter that merely ends in add", () => {
    expect(addUrlFromQuery("?padd=https://x.test/a")).toBe("");
    expect(addUrlFromQuery("?at=spya-k6fpme")).toBe("");
  });

  it("reads add= from the middle, taking everything after it", () => {
    expect(addUrlFromQuery("?cols=0,1&add=https://x.test/a?b=1")).toBe("https://x.test/a?b=1");
  });

  it("is empty for an empty value", () => {
    expect(addUrlFromQuery("?add=")).toBe("");
    expect(addUrlFromQuery("")).toBe("");
  });
});

/**
 * The callback route, and the rewrite it must dodge.
 *
 * The point is not that `/auth/callback` parses — it is that **no rewrite
 * touches it**. `canonicalAddHref` reads `location.search` as part of an
 * article's address, which is its whole job, so a Google return landing on any
 * `/add/…` spelling would fold our one-time authorisation code into a
 * stranger's URL and then ingest would fetch it. GPT Sol, 2026-08-26.
 *
 * main.tsx does the exempting (it is module-init side effects, which nothing
 * can test); what is tested here is the pure function it guards, so that the
 * two cannot drift apart without something going red.
 */
describe("the auth callback", () => {
  it("is its own route", () => {
    expect(parseRoute("/auth/callback")).toEqual({ kind: "callback" });
    expect(parseRoute("/auth/callback/")).toEqual({ kind: "callback" });
  });

  it("is not mistaken for an article, an add, or the shelf", () => {
    expect(parseRoute("/auth/callback").kind).not.toBe("read");
    expect(parseRoute("/auth/callback").kind).not.toBe("add");
    expect(parseRoute("/login")).toEqual({ kind: "login" });
  });

  /**
   * The consequence, stated as the thing we actually care about: with a code on
   * it, this address must not turn into a request to add an article.
   *
   * `canonicalAddHref` would happily do that if it were ever asked — it has no
   * idea what `/auth/callback` is — which is exactly why the guard lives above
   * it in main.tsx rather than inside it.
   */
  it("would be rewritten into an add if it were not exempt — so it must be exempt", () => {
    /* Not an `/add/` path, so nothing to canonicalise: proves the callback is
       safe from the path branch on its own. */
    expect(canonicalAddHref("/auth/callback", "?code=SECRET&state=S", "")).toBeNull();
    /* But `?add=` is read from the query wherever it appears, and this is the
       shape that shows the guard is doing work rather than being decorative. */
    const folded = canonicalAddHref("/auth/callback", "?add=https://x.test/a&code=SECRET", "");
    expect(folded).not.toBeNull();
    expect(folded).toContain("SECRET");
  });
});
