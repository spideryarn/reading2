/**
 * **The public path is a bare `fetch`, and 404 is an answer.**
 *
 * Two claims, and the first one is the one that would have failed silently. If
 * the public reads went through `apiFetch`, every developer, every test run and
 * every demo would exercise them **with a session in hand** — and the one case
 * the whole feature exists for, a stranger with no account, would be exercised
 * for the first time by a stranger. It would look like it worked right up until
 * it mattered. docs/reusable/silent-success.md.
 *
 * So this checks what actually leaves the browser: no `Authorization`, no
 * cookies, no refresh. The server half is built the same way round —
 * `servePublicApi` is handed `{res, path, method}` and never the request — and
 * these two facts together are what make *"signed in and signed out get
 * identical bytes"* structural rather than a rule somebody remembers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicArticle } from "../src/public-types.js";
import { pathOf, PUBLIC_ROUTE_NAMES } from "../src/public/route-names.js";
import type { PublicLibrary } from "../src/public-library-types.js";
import { loadPublicArticle, loadPublicLibrary, publicFetch } from "../src/web/public-api.js";

/** Every request this file's calls made, exactly as `fetch` saw it. */
const calls: { url: string; init: RequestInit | undefined }[] = [];
/** What the next reply is. Posed by each test. */
let next: () => Response;

beforeEach(() => {
  calls.length = 0;
  next = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(next());
  });
});

afterEach(() => vi.unstubAllGlobals());

const ARTICLE: PublicArticle = {
  meta: { slug: "a-piece", title: "A piece" },
  blocks: [],
  /* Absent, and that is the third state: this article has never been through the
     `assets` step, so the reader hot-links exactly as before. src/assets.ts. */
  assets: undefined,
  comments: [],
  searches: [],
  tree: { version: "t", generator: "t", slug: "a-piece", rootId: "n0", nodes: {} },
};

describe("publicFetch", () => {
  it("sends no Authorization header and no cookies", async () => {
    await publicFetch("/api/public/article/a-piece");

    const [call] = calls;
    expect(call).toBeDefined();
    expect(new Headers(call?.init?.headers).get("Authorization")).toBeNull();
    /* Nothing authenticates by cookie today — Supabase hands out a bearer token
       — but a same-origin `fetch` sends cookies by default, so if one ever
       appeared this call would start carrying it without a line changing. */
    expect(call?.init?.credentials).toBe("omit");
  });

  /**
   * The prefix check, which is `apiFetch`'s narrowed.
   *
   * A path that is not under `/api/public/` reaching this function is a request
   * that meant to carry a token and lost it, and answering it anonymously would
   * be a 401 nobody could explain.
   */
  it("refuses a path outside the public namespace", async () => {
    await expect(publicFetch("/api/article/a-piece")).rejects.toThrow(/public namespace/);
    await expect(publicFetch("https://elsewhere.example/api/public/x")).rejects.toThrow(
      /public namespace/,
    );
    expect(calls).toEqual([]);
  });

  /**
   * **A prefix test is a test on a string, and the browser sends a resolved
   * path.**
   *
   * `/api/public/../article/x` passes `startsWith("/api/public/")` and leaves
   * as `/api/article/x` — the authenticated namespace, asked anonymously, which
   * answers 401 to a caller that believed it was in the closed room. Today's
   * loaders encode their slugs and cannot produce one, so this was a guard
   * weaker than it claimed rather than a live hole. GPT Sol, finding 9.
   */
  it.each([
    "/api/public/../article/a-piece",
    "/api/public/./../article/a-piece",
    "/api/public/foo/../../article/a-piece",
    "//elsewhere.example/api/public/article/a-piece",
    "https://elsewhere.example/api/public/article/a-piece",
  ])("refuses %s, which does not resolve where it looks like it does", async (path) => {
    await expect(publicFetch(path)).rejects.toThrow(/public namespace/);
    expect(calls).toEqual([]);
  });

  /**
   * **And `%2F` is not one of them**, which I had assumed it was.
   *
   * An encoded slash is not a path separator: `URL` leaves it in the pathname,
   * so the path still begins `/api/public/`, and the server agrees — the raw
   * path reaches `isPublicNamespace` unchanged, stays in the closed room, and
   * fails the route patterns there, which answer 404 rather than falling
   * through. It escapes nothing at either end.
   *
   * Kept as a passing case rather than deleted, because "this looks like a
   * traversal and is not" is the kind of thing somebody will otherwise decide
   * to defend against — and rejecting it would refuse a slug that legitimately
   * carries an encoded character.
   */
  it("allows an encoded slash, which is not a path separator", async () => {
    next = () => new Response(JSON.stringify(ARTICLE), { status: 200 });
    await expect(publicFetch("/api/public/article/a%2Fb")).resolves.toBeInstanceOf(Response);
    expect(calls[0]?.url).toBe("/api/public/article/a%2Fb");
  });
});

describe("reading a public endpoint", () => {
  it("returns the body on a 200", async () => {
    next = () =>
      new Response(JSON.stringify(ARTICLE), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const read = await loadPublicArticle("a-piece");

    expect(read).toEqual({ kind: "ok", body: ARTICLE });
    expect(calls[0]?.url).toBe("/api/public/article/a-piece");
  });

  /**
   * **404 is a value, not a throw**, and the whole two-step in App.tsx turns on
   * it: *this document is not shared* has to be told apart from *the request
   * went wrong*, because the first ends at the landing page and the second at
   * an error the reader can act on.
   */
  it("turns a 404 into `not-shared` rather than an error", async () => {
    next = () => new Response(JSON.stringify({ error: "no" }), { status: 404 });

    await expect(loadPublicArticle("a-piece")).resolves.toEqual({ kind: "not-shared" });
  });

  /**
   * And **only** a 404.
   *
   * A 500 rendered as *"this document isn't shared"* would be a page that looks
   * exactly like one that works — and worse, it would send the reader away
   * believing a true thing about the owner that is actually a fact about our
   * server being down.
   */
  it("throws on any other failure, including the store refusing", async () => {
    for (const status of [401, 500, 502]) {
      next = () => new Response(JSON.stringify({ error: "nope" }), { status });
      await expect(loadPublicArticle("a-piece")).rejects.toBeInstanceOf(Error);
    }
    /* 501 is the one the filesystem store answers with, and it must reach the
       reader as an error rather than as a shrug about sharing.
       src/public/routes.ts § requirePostgres. */
    next = () =>
      new Response(JSON.stringify({ error: "Public reading needs Postgres" }), { status: 501 });
    await expect(loadPublicArticle("a-piece")).rejects.toBeInstanceOf(Error);
  });

  /**
   * **The loaders, not just `publicFetch`.**
   *
   * The credentials and header assertions above call `publicFetch` directly, so
   * they say nothing about whether `loadPublicArticle` actually goes through
   * it. Swap it for a bare `fetch(path)` and every one of them stays green
   * while the real client sends cookies. GPT Sol named that mutation by file
   * and line, 2026-08-28.
   *
   * `it.each` over a list of one since `loadPublicMetadata` was deleted with
   * its route on 2026-09-02 — kept as a list because the next public loader
   * has to join it rather than be remembered.
   */
  it.each([
    ["the article", () => loadPublicArticle("a-piece")],
    /* The collection loader joined the list on 2026-09-04 rather than getting a
       copy of the assertion later. It is the one that would be easiest to write
       as a bare `fetch` — there is no slug to encode, so the line looks trivial
       — which is exactly why it belongs here. */
    ["the library", () => loadPublicLibrary()],
  ])("sends no credentials and no Authorization when loading %s", async (_name, load) => {
    next = () => new Response(JSON.stringify(ARTICLE), { status: 200 });
    await load();

    const [call] = calls;
    expect(call).toBeDefined();
    expect(call?.init?.credentials).toBe("omit");
    expect(new Headers(call?.init?.headers).get("Authorization")).toBeNull();
  });

  it("encodes the slug into the path", async () => {
    next = () => new Response(JSON.stringify(ARTICLE), { status: 200 });
    await loadPublicArticle("a b/c");
    expect(calls[0]?.url).toBe("/api/public/article/a%20b%2Fc");
  });
});

/**
 * **The path is a seam, so it is tested from both ends of it.**
 *
 * The assertions above pin what the client *sends*; on their own they would go
 * on passing after a server-side rename, and the only thing left wrong would be
 * the real client. `PUBLIC_ROUTE_NAMES` is the server's own inventory — the
 * dispatcher walks it and the method and spend sweeps drive off it — so asking
 * the client to agree with *that* is what makes a unilateral rename on either
 * side a red test rather than a 404 in a stranger's browser.
 *
 * Added after the server half grew the inventory, 2026-08-28, on the team
 * lead's steer. Before it there were two literal spellings of each path and no
 * line anywhere that said they had to match.
 *
 * ## Why the import is `route-names.js` and is at the top of the file
 *
 * It was `PUBLIC_ROUTES` from `public/routes.js`, dynamically imported inside
 * the test with a note saying it "pulls in the public reader and the store" —
 * a cost stated as a hunch and never measured. It was **776ms**, because the
 * inventory sat in the same module as the `read` functions, which reach
 * `public-reader.ts` → `sanitize.ts` → **jsdom**. With vitest's 5s default and
 * a dozen workers competing, that is not a safe margin, and this test failed in
 * full runs while passing alone — which reads exactly like flakiness and is
 * not.
 *
 * `route-names.ts` is the leaf the server half split out for it: name, pattern
 * and `path()`, importing nothing at all. So the import is static and at the
 * top, where an import belongs, and the seam still has one authoritative
 * spelling. A list of URL shapes had no business importing an HTML sanitiser.
 *
 * **One direction only, deliberately.** Every route the client asks for must be
 * in the inventory; the reverse is not asserted, because slice 1b lands public
 * glossary, summaries, ideas and tweets on the server before the client has
 * loaders for them, and a test that went red for the whole of that would be
 * turned off rather than read.
 */
describe("the client and the server agree about the paths", () => {
  /**
   * The inventory's spellings, both kinds. `pathOf` is what knows that a
   * collection route's `path()` takes nothing — the same helper the server's
   * three sweeps use, so the client asks the question the same way rather than
   * writing its own ternary and its own idea of what a collection is.
   */
  const spelled = new Set(PUBLIC_ROUTE_NAMES.map((r) => pathOf(r, "a-piece")));

  it("asks only for routes the server's own inventory names", async () => {
    /* The inventory does not encode — `path()` is the *spelling*, and encoding
       is the client's own job, which the test above covers. A plain slug is the
       same either way, which is why this one uses one. */
    expect(spelled.size).toBe(PUBLIC_ROUTE_NAMES.length); // no two routes spell alike

    next = () => new Response(JSON.stringify(ARTICLE), { status: 200 });
    calls.length = 0;
    await loadPublicArticle("a-piece");

    expect(calls).toHaveLength(1);
    for (const call of calls) expect(spelled).toContain(call.url);
    // And no loader asks for the same thing twice.
    expect(new Set(calls.map((c) => c.url)).size).toBe(calls.length);
  });

  /**
   * **And the collection loader, whose path is a constant.**
   *
   * A slug loader would show a rename as an obviously wrong URL; this one is a
   * literal string in one file and a `publicCollection("library")` in another,
   * with nothing between them. So the assertion is the exact path, against the
   * inventory — the seam this whole block exists for, at the one route where
   * nothing else would notice it had moved.
   */
  it("and the library loader asks for exactly the collection path the server spells", async () => {
    const shelf: PublicLibrary = { entries: [], truncated: false };
    next = () => new Response(JSON.stringify(shelf), { status: 200 });
    calls.length = 0;
    await loadPublicLibrary();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/public/library");
    expect(spelled).toContain(calls[0]?.url);
    /* The inventory really does hold a slugless route, or the line above is
       comparing against a set that could not have contained this path anyway. */
    expect(PUBLIC_ROUTE_NAMES.some((r) => r.kind === "collection")).toBe(true);
  });
});
