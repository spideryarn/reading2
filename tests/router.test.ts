/**
 * Path routing — src/web/router.ts. Pure string work, no DOM.
 *
 * The case worth having a test for is the *degradation*: an address nobody
 * meant to type has to land somewhere sensible rather than render nothing. A
 * blank page from a stray slash is the sort of failure that looks like the app
 * is broken rather than like the link was.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  settleAddress,
  ADMIN_FEEDBACK_HREF,
  ADMIN_HREF,
  ADMIN_USERS_HREF,
  addHref,
  addUploadHref,
  addUrlFrom,
  addUrlFromQuery,
  canonicalAddHref,
  carriedSearch,
  PRIVACY_HREF,
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

  /**
   * The decode still happens — the fixture changed, because the old one could
   * not exist.
   *
   * This case read `/read/a%20b` → `slug: "a b"` until `parseRoute` grew an
   * `isSlug` guard. `isSlug` is `^[a-z0-9][a-z0-9-]*$` with a 60-character cap
   * (src/ingest.ts), and its own comment calls it a path-traversal guard rather
   * than a tidiness check, because a slug is joined onto `data/` and `output/`.
   * So no article has ever had a space in its slug and none ever can, and the
   * server 400s the address. `%2D` is a percent-encoded hyphen: a legal slug,
   * spelled in a way that still has to be decoded to be recognised.
   */
  it("decodes an escaped slug", () => {
    expect(parseRoute("/read/a%2Db")).toEqual({ kind: "read", slug: "a-b", view: "article" });
  });

  /**
   * **An address the server could never answer is a mistyped address**, and a
   * mistyped address lands on the shelf — which is what this file's own opening
   * paragraph says the degradation is for.
   *
   * Before the guard, `/read/Upper` became an article route: the client asked
   * for it, the API refused it with the 400 it gives every malformed slug, and
   * the reader got an error page. GPT Sol's stage 2 design § 5.
   *
   * The three shapes are chosen to be different failures rather than three of
   * one: a capital letter, a leading hyphen (the path-traversal shape `../` is
   * a leading punctuation mark too), and a slug past the 60-character cap — the
   * one an alphabet-only check would wave straight through.
   */
  it("sends an address that is not a slug to the library instead of rendering an error", () => {
    expect(parseRoute("/read/Upper")).toEqual({ kind: "library" });
    expect(parseRoute("/read/-leading")).toEqual({ kind: "library" });
    expect(parseRoute(`/read/${"a".repeat(61)}`)).toEqual({ kind: "library" });
    /* And the control: one character shorter is a slug, and still reads. If the
       cap moved, the case above would pass for the wrong reason. */
    expect(parseRoute(`/read/${"a".repeat(60)}`)).toEqual({
      kind: "read",
      slug: "a".repeat(60),
      view: "article",
    });
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

/**
 * `/admin`, `/admin/users` and `/admin/feedback` — see src/web/AdminPage.tsx.
 *
 * **Parsing an address says nothing about being allowed to use it.** These
 * routes exist for everybody; App.tsx renders the shelf for anybody who is not
 * the administrator, and the refusal that matters is the server's on
 * `/api/admin`. So nothing here is a security test, and it must not be read as
 * one — it is about the two spellings Greg wrote, and the ones that must not
 * match. docs/project/admin.md.
 */
describe("the admin routes", () => {
  it("takes both of the addresses, with or without the trailing slash", () => {
    for (const path of ["/admin", "/admin/"]) {
      expect(parseRoute(path), path).toEqual({ kind: "admin", page: "home" });
    }
    for (const path of ["/admin/users", "/admin/users/"]) {
      expect(parseRoute(path), path).toEqual({ kind: "admin", page: "users" });
    }
    for (const path of ["/admin/feedback", "/admin/feedback/"]) {
      expect(parseRoute(path), path).toEqual({ kind: "admin", page: "feedback" });
    }
  });

  it("sends anything else under /admin to the shelf, like every other unknown address", () => {
    /* The alternation in the regex is the validation. A third admin page is a
       word added there, not a path that silently half-works. */
    for (const path of [
      "/admin/nonsense",
      "/admin/users/extra",
      "/admin/feedback/extra",
      "/adminx",
      "/admin/USERS",
      "/admin/FEEDBACK",
    ]) {
      expect(parseRoute(path), path).toEqual({ kind: "library" });
    }
  });

  it("is spelled once, by the constants the links use", () => {
    /* A link that does not parse lands the reader on the shelf while the
       address bar says otherwise — which looks like nothing happened at all. */
    expect(parseRoute(ADMIN_HREF)).toEqual({ kind: "admin", page: "home" });
    expect(parseRoute(ADMIN_USERS_HREF)).toEqual({ kind: "admin", page: "users" });
    expect(parseRoute(ADMIN_FEEDBACK_HREF)).toEqual({ kind: "admin", page: "feedback" });
  });
});

describe("the privacy route", () => {
  /* It is three lines of regex, and it is tested for the reason every other
     standalone route here is: a link that does not parse lands the reader on
     the shelf with the address bar still saying `/privacy`, which looks like
     nothing happened at all. The policy is also the one page a reader may have
     been *sent* a link to, so a link that silently goes nowhere is worse here
     than on `/design`. See src/web/PrivacyPage.tsx. */
  it("takes the address with or without the trailing slash", () => {
    expect(parseRoute("/privacy")).toEqual({ kind: "privacy" });
    expect(parseRoute("/privacy/")).toEqual({ kind: "privacy" });
  });

  it("is spelled once, by the constant the two links use", () => {
    expect(parseRoute(PRIVACY_HREF)).toEqual({ kind: "privacy" });
  });

  it("does not swallow anything underneath it", () => {
    /* `/privacy/cookies` is an address nobody minted, and an unknown address is
       the shelf — the same rule `/admin/foo` follows above. It must not become
       the policy page, because a reader who typed it would be told they were
       reading a document that does not answer what they asked. */
    expect(parseRoute("/privacy/cookies")).toEqual({ kind: "library" });
  });
});

describe("readHref", () => {
  it("round-trips through parseRoute", () => {
    const slug = "a-slug-with-dashes";
    expect(parseRoute(readHref(slug))).toEqual({ kind: "read", slug, view: "article" });
  });

  /**
   * **The escaping stays defensive; what changed is the far end.**
   *
   * `readHref` still refuses to let a slash out into the path unescaped, and
   * that half of this case is unchanged — it is the assertion that stops a
   * `/`-carrying value silently becoming two path segments.
   *
   * The round trip no longer comes back as an article, and that is the point
   * rather than a weakening: `parseRoute` now applies `isSlug`, which no value
   * containing a slash can pass, so an encoded slash is refused at **both**
   * ends instead of being handed on to a server that would 400 it. Nothing that
   * calls `readHref` in the app can produce one — every caller passes a slug
   * the server minted, and `kebab()` in src/ingest.ts strips everything outside
   * `[a-z0-9-]` and trims to 60 characters — so this is a guard against a value
   * that should not exist, kept because it should not exist quietly.
   */
  it("escapes a slug that would otherwise change the shape of the path", () => {
    expect(readHref("a/b")).toBe("/read/a%2Fb");
    expect(parseRoute(readHref("a/b"))).toEqual({ kind: "library" });
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
/**
 * `/add/upload/<uploadId>` — the one `/add/` address whose parameter is one of
 * ours rather than somebody else's.
 */
describe("the upload route", () => {
  const ID = "069894e5-aa66-48b0-8e25-a35c508777ef";

  it("reads an upload id, and the href round-trips", () => {
    expect(parseRoute(`/add/upload/${ID}`)).toEqual({ kind: "add-upload", uploadId: ID });
    expect(parseRoute(addUploadHref(ID))).toEqual({ kind: "add-upload", uploadId: ID });
  });

  /* An id is hex, and a URL path is not reliably one case or the other — a
     copied address can arrive shouting. Lower-cased on the way in so that the
     server, which matches lower-case, is asked about the same string. */
  it("accepts the shouted spelling, and a trailing slash", () => {
    expect(parseRoute(`/add/upload/${ID.toUpperCase()}/`)).toEqual({
      kind: "add-upload",
      uploadId: ID,
    });
  });

  /**
   * **Thirty-six hyphens are the right length and the right alphabet.**
   *
   * `[0-9a-f-]{36}` matched them, and this is the second time that exact regex
   * has appeared in this codebase — the first was `isStagingKey` in
   * src/source.ts, found by a cross-family review; this one was found by the
   * next review, two weeks later. Not a security hole either time, because the
   * server refuses the id anyway. What it did was render a whole ingest page
   * for an address that could never mean anything.
   */
  it("refuses the things that are shaped like an id and are not one", () => {
    for (const bad of [
      "-".repeat(36),
      "069894e5aa6648b08e25a35c508777ef",
      "069894e5-aa66-48b0-8e25-a35c50877",
      "069894e5-aa66-48b0-8e25-a35c508777efff",
      "nope",
    ]) {
      expect(parseRoute(`/add/upload/${bad}`).kind, bad).not.toBe("add-upload");
    }
  });

  /* It has to win over the general `/add/<a whole URL>` branch, which reads
     everything after the prefix as an address. Losing that race would land the
     reader on the shelf with their file already in the object store and nothing
     pointing at it. */
  it("is matched before the general add route, not after it", () => {
    expect(parseRoute(`/add/upload/${ID}`).kind).toBe("add-upload");
    expect(parseRoute("/add/https://example.com/upload/x").kind).toBe("add");
  });

  /**
   * **The reload bug, and it was live.**
   *
   * `canonicalAddHref` runs on every load in main.tsx and rewrites an `/add/`
   * path to the encoded spelling `addHref` mints. It did not know about upload
   * addresses, so it read `/add/upload/<uuid>` as the *URL* `upload/<uuid>`,
   * percent-encoded the slash, and sent the reader to
   * `/add/upload%2F<uuid>` — which matches no route and rendered "That isn't a
   * web address we can fetch". The page the whole upload flow navigates to
   * could not be reloaded, which is most of the reason it has an address.
   *
   * Every unit test passed while that was true, because the rewrite is
   * something main.tsx does rather than something `parseRoute` decides. It took
   * pressing reload in a real browser. See browser-testing.md.
   */
  it("is left alone by the canonicalising rewrite", () => {
    expect(canonicalAddHref(`/add/upload/${ID}`, "", "")).toBeNull();
    expect(canonicalAddHref(`/add/upload/${ID}/`, "", "")).toBeNull();
    /* And an ordinary add address is still canonicalised — a guard that turned
       the rewrite off for everything would pass the two lines above. */
    expect(canonicalAddHref("/add/https://example.com/an-essay", "", "")).not.toBeNull();
  });
});

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
  /**
   * **Two guards now, and each is checked on its own.**
   *
   * This case used to read "`?add=` is read from the query wherever it appears,
   * so the exemption in main.tsx is the only thing standing between a Google
   * return and an ingest of the reader's authorisation code". That sentence
   * stopped being true on 2026-08-30: `?add=` is now read on the **root only**,
   * because reading it anywhere else made `/read/a?add=…` a page the server
   * titled as article *a* and the client turned into an add.
   *
   * So the callback is safe twice over — and the danger of that is a test that
   * passes because the function has gone inert rather than because a guard
   * works. Hence the positive control below: the same query on `/` **is**
   * folded, and does carry the secret, which is what makes the `null` above
   * evidence about the pathname rather than about the query.
   */
  it("is not folded into an add — by the root constraint, and separately by main.tsx", () => {
    /* Not an `/add/` path, so nothing to canonicalise: the path branch cannot
       touch the callback on its own. */
    expect(canonicalAddHref("/auth/callback", "?code=SECRET&state=S", "")).toBeNull();

    /* Guard one, the root constraint. */
    expect(canonicalAddHref("/auth/callback", "?add=https://x.test/a&code=SECRET", "")).toBeNull();

    /* **The control.** The identical query on the root is folded and does carry
       the code, so the two `null`s above are the pathname doing work — not a
       function that has quietly stopped reading `?add=` at all. */
    const onRoot = canonicalAddHref("/", "?add=https://x.test/a&code=SECRET", "");
    expect(onRoot).not.toBeNull();
    expect(onRoot).toContain("SECRET");
  });

  /**
   * **Guard two, and it is now a structural property rather than a habit.**
   *
   * Every pre-mount rewrite lives inside `settleAddress`, so `main.tsx` has
   * exactly **one** place that changes the address and one `onCallback` check in
   * front of it. It used to have four of each, which meant the person adding a
   * fifth rewrite had to remember — and counting the guards, as an earlier
   * version of this test did, would not have noticed an unguarded fifth. GPT Sol
   * made that point on 2026-08-30; the fix is that a fifth rewrite now goes
   * *inside* the guarded function and is exempt by construction.
   *
   * Still partly static, because module-init side effects cannot be called. But
   * what it asserts is a count of rewrite *sites*, which is the thing that was
   * actually hard to keep right.
   */
  it("carries a fragment across the ?slug= rewrite, which the old version dropped", () => {
    /* A deliberate change, made while turning the four rewrites into one
       function: the inline `?slug=` rewrite dropped the fragment and the
       `about=` one beside it kept it, which reads as two rewrites written at
       different times rather than a decision. Only a non-id fragment is
       affected — `liftLegacyAnchor` runs first and turns `#spya-…` into `?at=`. */
    expect(settleAddress("/", "?slug=a-piece", "#section-2")).toBe("/read/a-piece#section-2");
    /* And the id case, to show the ordering: the fragment is consumed, not
       carried, because it means a position rather than a place. */
    expect(settleAddress("/", "?slug=a-piece", "#spya-k3m9qt")).toBe(
      "/read/a-piece?at=spya-k3m9qt",
    );
  });

  it("and main.tsx has exactly one guarded place where the address changes", () => {
    const main = readFileSync(
      path.join(path.resolve(import.meta.dirname, ".."), "src", "web", "main.tsx"),
      "utf8",
    );
    expect(main.match(/history\.replaceState/g) ?? [], "one rewrite site, not four").toHaveLength(1);
    expect(main).toContain("if (!onCallback) {");
    expect(main).toContain("settleAddress(location.pathname, location.search, location.hash)");

    /* And the behavioural half, which the old version had none of.
       `?add=` on the callback is already inert — it is read on the root only —
       so that shape no longer demonstrates anything: */
    expect(settleAddress("/auth/callback", "?add=https://x.test/a&code=SECRET", "")).toBeNull();

    /* **This is the shape that shows the guard still has work.** `about=` is
       stripped on any path, so an unguarded `settleAddress` would rewrite the
       callback's address — and a Google return carries a one-time `code` on it.
       Google sends no `about=`, so this is not a live route; the point is that
       the guard is doing something rather than being a comment, and it must stay
       whatever the other rewrites are constrained to. */
    const rewritten = settleAddress("/auth/callback", "?about=0&code=SECRET", "");
    expect(rewritten, "the guard must have work to do, or it proves nothing").not.toBeNull();
    expect(rewritten).toContain("code=SECRET");
  });});
