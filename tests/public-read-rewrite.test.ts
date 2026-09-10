/**
 * **How a `/read/:slug` request reaches the function, and what it must not
 * drag in with it** — stage 2 slice 1 of docs/plans/260827ai-public-read-only-access.md.
 *
 * Three separate things, in the order a request meets them:
 *
 * 1. **`vercel.json`.** The rewrite has to be *above* the SPA catch-all, and it
 *    has to match the base reading URL only. Ordering in that array is the
 *    whole behaviour and there is no way to see it from inside the code.
 * 2. **`originalUrl`.** It now understands two captures rather than one, and the
 *    interesting cases are the refusals — a caller who can choose which of two
 *    handlers runs is a routing bypass.
 * 3. **`parseRoute`.** The client half of the same address, which used to accept
 *    `/read/Upper` and render an error page.
 *
 * ## Why the config is asserted here rather than commented in the file
 *
 * `vercel.json` is parsed as strict JSON by the platform and cannot carry a
 * comment. So the reasoning lives in a test, which is the better half of the
 * bargain anyway: a comment saying "do not reach for `/read/:path*`" is advice,
 * and the case below that pins `/read/x/metadata` to the catch-all is a
 * consequence somebody has to break on purpose.
 *
 * Deterministic — no network, no deployment. What this file **cannot** prove is
 * that Vercel matches these rules the way the documentation says it does; that
 * is a deployed check, and docs/plans/260828ao-public-read-only-stage2-input-sol.md § 7
 * lists it as one of the three genuinely platform-composition claims.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { decidePublicPage } from "../src/public/page.js";
import { DEFAULT_MODE, MODES } from "../src/modes.js";
import { redirectsToMetadata, viewFor } from "../src/read-address.js";
import { modeParam } from "../src/web/params.js";
import { originalUrl, readMode, readSlug } from "../src/vercel.js";
import { canonicalAddHref, parseRoute, settleAddress } from "../src/web/router.js";

const ROOT = path.resolve(import.meta.dirname, "..");

interface VercelConfig {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const config = JSON.parse(
  readFileSync(path.join(ROOT, "vercel.json"), "utf8"),
) as VercelConfig;

/**
 * **A rewrite source, as the pattern Vercel matches paths against.**
 *
 * Vercel's sources are path-to-regexp: `:name` is one segment, `:name*` is any
 * number of them, and anything else — including the catch-all's negative
 * lookahead — is already a regular expression. Two substitutions and an anchor
 * is the whole of it.
 *
 * The `*` form is replaced first, or `:path*` would become `[^/]+*`. It is here
 * at all because `/read/:path*` is the mistake this file warns about, and a
 * converter that could not express it could not show the warning biting.
 */
function matches(source: string, path: string): boolean {
  const pattern = source.replace(/:[A-Za-z_]\w*\*/g, ".+").replace(/:[A-Za-z_]\w*/g, "[^/]+");
  return new RegExp(`^${pattern}$`).test(path);
}

/** The source of the **first** rewrite that claims a path — Vercel takes that one. */
function routedBy(path: string): string | undefined {
  return config.rewrites.find((r) => matches(r.source, path))?.source;
}

describe("vercel.json's rewrites", () => {
  const sources = () => config.rewrites.map((r) => r.source);

  /**
   * **The read rewrite is first, and the SPA catch-all is last.**
   *
   * Vercel takes the first matching rewrite, and `/((?!api/).*)` matches
   * `/read/anything`. Below it, the new rule is dead — and dead in the way that
   * is hardest to notice, because the page still loads, still renders, and
   * still has the bare word *Spideryarn* in its `<title>` exactly as it did
   * before the feature was built.
   */
  it("sends /read/:slug to the function, ahead of the SPA catch-all", () => {
    const read = config.rewrites.findIndex((r) => r.source === "/read/:slug");
    const spa = config.rewrites.findIndex((r) => r.source === "/((?!api/).*)");
    expect(read, "the /read/:slug rewrite is missing").toBeGreaterThanOrEqual(0);
    expect(spa, "the SPA catch-all is missing").toBeGreaterThanOrEqual(0);
    expect(read).toBeLessThan(spa);
    expect(config.rewrites[read]?.destination).toBe("/api/index?__spy_read=:slug");
  });

  /**
   * **And the API catch-all keeps its own parameter**, which is the other half
   * of why there are two: `__spy_path` always rebuilds `/api/${capture}`.
   */
  it("leaves the /api/ rewrite on its own parameter", () => {
    const api = config.rewrites.find((r) => r.source === "/api/(.*)");
    expect(api?.destination).toBe("/api/index?__spy_path=$1");
  });

  /**
   * **`/read/:slug` and not `/read/:path*`.**
   *
   * The base reading URL only. `/read/:slug/metadata` and `/read/:slug/tweets`
   * are live client routes with their own pages, and a `:path*` source would
   * capture both by accident — the function would then answer them with a shell
   * whose head describes the reading view, or 404 them outright, and nobody
   * would have decided that. GPT Sol's § 10, and this is the assertion that
   * makes the warning bite.
   */
  it("matches the base reading URL only, so the nested views still fall through", () => {
    for (const source of sources()) {
      expect(source, `${source} would capture more than one segment`).not.toMatch(/^\/read\/.*\*/);
    }
    /* Said positively too: nothing in the array claims a nested read path. */
    const nested = config.rewrites.filter(
      (r) => r.source.startsWith("/read/") && r.source !== "/read/:slug",
    );
    expect(nested).toEqual([]);
  });

  /**
   * **Which rewrite each path actually lands on**, run against the patterns in
   * the file rather than against a copy of them.
   *
   * The line this replaced was `expect(/^\/\(\(\?!api\/\)\.\*\)$/.test("/((?!api/).*)"))` —
   * a literal regular expression tested against a literal string, so no mutation
   * of `vercel.json` or of any source file could redden it. GPT Sol's review of
   * slice 1 caught it. Everything below reads `config` from disk.
   *
   * **Mutations, all run against `vercel.json` and put back:** `/read/:slug` to
   * `/read/:path*` — red, the nested views stop falling through. The read
   * rewrite moved below the catch-all — red, the base URL stops reaching the
   * function. The catch-all's `(?!api/)` deleted — red, it swallows `/api/`.
   */
  it("routes the base URL to the function and everything under it to the client", () => {
    expect(routedBy("/read/some-article")).toBe("/read/:slug");
    /* The two nested reading views, and the reason `/read/:path*` is the wrong
       reach: the client owns these pages, and the function would answer them
       with a head describing the reading view or 404 them outright. */
    expect(routedBy("/read/some-article/metadata")).toBe("/((?!api/).*)");
    expect(routedBy("/read/some-article/tweets")).toBe("/((?!api/).*)");
    /* And the ordinary pages, so "falls through" is not just true of `/read/`. */
    expect(routedBy("/library")).toBe("/((?!api/).*)");
    expect(routedBy("/")).toBe("/((?!api/).*)");
    /* The API keeps its own rule, ahead of the catch-all that excludes it. */
    expect(routedBy("/api/library")).toBe("/api/(.*)");
    expect(routedBy("/api/public/article/some-article")).toBe("/api/(.*)");
  });
});

describe("vercel.json's headers", () => {
  /**
   * **Slice 1 changes crawler exposure by exactly nothing.**
   *
   * The site-wide `noindex, nofollow` stays where it is and stays the only one:
   * `src/public/page.ts` sets no `X-Robots-Tag` of its own, and two sources for
   * one header is a duplicate on the wire. Slice 2 splits this rule and moves
   * the decision into the function; until then, this case is what says the
   * feature did not quietly do it early.
   */
  it("still carries one site-wide noindex, which slice 1 must not touch", () => {
    const robots = config.headers.flatMap((h) =>
      h.headers.filter((k) => k.key.toLowerCase() === "x-robots-tag").map((k) => ({
        source: h.source,
        value: k.value,
      })),
    );
    expect(robots).toEqual([{ source: "/(.*)", value: "noindex, nofollow" }]);
  });

  it("and the referrer policy beside it", () => {
    const referrer = config.headers.flatMap((h) =>
      h.headers.filter((k) => k.key.toLowerCase() === "referrer-policy"),
    );
    expect(referrer).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
  });
});

describe("originalUrl and the second capture", () => {
  it("puts a /read/ path back together", () => {
    expect(originalUrl("/api/index?__spy_read=some-article")).toBe("/read/some-article");
  });

  /**
   * The reading view's own state lives in the query string — `?at=`, `?cols=`,
   * `?mode=` — and the client reads all of it. Losing it would land every
   * shared link at the top of the article with the default panel open.
   */
  it("keeps the reader's own query parameters, in order", () => {
    expect(originalUrl("/api/index?__spy_read=some-article&at=spya-k3m9qt&mode=chat")).toBe(
      "/read/some-article?at=spya-k3m9qt&mode=chat",
    );
  });

  /**
   * **Exactly one decode**, for the reason the existing `__spy_path` cases give
   * at length: Vercel encodes the capture once when it substitutes it into a
   * query value, so decoding is the inverse of the platform's own encoding.
   *
   * A second decode is how `%252F` becomes a path separator, so the assertion
   * is written on a value where one decode and two decodes differ visibly.
   */
  it("decodes the capture exactly once", () => {
    expect(originalUrl("/api/index?__spy_read=a%252Fb")).toBe("/read/a%2Fb");
    expect(originalUrl("/api/index?__spy_read=a%25b")).toBe("/read/a%b");
  });

  it("refuses a capture that cannot have come from that encoder", () => {
    expect(originalUrl("/api/index?__spy_read=a%zzb")).toBeNull();
  });

  /**
   * **A repeated parameter is the client choosing**, and it is refused for the
   * `/read/` capture exactly as it always has been for the API one. Both
   * orderings, because which arrives first is Vercel's business.
   */
  it("refuses two __spy_read parameters instead of picking one", () => {
    expect(originalUrl("/api/index?__spy_read=mine&__spy_read=yours")).toBeNull();
    expect(originalUrl("/api/index?__spy_read=yours&__spy_read=mine")).toBeNull();
  });

  /**
   * **And both kinds together, which is the new one.**
   *
   * This is the fault the second parameter creates: a caller who appends
   * `?__spy_read=…` to an `/api/` request — or `?__spy_path=…` to a reading URL
   * — is choosing between two handlers with two entirely different
   * authorization stories. There is no resolution here that is not a guess, and
   * the guess is a routing bypass, so both orderings are `null`.
   */
  it("refuses a __spy_path and a __spy_read together, either way round", () => {
    expect(originalUrl("/api/index?__spy_path=library&__spy_read=some-article")).toBeNull();
    expect(originalUrl("/api/index?__spy_read=some-article&__spy_path=library")).toBeNull();
  });

  /** The old behaviour, unchanged — a control, so the rewrite above is not a rewrite. */
  it("still restores an /api/ path and still leaves an unrewritten URL alone", () => {
    expect(originalUrl("/api/index?__spy_path=jobs%2Fabc%2Fretry")).toBe("/api/jobs/abc/retry");
    expect(originalUrl("/api/index?__spy_path=library&archived=1")).toBe("/api/library?archived=1");
    expect(originalUrl("/api/health")).toBe("/api/health");
  });
});

describe("readSlug, and what a malformed capture is answered with", () => {
  /**
   * **One answer to one question.**
   *
   * `__spy_read=a%2Fb` restores to `/read/a/b`, and under the old
   * `/^\/read\/([^/]+)\/?$/` that missed the reading branch, fell through to
   * `handleApi` and came back a **generic JSON 404** — while `/read/A%20b`, just
   * as malformed, came back the **default shell with a 400**. Two answers to one
   * question, and a stranger could see both. An empty capture did the same.
   * GPT Sol's review of slice 1, finding 3.
   *
   * It is safe to claim everything under `/read/` here because the only way such
   * a path reaches this function is the `__spy_read` rewrite, and vercel.json's
   * source is `/read/:slug` — one segment. The test above pins that at the
   * rewrite level, which is where it is decided; `/read/x/metadata` never
   * arrives, so claiming it here swallows nothing.
   */
  const SHA = "f".repeat(64);

  it("takes the slug out of the base reading URL, and strips one trailing slash", () => {
    expect(readSlug("/read/some-article")).toBe("some-article");
    expect(readSlug("/read/some-article/")).toBe("some-article");
  });

  it("claims nothing that is not under /read/", () => {
    for (const path of ["/api/library", "/read", "/reading/x", "/", "/library"]) {
      expect(readSlug(path), path).toBeNull();
    }
  });

  /**
   * **The three malformed captures, all the way to a status.**
   *
   * `decidePublicPage` rather than a re-implemented `isSlug`: the claim is about
   * what the reader is answered with, and a test that re-derived the slug rule
   * would agree with any version of it.
   */
  it("sends a slash, an empty capture and a trailing slash to the same 400", () => {
    for (const [raw, path, slug] of [
      ["a%2Fb", "/read/a/b", "a/b"],
      ["", "/read/", ""],
      ["a%2Fb%2F", "/read/a/b/", "a/b"],
      ["Upper", "/read/Upper", "Upper"],
    ] as const) {
      const restored = originalUrl(`/api/index?__spy_read=${raw}`);
      expect(restored, raw).toBe(path);
      const got = readSlug(restored ?? "");
      /* Not null — the old regex returned null for the first three, which is
         how they escaped to the JSON 404. This assertion is the one that dies
         if the regex goes back. */
      expect(got, raw).toBe(slug);
      expect(decidePublicPage("GET", got ?? "", null, SHA).status, raw).toBe(400);
    }
  });

  /** And the control: a real slug is not swept up in any of that. */
  it("but a real capture still reaches the reader", () => {
    const restored = originalUrl("/api/index?__spy_read=some-article");
    expect(readSlug(restored ?? "")).toBe("some-article");
    expect(
      decidePublicPage(
        "GET",
        "some-article",
        { kind: "not-shared" },
        SHA,
      ).status,
    ).toBe(404);
  });
});

/**
 * **The mode has to survive the rewrite, because the tab carries it.**
 *
 * `/read/x?mode=glossary` was served as `x · Spideryarn` and then rewritten by
 * React to `x · Glossary · Spideryarn` — the same fault as the whitespace one,
 * on the axis nothing was varying. GPT Sol found it, 2026-08-30.
 *
 * The rewrite preserves the original query beside the `__spy_read` capture
 * (§ *originalUrl and the second capture* above), so the value is here to be
 * read; `readMode` is what reads it.
 */
describe("readMode, and the mode a shared address asked for", () => {
  it("takes it off the restored URL, for every mode there is", () => {
    for (const mode of MODES) {
      expect(readMode(`/read/some-article?mode=${mode}`), mode).toBe(mode);
    }
  });

  it("lands an unknown one on the default rather than failing", () => {
    /* The rule `modeParam` already keeps on the client: a link naming a mode
       this version has not got degrades to the article rather than to an error.

       **`DEFAULT_MODE`, not the literal `"hierarchy"` it was.** `toc` is in this
       list as one unrecognised string among six and nothing more. It used to be
       here as *the* case, because it named the hierarchy until 2026-08-29 and
       old links carrying it survived on this very rule landing them on a default
       that happened to be that view. Moving the default to `plain` on 2026-08-31
       ended that, deliberately — Greg, asked directly: *"I'm not worried about
       breaking urls — we're in alpha and have no users yet."* What is left is
       the rule itself, which is worth keeping and is about the default rather
       than about any particular mode. */
    for (const asked of ["toc", "", "HIERARCHY", "glossary ", "../../etc/passwd", "%zz"]) {
      expect(readMode(`/read/some-article?mode=${asked}`), asked).toBe(DEFAULT_MODE);
    }
  });

  /**
   * **The one mode the server is allowed to disagree with the address about.**
   *
   * `?mode=hierarchy&text=0` is a state the reader cannot get out of since the
   * `Text` pill went (2026-09-05), so the client rewrites it to `?mode=structure`
   * before React mounts (`liftStrandedText` in src/web/router.ts). This has to
   * predict that, or the tab reads Hierarchy and is replaced a second later —
   * the fault src/title-text.ts exists to close, for the eleventh time.
   *
   * Only in Hierarchy, and only for `text=0`: `proseVisible` ignores `showText`
   * in every other mode, so nothing else is stranded and nothing else moves.
   */
  it("moves a stranded Hierarchy address to Structure, as the client is about to", () => {
    expect(readMode("/read/some-article?mode=hierarchy&text=0")).toBe("structure");
    expect(readMode("/read/some-article?text=0&mode=hierarchy")).toBe("structure");
    // Decoded on both halves, the way `isMetadataPair` is, so the client's
    // removal and this decision cannot answer differently.
    expect(readMode("/read/some-article?mode=hierarchy&te%78t=%30")).toBe("structure");
    // And the cases that are not stranded.
    expect(readMode("/read/some-article?mode=hierarchy&text=1")).toBe("hierarchy");
    expect(readMode("/read/some-article?mode=hierarchy")).toBe("hierarchy");
    expect(readMode("/read/some-article?mode=glossary&text=0")).toBe("glossary");
    expect(readMode("/read/some-article?text=0")).toBe(DEFAULT_MODE);
  });

  it("and on the default when the address says nothing about it", () => {
    expect(readMode("/read/some-article")).toBe(DEFAULT_MODE);
    expect(readMode("/read/some-article?at=spya-k3m9qt")).toBe(DEFAULT_MODE);
    /* A stranger controls this string, and a throw here would be a 500 on an
       address that only wanted a tab title. */
    expect(readMode("/read/some-article?%")).toBe(DEFAULT_MODE);
    expect(readMode("")).toBe(DEFAULT_MODE);
  });

  /**
   * **The two predicates, paired on the inputs that are not modes.**
   *
   * `readMode` calls `isMode`; `modeParam.parse` used to call `MODES.includes`
   * separately, so "one place decides what a mode is" was a claim rather than a
   * fact — and every test compared each side against literals instead of
   * against the other. They agreed, but nothing would have noticed if they
   * stopped. GPT Sol, 2026-08-30.
   *
   * The corpus is mostly **junk on purpose**: the nine good values are the case
   * that already passes, and the interesting question is whether two
   * implementations of "not a mode" reject identically.
   */
  it("agrees with the client's own parser about what is not a mode", () => {
    const asked = [
      ...MODES,
      "toc",
      "TOC",
      "Hierarchy",
      "hierarchy ",
      " hierarchy",
      "hierarchy,chat",
      "",
      "0",
      "null",
      "undefined",
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "length",
      "0.5",
      "-1",
      "true",
    ];
    for (const value of asked) {
      const client = modeParam.parse(value) ?? DEFAULT_MODE;
      const server = readMode(`/read/some-article?mode=${encodeURIComponent(value)}`);
      expect(server, `mode=${JSON.stringify(value)}`).toBe(client);
    }
    /* And the control: the corpus really does contain things that are rejected,
       so "they agree" is not the trivial agreement of two functions that accept
       everything. */
    expect(asked.filter((v) => modeParam.parse(v) === null).length).toBeGreaterThan(10);
  });

  it("survives the round trip through the rewrite, which is the only path it has", () => {
    /* Not `readMode` on a URL written by hand: the value has to come through
       `originalUrl`, because that is where a rewrite that dropped the query
       would show up — and a hand-written URL would pass with the query
       discarded. */
    const restored = originalUrl("/api/index?__spy_read=some-article&mode=glossary");
    expect(restored, "the rewrite must preserve the query").toContain("mode=glossary");
    expect(readMode(restored ?? "")).toBe("glossary");
  });
});

/**
 * **The legacy metadata spellings, which reach the composer while the real
 * metadata address never does.**
 *
 * `/read/x/metadata` is two path segments, so vercel.json's `/read/:slug` does
 * not match it and it falls to the SPA catch-all — pinned above. I checked that
 * and concluded the view axis was safe. It is not: `/read/x?about=1` is **one**
 * segment, so it matches, the server composed the *article's* title for it, and
 * `main.tsx` then rewrote the address to `/read/x/metadata` before React drew
 * anything. The tab went `Article · Spideryarn` → `Article · Metadata ·
 * Spideryarn`; with `?mode=glossary` on it, `Article · Glossary · Spideryarn` →
 * `Article · Metadata · Spideryarn`. GPT Sol, 2026-08-30 — the fifth of these,
 * and the second it found after I had reasoned my way past the axis.
 */
describe("viewFor, and the legacy spellings of the metadata page", () => {
  it("recognises the two that redirect, given a query or a whole URL", () => {
    /* Both shapes, because the client passes `location.search` and the server
       passes the restored URL — and the doc-comment claimed only the first while
       production used the second. GPT Sol, 2026-08-30. */
    for (const query of [
      "/read/some-article?about=1",
      "/read/some-article?panel=about",
      "/read/some-article?mode=glossary&about=1",
      "?about=1",
      "?panel=about",
      "?mode=glossary&about=1",
      "?about=1&mode=glossary",
      "?at=spya-k3m9qt&panel=about&cols=0,1",
    ]) {
      expect(viewFor(query), query).toBe("metadata");
      expect(redirectsToMetadata(query), query).toBe(true);
    }
  });

  it("and leaves the article alone for everything else, `about=0` included", () => {
    /* `about=0` meant the panel was shut. It is stripped from the URL and the
       reader stays on the article, so the server must go on composing the
       article's title for it — the one case where "contains about=" and
       "becomes the metadata page" are different answers. */
    for (const query of [
      "/read/some-article",
      "/read/some-article?about=0",
      "/read/some-article?mode=glossary",
      "",
      "?",
      "?about=0",
      "?mode=glossary",
      "?about=2",
      "?aboutx=1",
      "?xabout=1",
      "?panel=notes",
      "?panel=aboutish",
      "?notabout=1",
    ]) {
      expect(viewFor(query), query).toBe("article");
      expect(redirectsToMetadata(query), query).toBe(false);
    }
  });

  it("agrees with the rewrite the client actually performs", () => {
    /* Not a grep for a string any more: `settleAddress` **is** the sequence
       main.tsx runs, so this compares the server's prediction against the
       client's real behaviour rather than against a copy of it. */
    for (const [query, settled] of [
      ["?about=1", "/read/some-article/metadata"],
      ["?panel=about", "/read/some-article/metadata"],
      ["?about=1&mode=glossary", "/read/some-article/metadata?mode=glossary"],
    ] as const) {
      expect(settleAddress("/read/some-article", query, ""), query).toBe(settled);
      expect(viewFor(query), query).toBe("metadata");
    }
    /* And the pair that must NOT move, with the server agreeing. */
    for (const query of ["?about=0", "?mode=glossary", ""]) {
      const after = settleAddress("/read/some-article", query, "");
      expect(after === null || !after.includes("/metadata"), query).toBe(true);
      expect(viewFor(query), query).toBe("article");
    }
  });
});

/**
 * **The two older legacy entrances, which reach the composer the same way.**
 *
 * `/?slug=x` and `/?add=<url>` are addresses from when everything was a
 * parameter on one page (docs/project/url-state.md). Neither was constrained to
 * the root, so both fired on `/read/a?…` — which is **one** path segment, so the
 * server composes article *a*'s title for it and the client then navigates
 * somewhere else entirely: to a different article, or to an add page.
 *
 * Sixth and seventh of these. GPT Sol found both on 2026-08-30, in the third
 * round, after I had twice said the axis was covered. The lesson is the one from
 * the metadata case, and it did not take the first time: **a legacy entrance is
 * a door into a different page that does not look like one**, and enumerating
 * the routes will not find it because it is not a route.
 */
describe("the older legacy entrances, which must not fire under /read/", () => {
  it("leaves ?slug= alone anywhere but the root, so the client cannot swap the article", () => {
    /* Behavioural now that the sequence is a function: the address the server
       titled as article `an-article` must still be that article afterwards. */
    const after = settleAddress("/read/an-article", "?slug=other", "");
    expect(after === null || !after.includes("other"), String(after)).toBe(true);
    /* The control: on the root it still works, so the assertion above is about
       the pathname rather than about a rewrite that has stopped happening. */
    expect(settleAddress("/", "?slug=other", "")).toBe("/read/other");
  });

  it("and reads ?add= on the root only", () => {
    /* The address the server composes an article title for. */
    expect(canonicalAddHref("/read/an-article", "?add=https://example.com/x", "")).toBeNull();
    expect(canonicalAddHref("/read/an-article", "?add=https://example.com/x&at=spya-k3m9qt", "")).toBeNull();
    /* And the control, or the assertions above would pass against a function
       that had stopped reading `?add=` at all: on the root it still works, which
       is the whole feature Greg asked for. */
    expect(canonicalAddHref("/", "?add=https://example.com/x", "")).toBe(
      "/add/https%3A%2F%2Fexample.com%2Fx",
    );
    /* The path form is untouched — `/add/<url>` is canonical wherever it is. */
    expect(canonicalAddHref("/add/https://x.test/a", "?utm=1", "")).not.toBeNull();
  });

  it("while the server goes on composing the article's own title for both", () => {
    /* The other half of the pair: these addresses stay on the reading view, so
       the server's title is right and must not become a Metadata one. */
    for (const query of ["?slug=other", "?add=https://example.com/x"]) {
      expect(viewFor(query), query).toBe("article");
      expect(readMode(`/read/an-article${query}`), query).toBe(DEFAULT_MODE);
    }
  });
});

describe("parseRoute and a malformed slug", () => {
  /**
   * **`/read/Upper` is the 404 page, not an error page.**
   *
   * It used to be an article route: the client asked the API for `Upper`, the
   * API refused it with the 400 it gives every malformed slug, and the reader
   * saw a failure. An address the server can never answer is a mistyped path,
   * and since 2026-09-03 a mistyped path has a page of its own rather than
   * landing quietly on the shelf — docs/plans/260903j-not-found-page.md.
   *
   * **The two sides agree here without consulting each other**, which is the
   * property this case is really pinning: the edge rewrites `/read/:slug` to
   * the serverless function, and `decidePublicPage` answers 400 for exactly
   * these five.
   */
  it("sends anything that is not a slug to the not-found page", () => {
    for (const bad of ["/read/Upper", "/read/has space", "/read/-leading", "/read/a_b", "/read/%20"]) {
      expect(parseRoute(bad), bad).toEqual({ kind: "not-found" });
    }
  });

  /**
   * **And a real slug still reads**, which is the control: an `isSlug` that
   * refused everything would pass the case above and break the whole app.
   */
  it("but a real slug still reads, at all three views", () => {
    expect(parseRoute("/read/noema-mythology-of-conscious-ai")).toEqual({
      kind: "read",
      slug: "noema-mythology-of-conscious-ai",
      view: "article",
    });
    expect(parseRoute("/read/a-slug/metadata")).toEqual({
      kind: "read",
      slug: "a-slug",
      view: "metadata",
    });
    expect(parseRoute("/read/a-slug/tweets")).toEqual({
      kind: "read",
      slug: "a-slug",
      view: "tweets",
    });
  });
});

/**
 * **public/robots.txt, and the one hole in it.**
 *
 * Greg's call, 2026-08-30: name the two preview bots so a shared link draws a
 * card in Meta's apps, and leave the blanket `Disallow: /` standing for
 * everybody else.
 *
 * **What this describe does not do is model a crawler.** It parses the file into
 * groups and asserts what is in them; it makes no claim about how any given
 * robot resolves `Allow` against `Disallow`, because a parser I wrote agreeing
 * with a parser I wrote is worth nothing. The real check is empirical and comes
 * after a deploy: paste a link and look at the card. What these cases are for is
 * the *other* failure — a later edit that drops a line, or adds a bot, without
 * anybody noticing.
 *
 * The one semantic claim here is the one that is easy to get wrong and cheap to
 * check: **a robot obeys exactly one group**, the most specific one naming it,
 * and inherits nothing from `*`. So a named group without its own `Disallow: /`
 * is not a narrow hole, it is an open door — and it would look, in a diff, like
 * the tidier version of this file.
 */
describe("public/robots.txt", () => {
  type Group = { agents: string[]; rules: { rule: string; path: string }[] };

  const groups: Group[] = [];
  {
    const text = readFileSync(path.join(process.cwd(), "public/robots.txt"), "utf8");
    let open: Group | null = null;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/#.*$/, "").trim();
      if (line === "") continue;
      const [key = "", ...rest] = line.split(":");
      const value = rest.join(":").trim();
      const name = key.trim().toLowerCase();
      if (name === "user-agent") {
        /* Consecutive user-agent lines share one group; a rule closes it. */
        if (open === null || open.rules.length > 0) {
          open = { agents: [], rules: [] };
          groups.push(open);
        }
        open.agents.push(value);
      } else if (open !== null) {
        open.rules.push({ rule: name, path: value });
      }
    }
  }

  const groupFor = (agent: string): Group | undefined =>
    groups.find((g) => g.agents.some((a) => a.toLowerCase() === agent.toLowerCase()));

  it("still shuts out everybody who is not named", () => {
    expect(groupFor("*")?.rules).toEqual([{ rule: "disallow", path: "/" }]);
  });

  /* Mutation: drop either name and this reddens; that is the whole point of it,
     because losing a card is silent — the link still works, it just looks like
     nothing. */
  it("names exactly the two preview bots and no others", () => {
    const named = groups.flatMap((g) => g.agents).filter((a) => a !== "*");
    expect(named.sort()).toEqual(["Twitterbot", "facebookexternalhit"]);
  });

  it.each(["facebookexternalhit", "Twitterbot"])(
    "lets %s reach /read/ and nothing else",
    (agent) => {
      const group = groupFor(agent);
      expect(group).toBeDefined();
      /* Both lines, in this order. `Allow` alone would be the open door, and
         `Disallow` alone would be the hole closed again. */
      expect(group?.rules).toEqual([
        { rule: "allow", path: "/read/" },
        { rule: "disallow", path: "/" },
      ]);
    },
  );

  /**
   * **The hole is for cards, not for search**, and this is the pair that says
   * so. Fetching is now permitted for two robots; indexing is refused to all of
   * them, by a header and a meta tag that neither of those two reads for
   * anything. If a later slice wants public articles indexed, it has to defeat
   * both of these deliberately — see docs/project/page-titles.md.
   */
  it("does not, on its own, let anything be indexed", () => {
    const robots = config.headers.flatMap((h) =>
      h.headers.filter((k) => k.key.toLowerCase() === "x-robots-tag").map((k) => k.value),
    );
    expect(robots).toEqual(["noindex, nofollow"]);
  });
});
