/**
 * **How a `/read/:slug` request reaches the function, and what it must not
 * drag in with it** — stage 2 slice 1 of docs/plans/public-read-only-access.md.
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
 * is a deployed check, and docs/plans/public-read-only-stage2-input-sol.md § 7
 * lists it as one of the three genuinely platform-composition claims.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { decidePublicPage } from "../src/public/page.js";
import { originalUrl, readSlug } from "../src/vercel.js";
import { parseRoute } from "../src/web/router.js";

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

describe("parseRoute and a malformed slug", () => {
  /**
   * **`/read/Upper` is the shelf, not an error page.**
   *
   * It used to be an article route: the client asked the API for `Upper`, the
   * API refused it with the 400 it gives every malformed slug, and the reader
   * saw a failure rather than the shelf. This function's own header says a
   * mistyped path lands you on the shelf, and an address the server can never
   * answer is a mistyped path.
   */
  it("sends anything that is not a slug to the library", () => {
    for (const bad of ["/read/Upper", "/read/has space", "/read/-leading", "/read/a_b", "/read/%20"]) {
      expect(parseRoute(bad), bad).toEqual({ kind: "library" });
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
